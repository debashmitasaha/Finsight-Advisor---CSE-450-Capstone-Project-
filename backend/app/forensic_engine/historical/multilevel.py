"""Outliers one level above the transaction.

This is the MODF-inspired layer: instead of asking whether a row is unusual, it
asks whether an account head, an expense category, a group or a department behaved
unusually during a period, judged against what that same entity normally does.

It is what catches the month where fuel spending tripled across eighty ordinary
looking payments, none of which the row engine would ever raise on its own.
"""

from __future__ import annotations

import pandas as pd

from app.forensic_engine.historical.baselines import reference_for
from app.forensic_engine.historical.types import Evidence, HistoricalConfig, ramp

# metric -> (code, sentence, whether a fall is also interesting)
#
# The sentence for a level metric completes "'<entity>' <sentence> <value> in this
# <period>", so it reads as a clause and not as a column heading pasted into prose.
METRIC_TESTS = {
    "total": ("spend_surge", "spent", False),
    "count": ("volume_surge", "made", False),
    "p95": ("large_payment_shift", "paid as much as", False),
    "weekend_share": ("weekend_shift", "share posted at the weekend", True),
    "round_share": ("round_number_shift", "share of suspiciously round amounts", True),
    "near_limit_share": ("near_threshold_shift", "share sitting just under an approval limit", True),
    "concentration": ("concentration_shift", "concentration in a single payment", True),
}

# What the number after the verb is, for the level metrics.
METRIC_UNITS = {
    "total": "",
    "count": " payments",
    "p95": " on its larger payments",
}

SHARE_METRICS = {"weekend_share", "round_share", "near_limit_share", "concentration"}


def _period_end(period_start, period_type: str):
    offset = {"day": pd.Timedelta(days=1), "week": pd.Timedelta(days=7)}.get(period_type)
    if offset is not None:
        return (pd.Timestamp(period_start) + offset - pd.Timedelta(days=1)).date()
    if period_type == "quarter":
        return (pd.Timestamp(period_start) + pd.offsets.QuarterEnd(0)).date()
    return (pd.Timestamp(period_start) + pd.offsets.MonthEnd(0)).date()


def detect(table: pd.DataFrame, config: HistoricalConfig, period_type: str) -> list[Evidence]:
    """Entity-periods that break their own pattern."""
    if table.empty:
        return []

    findings: list[Evidence] = []
    for _, row in table.iterrows():
        if int(row["count"]) < config.min_rows_per_period:
            continue

        for metric, (code, phrase, two_sided) in METRIC_TESTS.items():
            z = float(row.get(f"{metric}_z", 0.0))
            if z < config.surge_z:
                continue

            label, median, mad, n = reference_for(row, metric)
            if n < config.min_periods_for_baseline:
                continue

            value = float(row[metric])
            if metric in SHARE_METRICS:
                # A share needs enough rows underneath it to mean anything at all.
                if int(row["count"]) < config.min_rows_for_share:
                    continue
                # A share moving from 2% to 6% is a large robust z and a small fact.
                if abs(value - median) < config.share_shift:
                    continue
                multiple = 0.0
            else:
                if not two_sided and value <= median:
                    continue
                multiple = value / median if median else float("inf")
                if multiple < config.surge_min_multiple:
                    continue

            strength = ramp(z, config.surge_z, config.surge_z * 3) * 0.9
            if strength <= 0:
                continue

            if metric in SHARE_METRICS:
                message = (
                    f"'{row['entity_id']}' changed its {phrase} to {value:.0%} in this {period_type}, "
                    f"against {median:.0%} across {label}."
                )
            else:
                shown = f"{value:,.0f}" if metric != "count" else f"{int(value)}"
                typical = f"{median:,.0f}" if metric != "count" else f"{int(median)}"
                unit = METRIC_UNITS.get(metric, "")
                message = (
                    f"'{row['entity_id']}' {phrase} {shown}{unit} in this {period_type}, "
                    f"{multiple:.1f}x the {typical} typical of {label}."
                )

            findings.append(
                Evidence(
                    code=code,
                    layer="aggregate",
                    entity_type=str(row["entity_type"]),
                    entity_id=str(row["entity_id"]),
                    period_start=pd.Timestamp(row["period_start"]).date(),
                    period_end=_period_end(row["period_start"], period_type),
                    strength=strength,
                    message=message,
                    detail={
                        "metric": metric,
                        "period_type": period_type,
                        "value": round(value, 4),
                        "baseline_median": round(median, 4),
                        "baseline_mad": round(mad, 4),
                        "baseline_periods": n,
                        "baseline_used": label,
                        "robust_z": round(z, 2),
                        "multiple": round(multiple, 2) if multiple not in (0.0, float("inf")) else None,
                        "period_count": int(row["count"]),
                        "period_total": round(float(row["total"]), 2),
                    },
                    member_ids=list(row["member_ids"]),
                    amount=float(row["total"]),
                )
            )

    return findings
