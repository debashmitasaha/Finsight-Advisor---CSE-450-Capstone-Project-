"""Unit tests for the forensic intelligence engine.

The benchmark in `app/forensic_engine/benchmark.py` answers "does the whole thing work"
empirically. These tests cover the layer underneath it: the scoring primitives whose
behaviour the benchmark's numbers depend on, and which would otherwise only be checked
indirectly through a metric that moves for many reasons at once.
"""

from __future__ import annotations

import pandas as pd
import pytest

from app.forensic_engine.config import EngineConfig, risk_band
from app.forensic_engine.engine import analyse_frame
from app.forensic_engine.evaluation import evaluate
from app.forensic_engine.features import EntityBaseline, build_baselines, infer_approval_thresholds, is_round
from app.forensic_engine.fusion import fuse
from app.forensic_engine.injection import inject, resolve_approval_limit
from app.forensic_engine.signals import Signal, log_ramp, noisy_or, ramp
from app.services.dataframe import resolve_amount_and_type


# --------------------------------------------------------------------------- signals


def test_noisy_or_rewards_corroboration_without_reaching_certainty():
    assert noisy_or([0.5]) == pytest.approx(0.5)
    # Two independent 0.5 signals should exceed either alone but stay short of proof.
    combined = noisy_or([0.5, 0.5])
    assert 0.5 < combined < 1.0
    assert combined == pytest.approx(0.75)


def test_noisy_or_is_order_independent():
    assert noisy_or([0.2, 0.7, 0.4]) == pytest.approx(noisy_or([0.7, 0.4, 0.2]))


def test_noisy_or_never_exceeds_one():
    assert noisy_or([0.99] * 20) <= 1.0


def test_ramp_boundaries():
    assert ramp(2.0, 3.0, 8.0) == 0.0
    assert ramp(8.0, 3.0, 8.0) == 1.0
    assert ramp(5.5, 3.0, 8.0) == pytest.approx(0.5)


def test_log_ramp_keeps_large_deviations_separable():
    """The reason log_ramp exists: a linear ramp saturates and loses the ranking.

    A payment 130x its entity median must outrank one at 10x. On a linear ramp both hit
    1.0 and the auditor's work list loses its order.
    """
    soft, hard = 3.5, 150.0
    modest = log_ramp(10.0, soft, hard)
    extreme = log_ramp(130.0, soft, hard)
    assert 0.0 < modest < extreme < 1.0
    assert extreme - modest > 0.3

    # Contrast with the linear ramp this replaced.
    assert ramp(10.0, 3.5, 8.0) == ramp(130.0, 3.5, 8.0) == 1.0


def test_signal_strength_is_clamped():
    assert Signal("t", "rule", "c", 5.0, "m").strength == 1.0
    assert Signal("t", "rule", "c", -2.0, "m").strength == 0.0


# -------------------------------------------------------------------------- baselines


def _baseline(amounts: list[float]) -> EntityBaseline:
    series = pd.Series(amounts, dtype=float)
    median = float(series.median())
    return EntityBaseline(
        kind="account_head",
        key="test",
        count=len(amounts),
        median=median,
        mad=float((series - median).abs().median()),
        p95=float(series.quantile(0.95)),
        total=float(series.sum()),
        first_seen=pd.Timestamp("2024-01-01"),
        last_seen=pd.Timestamp("2024-12-31"),
        round_share=0.0,
    )


def test_mad_does_not_let_an_outlier_hide_itself():
    """The specific failure the old z-score had.

    With mean/std, one huge payment inflates the standard deviation enough that its own
    z-score falls under the threshold. Median/MAD is unmoved by it.
    """
    routine = [100.0, 105.0, 98.0, 102.0, 99.0, 101.0, 103.0, 97.0]
    fraud = 9_500.0
    amounts = routine + [fraud]

    series = pd.Series(amounts)
    classic_z = abs(fraud - series.mean()) / series.std()
    robust = _baseline(amounts).robust_z(fraud)

    assert classic_z < 3.0, "the outlier hides inside mean/std, which is the bug"
    assert robust > 100.0, "median/MAD exposes it"


def test_robust_z_handles_a_cohort_with_no_spread():
    baseline = _baseline([500.0] * 6)
    assert baseline.mad == 0.0
    assert baseline.robust_z(500.0) == 0.0
    assert baseline.robust_z(1_500.0) == pytest.approx(2.0)


def test_is_round():
    assert is_round(100_000, 100_000)
    assert not is_round(99_999, 100_000)
    assert not is_round(0, 1_000)


# ----------------------------------------------------------------------------- fusion


def _fuse_one(*signals: Signal) -> float:
    findings = fuse(list(signals), EngineConfig())
    return findings[0].risk_score


