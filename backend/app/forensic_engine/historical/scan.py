"""Orchestration: ledger in, ranked audit cases out.

Deliberately a plain function over a list of transactions rather than something
that reaches into the database. It can be run in a test, on a fixture, or from the
API, and it always does the same thing.

Every stage is timed and every stage's output is counted, because the first
question anyone asks about a five-year scan is "what did it actually do, and where
did the time go?".
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import pandas as pd

from app.forensic_engine.config import EngineConfig
from app.forensic_engine.historical import aggregates as agg
from app.forensic_engine.historical import auto_category
from app.forensic_engine.historical import baselines as base
from app.forensic_engine.historical import case_builder, case_ranker, changepoints, explain
from app.forensic_engine.historical import microclusters, multilevel
from app.forensic_engine.historical.canonicalize import canonicalize
from app.forensic_engine.historical.materiality import company_scale, first_seen_map
from app.forensic_engine.historical.types import (
    HISTORICAL_VERSION,
    Evidence,
    HistoricalConfig,
)


@dataclass
class ScanResult:
    cases: list = field(default_factory=list)
    diagnostics: dict = field(default_factory=dict)
    frame: pd.DataFrame | None = None


def _transaction_evidence(frame: pd.DataFrame, config: HistoricalConfig) -> tuple[list[Evidence], dict]:
    """The existing four views, folded in as one more evidence layer.

    They are the slowest thing in the scan by a wide margin, so above a row count
    they are skipped and the scan says so. Skipping them costs the case builder one
    corroborating layer; pretending to run them would cost the reviewer an hour.
    """
    if len(frame) > config.transaction_layer_max_rows:
        return [], {
            "status": "skipped",
            "reason": (
                f"{len(frame):,} rows is above the {config.transaction_layer_max_rows:,} row limit for the "
                "row-level views. The historical layers cover this scan; run the standard analysis on a "
                "single department for row-level detail."
            ),
        }

    from app.forensic_engine.engine import analyse_frame

    started = time.perf_counter()
    result = analyse_frame(frame, EngineConfig())
    alerts = [finding for finding in result.findings if finding.risk_score >= 60]

    evidence: list[Evidence] = []
    by_head: dict[str, list] = {}
    lookup = frame.set_index(frame["transaction_id"].astype(str))
    for finding in alerts:
        head = str(lookup.at[finding.transaction_id, "entity_account_head"]) if finding.transaction_id in lookup.index else ""
        if head:
            by_head.setdefault(head, []).append(finding)

    for head, findings in by_head.items():
        ids = [finding.transaction_id for finding in findings]
        rows = lookup.loc[[i for i in ids if i in lookup.index]]
        if rows.empty:
            continue
        evidence.append(
            Evidence(
                code="transaction_alert",
                layer="transaction",
                entity_type="account_head",
                entity_id=head,
                period_start=pd.Timestamp(rows["transaction_date"].min()).date(),
                period_end=pd.Timestamp(rows["transaction_date"].max()).date(),
                strength=min(1.0, max(finding.risk_score for finding in findings) / 100.0),
                message=(
                    f"{len(findings)} payment(s) to '{head}' were flagged individually by the row-level views, "
                    f"the highest scoring {max(finding.risk_score for finding in findings):.0f} out of 100."
                ),
                detail={
                    "alerts": len(findings),
                    "max_risk_score": round(max(finding.risk_score for finding in findings), 2),
                    "views": sorted({view for finding in findings for view in finding.views_triggered}),
                },
                member_ids=ids,
                amount=float(rows["amount"].sum()),
            )
        )

    return evidence, {
        "status": "ok",
        "alerts": len(alerts),
        "entities_with_alerts": len(by_head),
        "seconds": round(time.perf_counter() - started, 2),
    }


def run_scan(transactions: list, config: HistoricalConfig | None = None) -> ScanResult:
    """Mine a company's history and return ranked audit cases."""
    config = config or HistoricalConfig()
    timings: dict[str, float] = {}
    started = time.perf_counter()

    if len(transactions) > config.max_rows:
        return ScanResult(
            diagnostics={
                "status": "refused",
                "reason": (
                    f"{len(transactions):,} rows exceeds the {config.max_rows:,} row scan limit. Narrow the "
                    "date range, or raise the limit once the scan has been given a background worker."
                ),
                "engine_version": HISTORICAL_VERSION,
            }
        )

    mark = time.perf_counter()
    frame, quality = canonicalize(transactions)
    timings["canonicalize"] = round(time.perf_counter() - mark, 2)

    if frame.empty:
        return ScanResult(
            diagnostics={
                "status": "empty",
                "data_quality": quality,
                "engine_version": HISTORICAL_VERSION,
                "config": config.to_dict(),
            }
        )

    # A category for every row, so category-level history exists on a fresh upload
    # instead of waiting for the approval queue. Nothing here is persisted.
    mark = time.perf_counter()
    frame, category_report = auto_category.attach_historical_categories(frame)
    timings["categories"] = round(time.perf_counter() - mark, 2)

    mark = time.perf_counter()
    limits = agg.infer_approval_limits(frame)
    tables = agg.build_aggregates(frame, config, limits)
    company_months = agg.company_periods(frame, "month")
    timings["aggregates"] = round(time.perf_counter() - mark, 2)

    mark = time.perf_counter()
    enriched = {period: base.build_baselines(table) for period, table in tables.items()}
    timings["baselines"] = round(time.perf_counter() - mark, 2)

    evidence: list[Evidence] = []
    layer_counts: dict[str, int] = {}

    mark = time.perf_counter()
    for period_type, table in enriched.items():
        found = multilevel.detect(table, config, period_type)
        evidence.extend(found)
        layer_counts[f"multilevel_{period_type}"] = len(found)
    timings["multilevel"] = round(time.perf_counter() - mark, 2)

    mark = time.perf_counter()
    monthly = enriched.get("month", pd.DataFrame())
    found = changepoints.detect(monthly, config, "month")
    evidence.extend(found)
    layer_counts["changepoints"] = len(found)
    timings["changepoints"] = round(time.perf_counter() - mark, 2)

    mark = time.perf_counter()
    found = microclusters.detect(frame, config, limits)
    evidence.extend(found)
    layer_counts["collective"] = len(found)
    timings["microclusters"] = round(time.perf_counter() - mark, 2)

    mark = time.perf_counter()
    row_evidence, row_report = _transaction_evidence(frame, config)
    evidence.extend(row_evidence)
    layer_counts["transaction"] = len(row_evidence)
    timings["transaction_views"] = round(time.perf_counter() - mark, 2)

    # Evidence that scored zero passed its detector's floor and nothing more. It
    # adds no weight to a case but it does widen the case's window and lengthen its
    # evidence list, so it is dropped here rather than shown to a reviewer.
    weightless = sum(1 for item in evidence if item.strength <= 0)
    evidence = [item for item in evidence if item.strength > 0]

    mark = time.perf_counter()
    cases = case_builder.build_cases(evidence)
    scale = company_scale(company_months)
    seen = first_seen_map(frame, "entity_account_head")
    seen.update(first_seen_map(frame, "entity_expense_category"))
    ledger_start = pd.Timestamp(frame["transaction_date"].min())

    # Thin data should make the ordering less confident, not invisible.
    confidence = 1.0
    if quality.get("months_covered", 0) < 12:
        confidence -= 0.2
    if quality.get("voucher_coverage", 0) < 0.5:
        confidence -= 0.1
    if quality.get("expense_category_coverage", 0) == 0:
        confidence -= 0.1

    cases = case_ranker.rank_cases(cases, config, scale, seen, ledger_start, confidence)
    cases, restated = case_ranker.drop_restatements(cases, config)
    for case in cases:
        case.explanation = explain.explain(case, frame)
    timings["cases"] = round(time.perf_counter() - mark, 2)

    bands: dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for case in cases:
        bands[case.band] = bands.get(case.band, 0) + 1

    diagnostics = {
        "status": "ok",
        "engine_version": HISTORICAL_VERSION,
        "config": config.to_dict(),
        "data_quality": quality,
        "approval_limits_inferred": limits,
        "categories": category_report,
        "evidence_total": len(evidence),
        "evidence_by_detector": layer_counts,
        "evidence_dropped_weightless": weightless,
        "cases_dropped_as_restatement": restated,
        "row_level_views": row_report,
        "entity_periods": {period: int(len(table)) for period, table in tables.items()},
        "company_monthly_median": round(scale, 2),
        "cases_built": len(cases),
        "cases_by_band": bands,
        "data_quality_confidence": round(confidence, 2),
        "timings_seconds": timings,
        "total_seconds": round(time.perf_counter() - started, 2),
    }

    return ScanResult(cases=cases, diagnostics=diagnostics, frame=frame)
