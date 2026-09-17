"""Expense category as an entity in the forensic engine.

The categorization pipeline (a teammate's work) assigns an admin-approved expense category
to every transaction in an approved group. These tests pin down how the engine uses it:
as a *fallback* cohort for account heads too thin to have a baseline of their own, never
as a second vote on a row the head already judged, and never at all when no categories
have been assigned.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace

from app.forensic_engine.config import EngineConfig
from app.forensic_engine.engine import analyse_frame
from app.forensic_engine.features import active_entity_kinds, build_baselines, build_frame, ensemble_feature_matrix
from app.forensic_engine.views import behavioral


START = datetime(2023, 1, 2)


def _txn(index: int, head: str, amount: float, category: str | None, day: int | None = None) -> SimpleNamespace:
    """An ORM-shaped transaction. `expense_category` mirrors the relationship the router
    eager-loads; None is what an unassigned row carries."""
    return SimpleNamespace(
        transaction_id=f"T{index:04d}",
        department_id="dept-1",
        transaction_date=START + timedelta(days=day if day is not None else index * 2),
        amount=amount,
        transaction_type="debit",
        description="routine purchase",
        chart_acc_head=head,
        cleaned_chart_acc_head=head,
        group_name="operations",
        invoice_id=f"V{index:04d}",
        po_number="",
        payment_method="cash",
        expense_category=SimpleNamespace(name=category) if category else None,
    )


def _ledger(with_categories: bool) -> list[SimpleNamespace]:
    """Three established fuel heads, one established stationery head, and one brand-new
    fuel head that has a single routine payment followed by a huge one."""
    rows: list[SimpleNamespace] = []
    index = 0
    for head in ("petrol", "diesel", "lubricants"):
        for step in range(20):
            rows.append(_txn(index, head, 5_000.0 + (step % 7) * 250.0, "Fuel" if with_categories else None))
            index += 1
    for step in range(20):
        rows.append(_txn(index, "office stationery", 1_200.0 + (step % 5) * 50.0, "Office Supplies" if with_categories else None))
        index += 1
    # The thin head: two payments only, the second one absurd for fuel.
    rows.append(_txn(index, "generator diesel", 5_200.0, "Fuel" if with_categories else None, day=150))
    index += 1
    rows.append(_txn(index, "generator diesel", 400_000.0, "Fuel" if with_categories else None, day=158))
    return rows


def _codes_for(signals, transaction_id: str) -> set[str]:
    return {signal.code for signal in signals if signal.transaction_id == transaction_id}


def test_category_entity_stays_dark_without_assigned_categories():
    frame = build_frame(_ledger(with_categories=False))
    assert ("expense_category", "entity_expense_category") not in active_entity_kinds(frame)
    baselines = build_baselines(frame, EngineConfig())
    assert "expense_category" not in baselines

    _, names = ensemble_feature_matrix(frame, baselines)
    assert "category_robust_z" not in names

    result = analyse_frame(frame, EngineConfig())
    quality = result.diagnostics["data_quality"]
    assert quality["expense_category_coverage"] == 0.0
    assert any("expense categor" in warning.lower() for warning in quality["warnings"])


def test_category_baselines_are_built_from_approved_categories():
    frame = build_frame(_ledger(with_categories=True))
    assert ("expense_category", "entity_expense_category") in active_entity_kinds(frame)
    baselines = build_baselines(frame, EngineConfig())
    fuel = baselines["expense_category"]["fuel"]
    assert fuel.count == 62  # three heads of twenty plus the two generator rows
    assert 5_000.0 <= fuel.median <= 6_000.0
    _, names = ensemble_feature_matrix(frame, baselines)
    assert names[-1] == "category_robust_z"


def test_a_thin_head_falls_back_to_its_category_baseline():
    """Two payments are too few for a head baseline, so without categories the spike is
    invisible to the deviation test. With the Fuel category it is judged against fuel."""
    config = EngineConfig()
    spike = "T0081"

    blind = build_frame(_ledger(with_categories=False))
    blind_signals, _ = behavioral.run(blind, build_baselines(blind, config), config)
    assert not {code for code in _codes_for(blind_signals, spike) if code.endswith("_amount_deviation")}

    sighted = build_frame(_ledger(with_categories=True))
    sighted_signals, _ = behavioral.run(sighted, build_baselines(sighted, config), config)
    codes = _codes_for(sighted_signals, spike)
    assert "expense_category_amount_deviation" in codes
    assert "account_head_amount_deviation" not in codes

    signal = next(s for s in sighted_signals if s.transaction_id == spike and s.code == "expense_category_amount_deviation")
    assert signal.detail["entity_key"] == "fuel"
    assert signal.detail["head_events"] == 2
    assert signal.strength > 0.5
    assert "too few for a baseline of its own" in signal.message


def test_an_established_head_is_never_double_counted_by_its_category():
    config = EngineConfig()
    rows = _ledger(with_categories=True)
    rows.append(_txn(len(rows), "petrol", 400_000.0, "Fuel", day=170))
    spike = rows[-1].transaction_id

    frame = build_frame(rows)
    signals, _ = behavioral.run(frame, build_baselines(frame, config), config)
    codes = _codes_for(signals, spike)
    assert "account_head_amount_deviation" in codes
    assert "expense_category_amount_deviation" not in codes


def test_category_evidence_reaches_the_fused_finding():
    result = analyse_frame(build_frame(_ledger(with_categories=True)), EngineConfig())
    spike = next(finding for finding in result.findings if finding.transaction_id == "T0081")
    assert any(signal.code == "expense_category_amount_deviation" for signal in spike.signals)
    assert spike.risk_score >= 40.0
    assert "expense_category" in result.diagnostics["entity_kinds_active"]
    assert result.diagnostics["data_quality"]["expense_category_coverage"] == 1.0
