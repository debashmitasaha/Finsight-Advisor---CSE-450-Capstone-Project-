from __future__ import annotations

import os
from dataclasses import dataclass, field


ENGINE_VERSION = "2.1.0"
"""Stamped on every reviewer label and every calibration record.

A threshold chosen from labels is only meaningful against the scoring code that produced
the scores those labels were judged on. Recording the version lets an auditor tell whether
a company's active threshold pre-dates a change to the engine.
"""


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    try:
        return float(raw) if raw not in (None, "") else default
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    try:
        return int(raw) if raw not in (None, "") else default
    except ValueError:
        return default


# How much weight one view's verdict carries on its own, before any corroboration.
#
# These are credibilities, not shares of a budget, and they deliberately do not sum to 1.
# An earlier design used weights summing to 1.0 and it mis-scored badly: a duplicate
# payment under the same invoice reference — about as close to proof as a ledger offers —
# could reach only 30 because the other three views happened to be silent, so the whole
# scale compressed into its bottom half and the top bands were unreachable.
#
# Rule tests rank highest because a hit points at specific rows a human can confirm.
# Relational ranks lowest because unusual structure is suggestive, never conclusive.
DEFAULT_VIEW_CREDIBILITY: dict[str, float] = {
    "rule": 0.85,
    "behavioral": 0.75,
    "temporal": 0.70,
    "relational": 0.60,
}

# Risk bands used by the case report and the UI. These are display bands only: they say how
# a score *reads*, not whether it alerts. Whether a row alerts is decided per company by
# `CalibrationConfig` / `calibration.py` — the bootstrap threshold until that company has
# enough reviewer ground truth, and a validated company-specific threshold after.
#
# The high/medium boundary sits at 60 because that is where the precision-recall curve
# peaked on the reference benchmark ledger (89% recall, 3.4% false-positive rate) — which
# is also why 60 is the bootstrap threshold below. Both numbers come from *reference* data,
# never from the company being scored.
RISK_BANDS: list[tuple[float, str]] = [
    (85.0, "critical"),
    (60.0, "high"),
    (40.0, "medium"),
    (0.0, "low"),
]


@dataclass
class EngineConfig:
    """Tunables for one analysis run.

    Every threshold here is deliberately data-relative (percentiles, ratios against an
    entity's own history) rather than an absolute currency figure, because the amounts in
    a spend ledger span several orders of magnitude between departments.
    """

    # --- entity baselines ---
    min_baseline_events: int = 4
    """Below this many historical rows an entity has no usable baseline, so behavioral
    scoring is skipped for it rather than fabricated from two points."""

    robust_z_soft: float = 3.5
    robust_z_hard: float = 150.0
    """Modified z-score (median/MAD based) at which a row starts and saturates scoring.
    MAD is used instead of standard deviation because a single large fraudulent payment
    inflates the standard deviation enough to hide itself."""

    # --- rule / ACFE view ---
    duplicate_window_days: int = 45
    same_amount_min_repeats: int = 3
    round_number_bases: tuple[int, ...] = (100_000, 10_000, 1_000)
    round_number_min_share: float = 0.35
    approval_thresholds: tuple[float, ...] = ()
    """Organisation approval limits. When empty the engine infers candidate limits from
    clustering of round magnitudes in the data itself."""
    threshold_proximity: float = 0.10
    """A payment landing within this fraction below a limit is 'just below' it."""
    split_window_days: int = 7
    split_min_parts: int = 3

    # --- temporal view ---
    burst_window_days: int = 3
    burst_min_events: int = 4
    burst_baseline_multiple: float = 3.0
    dormancy_days: int = 90
    dormant_amount_multiple: float = 2.0
    month_end_days: int = 3
    velocity_lookback_days: int = 30

    # --- relational view ---
    concentration_share: float = 0.60
    """Share of an account group's spend flowing through a single head before the
    concentration signal fires."""
    rare_pair_max_support: int = 0
    rare_pair_min_expected: float = 1.5
    """A never-seen pairing is only reported when independence would have predicted at
    least this many co-postings. Without it, a sparse ledger makes every pair a 'first'."""
    min_vouchers_for_rarity: int = 60
    min_voucher_lines: int = 2

    # --- data quality guards ---
    degenerate_group_ratio: float = 0.90
    """When grouping produces nearly one group per account head it carries no information
    beyond the head itself, so group-level signals would double-count head-level ones."""

    # --- behavioral view ---
    contamination: float = 0.05
    ensemble_min_rows: int = 30
    random_state: int = 42

    ensemble_max_strength: float = 0.55
    """Ceiling on how strong an ensemble signal can be on its own.

    The ensemble ranks rows, and a ranking always has a top — so on a perfectly clean
    ledger it still nominates whichever row is least typical, which is not evidence of
    anything. Capping it makes the ensemble a corroborator: it can lift a row another view
    has already questioned into the high band, but cannot put one there unaided."""

    view_credibility: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_VIEW_CREDIBILITY))

    # --- fusion ---
    min_view_score: float = 0.20
    """A view scoring below this contributes nothing to the fused total. Without the floor,
    three views each mumbling at 0.1 combine into a respectable-looking score, which is how
    an engine ends up flagging a third of a clean ledger."""

    # --- reporting ---
    min_report_score: float = 60.0
    """Alert cut-off for one run. The router sets this from the company's active threshold
    (see `CalibrationConfig.bootstrap_threshold` and `calibration.active_threshold`); the
    default here only matters for direct library use and for the synthetic benchmark."""
    max_findings: int = 500
    """Cap on how many alerts one response carries. Every scored row is still persisted, so
    the review queue can sample below the threshold; only the returned list is capped."""


