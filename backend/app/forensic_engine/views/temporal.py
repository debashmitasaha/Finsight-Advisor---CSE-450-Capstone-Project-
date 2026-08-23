from __future__ import annotations

import pandas as pd

from app.forensic_engine.config import EngineConfig
from app.forensic_engine.features import EntityBaseline
from app.forensic_engine.signals import Signal, ramp


VIEW = "temporal"


def run(
    frame: pd.DataFrame,
    baselines: dict[str, dict[str, EntityBaseline]],
    config: EngineConfig,
) -> tuple[list[Signal], dict]:
    """Patterns that only exist across rows, never inside one.

    Four payments of 98,000 against a 100,000 limit are each unremarkable on their own
    line. Read as a sequence they are the signature of a split. Every test in this view
    exists because the fraud is in the arrangement, not the amount.
    """
    signals: list[Signal] = []
    positive = frame[frame["amount"] > 0]
    if positive.empty:
        return signals, {"rows_tested": 0}

    signals += _payment_bursts(positive, config)
    signals += _dormant_reactivation(positive, baselines, config)
    signals += _off_cycle_activity(positive, config)
    signals += _velocity_spikes(positive, config)

    return signals, {
        "rows_tested": int(len(positive)),
        "ledger_span_days": int((positive["transaction_date"].max() - positive["transaction_date"].min()).days),
    }


def _payment_bursts(frame: pd.DataFrame, config: EngineConfig) -> list[Signal]:
    """A cluster of payments to one head far denser than that head's own rhythm."""
    signals: list[Signal] = []

    reported: set[frozenset] = set()

    for head, group in frame.groupby("entity_account_head"):
        if len(group) < config.burst_min_events:
            continue
        ordered = group.sort_values("transaction_date").reset_index(drop=True)
        span_days = max((ordered["transaction_date"].max() - ordered["transaction_date"].min()).days, 1)
        typical_per_window = len(ordered) * config.burst_window_days / span_days

        for start in range(len(ordered)):
            window_end = ordered.at[start, "transaction_date"] + pd.Timedelta(days=config.burst_window_days)
            window = ordered[
                (ordered["transaction_date"] >= ordered.at[start, "transaction_date"])
                & (ordered["transaction_date"] <= window_end)
            ]
            if len(window) < config.burst_min_events:
                continue
            intensity = len(window) / max(typical_per_window, 0.5)
            if intensity < config.burst_baseline_multiple:
                continue

            key = frozenset(window["transaction_id"])
            if key in reported or any(key <= seen for seen in reported):
                continue
            reported.add(key)

            strength = ramp(intensity, config.burst_baseline_multiple, config.burst_baseline_multiple * 4)
            for transaction_id in window["transaction_id"]:
                signals.append(
                    Signal(
                        transaction_id,
                        VIEW,
                        "payment_burst",
                        strength,
                        f"{len(window)} payments to '{head}' inside {config.burst_window_days} day(s), {intensity:.1f}x its usual pace",
                        {
                            "account_head": head,
                            "events_in_window": int(len(window)),
                            "window_days": config.burst_window_days,
                            "expected_in_window": round(typical_per_window, 2),
                            "intensity": round(intensity, 2),
                            "window_total": float(window["amount"].sum()),
                        },
                    )
                )
    return signals


