"""Unit tests for company-specific alert threshold calibration.

These cover the decisions in `app/forensic_engine/calibration.py` — when a company is and
is not allowed to calibrate, how a candidate threshold is chosen and validated, and how
the review sample below the threshold is drawn. All pure: no database, no engine run.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.forensic_engine.calibration import (
    LABEL_CLEARED,
    LABEL_CONFIRMED,
    LABEL_UNCERTAIN,
    MODE_BOOTSTRAP,
    MODE_CALIBRATED,
    MODE_WARMUP,
    SOURCE_BOOTSTRAP,
    SOURCE_COMPANY_F1,
    STRATUM_ALERT,
    STRATUM_LOW,
    STRATUM_NEAR,
    STRATUM_PRIORITY,
    LabelledRow,
    active_threshold,
    best_threshold,
    calibrate,
    confusion,
    maturity_mode,
    readiness,
    recalibration_due,
    review_stratum,
    sample_for_review,
    split_by_time,
    sweep,
    usable_rows,
)
from app.forensic_engine.config import CalibrationConfig


def _config(**overrides) -> CalibrationConfig:
    config = CalibrationConfig(
        bootstrap_threshold=60.0,
        min_reviewed_rows=100,
        min_positive_labels=20,
        min_negative_labels=50,
        recalibration_batch=100,
    )
    for key, value in overrides.items():
        setattr(config, key, value)
    return config


START = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _row(index: int, score: float, label: str) -> LabelledRow:
    return LabelledRow(transaction_id=f"T{index:04d}", risk_score=score, label=label, reviewed_at=START + timedelta(hours=index))


def _separable_ledger(positives: int = 30, negatives: int = 90, boundary: float = 50.0) -> list[LabelledRow]:
    """Confirmed rows score above `boundary`, cleared rows below it, with realistic overlap
    near the line so that no threshold is perfect and F1 genuinely peaks.

    Labels are interleaved along the review timeline so that a time-based split leaves
    both kinds on each side, as real review work would."""
    confirmed = [min(boundary + 5 + (i % 9) * 5 - (3 if i % 7 == 0 else 0), 99.0) for i in range(positives)]
    cleared = [max(boundary - 5 - (i % 10) * 4 + (8 if i % 11 == 0 else 0), 1.0) for i in range(negatives)]

    per_positive = max(negatives // max(positives, 1), 1)
    ordered: list[tuple[float, str]] = []
    while confirmed or cleared:
        if confirmed:
            ordered.append((confirmed.pop(0), LABEL_CONFIRMED))
        for _ in range(per_positive):
            if cleared:
                ordered.append((cleared.pop(0), LABEL_CLEARED))
    return [_row(index, score, label) for index, (score, label) in enumerate(ordered)]


# ----------------------------------------------------------------------------- metrics


def test_uncertain_labels_never_enter_the_metrics():
    rows = [_row(0, 90, LABEL_CONFIRMED), _row(1, 90, LABEL_UNCERTAIN), _row(2, 10, LABEL_CLEARED)]
    assert len(usable_rows(rows)) == 2
    table = confusion(usable_rows(rows), 60)
    assert table["rows"] == 2
    assert table["true_positives"] == 1 and table["true_negatives"] == 1


def test_confusion_counts_every_quadrant():
    rows = [
        _row(0, 80, LABEL_CONFIRMED),  # tp
        _row(1, 30, LABEL_CONFIRMED),  # fn
        _row(2, 70, LABEL_CLEARED),  # fp
        _row(3, 20, LABEL_CLEARED),  # tn
    ]
    table = confusion(rows, 60)
    assert (table["true_positives"], table["false_negatives"], table["false_positives"], table["true_negatives"]) == (1, 1, 1, 1)
    assert table["precision"] == pytest.approx(0.5)
    assert table["recall"] == pytest.approx(0.5)
    assert table["f1"] == pytest.approx(0.5)
    assert table["false_positive_rate"] == pytest.approx(0.5)
    assert table["alerts"] == 2


def test_confusion_has_no_division_by_zero_on_empty_or_one_sided_sets():
    assert confusion([], 60)["f1"] == 0.0
    only_cleared = [_row(0, 10, LABEL_CLEARED)]
    table = confusion(only_cleared, 60)
    assert table["precision"] == 0.0 and table["recall"] == 0.0 and table["false_positive_rate"] == 0.0


def test_best_threshold_breaks_ties_towards_the_current_threshold():
    """Several candidates share the top F1: the line should not move further than the
    labels justify."""
    curve = [
        {"threshold": 40.0, "f1": 0.7},
        {"threshold": 50.0, "f1": 0.7},
        {"threshold": 60.0, "f1": 0.6},
    ]
    assert best_threshold(curve, current=60.0) == 50.0
    assert best_threshold(curve, current=40.0) == 40.0
    # Equidistant ties go to the higher threshold (fewer alerts for the same F1).
    assert best_threshold(curve, current=45.0) == 50.0


def test_best_threshold_keeps_the_current_line_when_it_is_among_the_best():
    curve = [{"threshold": float(t), "f1": 1.0} for t in range(25, 80, 5)]
    assert best_threshold(curve, current=60.0) == 60.0


def test_best_threshold_falls_back_when_there_is_no_curve():
    assert best_threshold([], current=60.0) == 60.0


def test_split_is_by_time_oldest_first():
    rows = [_row(i, 50, LABEL_CLEARED) for i in range(10)]
    calibration, validation = split_by_time(rows, 0.7)
    assert len(calibration) == 7 and len(validation) == 3
    assert max(row.reviewed_at for row in calibration) < min(row.reviewed_at for row in validation)


def test_split_always_keeps_a_row_on_each_side_when_possible():
    rows = [_row(0, 50, LABEL_CLEARED), _row(1, 50, LABEL_CONFIRMED)]
    calibration, validation = split_by_time(rows, 0.99)
    assert len(calibration) == 1 and len(validation) == 1


def test_split_keeps_both_labels_on_both_sides_when_alerts_were_reviewed_first():
    """Reviewers clear the alert list first and work the samples later, so every confirmed
    row is older than every cleared row. A single time cut would leave validation with no
    positives; the per-label cut must not."""
    rows = [_row(i, 80, LABEL_CONFIRMED) for i in range(20)] + [_row(20 + i, 10, LABEL_CLEARED) for i in range(60)]
    calibration, validation = split_by_time(rows, 0.7)
    assert sum(1 for row in validation if row.label == LABEL_CONFIRMED) == 6
    assert sum(1 for row in validation if row.label == LABEL_CLEARED) == 18
    assert len(calibration) == 14 + 42
    # Within each label the validation rows are still the newest ones.
    newest_confirmed_in_calibration = max(row.reviewed_at for row in calibration if row.label == LABEL_CONFIRMED)
    oldest_confirmed_in_validation = min(row.reviewed_at for row in validation if row.label == LABEL_CONFIRMED)
    assert newest_confirmed_in_calibration < oldest_confirmed_in_validation


# --------------------------------------------------------------------------- readiness


def test_readiness_requires_all_three_minimums():
    config = _config()
    assert readiness(100, 20, 50, config)["ready"]
    assert not readiness(99, 20, 50, config)["ready"]
    assert not readiness(100, 19, 50, config)["ready"]
    assert not readiness(100, 20, 49, config)["ready"]


def test_readiness_reports_each_check_for_the_ui():
    checks = readiness(46, 8, 34, _config())["checks"]
    by_code = {check["code"]: check for check in checks}
    assert by_code["reviewed"]["actual"] == 46 and by_code["reviewed"]["required"] == 100
    assert not by_code["confirmed"]["passed"]


def test_maturity_states():
    assert maturity_mode(0, False) == MODE_BOOTSTRAP
    assert maturity_mode(1, False) == MODE_WARMUP
    assert maturity_mode(500, False) == MODE_WARMUP  # ready is not the same as calibrated
    assert maturity_mode(500, True) == MODE_CALIBRATED


def test_only_a_calibrated_company_gets_its_own_threshold():
    config = _config()
    assert active_threshold(MODE_BOOTSTRAP, None, config) == (60.0, SOURCE_BOOTSTRAP)
    assert active_threshold(MODE_WARMUP, None, config) == (60.0, SOURCE_BOOTSTRAP)
    # A stored value without calibrated mode must not leak through.
    assert active_threshold(MODE_WARMUP, 48.0, config) == (60.0, SOURCE_BOOTSTRAP)
    assert active_threshold(MODE_CALIBRATED, 48.0, config) == (48.0, SOURCE_COMPANY_F1)


def test_recalibration_triggers_first_on_readiness_then_per_batch():
    config = _config()
    assert not recalibration_due(reviews_since_last=500, ever_calibrated=False, ready=False, config=config)
    assert recalibration_due(reviews_since_last=0, ever_calibrated=False, ready=True, config=config)
    assert not recalibration_due(reviews_since_last=99, ever_calibrated=True, ready=True, config=config)
    assert recalibration_due(reviews_since_last=100, ever_calibrated=True, ready=True, config=config)


# ------------------------------------------------------------------------- calibration


def test_calibration_refuses_below_the_minimums_and_keeps_the_current_threshold():
    rows = _separable_ledger(positives=10, negatives=20)
    outcome = calibrate(rows, current_threshold=60.0, config=_config())
    assert not outcome.ready
    assert outcome.candidate_threshold is None
    assert not outcome.activated
    assert "Not enough company ground truth" in outcome.reason
    assert outcome.readiness["ready"] is False


def test_calibration_picks_the_f1_peak_and_validates_on_held_out_rows():
    rows = _separable_ledger(positives=30, negatives=90, boundary=50.0)
    outcome = calibrate(rows, current_threshold=60.0, config=_config())

    assert outcome.ready
    assert outcome.candidate_threshold is not None
    assert outcome.calibration_rows + outcome.validation_rows == len(rows)
    assert outcome.calibration_rows == round(len(rows) * 0.7)

    # The candidate is the best-F1 point of the sweep over the calibration rows.
    best = max(outcome.sweep, key=lambda point: (round(point["f1"], 6), point["threshold"]))
    assert outcome.candidate_threshold == best["threshold"]
    assert outcome.calibration_metrics["threshold"] == outcome.candidate_threshold
    assert outcome.validation_metrics["threshold"] == outcome.candidate_threshold
    assert outcome.current_validation_metrics["threshold"] == 60.0
    assert {check.code for check in outcome.checks} == {"validation_labels", "no_regression", "holds_up"}


def test_a_separable_ledger_activates_a_company_threshold_near_its_boundary():
    rows = _separable_ledger(positives=30, negatives=90, boundary=50.0)
    outcome = calibrate(rows, current_threshold=60.0, config=_config())
    assert outcome.activated, outcome.reason
    assert 40.0 <= outcome.candidate_threshold <= 60.0
    assert "active alert threshold" in outcome.reason


def test_candidate_is_rejected_when_the_held_out_set_is_too_small():
    rows = _separable_ledger(positives=30, negatives=90)
    config = _config(min_validation_positive=1000)
    outcome = calibrate(rows, current_threshold=60.0, config=config)
    assert outcome.ready and not outcome.activated
    failed = [check for check in outcome.checks if not check.passed]
    assert failed and failed[0].code == "validation_labels"
    assert "stays in force" in outcome.reason


def test_candidate_is_rejected_when_it_would_be_worse_than_the_current_threshold():
    """Calibration rows say one thing, held-out rows say another: keep what works."""
    rows: list[LabelledRow] = []
    index = 0
    # Oldest 70%: fraud clusters at 45-55, so the sweep will pick ~45.
    for _ in range(25):
        rows.append(_row(index, 50.0, LABEL_CONFIRMED))
        index += 1
    for _ in range(60):
        rows.append(_row(index, 20.0, LABEL_CLEARED))
        index += 1
    # Newest 30%: behaviour shifted — legitimate rows now sit at 50, fraud at 90.
    for _ in range(10):
        rows.append(_row(index, 90.0, LABEL_CONFIRMED))
        index += 1
    for _ in range(26):
        rows.append(_row(index, 50.0, LABEL_CLEARED))
        index += 1

    outcome = calibrate(rows, current_threshold=60.0, config=_config())
    assert outcome.ready
    assert outcome.candidate_threshold < 60.0
    assert not outcome.activated
    codes = {check.code: check.passed for check in outcome.checks}
    assert codes["no_regression"] is False
    assert outcome.current_validation_metrics["f1"] > outcome.validation_metrics["f1"]


def test_calibration_never_sees_uncertain_rows_but_counts_them_as_reviewed():
    rows = _separable_ledger(positives=30, negatives=90)
    rows += [_row(1000 + i, 55.0, LABEL_UNCERTAIN) for i in range(30)]
    outcome = calibrate(rows, current_threshold=60.0, config=_config())
    assert outcome.reviewed_count == len(rows)
    assert outcome.positive_count == 30 and outcome.negative_count == 90
    assert outcome.calibration_rows + outcome.validation_rows == 120


# ---------------------------------------------------------------- review sampling


def test_strata_follow_the_company_threshold_not_a_fixed_band():
    config = _config()
    assert review_stratum(90, 60, config) == STRATUM_PRIORITY
    assert review_stratum(60, 60, config) == STRATUM_ALERT
    assert review_stratum(59.9, 60, config) == STRATUM_NEAR
    assert review_stratum(40, 60, config) == STRATUM_NEAR
    assert review_stratum(39.9, 60, config) == STRATUM_LOW
    # With a calibrated threshold of 45 the near-miss band moves down with it.
    assert review_stratum(45, 45, config) == STRATUM_ALERT
    assert review_stratum(31, 45, config) == STRATUM_NEAR
    assert review_stratum(29, 45, config) == STRATUM_LOW


def test_every_alert_is_queued_and_non_alerts_are_sampled():
    config = _config()
    candidates = [(f"A{i}", 70.0) for i in range(10)] + [(f"N{i}", 45.0) for i in range(100)] + [(f"L{i}", 5.0) for i in range(200)]
    selected, summary = sample_for_review(candidates, 60.0, config, seed="run-1")

    by_stratum: dict[str, list[dict]] = {}
    for item in selected:
        by_stratum.setdefault(item["stratum"], []).append(item)

    assert len(by_stratum[STRATUM_ALERT]) == 10
    assert summary[STRATUM_ALERT]["sampled"] == summary[STRATUM_ALERT]["population"] == 10
    assert len(by_stratum[STRATUM_NEAR]) == round(100 * config.sample_rate_near)
    assert len(by_stratum[STRATUM_LOW]) == round(200 * config.sample_rate_low)
    assert summary[STRATUM_LOW]["population"] == 200


def test_sampling_is_stable_for_a_run_and_changes_with_the_run():
    config = _config()
    candidates = [(f"L{i}", float(i % 30)) for i in range(300)]
    first, _ = sample_for_review(candidates, 60.0, config, seed="run-1")
    again, _ = sample_for_review(candidates, 60.0, config, seed="run-1")
    other, _ = sample_for_review(candidates, 60.0, config, seed="run-2")
    ids = lambda items: [item["transaction_id"] for item in items]  # noqa: E731
    assert ids(first) == ids(again)
    assert ids(first) != ids(other)


def test_small_strata_still_get_a_minimum_sample():
    config = _config()
    candidates = [(f"L{i}", 5.0) for i in range(8)]  # 5% of 8 rounds to 0
    selected, summary = sample_for_review(candidates, 60.0, config, seed="run-1")
    assert len(selected) == min(config.sample_min_low, 8)
    assert summary[STRATUM_LOW]["sampled"] == 5


def test_sweep_covers_every_candidate_threshold():
    config = _config()
    rows = _separable_ledger()
    curve = sweep(rows, config.candidate_thresholds)
    assert [point["threshold"] for point in curve] == list(config.candidate_thresholds)
