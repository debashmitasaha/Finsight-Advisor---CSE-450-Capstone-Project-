from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from app.forensic_engine.config import EngineConfig
from app.forensic_engine.features import active_entity_kinds, build_baselines, build_frame
from app.forensic_engine.fusion import FusedFinding, fuse, summarise
from app.forensic_engine.injection import UNSUPPORTED_SCENARIOS
from app.forensic_engine.signals import Signal
from app.forensic_engine.views import behavioral, relational, rules, temporal
from app.forensic_engine.views.behavioral import grouping_ratio


VIEW_MODULES = {
    "rule": rules,
    "behavioral": behavioral,
    "temporal": temporal,
    "relational": relational,
}


@dataclass
class EngineResult:
    findings: list[FusedFinding]
    summary: dict
    diagnostics: dict = field(default_factory=dict)
    frame: pd.DataFrame | None = None

    def top(self, limit: int, min_score: float) -> list[FusedFinding]:
        return [finding for finding in self.findings if finding.risk_score >= min_score][:limit]


def analyse_frame(frame: pd.DataFrame, config: EngineConfig | None = None) -> EngineResult:
    """Run every view over a prepared frame and fuse the evidence."""
    config = config or EngineConfig()

    if frame.empty:
        return EngineResult(findings=[], summary={"total_scored": 0}, diagnostics={"reason": "no transactions"}, frame=frame)

    # Forensics is about money leaving the organisation. Receipts belong in the ledger but
    # scoring them would flag a large customer payment as a suspicious disbursement.
    full_frame = frame
    if "transaction_type" in frame.columns:
        spending = frame[frame["transaction_type"].str.lower() != "credit"]
        if not spending.empty:
            frame = spending.reset_index(drop=True)

    baselines = build_baselines(frame, config)

    all_signals: list[Signal] = []
    view_diagnostics: dict[str, dict] = {}

    for view_name, module in VIEW_MODULES.items():
        try:
            signals, meta = module.run(frame, baselines, config)
        except Exception as exc:  # one failing view must not lose the other three
            view_diagnostics[view_name] = {"status": "error", "error": str(exc)}
            continue
        all_signals.extend(signals)
        view_diagnostics[view_name] = {"status": "ok", "signals": len(signals), **meta}

    findings = fuse(all_signals, config)

    diagnostics = {
        "rows_analysed": int(len(frame)),
        "rows_in_ledger": int(len(full_frame)),
        "credit_rows_excluded": int(len(full_frame) - len(frame)),
        "positive_rows": int((frame["amount"] > 0).sum()),
        "zero_amount_rows": int((frame["amount"] == 0).sum()),
        "date_range": {
            "from": str(frame["transaction_date"].min().date()),
            "to": str(frame["transaction_date"].max().date()),
        },
        "entity_kinds_active": [kind for kind, _ in active_entity_kinds(frame)],
        "entity_counts": {kind: len(values) for kind, values in baselines.items()},
        "data_quality": _data_quality(frame, config),
        "views": view_diagnostics,
        "signals_total": len(all_signals),
        "unsupported_without_extra_columns": UNSUPPORTED_SCENARIOS,
        "view_credibility": config.view_credibility,
    }

    return EngineResult(findings=findings, summary=summarise(findings), diagnostics=diagnostics, frame=frame)


def _data_quality(frame: pd.DataFrame, config: EngineConfig) -> dict:
    """Conditions upstream of the engine that limit what any view can find.

    Surfaced rather than silently absorbed, because a run that finds little because the
    data is thin looks identical to a clean ledger unless the difference is stated.
    """
    warnings: list[str] = []

    ratio = grouping_ratio(frame)
    if ratio >= config.degenerate_group_ratio:
        warnings.append(
            f"Grouping produced {ratio:.2f} groups per account head, so group-level signals were "
            "suppressed as duplicates of head-level ones. Semantic grouping is likely not running."
        )

    zero_share = float((frame["amount"] == 0).mean())
    if zero_share > 0.20:
        warnings.append(
            f"{zero_share:.0%} of rows carry amount = 0 and are invisible to every view. "
            "If the source ledger has a Credit column, it is not being ingested."
        )

    span = (frame["transaction_date"].max() - frame["transaction_date"].min()).days
    if span < 90:
        warnings.append(
            f"Ledger spans only {span} day(s); temporal and relational views need months of "
            "history before dormancy, velocity and co-posting habits become measurable."
        )

    vouchers = frame.loc[frame["invoice_id"].astype(str).str.len() > 0, "invoice_id"].nunique()
    if vouchers < config.min_vouchers_for_rarity:
        warnings.append(
            f"Only {vouchers} distinct voucher references; relational rarity testing needs at least "
            f"{config.min_vouchers_for_rarity}."
        )

    return {
        "grouping_ratio": round(ratio, 3),
        "zero_amount_share": round(zero_share, 3),
        "ledger_span_days": int(span),
        "distinct_vouchers": int(vouchers),
        "warnings": warnings,
    }


def analyse_transactions(transactions: list, config: EngineConfig | None = None) -> EngineResult:
    """Entry point used by the API: ORM rows in, fused findings out."""
    frame = build_frame(transactions)
    return analyse_frame(frame, config)
