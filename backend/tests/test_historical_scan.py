"""Tests for historical full-population anomaly mining.

The scanner's whole claim is that it finds things the row engine cannot: patterns
made of individually unremarkable payments. These tests plant exactly that and
check it comes back as one case rather than as scattered noise, and that the parts
which decide ordering behave the way the ranking says they do.

Pure functions over synthetic frames: no database, no network.
"""

from __future__ import annotations

import random
from datetime import date, timedelta
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from app.forensic_engine.historical import aggregates as agg
from app.forensic_engine.historical import baselines as base
from app.forensic_engine.historical import case_builder, case_ranker, changepoints, microclusters, multilevel
from app.forensic_engine.historical.canonicalize import canonicalize
from app.forensic_engine.historical.explain import explain
from app.forensic_engine.historical.materiality import materiality_score, persistence_score
from app.forensic_engine.historical.scan import run_scan
from app.forensic_engine.historical.types import Evidence, HistoricalConfig


# --------------------------------------------------------------------- fixtures


def _txn(counter: list[int], day: date, head: str, amount: float, **extra):
    counter[0] += 1
    return SimpleNamespace(
        transaction_id=f"T{counter[0]}",
        department_id="D1",
        transaction_date=day,
        amount=float(amount),
        transaction_type=extra.get("kind", "debit"),
        description=extra.get("description", "payment"),
        chart_acc_head=head,
        cleaned_chart_acc_head=head,
        group_name="grp",
        group_no=1.0,
        expense_category=None,
        invoice_id=extra.get("voucher", f"V{counter[0]}"),
        po_number="",
        payment_method="bank",
    )


@pytest.fixture
def five_year_ledger():
    """Four quiet years, then a three-month episode on one account head.

    The episode is the scenario the mentor described: many payments, none of them
    individually large, concentrated in a short window.
    """
    rng = random.Random(7)
    counter = [0]
    rows = []
    heads = [f"head {i}" for i in range(12)]

    day = date(2021, 1, 1)
    while day < date(2026, 1, 1):
        for head in heads:
            if rng.random() < 0.12:
                rows.append(_txn(counter, day, head, rng.lognormvariate(10.0, 0.5)))
        day += timedelta(days=1)

    fuel = "fac fuel exp"
    day = date(2021, 1, 1)
    while day < date(2026, 1, 1):
        if day.day in (7, 21):
            rows.append(_txn(counter, day, fuel, rng.uniform(25_000, 55_000), description="fuel"))
        day += timedelta(days=1)

    planted = []
    day = date(2024, 3, 1)
    while day < date(2024, 6, 1):
        for _ in range(rng.randint(0, 2)):
            rows.append(_txn(counter, day, fuel, rng.uniform(20_000, 45_000), description="fuel"))
            planted.append(f"T{counter[0]}")
        day += timedelta(days=1)

    return rows, planted, fuel


# ---------------------------------------------------------------- canonicalize


def test_credit_rows_are_excluded_and_counted():
    counter = [0]
    rows = [
        _txn(counter, date(2024, 1, 5), "head", 1000),
        _txn(counter, date(2024, 1, 6), "head", 9000, kind="credit"),
    ]
    frame, quality = canonicalize(rows)
    assert len(frame) == 1
    assert quality["credit_rows_excluded"] == 1
    assert quality["rows_in_ledger"] == 2


def test_empty_ledger_reports_rather_than_crashes():
    frame, quality = canonicalize([])
    assert frame.empty
    assert quality["rows_scanned"] == 0
    assert quality["warnings"]


def test_thin_history_is_warned_about():
    counter = [0]
    rows = [_txn(counter, date(2024, 1, day), "head", 1000) for day in range(1, 20)]
    _, quality = canonicalize(rows)
    assert any("month" in warning for warning in quality["warnings"])


# ------------------------------------------------------------------ baselines


def test_a_period_is_never_compared_with_itself():
    """A month that helped compute its own median cannot look unusual against it."""
    table = pd.DataFrame(
        [
            {
                "entity_type": "account_head",
                "entity_id": "h",
                "period_type": "month",
                "period_start": pd.Timestamp(2024, month, 1),
                "count": 3,
                "total": total,
                "median": total / 3,
                "mad": 1.0,
                "p95": total,
                "maximum": total,
                "weekend_share": 0.0,
                "month_end_share": 0.0,
                "round_share": 0.0,
                "near_limit_share": 0.0,
                "distinct_days": 3,
                "concentration": 0.4,
                "member_ids": [f"T{month}"],
            }
            for month, total in enumerate([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 900], start=1)
        ]
    )
    enriched = base.build_baselines(table)
    spike = enriched.iloc[-1]
    quiet = enriched.iloc[0]
    # The spike's own reference excludes it, so it stands out sharply.
    assert spike["total_z"] > quiet["total_z"]
    assert spike["total_long_median"] == pytest.approx(100.0)


