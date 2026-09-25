"""Groups of ordinary payments that are not ordinary together.

This is the layer that answers the question directly: eighty-three fuel payments
of twenty to forty-five thousand each, spread over three months, where no single
row is remarkable and the group is the whole story.

Three collective patterns, all scoped to one entity and a sliding window:

* a burst, far more payments than that entity's own rate for a window that length;
* a repeat, the same amount paid over and over;
* a near-threshold cluster, many payments sitting just under an approval limit.

Every one of them is time-boxed. The same amount paid every month for five years
is a contract, not a finding, and an unbounded test reports it as one - and hands
the case builder a five-year window in place of the months that actually matter.

Each returns the member transactions, because a case that cannot show its rows is
not worth reviewing.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.forensic_engine.historical.types import Evidence, HistoricalConfig, ramp


def _windows(dates: np.ndarray, window_days: int):
    """Every maximal run of rows that fits inside one sliding window."""
    if dates.size == 0:
        return
    span = np.timedelta64(window_days, "D")
    start = 0
    for end in range(dates.size):
        while dates[end] - dates[start] > span:
            start += 1
        yield start, end + 1


def _dense_spans(dates: np.ndarray, window_days: int, min_count: int) -> list[tuple[int, int]]:
    """Disjoint spans of a selected set that are dense on the window's timescale.

    ``dates`` holds only the selected rows, sorted. Each span returned is at most
    ``window_days`` wide and holds at least ``min_count`` rows, and the spans do
    not overlap.

    Merging overlapping windows instead would chain: a window ending where the next
    begins, over and over, turns a 45-day test into a nine-month claim. Walking
    left to right and taking each full window once keeps the span honest about the
    timescale the test actually examined.
    """
    spans: list[tuple[int, int]] = []
    span = np.timedelta64(window_days, "D")
    start = 0
    size = dates.size
    while start < size:
        end = start
        while end + 1 < size and dates[end + 1] - dates[start] <= span:
            end += 1
        if end - start + 1 >= min_count:
            spans.append((start, end + 1))
            start = end + 1
        else:
            start += 1
    return spans


def detect(frame: pd.DataFrame, config: HistoricalConfig, limits: list[float]) -> list[Evidence]:
    """Collective patterns, per account head and per approved category."""
    if frame.empty:
        return []

    findings: list[Evidence] = []
    columns = [("account_head", "entity_account_head"), ("expense_category", "entity_expense_category")]

    for entity_type, column in columns:
        if column not in frame.columns:
            continue
        subset = frame[frame[column].astype(str).str.len() > 0]
        if subset.empty:
            continue

        for entity_id, block in subset.groupby(column, sort=False):
            if len(block) < config.min_rows_per_entity:
                continue
            block = block.sort_values("transaction_date")
            dates = block["transaction_date"].to_numpy(dtype="datetime64[D]")
            amounts = block["amount"].to_numpy(dtype=float)
            ids = block["transaction_id"].astype(str).to_numpy()

            span_days = max(int((dates[-1] - dates[0]).astype(int)), 1)
            rate = len(block) * config.cluster_window_days / span_days  # expected rows per window

            seen_bursts: list[tuple[int, int]] = []
            for start, end in _windows(dates, config.cluster_window_days):
                size = end - start
                if size < config.cluster_min_members:
                    continue
                if rate > 0 and size / rate < config.cluster_min_multiple:
                    continue
                # Keep the widest burst of any overlapping family, not every prefix of it.
                if seen_bursts and start >= seen_bursts[-1][0] and end <= seen_bursts[-1][1]:
                    continue
                if seen_bursts and start <= seen_bursts[-1][1]:
                    seen_bursts[-1] = (min(seen_bursts[-1][0], start), max(seen_bursts[-1][1], end))
                else:
                    seen_bursts.append((start, end))

            for start, end in seen_bursts:
                size = end - start
                window_amount = float(amounts[start:end].sum())
                multiple = size / rate if rate else float("inf")
                findings.append(
                    Evidence(
                        code="payment_burst",
                        layer="collective",
                        entity_type=entity_type,
                        entity_id=str(entity_id),
                        period_start=pd.Timestamp(dates[start]).date(),
                        period_end=pd.Timestamp(dates[end - 1]).date(),
                        strength=ramp(multiple, config.cluster_min_multiple, config.cluster_min_multiple * 3) * 0.75,
                        message=(
                            f"{size} payments to '{entity_id}' inside {config.cluster_window_days} days, "
                            f"{multiple:.1f}x this head's own rate, totalling {window_amount:,.0f}."
                        ),
                        detail={
                            "members": size,
                            "expected_in_window": round(rate, 2),
                            "multiple": round(multiple, 2) if multiple != float("inf") else None,
                            "window_days": config.cluster_window_days,
                        },
                        member_ids=list(ids[start:end]),
                        amount=window_amount,
                    )
                )

            # Repeated identical amounts, which is what split purchasing and
            # duplicated standing payments both look like from the outside. The
            # repeats have to be concentrated: the same figure paid once a month
            # on a contract is not the same fact as fourteen of them in a fortnight.
            # A repeated amount is only the split-purchasing signature when the amount
            # is a large one for this head. A petty sum paid to the same figure over
            # and over is a standing charge - a cleaning contract, a rent, a monthly
            # subscription - and reporting it buries the reviewer in the ordinary.
            typical = float(np.median(amounts))
            values, counts = np.unique(np.round(amounts, 2), return_counts=True)
            for value, count in zip(values, counts):
                if count < config.repeat_amount_min or value <= 0:
                    continue
                if value < typical:
                    continue
                selected = np.flatnonzero(np.isclose(amounts, value))
                for start, end in _dense_spans(dates[selected], config.cluster_window_days, config.repeat_amount_min):
                    members = selected[start:end]
                    times = int(members.size)
                    member_dates = dates[members]
                    findings.append(
                        Evidence(
                            code="repeated_amount",
                            layer="collective",
                            entity_type=entity_type,
                            entity_id=str(entity_id),
                            period_start=pd.Timestamp(member_dates.min()).date(),
                            period_end=pd.Timestamp(member_dates.max()).date(),
                            strength=ramp(float(times), config.repeat_amount_min, config.repeat_amount_min * 4) * 0.7,
                            message=(
                                f"The exact amount {value:,.0f} was paid to '{entity_id}' {times} times "
                                f"within {config.cluster_window_days} days, totalling {value * times:,.0f}. "
                                f"This head's typical payment is {typical:,.0f}."
                            ),
                            detail={
                                "amount": float(value),
                                "times": times,
                                "times_in_ledger": int(count),
                                "entity_median_amount": round(typical, 2),
                                "window_days": config.cluster_window_days,
                            },
                            member_ids=list(ids[members]),
                            amount=float(value * times),
                        )
                    )

            # Payments hugging an approval limit from below, again inside a window:
            # a limit that has always been approached is a habit; a stretch of weeks
            # where it suddenly is, is an episode.
            for limit in limits:
                mask = (amounts >= limit * (1 - config.near_threshold_band)) & (amounts < limit)
                selected = np.flatnonzero(mask)
                if selected.size < config.near_threshold_min:
                    continue
                for start, end in _dense_spans(dates[selected], config.cluster_window_days, config.near_threshold_min):
                    members = selected[start:end]
                    hits = int(members.size)
                    member_dates = dates[members]
                    # Share is measured against what this entity did over the same
                    # stretch, not against its whole five-year history.
                    lo = int(np.searchsorted(dates, member_dates.min(), side="left"))
                    hi = int(np.searchsorted(dates, member_dates.max(), side="right"))
                    share = hits / max(hi - lo, 1)
                    findings.append(
                        Evidence(
                            code="near_threshold_cluster",
                            layer="collective",
                            entity_type=entity_type,
                            entity_id=str(entity_id),
                            period_start=pd.Timestamp(member_dates.min()).date(),
                            period_end=pd.Timestamp(member_dates.max()).date(),
                            strength=ramp(share, 0.15, 0.6) * 0.8,
                            message=(
                                f"{hits} payments to '{entity_id}' ({share:.0%} of its rows over that stretch) sit "
                                f"within {config.near_threshold_band:.0%} below the {limit:,.0f} approval limit."
                            ),
                            detail={
                                "limit": float(limit),
                                "payments": hits,
                                "share_of_entity_rows": round(share, 3),
                                "band": config.near_threshold_band,
                                "window_days": config.cluster_window_days,
                            },
                            member_ids=list(ids[members]),
                            amount=float(amounts[members].sum()),
                        )
                    )

    return findings