def test_a_near_certain_rule_hit_alone_reaches_the_high_band():
    """Regression on a real mis-calibration.

    Weights that summed to 1.0 capped a duplicate payment under the same invoice — about
    as close to proof as a ledger offers — at 30/100, which put the whole top of the scale
    out of reach.
    """
    score = _fuse_one(Signal("t1", "rule", "duplicate_payment", 0.95, "m"))
    assert score >= 65.0
    assert risk_band(score) in {"high", "critical"}


def test_agreeing_views_outrank_a_single_view():
    alone = _fuse_one(Signal("t1", "behavioral", "dev", 0.8, "m"))
    together = _fuse_one(
        Signal("t2", "behavioral", "dev", 0.8, "m"),
        Signal("t2", "temporal", "burst", 0.8, "m"),
    )
    assert together > alone


def test_weak_views_do_not_accumulate_into_an_alert():
    """Three views mumbling should not add up to a finding."""
    score = _fuse_one(
        Signal("t1", "rule", "a", 0.10, "m"),
        Signal("t1", "behavioral", "b", 0.10, "m"),
        Signal("t1", "temporal", "c", 0.10, "m"),
    )
    assert score < 40.0


def test_rule_view_outweighs_relational_at_equal_strength():
    rule = _fuse_one(Signal("t1", "rule", "a", 0.7, "m"))
    relational = _fuse_one(Signal("t2", "relational", "b", 0.7, "m"))
    assert rule > relational


def test_findings_are_returned_worst_first():
    findings = fuse(
        [
            Signal("low", "relational", "a", 0.3, "m"),
            Signal("high", "rule", "b", 0.95, "m"),
            Signal("mid", "behavioral", "c", 0.6, "m"),
        ],
        EngineConfig(),
    )
    scores = [f.risk_score for f in findings]
    assert scores == sorted(scores, reverse=True)


def test_risk_bands_partition_the_scale():
    assert risk_band(90) == "critical"
    assert risk_band(70) == "high"
    assert risk_band(50) == "medium"
    assert risk_band(10) == "low"


# ------------------------------------------------------------------ debit/credit intake


def _upload_frame(**columns) -> pd.DataFrame:
    return pd.DataFrame(columns)


def test_credit_rows_survive_ingestion():
    """The data-loss bug: a credit-only row used to land as amount = 0.

    `normalize_upload_dataframe` renames Debit to `amount` upstream, so the resolver has
    to treat an existing `amount` column as the debit side.
    """
    frame = _upload_frame(amount=[3300.0, 0.0, 5950.0], credit=[0.0, 4200.0, 0.0])
    resolved = resolve_amount_and_type(frame)

    assert list(resolved["transaction_type"]) == ["debit", "credit", "debit"]
    assert list(resolved["amount"]) == [3300.0, 4200.0, 5950.0]
    assert resolved["amount"].sum() == 13_450.0


def test_credit_column_stored_as_text_is_still_read():
    frame = _upload_frame(amount=[0.0, 100.0], credit=["4200.0000", "0.0000"])
    resolved = resolve_amount_and_type(frame)
    assert list(resolved["amount"]) == [4200.0, 100.0]
    assert list(resolved["transaction_type"]) == ["credit", "debit"]


def test_single_amount_ledger_defaults_to_debit():
    resolved = resolve_amount_and_type(_upload_frame(amount=[10.0, 20.0]))
    assert set(resolved["transaction_type"]) == {"debit"}
    assert list(resolved["amount"]) == [10.0, 20.0]


def test_ledger_without_any_amount_column_is_left_alone():
    resolved = resolve_amount_and_type(_upload_frame(description=["a", "b"]))
    assert set(resolved["transaction_type"]) == {"debit"}


# -------------------------------------------------------------- end-to-end on a frame


def _ledger(rows: int = 160) -> pd.DataFrame:
    """A clean, boring ledger: two heads, steady amounts, weekdays only."""
    start = pd.Timestamp("2023-01-02")
    records = []
    for index in range(rows):
        head = "office stationery" if index % 2 else "fuel and lubricants"
        day = start + pd.Timedelta(days=index * 3)
        if day.weekday() >= 5:
            day += pd.Timedelta(days=2)
        records.append(
            {
                "transaction_id": f"T{index:04d}",
                "department_id": "dept-1",
                "transaction_date": day,
                "amount": 5_000.0 + (index % 7) * 250.0,
                "transaction_type": "debit",
                "description": "routine purchase",
                "chart_acc_head": head,
                "entity_account_head": head,
                "entity_account_group": "operations",
                "entity_vendor": "",
                "entity_employee": "",
                "entity_approver": "",
                "invoice_id": f"V{index:04d}",
                "po_number": "",
                "payment_method": "cash",
            }
        )
    frame = pd.DataFrame(records).sort_values("transaction_date").reset_index(drop=True)
    frame["day"] = frame["transaction_date"].dt.normalize()
    frame["weekday"] = frame["transaction_date"].dt.weekday
    frame["is_weekend"] = frame["weekday"] >= 5
    frame["month"] = frame["transaction_date"].dt.to_period("M").astype(str)
    frame["days_in_month"] = frame["transaction_date"].dt.days_in_month
    frame["day_of_month"] = frame["transaction_date"].dt.day
    frame["is_month_end"] = (frame["days_in_month"] - frame["day_of_month"]) < 3
    return frame


