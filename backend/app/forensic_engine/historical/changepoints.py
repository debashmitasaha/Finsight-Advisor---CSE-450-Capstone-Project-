"""When did this entity's behaviour change, and by how much?

Five years is long enough that an entity's "normal" is often not one thing. A
department that doubled its spending in March 2024 and stayed there has no single
baseline; comparing every month to a five-year median would flag the whole second
half of the history and explain none of it.

A change point locates the moment instead. It is not evidence of fraud on its own,
which the code says in as many words: it is evidence that something changed, with a
date attached, which is exactly what an auditor needs to start asking questions.

Implemented with binary segmentation over a least-squares cost, penalised by
segment count. `ruptures` implements PELT for the same cost; it is not a
dependency here, and for the few dozen periods one entity has, exact PELT and
binary segmentation agree in practice.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.forensic_engine.historical.types import Evidence, HistoricalConfig, ramp


def _cost(segment: np.ndarray) -> float:
    """Sum of squared deviations from the segment's own mean."""
    if segment.size == 0:
        return 0.0
    return float(((segment - segment.mean()) ** 2).sum())


def find_change_points(series: np.ndarray, penalty: float, min_segment: int) -> list[int]:
    """Indices where the level of `series` shifts, best split first.

    Greedy binary segmentation: repeatedly take the split that reduces total cost
    the most, and stop when the best remaining split no longer pays for itself.
    """
    if series.size < 2 * min_segment:
        return []

    # Scale the penalty so it means the same thing for a series measured in taka
    # and one measured as a share. The spread has to be robust: using the variance
    # let a single large spike inflate the threshold that was supposed to detect
    # it, and the change point went unreported on exactly the series that needed it.
    deviations = np.abs(series - np.median(series))
    spread = float(np.median(deviations)) * 1.4826
    if spread <= 0:
        spread = float(np.mean(deviations)) or 1.0
    threshold = penalty * (spread**2) * min_segment

    points: list[int] = []
    segments = [(0, series.size)]

    while segments:
        start, end = segments.pop()
        block = series[start:end]
        if block.size < 2 * min_segment:
            continue

        base = _cost(block)
        best_gain = 0.0
        best_at = -1
        for offset in range(min_segment, block.size - min_segment + 1):
            gain = base - _cost(block[:offset]) - _cost(block[offset:])
            if gain > best_gain:
                best_gain = gain
                best_at = offset

        if best_at > 0 and best_gain > threshold:
            cut = start + best_at
            points.append(cut)
            segments.append((start, cut))
            segments.append((cut, end))

    return sorted(points)


def detect(table: pd.DataFrame, config: HistoricalConfig, period_type: str = "month") -> list[Evidence]:
    """A breakpoint per entity whose monthly spend changed level."""
    if table.empty:
        return []

    findings: list[Evidence] = []
    for (entity_type, entity_id), block in table.groupby(["entity_type", "entity_id"], sort=False):
        block = block.sort_values("period_start")
        if len(block) < config.changepoint_min_periods:
            continue

        totals = block["total"].to_numpy(dtype=float)
        periods = pd.to_datetime(block["period_start"]).tolist()
        members = list(block["member_ids"])

        cuts = find_change_points(totals, config.changepoint_penalty, config.changepoint_min_segment)
        # Each break is judged against the segment on either side of it, not against
        # the whole history before and after. A three-month spike that returns to
        # normal has two breaks, and comparing the first one with everything that
        # follows averaged the spike away with the recovery and reported nothing.
        bounds = [0, *cuts, totals.size]
        for position, cut in enumerate(cuts):
            before = totals[bounds[position] : cut]
            after = totals[cut : bounds[position + 2]]
            if before.size < config.changepoint_min_segment or after.size < config.changepoint_min_segment:
                continue

            before_level = float(np.median(before))
            after_level = float(np.median(after))
            if before_level <= 0 and after_level <= 0:
                continue

            multiple = after_level / before_level if before_level > 0 else float("inf")
            # Only report a shift big enough to be worth a conversation.
            if 0.5 < multiple < 2.0:
                continue

            direction = "rose" if after_level > before_level else "fell"
            strength = ramp(abs(np.log2(max(multiple, 1e-6))), 1.0, 3.0) * 0.8
            if strength <= 0:
                continue

            # The case should hold the rows on the new side of the break, which is
            # the behaviour anyone would want to look at.
            segment_end = bounds[position + 2]
            member_ids = [tid for group in members[cut:segment_end] for tid in group]
            amount = float(after.sum())

            findings.append(
                Evidence(
                    code="regime_change",
                    layer="changepoint",
                    entity_type=str(entity_type),
                    entity_id=str(entity_id),
                    period_start=periods[cut].date(),
                    # The break is the event. Letting the window run to the end of a
                    # long steady segment stretched a three-month episode into a
                    # two-year case and swallowed everything that happened after it.
                    period_end=min(
                        periods[min(segment_end, len(periods)) - 1],
                        periods[cut] + pd.Timedelta(days=92),
                    ).date(),
                    strength=strength,
                    message=(
                        f"'{entity_id}' spending {direction} sharply from {periods[cut].date().isoformat()}: "
                        f"{before_level:,.0f} per {period_type} before, {after_level:,.0f} after, and it stayed there "
                        f"for {len(after)} {period_type}s."
                    ),
                    detail={
                        "period_type": period_type,
                        "change_at": periods[cut].date().isoformat(),
                        "before_median": round(before_level, 2),
                        "after_median": round(after_level, 2),
                        "multiple": round(multiple, 2) if multiple != float("inf") else None,
                        "periods_before": int(before.size),
                        "periods_after": int(after.size),
                        "note": "A change point says behaviour shifted on a date. It is a lead, not a finding.",
                    },
                    member_ids=member_ids,
                    amount=amount,
                )
            )

    return findings
