from __future__ import annotations

from dataclasses import dataclass, field


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

# Risk bands used by the case report and the UI.
# The high/medium boundary is where the measured precision-recall curve peaks, not a
# round number chosen by feel — see `evaluation.sweep_thresholds`, which re-derives it for
# any ledger. On the reference data F1 peaks at 60 (89% recall, 3.4% false-positive rate).
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
    """Default alert cut-off, aligned with the 'high' band floor so the two never disagree
    about what counts as actionable."""
    max_findings: int = 500


def risk_band(score: float) -> str:
    for floor, label in RISK_BANDS:
        if score >= floor:
            return label
    return "low"