@dataclass
class CalibrationConfig:
    """How a company's alert threshold is chosen, and when it is allowed to change.

    The engine scores; this decides where one company's alert line sits. Three states:

    * **bootstrap** — no reviewer labels for this company. Alerts use `bootstrap_threshold`,
      which comes from the reference benchmark and fraud-control practice. F1 is not used
      and the UI must not claim it is.
    * **warmup** — reviewers are labelling alerts and sampled non-alerts. The bootstrap
      threshold stays in force while labels accumulate.
    * **calibrated** — enough labels exist. Candidates are swept on the oldest labels, the
      best-F1 candidate is validated on the newest, and only a candidate that survives
      validation becomes the active threshold. Repeats after every `recalibration_batch`
      new reviews.

    The minimums are starting values, not scientific constants; every one can be overridden
    with a `FORENSIC_*` environment variable so a deployment (or a demo) can tune them
    without touching code.
    """

    bootstrap_threshold: float = _env_float("FORENSIC_BOOTSTRAP_THRESHOLD", 60.0)
    """Cold-start alert threshold for a company with no ground truth of its own."""

    # --- when a company is allowed to calibrate (Phase 7) ---
    min_reviewed_rows: int = _env_int("FORENSIC_MIN_REVIEWED_ROWS", 100)
    min_positive_labels: int = _env_int("FORENSIC_MIN_POSITIVE_LABELS", 20)
    """Confirmed labels. Below this a swept F1 is mostly noise."""
    min_negative_labels: int = _env_int("FORENSIC_MIN_NEGATIVE_LABELS", 50)
    """Cleared labels. Needed so false positives can actually be counted."""

    # --- how a calibration is run (Phases 9-11) ---
    calibration_share: float = 0.70
    """Oldest share of reviewed rows used to *choose* the threshold; the newest remainder is
    held out to *validate* it. Time-ordered on purpose: it mimics deployment, where the
    threshold chosen today is judged by tomorrow's rows."""
    candidate_thresholds: tuple[float, ...] = tuple(float(value) for value in range(20, 90, 5))
    min_validation_positive: int = 3
    min_validation_negative: int = 5
    """A held-out set with fewer labels than this cannot confirm or refute anything."""
    max_validation_drop: float = 0.15
    """A candidate whose F1 falls further than this between calibration and validation
    rows was fitted to noise, and is rejected."""

    # --- recalibration (Phase 15) ---
    recalibration_batch: int = _env_int("FORENSIC_RECALIBRATION_BATCH", 100)
    """New reviews since the last calibration before the next one runs automatically."""

    # --- review sampling below the threshold (Phase 6) ---
    near_miss_share: float = 2.0 / 3.0
    """Fraction of the threshold above which a non-alert counts as a near miss. At the
    bootstrap threshold of 60 this is the 40-59 band from the design note."""
    sample_rate_near: float = 0.25
    sample_rate_low: float = 0.05
    sample_min_near: int = 5
    sample_min_low: int = 5
    priority_score: float = 85.0
    """Alerts at or above this go to the front of the review queue."""


def risk_band(score: float) -> str:
    for floor, label in RISK_BANDS:
        if score >= floor:
            return label
    return "low"