def test_baselines_are_built_over_full_history_not_per_month():
    """The fix for the cohort-too-small problem.

    Bucketing by month leaves two or three rows per account head, too few for any
    statistic. Profiling each head across the whole ledger is what makes scoring possible.
    """
    frame = _ledger()
    baselines = build_baselines(frame, EngineConfig())
    heads = baselines["account_head"]
    assert set(heads) == {"office stationery", "fuel and lubricants"}
    assert all(baseline.count >= 12 for baseline in heads.values())


def test_engine_ranks_a_planted_spike_first():
    frame = _ledger()
    spike = frame.iloc[-1].copy()
    spike["transaction_id"] = "FRAUD-1"
    spike["amount"] = 750_000.0
    spike["transaction_date"] = spike["transaction_date"] + pd.Timedelta(days=3)
    frame = pd.concat([frame, pd.DataFrame([spike])], ignore_index=True)

    result = analyse_frame(frame, EngineConfig())
    assert result.findings, "engine produced no findings at all"
    assert result.findings[0].transaction_id == "FRAUD-1"
    assert result.findings[0].risk_score >= 65.0


def test_credit_rows_are_excluded_from_scoring():
    frame = _ledger()
    receipt = frame.iloc[0].copy()
    receipt["transaction_id"] = "RECEIPT-1"
    receipt["amount"] = 5_000_000.0
    receipt["transaction_type"] = "credit"
    frame = pd.concat([frame, pd.DataFrame([receipt])], ignore_index=True)

    result = analyse_frame(frame, EngineConfig())
    scored = {finding.transaction_id for finding in result.findings}
    assert "RECEIPT-1" not in scored, "a customer receipt must not be scored as spending"
    assert result.diagnostics["credit_rows_excluded"] == 1


def test_a_clean_ledger_raises_no_high_risk_findings():
    result = analyse_frame(_ledger(), EngineConfig())
    high = [f for f in result.findings if f.risk_score >= 65.0]
    assert not high, f"false positives on a clean ledger: {[f.risk_score for f in high]}"


def test_every_view_reports_its_status():
    result = analyse_frame(_ledger(), EngineConfig())
    views = result.diagnostics["views"]
    assert set(views) == {"rule", "behavioral", "temporal", "relational"}
    assert all(view["status"] == "ok" for view in views.values()), views


# ------------------------------------------------------------- injection & evaluation


def test_injection_is_deterministic_for_a_seed():
    frame = _ledger()
    first = inject(frame, seed=99)
    second = inject(frame, seed=99)
    assert first.planted_ids == second.planted_ids


def test_injection_appends_rather_than_mutating_real_rows():
    frame = _ledger()
    result = inject(frame, seed=7)
    original_ids = set(frame["transaction_id"])
    assert original_ids.issubset(set(result.frame["transaction_id"]))
    assert len(result.frame) > len(frame)
    assert not (result.planted_ids & original_ids), "planted rows must be new rows"


def test_resolve_approval_limit_prefers_an_explicit_value():
    assert resolve_approval_limit(_ledger(), explicit=250_000.0) == 250_000.0


def test_inferred_thresholds_need_a_pile_up_to_fire():
    """No steering under a limit means no limit should be claimed."""
    assert infer_approval_thresholds(_ledger(), EngineConfig()) == []


def test_evaluation_metrics_agree_with_their_own_counts():
    frame = _ledger()
    injection = inject(frame, seed=11)
    result = analyse_frame(injection.frame, EngineConfig())
    report = evaluate(result.findings, injection, total_rows=len(injection.frame), threshold=65.0)

    assert report.planted == len(injection.planted_ids)
    assert report.true_positives + report.false_negatives == report.planted
    assert report.true_positives + report.false_positives == report.flagged
    assert 0.0 <= report.precision <= 1.0
    assert 0.0 <= report.recall <= 1.0
    if report.precision and report.recall:
        expected_f1 = 2 * report.precision * report.recall / (report.precision + report.recall)
        assert report.f1 == pytest.approx(expected_f1)


def test_planted_fraud_ranks_above_the_median_row():
    frame = _ledger()
    injection = inject(frame, seed=11)
    result = analyse_frame(injection.frame, EngineConfig())
    report = evaluate(result.findings, injection, total_rows=len(injection.frame), threshold=65.0)

    assert report.mean_rank_of_planted is not None
    assert report.mean_rank_of_planted < len(injection.frame) / 2