def test_robust_z_handles_a_flat_history():
    assert base.robust_z(100.0, 100.0, 0.0) == 0.0
    assert base.robust_z(500.0, 100.0, 0.0) > 0


# --------------------------------------------------------------- change points


def test_change_point_finds_a_level_shift():
    series = np.array([100.0] * 12 + [400.0] * 12)
    cuts = changepoints.find_change_points(series, penalty=2.5, min_segment=3)
    assert cuts, "a doubling that lasts a year must be found"
    assert abs(cuts[0] - 12) <= 1


def test_change_point_ignores_noise_around_one_level():
    rng = np.random.default_rng(3)
    series = 100 + rng.normal(0, 4, size=40)
    assert changepoints.find_change_points(series, penalty=2.5, min_segment=3) == []


def test_a_spike_does_not_raise_its_own_detection_threshold():
    """Scaling the penalty by variance let one spike hide behind itself."""
    series = np.array([100.0] * 10 + [900.0] * 5 + [100.0] * 10)
    cuts = changepoints.find_change_points(series, penalty=2.5, min_segment=3)
    assert len(cuts) >= 2


# ------------------------------------------------------------------- collective


def test_repeated_identical_amounts_are_reported_with_their_rows():
    counter = [0]
    rows = [_txn(counter, date(2024, 3, 1) + timedelta(days=i * 2), "vendor a", 48_000) for i in range(9)]
    rows += [_txn(counter, date(2024, 1, 1) + timedelta(days=i * 3), "vendor a", 1000 + i * 37) for i in range(12)]
    frame, _ = canonicalize(rows)
    found = microclusters.detect(frame, HistoricalConfig(), limits=[])
    repeats = [item for item in found if item.code == "repeated_amount"]
    assert repeats
    assert repeats[0].detail["times"] == 9
    assert len(repeats[0].member_ids) == 9


def test_near_threshold_cluster_needs_a_limit_to_hug():
    counter = [0]
    rows = [_txn(counter, date(2024, 3, 1) + timedelta(days=i), "head", 47_000 + i * 10) for i in range(14)]
    frame, _ = canonicalize(rows)
    without = microclusters.detect(frame, HistoricalConfig(), limits=[])
    with_limit = microclusters.detect(frame, HistoricalConfig(), limits=[50_000.0])
    assert not [item for item in without if item.code == "near_threshold_cluster"]
    assert [item for item in with_limit if item.code == "near_threshold_cluster"]


# ------------------------------------------------------------------ case layer


def _evidence(code: str, layer: str, start: date, end: date, strength: float, members: list[str], amount: float = 0.0):
    return Evidence(
        code=code,
        layer=layer,
        entity_type="account_head",
        entity_id="fuel",
        period_start=start,
        period_end=end,
        strength=strength,
        message=code,
        member_ids=members,
        amount=amount,
    )


def test_overlapping_evidence_about_one_entity_becomes_one_case():
    items = [
        _evidence("spend_surge", "aggregate", date(2024, 3, 1), date(2024, 3, 31), 0.8, ["a", "b"], 1000),
        _evidence("payment_burst", "collective", date(2024, 3, 10), date(2024, 4, 20), 0.6, ["b", "c"], 900),
        _evidence("regime_change", "changepoint", date(2024, 3, 1), date(2024, 5, 31), 0.7, ["c", "d"], 1200),
    ]
    cases = case_builder.build_cases(items)
    assert len(cases) == 1
    assert cases[0].member_ids == ["a", "b", "c", "d"], "a row named twice is still one member"
    assert cases[0].amount == 1200, "the largest claim, not the sum of overlapping ones"
    assert cases[0].layers == {"aggregate", "collective", "changepoint"}


def test_distant_evidence_stays_in_separate_cases():
    items = [
        _evidence("spend_surge", "aggregate", date(2021, 3, 1), date(2021, 3, 31), 0.8, ["a"]),
        _evidence("spend_surge", "aggregate", date(2024, 3, 1), date(2024, 3, 31), 0.8, ["b"]),
    ]
    assert len(case_builder.build_cases(items)) == 2


def test_different_entities_never_merge():
    left = _evidence("spend_surge", "aggregate", date(2024, 3, 1), date(2024, 3, 31), 0.8, ["a"])
    right = _evidence("spend_surge", "aggregate", date(2024, 3, 1), date(2024, 3, 31), 0.8, ["b"])
    right.entity_id = "stationery"
    assert len(case_builder.build_cases([left, right])) == 2


