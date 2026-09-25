"""The multi-resolution feature store.

One pass over the ledger produces, for every entity and every period, the handful
of numbers every later detector needs. Detectors then read these small tables
instead of the raw frame, which is what keeps a five-year scan from re-walking
hundreds of thousands of rows once per test.

The features are deliberately the ones an auditor already reasons about: how much,
how often, how large typically, how concentrated, how much at the weekend, how
much just under a limit, how much in round numbers.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.forensic_engine.features import active_entity_kinds
from app.forensic_engine.historical.types import HistoricalConfig

PERIOD_RULES = {
    "day": "D",
    "week": "W-MON",
    "month": "MS",
    "quarter": "QS",
}

ROUND_BASES = (1000, 5000, 10000, 50000, 100000)


def _period_key(dates: pd.Series, period_type: str) -> pd.Series:
    """The first day of the period each date falls in."""
    if period_type == "day":
        return dates.dt.normalize()
    if period_type == "week":
        return dates.dt.to_period("W-MON").dt.start_time
    if period_type == "quarter":
        return dates.dt.to_period("Q").dt.start_time
    return dates.dt.to_period("M").dt.start_time


def _round_share(amounts: pd.Series) -> float:
    if amounts.empty:
        return 0.0
    hits = np.zeros(len(amounts), dtype=bool)
    values = amounts.to_numpy()
    for base in ROUND_BASES:
        hits |= np.isclose(values % base, 0)
    return float(hits.mean())


def infer_approval_limits(frame: pd.DataFrame) -> list[float]:
    """Round numbers that spending visibly clusters underneath.

    Real approval limits are rarely recorded anywhere the ledger can see, but a
    limit leaves a footprint: a pile of payments just below a round figure and a
    thin band just above it. Only limits with that asymmetry are kept.
    """
    if frame.empty:
        return []
    amounts = frame["amount"].to_numpy()
    limits: list[float] = []
    for candidate in (50_000, 100_000, 200_000, 250_000, 500_000, 1_000_000):
        below = int(((amounts >= candidate * 0.9) & (amounts < candidate)).sum())
        above = int(((amounts >= candidate) & (amounts <= candidate * 1.1)).sum())
        if below >= 8 and below >= 3 * max(above, 1):
            limits.append(float(candidate))
    return limits


def build_aggregates(
    frame: pd.DataFrame,
    config: HistoricalConfig,
    limits: list[float] | None = None,
) -> dict[str, pd.DataFrame]:
    """Entity-period features, one table per period type.

    The returned frames carry one row per (entity_type, entity_id, period_start).
    """
    if frame.empty:
        return {period: pd.DataFrame() for period in config.period_types}

    limits = limits if limits is not None else infer_approval_limits(frame)
    near_limit = np.zeros(len(frame), dtype=bool)
    for limit in limits:
        near_limit |= (frame["amount"] >= limit * (1 - config.near_threshold_band)) & (frame["amount"] < limit)

    work = frame.copy()
    work["_near_limit"] = near_limit
    work["_is_weekend"] = work["is_weekend"].astype(bool)
    work["_is_month_end"] = work["is_month_end"].astype(bool)
    round_hits = np.zeros(len(work), dtype=bool)
    values = work["amount"].to_numpy()
    for base in ROUND_BASES:
        round_hits |= np.isclose(values % base, 0)
    work["_is_round"] = round_hits

    kinds = active_entity_kinds(work)
    # The inferred category is an entity in its own right, alongside the account head
    # rather than instead of it: "Fuel & Energy tripled in July" is the sentence a
    # finance officer acts on, and it survives a company renaming its account heads.
    if "historical_category" in work.columns and work["historical_category"].nunique() > 1:
        kinds = [*kinds, ("historical_category", "historical_category")]
    tables: dict[str, pd.DataFrame] = {}

    for period_type in config.period_types:
        work["_period"] = _period_key(work["transaction_date"], period_type)
        rows = []
        for entity_type, column in kinds:
            grouped = work[work[column].astype(str).str.len() > 0].groupby([column, "_period"], sort=False)
            for (entity_id, period_start), block in grouped:
                amounts = block["amount"]
                median = float(amounts.median())
                rows.append(
                    {
                        "entity_type": entity_type,
                        "entity_id": str(entity_id),
                        "period_type": period_type,
                        "period_start": period_start,
                        "count": int(len(block)),
                        "total": float(amounts.sum()),
                        "median": median,
                        "mad": float((amounts - median).abs().median()),
                        "p95": float(amounts.quantile(0.95)),
                        "maximum": float(amounts.max()),
                        "weekend_share": float(block["_is_weekend"].mean()),
                        "month_end_share": float(block["_is_month_end"].mean()),
                        "round_share": float(block["_is_round"].mean()),
                        "near_limit_share": float(block["_near_limit"].mean()),
                        "distinct_days": int(block["day"].nunique()),
                        # How much of the period's money sits in its single largest
                        # payment. A month whose total tripled because of one invoice
                        # is a different story from one that tripled across 80 rows.
                        "concentration": float(amounts.max() / amounts.sum()) if amounts.sum() else 0.0,
                        "member_ids": list(block["transaction_id"].astype(str)),
                    }
                )
        table = pd.DataFrame(rows)
        if not table.empty:
            table = table.sort_values(["entity_type", "entity_id", "period_start"]).reset_index(drop=True)
        tables[period_type] = table

    return tables


def company_periods(frame: pd.DataFrame, period_type: str = "month") -> pd.DataFrame:
    """The company's own total per period, used as the materiality reference."""
    if frame.empty:
        return pd.DataFrame(columns=["period_start", "total", "count"])
    work = frame.copy()
    work["_period"] = _period_key(work["transaction_date"], period_type)
    grouped = work.groupby("_period")["amount"].agg(["sum", "count"]).reset_index()
    grouped.columns = ["period_start", "total", "count"]
    return grouped.sort_values("period_start").reset_index(drop=True)
