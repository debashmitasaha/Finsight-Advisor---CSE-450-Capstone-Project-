"""Shared vocabulary for the historical scanner."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

HISTORICAL_VERSION = "hist-1.0.0"

# Which layer produced a piece of evidence. Kept separate from the row engine's
# four views so a case can say "two independent layers agree", which is a much
# stronger statement than two rules inside one layer agreeing.
LAYERS = ("aggregate", "changepoint", "collective", "transaction")


@dataclass
class Evidence:
    """One reason a slice of history looks wrong.

    An evidence item is always attached to an entity and a time interval, which is
    what lets the case builder merge items that are talking about the same thing.
    """

    code: str
    layer: str
    entity_type: str
    entity_id: str
    period_start: date
    period_end: date
    strength: float
    message: str
    detail: dict = field(default_factory=dict)
    member_ids: list[str] = field(default_factory=list)
    amount: float = 0.0

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "layer": self.layer,
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "period_start": self.period_start.isoformat(),
            "period_end": self.period_end.isoformat(),
            "strength": round(float(self.strength), 4),
            "message": self.message,
            "detail": self.detail,
            "member_count": len(self.member_ids),
            "amount": round(float(self.amount), 2),
        }


@dataclass
class HistoricalConfig:
    """Every number the scanner uses, in one place, so a scan can be reproduced.

    A scan stores this alongside its results. Two scans that disagree should be
    explainable by their configuration, never by hidden state.
    """

    # --- what to scan
    max_rows: int = 400_000
    """Refuse rather than silently truncate beyond this. A refusal is recoverable;
    a scan that quietly ignored half the ledger is not."""

    # --- feature store
    period_types: tuple[str, ...] = ("month",)
    """Month only by default, and that is a finding rather than a default.

    A weekly entity baseline was tried first and produced forty times more evidence
    than the monthly one, almost all of it noise: a head that receives one payment
    a fortnight has no weekly rhythm to depart from, so ordinary gaps read as
    surges. Weeks stay available for dense ledgers; they are not the default."""
    min_periods_for_baseline: int = 4
    """An entity seen in fewer periods than this has no history to be compared with."""
    min_rows_per_entity: int = 8
    min_rows_per_period: int = 3
    """A period holding fewer rows than this cannot surprise anyone."""

    # --- entity-period outliers
    surge_z: float = 3.5
    """Robust z above which a period's total or count counts as a surge."""
    surge_min_multiple: float = 2.0
    """...and it must also be at least this many times the entity's typical period,
    so a quiet entity with a tiny MAD cannot produce a surge out of noise."""
    share_shift: float = 0.25
    """Absolute change in weekend/round/near-threshold share that counts as a shift."""
    min_rows_for_share: int = 12
    """A share needs a denominator. Three payments in a month, two of them on a
    Saturday, is a 67% weekend share and means nothing; the share tests stay silent
    below this many rows even where the totals tests speak."""

    # --- change points
    changepoint_min_periods: int = 10
    changepoint_penalty: float = 2.5
    """Higher means fewer, more confident breakpoints."""
    changepoint_min_segment: int = 3

    # --- collective patterns
    cluster_window_days: int = 45
    cluster_min_members: int = 6
    cluster_min_multiple: float = 3.0
    """A burst must hold this many times the entity's normal rate for the window."""
    repeat_amount_min: int = 4
    """Identical amounts repeated at least this often inside the window."""
    near_threshold_band: float = 0.10
    near_threshold_min: int = 5

    # --- materiality
    materiality_reference: str = "company_total"
    persistence_days_full: int = 90
    """A pattern lasting this long scores full persistence."""

    # --- ranking
    weights: dict = field(
        default_factory=lambda: {
            "anomaly": 0.34,
            "corroboration": 0.20,
            "materiality": 0.24,
            "persistence": 0.12,
            "novelty": 0.10,
        }
    )
    max_cases: int = 100
    restatement_overlap: float = 0.9
    """Share of a case's rows that must already sit in a higher-ranked case before
    it counts as the same finding restated at another entity level, and is dropped."""

    # --- row-level engine inside the scan
    transaction_layer_max_rows: int = 5_000
    """The four views cost roughly O(rows squared / entities), so on a five-year
    ledger they are the slowest thing here by a wide margin. Above this they are
    skipped and the scan says so, rather than appearing to hang."""

    def to_dict(self) -> dict:
        return {
            "version": HISTORICAL_VERSION,
            "max_rows": self.max_rows,
            "period_types": list(self.period_types),
            "min_periods_for_baseline": self.min_periods_for_baseline,
            "min_rows_per_entity": self.min_rows_per_entity,
            "min_rows_per_period": self.min_rows_per_period,
            "surge_z": self.surge_z,
            "surge_min_multiple": self.surge_min_multiple,
            "share_shift": self.share_shift,
            "min_rows_for_share": self.min_rows_for_share,
            "changepoint_min_periods": self.changepoint_min_periods,
            "changepoint_penalty": self.changepoint_penalty,
            "changepoint_min_segment": self.changepoint_min_segment,
            "cluster_window_days": self.cluster_window_days,
            "cluster_min_members": self.cluster_min_members,
            "cluster_min_multiple": self.cluster_min_multiple,
            "repeat_amount_min": self.repeat_amount_min,
            "near_threshold_band": self.near_threshold_band,
            "near_threshold_min": self.near_threshold_min,
            "persistence_days_full": self.persistence_days_full,
            "weights": dict(self.weights),
            "max_cases": self.max_cases,
            "restatement_overlap": self.restatement_overlap,
            "transaction_layer_max_rows": self.transaction_layer_max_rows,
        }


def ramp(value: float, low: float, high: float) -> float:
    """0 below `low`, 1 at or above `high`, straight line between.

    The same shape the row engine uses, kept identical on purpose so a strength of
    0.6 means the same kind of thing in both layers.
    """
    if high <= low:
        return 1.0 if value >= high else 0.0
    return max(0.0, min(1.0, (value - low) / (high - low)))
