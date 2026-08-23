from __future__ import annotations

from app.forensic_engine.config import EngineConfig
from app.forensic_engine.engine import analyse_frame
from app.forensic_engine.evaluation import evaluate, sweep_thresholds
from app.forensic_engine.features import build_frame
from app.forensic_engine.injection import AVAILABLE_SCENARIOS, UNSUPPORTED_SCENARIOS, inject


def run_benchmark(
    transactions: list,
    scenarios: list[str] | None = None,
    threshold: float = 40.0,
    seed: int = 1337,
    approval_limit: float | None = None,
    config: EngineConfig | None = None,
) -> dict:
    """Plant known fraud in a copy of the ledger, re-analyse, and score the engine.

    This is what turns the tool from "it flags things" into "it recovers 7 of 8 planted
    schemes at 62% precision", which is the claim a capstone defence actually needs. The
    real rows are left untouched — injection appends new rows to an in-memory copy, so
    nothing here writes to the database.
    """
    config = config or EngineConfig()
    baseline_frame = build_frame(transactions)

    if baseline_frame.empty:
        return {"error": "no transactions to benchmark"}

    clean_result = analyse_frame(baseline_frame, config)
    injection = inject(baseline_frame, scenarios, seed=seed, approval_limit=approval_limit)
    injected_result = analyse_frame(injection.frame, config)

    report = evaluate(
        injected_result.findings,
        injection,
        total_rows=len(injection.frame),
        threshold=threshold,
    )
    curve = sweep_thresholds(injected_result.findings, injection, total_rows=len(injection.frame))

    return {
        "injection": injection.summary(),
        "planted_cases": [
            {
                "scenario": case.scenario,
                "rows": len(case.transaction_ids),
                "description": case.description,
                "detail": case.detail,
            }
            for case in injection.cases
        ],
        "metrics": report.to_dict(),
        "threshold_curve": curve,
        "clean_ledger": {
            "rows": int(len(baseline_frame)),
            "scored": clean_result.summary.get("total_scored", 0),
            "bands": clean_result.summary.get("bands", {}),
        },
        "injected_ledger": {
            "rows": int(len(injection.frame)),
            "scored": injected_result.summary.get("total_scored", 0),
            "bands": injected_result.summary.get("bands", {}),
        },
        "scenarios_available": list(AVAILABLE_SCENARIOS),
        "scenarios_unsupported": UNSUPPORTED_SCENARIOS,
        "data_quality": injected_result.diagnostics.get("data_quality", {}),
        "seed": seed,
    }
