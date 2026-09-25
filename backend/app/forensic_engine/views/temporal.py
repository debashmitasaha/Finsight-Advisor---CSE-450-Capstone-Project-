from __future__ import annotations

import numpy as np
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

    span = pd.Timedelta(days=config.burst_window_days)

    for head, group in frame.groupby("entity_account_head"):
        if len(group) < config.burst_min_events:
            continue
        ordered = group.sort_values("transaction_date").reset_index(drop=True)
        span_days = max((ordered["transaction_date"].max() - ordered["transaction_date"].min()).days, 1)
        typical_per_window = len(ordered) * config.burst_window_days / span_days

        # The rows are sorted, so a window is a contiguous slice and binary search finds
        # its end. Masking the whole head once per row is what made this quadratic.
        dates = ordered["transaction_date"].to_numpy()
        amounts = ordered["amount"].to_numpy(dtype=float)
        ids = ordered["transaction_id"].to_numpy()

        # Window ends never move backwards as the start advances, so a window sits
        # inside an already-reported one exactly when it ends no later.
        last_reported_end = -1

        for start in range(len(ordered)):
            # The window opens at the first row sharing this row's timestamp, not at
            # this row. Ledgers are commonly dated to the day, so several payments carry
            # the same timestamp and they all belong to the same window.
            lo = int(np.searchsorted(dates, dates[start], side="left"))
            end = int(np.searchsorted(dates, dates[start] + span, side="right"))
            events = end - lo
            if events < config.burst_min_events:
                continue
            intensity = events / max(typical_per_window, 0.5)
            if intensity < config.burst_baseline_multiple:
                continue

            if end <= last_reported_end:
                continue
            last_reported_end = end

            strength = ramp(intensity, config.burst_baseline_multiple, config.burst_baseline_multiple * 4)
            window_total = float(amounts[lo:end].sum())
            for transaction_id in ids[lo:end]:
                signals.append(
                    Signal(
                        transaction_id,
                        VIEW,
                        "payment_burst",
                        strength,
                        f"{events} payments to '{head}' inside {config.burst_window_days} day(s), {intensity:.1f}x its usual pace",
                        {
                            "account_head": head,
                            "events_in_window": int(events),
                            "window_days": config.burst_window_days,
                            "expected_in_window": round(typical_per_window, 2),
                            "intensity": round(intensity, 2),
                            "window_total": window_total,
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

        # The trailing window is a contiguous slice of the sorted rows, so its bounds
        # come from binary search and its total from a running sum, rather than from
        # masking the whole head once per row.
        dates = ordered["transaction_date"].to_numpy()
        amounts = ordered["amount"].to_numpy(dtype=float)
        ids = ordered["transaction_id"].to_numpy()
        cumulative = np.concatenate(([0.0], np.cumsum(amounts)))

        for position in range(len(ordered)):
            current = dates[position]
            lo = int(np.searchsorted(dates, current - lookback, side="right"))
            hi = int(np.searchsorted(dates, current, side="right"))
            if hi - lo < 3:
                continue
            window_rate = float(cumulative[hi] - cumulative[lo]) / config.velocity_lookback_days
            ratio = window_rate / overall_rate
            strength = ramp(ratio, 3.0, 12.0) * 0.8
            if strength <= 0:
                continue
            signals.append(
                Signal(
                    ids[position],
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
