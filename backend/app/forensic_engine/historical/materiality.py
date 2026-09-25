"""Audit context on top of statistical strangeness.

A perfectly strange payment of 100 taka should not outrank a persistent pattern
worth 50 million. Materiality does not change whether the statistical pattern is
real; it changes where the pattern sits in the reviewer's queue.

Three context scores, each between 0 and 1:

* materiality, the money involved against what this company normally spends;
* persistence, how long the pattern ran, because a single odd month is a smaller
  question than one that never went back;
* novelty, whether this entity is new to the ledger, since a first-time account
  head has no history to have departed from.
"""

from __future__ import annotations

import math

import pandas as pd

from app.forensic_engine.historical.types import HistoricalConfig, ramp


def company_scale(company_months: pd.DataFrame) -> float:
    """A typical month of company spending, used as the materiality yardstick."""
    if company_months.empty:
        return 0.0
    return float(company_months["total"].median())


def materiality_score(amount: float, monthly_scale: float) -> float:
    """How much of a normal month this case is worth.

    Logarithmic on purpose: the difference between 1% and 10% of a month matters
    far more than the difference between 300% and 310%.
    """
    if monthly_scale <= 0 or amount <= 0:
        return 0.0
    ratio = amount / monthly_scale
    return ramp(math.log10(ratio + 0.01) + 2, 0.5, 3.0)


def persistence_score(start: pd.Timestamp | None, end: pd.Timestamp | None, config: HistoricalConfig) -> float:
    if start is None or end is None:
        return 0.0
    days = max((pd.Timestamp(end) - pd.Timestamp(start)).days, 0)
    return ramp(float(days), 7.0, float(config.persistence_days_full))


def novelty_score(entity_id: str, first_seen: dict[str, pd.Timestamp], case_start: pd.Timestamp, ledger_start: pd.Timestamp) -> float:
    """1 when the entity appears for the first time inside the case window.

    An account head that has existed for four years and suddenly changes is a
    different story from one that did not exist last month.
    """
    seen = first_seen.get(entity_id)
    if seen is None or ledger_start is None:
        return 0.0
    age_days = max((pd.Timestamp(case_start) - pd.Timestamp(seen)).days, 0)
    ledger_days = max((pd.Timestamp(case_start) - pd.Timestamp(ledger_start)).days, 1)
    if ledger_days < 90:
        return 0.0
    # Brand new inside the case window scores 1; a year of prior history scores 0.
    return 1.0 - ramp(float(age_days), 0.0, 365.0)


def first_seen_map(frame: pd.DataFrame, column: str) -> dict[str, pd.Timestamp]:
    if frame.empty or column not in frame.columns:
        return {}
    grouped = frame.groupby(column)["transaction_date"].min()
    return {str(key): value for key, value in grouped.items()}