def test_corroboration_outranks_a_single_loud_detector():
    config = HistoricalConfig()
    loud = case_builder.build_cases([_evidence("spend_surge", "aggregate", date(2024, 3, 1), date(2024, 3, 31), 1.0, ["a"], 500)])
    agreed = case_builder.build_cases(
        [
            _evidence("spend_surge", "aggregate", date(2024, 3, 1), date(2024, 3, 31), 0.55, ["b"], 500),
            _evidence("payment_burst", "collective", date(2024, 3, 5), date(2024, 3, 25), 0.55, ["c"], 500),
            _evidence("regime_change", "changepoint", date(2024, 3, 1), date(2024, 4, 1), 0.55, ["d"], 500),
        ]
    )
    ranked_loud = case_ranker.rank_cases(loud, config, 1000.0, {}, pd.Timestamp("2021-01-01"))
    ranked_agreed = case_ranker.rank_cases(agreed, config, 1000.0, {}, pd.Timestamp("2021-01-01"))
    assert ranked_agreed[0].priority > ranked_loud[0].priority


def test_materiality_lifts_a_large_pattern_over_a_trivial_one():
    small = materiality_score(amount=100.0, monthly_scale=1_000_000.0)
    large = materiality_score(amount=5_000_000.0, monthly_scale=1_000_000.0)
    assert large > small


def test_persistence_rewards_duration():
    config = HistoricalConfig()
    brief = persistence_score(pd.Timestamp("2024-03-01"), pd.Timestamp("2024-03-03"), config)
    long = persistence_score(pd.Timestamp("2024-03-01"), pd.Timestamp("2024-06-01"), config)
    assert long > brief


def test_explanation_answers_every_required_question():
    case = case_builder.build_cases(
        [_evidence("spend_surge", "aggregate", date(2024, 3, 1), date(2024, 5, 31), 0.8, ["a", "b"], 5000)]
    )[0]
    packet = explain(case)
    for key in (
        "what_changed",
        "when_it_started",
        "who_it_affects",
        "how_many_transactions",
        "how_much",
        "which_layers_agree",
        "caveat",
    ):
        assert key in packet
    assert "not a finding of fraud" in packet["caveat"]


# ------------------------------------------------------------------ end to end


def test_the_episode_is_found_consolidated_and_ranked_first(five_year_ledger):
    rows, planted, fuel = five_year_ledger
    result = run_scan(rows, HistoricalConfig())

    assert result.diagnostics["status"] == "ok"
    assert result.cases, "five years with a planted episode must produce cases"

    fuel_cases = [case for case in result.cases if case.entity_id == fuel]
    assert len(fuel_cases) == 1, "the episode must be one case, not several"

    case = fuel_cases[0]
    assert result.cases.index(case) == 0, "it must outrank the ordinary noise"
    recovered = set(case.member_ids) & set(planted)
    assert len(recovered) >= 0.9 * len(planted), "nearly every planted row belongs to the case"
    assert len(case.layers) >= 2, "independent layers should agree on a real episode"


def test_scan_is_reproducible_and_reports_its_configuration(five_year_ledger):
    rows, _, _ = five_year_ledger
    config = HistoricalConfig()
    first = run_scan(rows, config)
    second = run_scan(rows, config)
    assert [case.title for case in first.cases] == [case.title for case in second.cases]
    assert first.diagnostics["config"] == config.to_dict()


def test_scan_refuses_rather_than_truncating_a_ledger_it_cannot_hold():
    counter = [0]
    rows = [_txn(counter, date(2024, 1, 1), "head", 10) for _ in range(30)]
    config = HistoricalConfig()
    config.max_rows = 10
    result = run_scan(rows, config)
    assert result.diagnostics["status"] == "refused"
    assert not result.cases


def test_row_level_views_are_skipped_on_a_large_ledger_and_say_so(five_year_ledger):
    rows, _, _ = five_year_ledger
    config = HistoricalConfig()
    config.transaction_layer_max_rows = 10
    result = run_scan(rows, config)
    assert result.diagnostics["row_level_views"]["status"] == "skipped"
    assert "row-level views" in result.diagnostics["row_level_views"]["reason"]


def test_empty_window_returns_a_reason_not_an_exception():
    result = run_scan([], HistoricalConfig())
    assert result.diagnostics["status"] == "empty"
    assert result.cases == []


def test_multilevel_ignores_periods_too_thin_to_judge():
    """One payment in a month cannot be a surge, however large."""
    counter = [0]
    rows = [_txn(counter, date(2021, m, 5), "head", 1000) for m in range(1, 13)]
    rows.append(_txn(counter, date(2022, 1, 5), "head", 900_000))
    frame, _ = canonicalize(rows)
    config = HistoricalConfig()
    tables = agg.build_aggregates(frame, config, [])
    enriched = base.build_baselines(tables["month"])
    found = multilevel.detect(enriched, config, "month")
    assert not found


