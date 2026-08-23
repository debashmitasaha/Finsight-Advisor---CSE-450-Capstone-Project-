from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from app.forensic_engine.config import EngineConfig


# Columns the engine will use as an "entity" when the ledger carries them. The first four
# are always derivable from the current upload pipeline; vendor/employee/approver light up
# automatically the day those columns exist in the source spreadsheet.
ENTITY_COLUMNS: tuple[tuple[str, str], ...] = (
    ("account_head", "entity_account_head"),
    ("account_group", "entity_account_group"),
    ("vendor", "entity_vendor"),
    ("employee", "entity_employee"),
    ("approver", "entity_approver"),
)

MAD_TO_SIGMA = 1.4826
"""Scaling that makes the median absolute deviation comparable to a standard deviation
for normally distributed data, so `robust_z` reads on the familiar sigma scale."""


@dataclass
class EntityBaseline:
    kind: str
    key: str
    count: int
    median: float
    mad: float
    p95: float
    total: float
    first_seen: pd.Timestamp
    last_seen: pd.Timestamp
    round_share: float

    def robust_z(self, amount: float) -> float:
        """How far this amount sits from the entity's own typical payment.

        Uses median/MAD rather than mean/std on purpose: the mean and standard deviation
        are dragged towards a large fraudulent payment by that very payment, which is how
        an outlier ends up hiding inside its own cohort statistics.
        """
        if self.mad > 0:
            return abs(amount - self.median) * MAD_TO_SIGMA / self.mad
        if self.median > 0:
            # Degenerate cohort: every historical amount identical. Any deviation at all
            # is meaningful, so fall back to a ratio against the median.
            return abs(amount - self.median) / self.median
        return 0.0


def is_round(amount: float, base: int) -> bool:
    return amount > 0 and float(amount) % base == 0


def round_number_share(amounts: pd.Series, bases: tuple[int, ...]) -> float:
    if amounts.empty:
        return 0.0
    biggest = max(bases)
    return float((amounts % biggest == 0).mean())


def build_frame(transactions: list) -> pd.DataFrame:
    """Flatten ORM transactions into the analysis frame every view consumes."""
    rows = []
    for txn in transactions:
        amount = float(txn.amount or 0)
        rows.append(
            {
                "transaction_id": txn.transaction_id,
                "department_id": txn.department_id,
                "transaction_date": pd.to_datetime(txn.transaction_date).tz_localize(None)
                if pd.to_datetime(txn.transaction_date).tzinfo
                else pd.to_datetime(txn.transaction_date),
                "amount": amount,
                "transaction_type": (getattr(txn, "transaction_type", None) or "debit").lower(),
                "description": txn.description or "",
                "chart_acc_head": txn.chart_acc_head or "",
                "entity_account_head": (txn.cleaned_chart_acc_head or txn.chart_acc_head or "unmapped").strip().lower(),
                "entity_account_group": (txn.group_name or "ungrouped").strip().lower(),
                "entity_vendor": _optional(txn, "vendor_name"),
                "entity_employee": _optional(txn, "created_by_name"),
                "entity_approver": _optional(txn, "approver_name"),
                "invoice_id": (txn.invoice_id or "").strip(),
                "po_number": (txn.po_number or "").strip(),
                "payment_method": txn.payment_method or "",
            }
        )

    frame = pd.DataFrame(rows)
    if frame.empty:
        return frame

    frame = frame.sort_values("transaction_date").reset_index(drop=True)
    frame["day"] = frame["transaction_date"].dt.normalize()
    frame["weekday"] = frame["transaction_date"].dt.weekday
    frame["is_weekend"] = frame["weekday"] >= 5
    frame["month"] = frame["transaction_date"].dt.to_period("M").astype(str)
    frame["days_in_month"] = frame["transaction_date"].dt.days_in_month
    frame["day_of_month"] = frame["transaction_date"].dt.day
    frame["is_month_end"] = (frame["days_in_month"] - frame["day_of_month"]) < 3
    return frame


def _optional(txn, attribute: str) -> str:
    value = getattr(txn, attribute, None)
    return str(value).strip().lower() if value else ""


def active_entity_kinds(frame: pd.DataFrame) -> list[tuple[str, str]]:
    """Only report on entity kinds the data actually populates.

    Keeps the engine honest on ledgers that have no vendor or approver columns instead of
    emitting empty vendor findings.
    """
    active = []
    for kind, column in ENTITY_COLUMNS:
        if column in frame.columns and frame[column].astype(str).str.len().gt(0).any():
            if frame[column].nunique() > 1:
                active.append((kind, column))
    return active


