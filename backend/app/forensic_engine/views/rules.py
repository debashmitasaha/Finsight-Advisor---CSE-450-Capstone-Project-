from __future__ import annotations

import pandas as pd

from app.forensic_engine.config import EngineConfig
from app.forensic_engine.features import EntityBaseline, infer_approval_thresholds, is_round
from app.forensic_engine.signals import Signal, ramp


VIEW = "rule"


def run(
    frame: pd.DataFrame,
    baselines: dict[str, dict[str, EntityBaseline]],
    config: EngineConfig,
) -> tuple[list[Signal], dict]:
    """ACFE-style control tests.

    These are the checks a human auditor runs first. They carry no statistics, which makes
    them the most defensible part of the engine: every hit points at a specific pair or
    run of rows a reviewer can pull up and confirm.
    """
    signals: list[Signal] = []
    positive = frame[frame["amount"] > 0]
    thresholds = infer_approval_thresholds(frame, config)

    signals += _duplicate_payments(positive, config)
    signals += _repeated_amounts(positive, config)
    signals += _threshold_avoidance(positive, thresholds, config)
    signals += _split_purchases(positive, thresholds, config)
    signals += _round_number_abuse(positive, baselines, config)

    meta = {
        "inferred_approval_thresholds": thresholds,
        "rows_tested": int(len(positive)),
    }
    return signals, meta


def _duplicate_payments(frame: pd.DataFrame, config: EngineConfig) -> list[Signal]:
    """Same account head, same amount, close together — the classic double-payment."""
    signals: list[Signal] = []
    if frame.empty:
        return signals

    for (head, amount), group in frame.groupby(["entity_account_head", "amount"]):
        if len(group) < 2:
            continue
        ordered = group.sort_values("transaction_date")
        dates = ordered["transaction_date"].tolist()
        ids = ordered["transaction_id"].tolist()
        invoices = ordered["invoice_id"].tolist()

        for index in range(1, len(ordered)):
            gap = (dates[index] - dates[index - 1]).days
            if gap > config.duplicate_window_days:
                continue
            same_invoice = bool(invoices[index]) and invoices[index] == invoices[index - 1]
            # A repeat under the same invoice number is near-conclusive; the same amount
            # under different references is suggestive but can be a genuine instalment.
            strength = 0.95 if same_invoice else ramp(config.duplicate_window_days - gap, 0, config.duplicate_window_days) * 0.7 + 0.2
            detail = {
                "account_head": head,
                "amount": float(amount),
                "days_apart": int(gap),
                "paired_transaction_id": ids[index - 1],
                "invoice_id": invoices[index] or None,
                "same_invoice_reference": same_invoice,
            }
            message = (
                f"Identical payment of {amount:,.2f} to '{head}' repeated after {gap} day(s)"
                + (" under the same invoice reference" if same_invoice else "")
            )
            signals.append(Signal(ids[index], VIEW, "duplicate_payment", strength, message, detail))
    return signals


def _repeated_amounts(frame: pd.DataFrame, config: EngineConfig) -> list[Signal]:
    """The exact same figure recurring far more often than a real price would."""
    signals: list[Signal] = []
    if frame.empty:
        return signals

    counts = frame.groupby(["entity_account_head", "amount"])["transaction_id"].transform("count")
    repeated = frame[counts >= config.same_amount_min_repeats]

    for (head, amount), group in repeated.groupby(["entity_account_head", "amount"]):
        span_days = max((group["transaction_date"].max() - group["transaction_date"].min()).days, 1)
        # Recurring rent or salary is legitimate; the tell is many repeats in a short span.
        density = len(group) / (span_days / 30.0 + 1.0)
        strength = ramp(density, 1.5, 6.0)
        if strength <= 0:
            continue
        for transaction_id in group["transaction_id"]:
            signals.append(
                Signal(
                    transaction_id,
                    VIEW,
                    "repeated_identical_amount",
                    strength,
                    f"Amount {amount:,.2f} recurs {len(group)}x for '{head}' within {span_days} day(s)",
                    {
                        "account_head": head,
                        "amount": float(amount),
                        "occurrences": int(len(group)),
                        "span_days": int(span_days),
                        "per_month": round(density, 2),
                    },
                )
            )
    return signals


