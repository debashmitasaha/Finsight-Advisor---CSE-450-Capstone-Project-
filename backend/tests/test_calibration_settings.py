"""Runtime calibration settings: per-company overrides that need no restart.

Pure tests on the settings helpers in `calibration.py`; the router stores the overrides
on `company_forensic_config.calibration_overrides` and resolves them per request.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.forensic_engine import calibration as cal
from app.forensic_engine.config import CalibrationConfig


BASE = CalibrationConfig()


def _rows(confirmed: int, cleared: int, uncertain: int = 0) -> list[cal.LabelledRow]:
    """Confirmed rows first (high scores), then cleared (low), then uncertain — the order a
    reviewer working the queue actually produces."""
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    rows: list[cal.LabelledRow] = []
    tick = 0
    for index in range(confirmed):
        rows.append(cal.LabelledRow(f"c{index}", 70 + (index % 5) * 5, cal.LABEL_CONFIRMED, start + timedelta(minutes=tick)))
        tick += 1
    for index in range(cleared):
        rows.append(cal.LabelledRow(f"n{index}", 10 + (index % 5) * 8, cal.LABEL_CLEARED, start + timedelta(minutes=tick)))
        tick += 1
    for index in range(uncertain):
        rows.append(cal.LabelledRow(f"u{index}", 50, cal.LABEL_UNCERTAIN, start + timedelta(minutes=tick)))
        tick += 1
    return rows


def test_no_overrides_returns_the_base_config_untouched():
    assert cal.with_overrides(BASE, None) is BASE
    assert cal.with_overrides(BASE, {}) is BASE


def test_overrides_change_only_the_knobs_not_the_method():
    cfg = cal.with_overrides(
        BASE,
        {"min_reviewed_rows": 30, "min_positive_labels": 10, "min_negative_labels": 17, "recalibration_batch": 10, "bootstrap_threshold": 55},
    )
    assert (cfg.min_reviewed_rows, cfg.min_positive_labels, cfg.min_negative_labels, cfg.recalibration_batch) == (30, 10, 17, 10)
    assert cfg.bootstrap_threshold == 55.0
    # The method itself is not a setting.
    assert cfg.calibration_share == BASE.calibration_share
    assert cfg.candidate_thresholds == BASE.candidate_thresholds
    assert cfg.min_validation_positive == BASE.min_validation_positive
    assert cfg.max_validation_drop == BASE.max_validation_drop
    # And the base object was never mutated.
    assert BASE.min_reviewed_rows == CalibrationConfig().min_reviewed_rows


@pytest.mark.parametrize(
    "overrides",
    [
        {"calibration_share": 0.5},  # not a knob
        {"min_positive_labels": 2},  # below the activation floor
        {"min_negative_labels": 4},
        {"bootstrap_threshold": 99},  # outside the candidate grid
        {"recalibration_batch": 0},
        {"recalibration_batch": "ten"},
    ],
)
def test_unknown_or_out_of_range_settings_are_refused(overrides):
    with pytest.raises(ValueError):
        cal.with_overrides(BASE, overrides)


def test_activation_floors_match_the_time_split():
    floors = cal.activation_floors(BASE)
    share = BASE.calibration_share
    # At the floor the held-out side just reaches the validation minimum; one fewer misses it.
    assert cal._held_out(floors["min_positive_labels"], share) >= BASE.min_validation_positive
    assert cal._held_out(floors["min_positive_labels"] - 1, share) < BASE.min_validation_positive
    assert cal._held_out(floors["min_negative_labels"], share) >= BASE.min_validation_negative
    assert cal._held_out(floors["min_negative_labels"] - 1, share) < BASE.min_validation_negative
    assert floors["min_reviewed_rows"] == floors["min_positive_labels"] + floors["min_negative_labels"]
    # With the shipped defaults (70/30 split, 3 and 5 held out) the floors are 9 and 15.
    assert (floors["min_positive_labels"], floors["min_negative_labels"]) == (9, 15)


def test_demo_preset_is_above_the_floors_and_can_actually_activate():
    cfg = cal.with_overrides(BASE, cal.PRESETS["demo"])
    floors = cal.activation_floors(BASE)
    assert cfg.min_positive_labels >= floors["min_positive_labels"]
    assert cfg.min_negative_labels >= floors["min_negative_labels"]

    rows = _rows(confirmed=cfg.min_positive_labels, cleared=cfg.min_negative_labels, uncertain=3)
    assert len(rows) >= cfg.min_reviewed_rows
    outcome = cal.calibrate(rows, current_threshold=cfg.bootstrap_threshold, config=cfg)
    assert outcome.ready
    assert outcome.activated, outcome.reason


def test_readiness_and_recalibration_follow_the_overridden_values():
    cfg = cal.with_overrides(BASE, {"min_reviewed_rows": 30, "min_positive_labels": 10, "min_negative_labels": 17, "recalibration_batch": 10})
    assert not cal.readiness(29, 10, 17, cfg)["ready"]
    assert cal.readiness(30, 10, 17, cfg)["ready"]
    assert not cal.readiness(30, 10, 17, BASE)["ready"]  # defaults still demand 100 / 20 / 50
    assert cal.recalibration_due(10, True, True, cfg)
    assert not cal.recalibration_due(9, True, True, cfg)
    assert not cal.recalibration_due(10, True, True, BASE)