def test_a_standing_charge_is_not_a_repeated_amount_finding():
    """The same rent every month for five years is a contract, not an episode.

    The test only means something when the repeats are concentrated, so an evenly
    spaced series has to come back silent however many times it recurs.
    """
    counter = [0]
    rows = [_txn(counter, date(2020, 1, 15) + timedelta(days=30 * i), "office rent", 25_000) for i in range(60)]
    rows += [_txn(counter, date(2020, 1, 3) + timedelta(days=17 * i), "office rent", 3000 + i * 11) for i in range(80)]
    frame, _ = canonicalize(rows)
    found = microclusters.detect(frame, HistoricalConfig(), limits=[])
    assert not [item for item in found if item.code == "repeated_amount"]


def test_a_repeated_amount_never_claims_a_window_wider_than_it_examined():
    """A chain of overlapping windows must not become one long claim."""
    counter = [0]
    # Fifty identical payments, one every ten days: dense enough to fire in places,
    # spread over well over a year.
    rows = [_txn(counter, date(2022, 1, 1) + timedelta(days=10 * i), "supplies", 40_000) for i in range(50)]
    rows += [_txn(counter, date(2022, 1, 2) + timedelta(days=9 * i), "supplies", 500 + i) for i in range(60)]
    frame, _ = canonicalize(rows)
    config = HistoricalConfig()
    found = microclusters.detect(frame, config, limits=[])
    for item in found:
        if item.code in ("repeated_amount", "near_threshold_cluster"):
            span = (item.period_end - item.period_start).days
            assert span <= config.cluster_window_days, f"{item.code} claimed {span} days"


def test_a_petty_repeat_is_left_alone_and_a_large_one_is_not():
    """Repetition is the split-purchasing signature only at a size that matters."""
    counter = [0]
    petty = [_txn(counter, date(2024, 2, 1) + timedelta(days=i), "canteen", 500) for i in range(10)]
    petty += [_txn(counter, date(2024, 2, 1) + timedelta(days=i), "canteen", 4000 + i * 90) for i in range(30)]
    frame, _ = canonicalize(petty)
    found = microclusters.detect(frame, HistoricalConfig(), limits=[])
    assert not [item for item in found if item.code == "repeated_amount" and item.detail["amount"] == 500]

    counter = [0]
    large = [_txn(counter, date(2024, 2, 1) + timedelta(days=i), "canteen", 48_000) for i in range(10)]
    large += [_txn(counter, date(2024, 2, 1) + timedelta(days=i), "canteen", 4000 + i * 90) for i in range(30)]
    frame, _ = canonicalize(large)
    found = microclusters.detect(frame, HistoricalConfig(), limits=[])
    assert [item for item in found if item.code == "repeated_amount" and item.detail["amount"] == 48_000]


def test_a_share_needs_a_denominator_before_it_can_shift():
    """Two of three payments on a Saturday is not a change in weekend posting."""
    counter = [0]
    rows = []
    for month in range(1, 13):
        for day in (4, 11, 18):
            rows.append(_txn(counter, date(2021, month, day), "head", 1000))
    # A thin month that is all weekend: a huge share move on three rows.
    for day in (2, 3, 9):
        rows.append(_txn(counter, date(2022, 1, day), "head", 1000))
    frame, _ = canonicalize(rows)
    config = HistoricalConfig()
    tables = agg.build_aggregates(frame, config, [])
    enriched = base.build_baselines(tables["month"])
    found = multilevel.detect(enriched, config, "month")
    assert not [item for item in found if item.code == "weekend_shift"]


def test_the_same_rows_are_not_queued_twice_under_a_coarser_label():
    """An account head and the group holding it are one finding, not two."""
    config = HistoricalConfig()
    members = [f"T{i}" for i in range(40)]
    specific = case_builder.Case(
        entity_type="account_head",
        entity_id="fuel and lubricant",
        start=date(2024, 1, 1),
        end=date(2024, 3, 31),
        evidence=[_evidence("spend_surge", "aggregate", date(2024, 1, 1), date(2024, 3, 31), 0.9, members, 500_000)],
        member_ids=list(members),
        amount=500_000,
    )
    coarse = case_builder.Case(
        entity_type="account_group",
        entity_id="group_fuel",
        start=date(2024, 1, 1),
        end=date(2024, 3, 31),
        evidence=[_evidence("spend_surge", "aggregate", date(2024, 1, 1), date(2024, 3, 31), 0.9, members, 500_000)],
        member_ids=list(members),
        amount=500_000,
    )
    ranked = case_ranker.rank_cases([coarse, specific], config, 100_000.0, {}, pd.Timestamp("2020-01-01"))
    kept, dropped = case_ranker.drop_restatements(ranked, config)
    assert dropped == 1
    assert len(kept) == 1
    # The one a reviewer can act on is the one that survives.
    assert kept[0].entity_type == "account_head"
