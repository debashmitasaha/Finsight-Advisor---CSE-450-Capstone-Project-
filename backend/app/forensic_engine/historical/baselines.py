"""What "normal" means for one entity in one period.

Three baselines, because one is not enough over five years:

* long run, every period the entity has ever had;
* rolling, the twelve periods immediately before this one, which follows a company
  that grew or shrank instead of holding it to a five-year-old average;
* seasonal, the same calendar month in other years, so December is judged against
  other Decembers.

Each is expressed with the median and the MAD rather than the mean and standard
deviation, for the same reason the row engine does: a mean is dragged towards the
very surge we are trying to detect.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

MAD_TO_SIGMA = 1.4826
ROLLING_PERIODS = 12
METRICS = ("total", "count", "p95", "weekend_share", "round_share", "near_limit_share", "concentration")


def robust_z(value: float, median: float, mad: float) -> float:
    """Distance from the middle in robust standard deviations.

    A MAD of zero means the entity has repeated the same figure every period; a
    departure from that is meaningful, so it is reported at a fixed high value
    rather than as infinity or as nothing.
    """
    if mad and mad > 0:
        return abs(value - median) * MAD_TO_SIGMA / mad
    if median and abs(value - median) > 1e-9:
        return 6.0 if abs(value - median) > abs(median) * 0.25 else 0.0
    return 0.0


def _summarise(values: np.ndarray) -> dict[str, float]:
    if values.size == 0:
        return {"median": 0.0, "mad": 0.0, "n": 0}
    median = float(np.median(values))
    return {
        "median": median,
        "mad": float(np.median(np.abs(values - median))),
        "n": int(values.size),
    }


def build_baselines(table: pd.DataFrame) -> pd.DataFrame:
    """Attach, for every entity-period row, what that entity normally looks like.

    Every baseline excludes the period being judged. A period that is compared with
    a median it helped compute is compared with itself, and the surge quietly hides
    inside its own reference.
    """
    if table.empty:
        return table

    enriched = table.copy()
    for metric in METRICS:
        for scope in ("long", "roll", "seas"):
            enriched[f"{metric}_{scope}_median"] = 0.0
            enriched[f"{metric}_{scope}_mad"] = 0.0
            enriched[f"{metric}_{scope}_n"] = 0
        enriched[f"{metric}_z"] = 0.0

    for (_, _), block in enriched.groupby(["entity_type", "entity_id"], sort=False):
        index = block.index.to_numpy()
        months = pd.to_datetime(block["period_start"]).dt.month.to_numpy()

        for metric in METRICS:
            series = block[metric].to_numpy(dtype=float)
            for position, row_index in enumerate(index):
                others = np.delete(series, position)

                long_run = _summarise(others)
                start = max(0, position - ROLLING_PERIODS)
                rolling = _summarise(series[start:position])
                same_month = np.array(
                    [series[other] for other in range(len(series)) if other != position and months[other] == months[position]],
                    dtype=float,
                )
                seasonal = _summarise(same_month)

                for scope, stats in (("long", long_run), ("roll", rolling), ("seas", seasonal)):
                    enriched.at[row_index, f"{metric}_{scope}_median"] = stats["median"]
                    enriched.at[row_index, f"{metric}_{scope}_mad"] = stats["mad"]
                    enriched.at[row_index, f"{metric}_{scope}_n"] = stats["n"]

                # The reference an auditor would reach for: the season if there is
                # enough of it, the recent past if not, the whole history as a last
                # resort.
                if seasonal["n"] >= 2:
                    reference = seasonal
                elif rolling["n"] >= 3:
                    reference = rolling
                else:
                    reference = long_run
                enriched.at[row_index, f"{metric}_z"] = robust_z(
                    float(series[position]), reference["median"], reference["mad"]
                )

    return enriched


def reference_for(row: pd.Series, metric: str) -> tuple[str, float, float, int]:
    """Which baseline was used for this metric, and what it held."""
    if row.get(f"{metric}_seas_n", 0) >= 2:
        scope = "seas"
        label = "the same month in other years"
    elif row.get(f"{metric}_roll_n", 0) >= 3:
        scope = "roll"
        label = "the preceding months"
    else:
        scope = "long"
        label = "this entity's whole history"
    return (
        label,
        float(row.get(f"{metric}_{scope}_median", 0.0)),
        float(row.get(f"{metric}_{scope}_mad", 0.0)),
        int(row.get(f"{metric}_{scope}_n", 0)),
    )