def _dormant_reactivation(
    frame: pd.DataFrame,
    baselines: dict[str, dict[str, EntityBaseline]],
    config: EngineConfig,
) -> list[Signal]:
    """A head that went quiet for months and returns with an unusually large payment."""
    signals: list[Signal] = []
    head_baselines = baselines.get("account_head", {})

    ordered = frame.sort_values("transaction_date").copy()
    ordered["gap_days"] = ordered.groupby("entity_account_head")["transaction_date"].diff().dt.days

    for row in ordered.itertuples():
        gap = row.gap_days
        if pd.isna(gap) or gap < config.dormancy_days:
            continue
        baseline = head_baselines.get(row.entity_account_head)
        if baseline is None or baseline.median <= 0:
            continue
        multiple = row.amount / baseline.median
        if multiple < config.dormant_amount_multiple:
            continue

        strength = min(0.9, ramp(gap, config.dormancy_days, 365) * 0.5 + ramp(multiple, config.dormant_amount_multiple, 10) * 0.5)
        signals.append(
            Signal(
                row.transaction_id,
                VIEW,
                "dormant_reactivation",
                strength,
                f"'{row.entity_account_head}' was dormant {int(gap)} days, then took {row.amount:,.2f} ({multiple:.1f}x its median)",
                {
                    "account_head": row.entity_account_head,
                    "dormant_days": int(gap),
                    "amount": float(row.amount),
                    "entity_median": round(baseline.median, 2),
                    "multiple_of_median": round(multiple, 2),
                },
            )
        )
    return signals


def _off_cycle_activity(frame: pd.DataFrame, config: EngineConfig) -> list[Signal]:
    """Weekend and month-end concentration.

    Only meaningful when the ledger is otherwise a weekday ledger, so the baseline rate is
    measured first and rows are scored against it rather than against an assumption.
    """
    signals: list[Signal] = []
    weekend_rate = float(frame["is_weekend"].mean())
    if weekend_rate >= 0.25 or weekend_rate == 0:
        # Either the organisation genuinely operates at weekends, or nothing to say.
        return signals

    p90 = float(frame["amount"].quantile(0.90))
    for row in frame[frame["is_weekend"]].itertuples():
        size_factor = ramp(row.amount / max(p90, 1.0), 0.5, 3.0)
        strength = (1.0 - weekend_rate) * (0.3 + 0.5 * size_factor)
        signals.append(
            Signal(
                row.transaction_id,
                VIEW,
                "weekend_payment",
                min(strength, 0.75),
                f"Weekend payment of {row.amount:,.2f} where only {weekend_rate:.1%} of the ledger falls at weekends",
                {
                    "amount": float(row.amount),
                    "weekday": int(row.weekday),
                    "ledger_weekend_rate": round(weekend_rate, 4),
                    "ledger_p90": round(p90, 2),
                },
            )
        )
    return signals


def _velocity_spikes(frame: pd.DataFrame, config: EngineConfig) -> list[Signal]:
    """Spend rate for a head jumping against its own trailing rate."""
    signals: list[Signal] = []
    lookback = pd.Timedelta(days=config.velocity_lookback_days)

    for head, group in frame.groupby("entity_account_head"):
        if len(group) < 6:
            continue
        ordered = group.sort_values("transaction_date").reset_index(drop=True)
        span_days = max((ordered["transaction_date"].max() - ordered["transaction_date"].min()).days, 1)
        overall_rate = float(ordered["amount"].sum()) / span_days

        if overall_rate <= 0:
            continue

        for position in range(len(ordered)):
            current = ordered.at[position, "transaction_date"]
            window = ordered[(ordered["transaction_date"] > current - lookback) & (ordered["transaction_date"] <= current)]
            if len(window) < 3:
                continue
            window_rate = float(window["amount"].sum()) / config.velocity_lookback_days
            ratio = window_rate / overall_rate
            strength = ramp(ratio, 3.0, 12.0) * 0.8
            if strength <= 0:
                continue
            signals.append(
                Signal(
                    ordered.at[position, "transaction_id"],
                    VIEW,
                    "spending_velocity_spike",
                    strength,
                    f"'{head}' burned {window_rate:,.0f}/day over {config.velocity_lookback_days} days against a {overall_rate:,.0f}/day norm",
                    {
                        "account_head": head,
                        "window_days": config.velocity_lookback_days,
                        "window_daily_rate": round(window_rate, 2),
                        "baseline_daily_rate": round(overall_rate, 2),
                        "ratio": round(ratio, 2),
                    },
                )
            )
    return signals