def build_baselines(frame: pd.DataFrame, config: EngineConfig) -> dict[str, dict[str, EntityBaseline]]:
    """Profile every entity over its whole history.

    This is the core departure from a per-month cohort: a month of one account head holds
    two or three rows, which is too few for any statistic to fire, whereas the same head
    across three years holds enough to describe what "normal" looks like for it.
    """
    baselines: dict[str, dict[str, EntityBaseline]] = {}
    positive = frame[frame["amount"] > 0]

    for kind, column in active_entity_kinds(frame):
        per_kind: dict[str, EntityBaseline] = {}
        for key, group in positive.groupby(column):
            if not key:
                continue
            amounts = group["amount"]
            median = float(amounts.median())
            mad = float((amounts - median).abs().median())
            per_kind[str(key)] = EntityBaseline(
                kind=kind,
                key=str(key),
                count=int(len(group)),
                median=median,
                mad=mad,
                p95=float(amounts.quantile(0.95)),
                total=float(amounts.sum()),
                first_seen=group["transaction_date"].min(),
                last_seen=group["transaction_date"].max(),
                round_share=round_number_share(amounts, config.round_number_bases),
            )
        baselines[kind] = per_kind
    return baselines


def infer_approval_thresholds(frame: pd.DataFrame, config: EngineConfig) -> list[float]:
    """Guess the organisation's approval limits when they were not supplied.

    Real limits are round numbers, and payments cluster just underneath them. So we look
    for round magnitudes that have a conspicuous pile-up in the 10% band below them and a
    thin band above — the signature of people steering under a control.
    """
    if config.approval_thresholds:
        return list(config.approval_thresholds)

    amounts = frame.loc[frame["amount"] > 0, "amount"]
    if len(amounts) < 20:
        return []

    candidates: list[float] = []
    ceiling = float(amounts.quantile(0.99))
    for base in (1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 500_000, 1_000_000):
        for multiple in (1, 2, 5):
            limit = float(base * multiple)
            if limit > ceiling or limit < float(amounts.median()):
                continue
            below = int(((amounts >= limit * (1 - config.threshold_proximity)) & (amounts < limit)).sum())
            above = int(((amounts >= limit) & (amounts < limit * (1 + config.threshold_proximity))).sum())
            if below >= 3 and below >= 2 * max(above, 1):
                candidates.append(limit)

    return sorted(set(candidates))[:4]


def ensemble_feature_matrix(frame: pd.DataFrame, baselines: dict[str, dict[str, EntityBaseline]]) -> tuple[np.ndarray, list[str]]:
    """Per-transaction features for the unsupervised ensemble.

    Everything here is either scale-free or expressed relative to the row's own entity, so
    a department spending in millions and one spending in thousands produce comparable
    feature vectors.
    """
    head_baselines = baselines.get("account_head", {})
    group_baselines = baselines.get("account_group", {})

    log_amount = np.log1p(frame["amount"].clip(lower=0).to_numpy(dtype=float))

    head_z = np.array(
        [
            head_baselines[key].robust_z(amount) if key in head_baselines else 0.0
            for key, amount in zip(frame["entity_account_head"], frame["amount"])
        ],
        dtype=float,
    )
    group_z = np.array(
        [
            group_baselines[key].robust_z(amount) if key in group_baselines else 0.0
            for key, amount in zip(frame["entity_account_group"], frame["amount"])
        ],
        dtype=float,
    )
    head_ratio = np.array(
        [
            amount / head_baselines[key].median
            if key in head_baselines and head_baselines[key].median > 0
            else 1.0
            for key, amount in zip(frame["entity_account_head"], frame["amount"])
        ],
        dtype=float,
    )

    gap_days = frame.groupby("entity_account_head")["transaction_date"].diff().dt.days.fillna(0).to_numpy(dtype=float)
    head_frequency = frame.groupby("entity_account_head")["transaction_id"].transform("count").to_numpy(dtype=float)

    matrix = np.column_stack(
        [
            log_amount,
            np.clip(head_z, 0, 25),
            np.clip(group_z, 0, 25),
            np.log1p(np.clip(head_ratio, 0, 500)),
            np.clip(gap_days, 0, 400),
            np.log1p(head_frequency),
            frame["is_weekend"].to_numpy(dtype=float),
            frame["is_month_end"].to_numpy(dtype=float),
            np.array([1.0 if is_round(a, 10_000) else 0.0 for a in frame["amount"]], dtype=float),
        ]
    )
    names = [
        "log_amount",
        "head_robust_z",
        "group_robust_z",
        "log_head_ratio",
        "days_since_prev_in_head",
        "log_head_frequency",
        "is_weekend",
        "is_month_end",
        "is_round_10k",
    ]
    return np.nan_to_num(matrix, nan=0.0, posinf=0.0, neginf=0.0), names