def _threshold_avoidance(frame: pd.DataFrame, thresholds: list[float], config: EngineConfig) -> list[Signal]:
    """Payments parked just under an approval limit."""
    signals: list[Signal] = []
    if not thresholds or frame.empty:
        return signals

    for limit in thresholds:
        floor = limit * (1 - config.threshold_proximity)
        band = frame[(frame["amount"] >= floor) & (frame["amount"] < limit)]
        for row in band.itertuples():
            closeness = (row.amount - floor) / (limit - floor) if limit > floor else 1.0
            signals.append(
                Signal(
                    row.transaction_id,
                    VIEW,
                    "below_approval_threshold",
                    0.35 + 0.45 * closeness,
                    f"Payment of {row.amount:,.2f} sits {(limit - row.amount):,.2f} below the {limit:,.0f} approval limit",
                    {
                        "amount": float(row.amount),
                        "threshold": float(limit),
                        "shortfall": float(limit - row.amount),
                        "shortfall_pct": round(100.0 * (limit - row.amount) / limit, 2),
                    },
                )
            )
    return signals


def _split_purchases(frame: pd.DataFrame, thresholds: list[float], config: EngineConfig) -> list[Signal]:
    """One purchase chopped into several below-limit slices within a few days."""
    signals: list[Signal] = []
    if frame.empty:
        return signals

    limit = min(thresholds) if thresholds else None
    reported: set[frozenset] = set()

    for head, group in frame.groupby("entity_account_head"):
        if len(group) < config.split_min_parts:
            continue
        ordered = group.sort_values("transaction_date").reset_index(drop=True)

        # Every window is examined, not just the first that qualifies: a head can be
        # split-purchased more than once across a multi-year ledger, and stopping at the
        # earliest occurrence silently hides every later one.
        for start in range(len(ordered)):
            window_end = ordered.at[start, "transaction_date"] + pd.Timedelta(days=config.split_window_days)
            window = ordered[
                (ordered["transaction_date"] >= ordered.at[start, "transaction_date"])
                & (ordered["transaction_date"] <= window_end)
            ]
            if len(window) < config.split_min_parts:
                continue

            total = float(window["amount"].sum())
            largest = float(window["amount"].max())
            if limit is not None and not (largest < limit <= total):
                # Only interesting when the parts stay under a limit the total would breach.
                continue
            if limit is None and largest <= 0:
                continue

            key = frozenset(window["transaction_id"])
            if key in reported or any(key <= seen for seen in reported):
                continue
            reported.add(key)

            spread = float(window["amount"].std() / window["amount"].mean()) if window["amount"].mean() else 1.0
            # Genuine instalments vary; deliberate slicing produces suspiciously even parts.
            evenness = max(0.0, 1.0 - spread)
            strength = min(0.9, 0.35 + 0.35 * evenness + 0.1 * (len(window) - config.split_min_parts))
            for transaction_id in window["transaction_id"]:
                signals.append(
                    Signal(
                        transaction_id,
                        VIEW,
                        "split_purchase",
                        strength,
                        f"{len(window)} payments to '{head}' totalling {total:,.2f} within {config.split_window_days} day(s), each individually below limit",
                        {
                            "account_head": head,
                            "parts": int(len(window)),
                            "window_days": config.split_window_days,
                            "combined_amount": total,
                            "largest_part": largest,
                            "approval_limit": limit,
                            "part_evenness": round(evenness, 3),
                        },
                    )
                )
    return signals


def _round_number_abuse(
    frame: pd.DataFrame,
    baselines: dict[str, dict[str, EntityBaseline]],
    config: EngineConfig,
) -> list[Signal]:
    """Suspiciously round figures where the head normally produces invoiced amounts."""
    signals: list[Signal] = []
    head_baselines = baselines.get("account_head", {})
    biggest_base = max(config.round_number_bases)

    for row in frame.itertuples():
        if not is_round(row.amount, biggest_base):
            continue
        baseline = head_baselines.get(row.entity_account_head)
        if baseline is None or baseline.count < config.min_baseline_events:
            continue
        if baseline.round_share >= config.round_number_min_share:
            # This head is round by nature (rent, fixed fees) — not evidence.
            continue
        strength = ramp(1.0 - baseline.round_share, 0.6, 1.0) * 0.6
        if strength <= 0:
            continue
        signals.append(
            Signal(
                row.transaction_id,
                VIEW,
                "round_amount_outlier",
                strength,
                f"Round amount {row.amount:,.0f} where only {baseline.round_share:.0%} of '{row.entity_account_head}' payments are round",
                {
                    "amount": float(row.amount),
                    "round_base": biggest_base,
                    "head_round_share": round(baseline.round_share, 3),
                    "head_events": baseline.count,
                },
            )
        )
    return signals
