from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.router import get_current_user
from app.database import get_db
from app.forensic_engine.benchmark import run_benchmark
from app.forensic_engine.config import EngineConfig
from app.forensic_engine.engine import analyse_transactions
from app.forensic_engine.injection import AVAILABLE_SCENARIOS, UNSUPPORTED_SCENARIOS
from app.forensic_engine.models import ForensicFinding, ForensicRun
from app.models import Department, Transaction, User

router = APIRouter(prefix="/forensic-engine", tags=["Forensic Intelligence Engine"])


class AnalyseRequest(BaseModel):
    dept_id: str
    min_report_score: float = Field(default=60.0, ge=0, le=100)
    approval_thresholds: list[float] = Field(default_factory=list)
    """Real organisational approval limits. Supplying them makes the control tests exact
    instead of relying on limits inferred from spend clustering."""
    persist: bool = True


class BenchmarkRequest(BaseModel):
    dept_id: str
    scenarios: list[str] | None = None
    threshold: float = Field(default=60.0, ge=0, le=100)
    seed: int = 1337
    approval_limit: float | None = None


class ResolveRequest(BaseModel):
    note: str | None = None


def _department_or_404(db: Session, dept_id: str) -> Department:
    department = db.query(Department).filter(Department.department_id == dept_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")
    return department


def _transactions(db: Session, dept_id: str) -> list[Transaction]:
    return (
        db.query(Transaction)
        .filter(Transaction.department_id == dept_id)
        .order_by(Transaction.transaction_date.asc())
        .all()
    )


def _config(min_report_score: float, approval_thresholds: list[float]) -> EngineConfig:
    config = EngineConfig()
    config.min_report_score = min_report_score
    if approval_thresholds:
        config.approval_thresholds = tuple(sorted(approval_thresholds))
    return config


@router.get("/capabilities")
def capabilities(dept_id: str | None = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """What this engine can and cannot do on the data currently loaded.

    Exposed as an endpoint because the honest answer depends on the ledger: views that need
    vendor or approval-workflow columns stay dark until those columns arrive, and a UI that
    cannot tell the difference will present an empty result as a clean result.
    """
    payload = {
        "views": {
            "rule": "ACFE control tests: duplicate payment, repeated amounts, threshold avoidance, split purchasing, round-amount outliers",
            "behavioral": "Entity-relative anomaly detection with an Isolation Forest / LOF / One-Class SVM ensemble",
            "temporal": "Payment bursts, dormant reactivation, spending velocity, off-cycle activity",
            "relational": "Co-posting graph over vouchers: rare pairings, spend concentration, structural bridges",
        },
        "injection_scenarios": list(AVAILABLE_SCENARIOS),
        "unsupported_scenarios": UNSUPPORTED_SCENARIOS,
    }

    if dept_id:
        _department_or_404(db, dept_id)
        transactions = _transactions(db, dept_id)
        if transactions:
            result = analyse_transactions(transactions)
            payload["ledger"] = {
                "rows": result.diagnostics.get("rows_analysed"),
                "entity_kinds_active": result.diagnostics.get("entity_kinds_active"),
                "data_quality": result.diagnostics.get("data_quality"),
            }
        else:
            payload["ledger"] = {"rows": 0}
    return payload


@router.post("/analyze")
def analyze(payload: AnalyseRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _department_or_404(db, payload.dept_id)
    transactions = _transactions(db, payload.dept_id)
    if not transactions:
        return {"success": True, "message": "No transactions for department", "findings": [], "summary": {}}

    config = _config(payload.min_report_score, payload.approval_thresholds)
    result = analyse_transactions(transactions, config)
    reportable = result.top(config.max_findings, config.min_report_score)

    run_id = None
    if payload.persist:
        run = ForensicRun(
            department_id=payload.dept_id,
            rows_analysed=int(result.diagnostics.get("rows_analysed", 0)),
            findings_stored=len(reportable),
            min_report_score=config.min_report_score,
            diagnostics=result.diagnostics,
            summary=result.summary,
        )
        db.add(run)
        db.flush()
        run_id = run.run_id

        # A run is a snapshot, so the previous one for this department is cleared rather
        # than accumulated: leaving both would show an auditor the same transaction twice
        # with two different scores and no way to tell which is current.
        db.query(ForensicFinding).filter(ForensicFinding.department_id == payload.dept_id).delete(synchronize_session=False)

        for finding in reportable:
            db.add(
                ForensicFinding(
                    run_id=run_id,
                    transaction_id=finding.transaction_id,
                    department_id=payload.dept_id,
                    risk_score=finding.risk_score,
                    band=finding.band,
                    corroboration=finding.corroboration,
                    views_triggered=finding.views_triggered,
                    view_scores={view: round(score, 2) for view, score in finding.view_scores.items()},
                    evidence=finding.explanation(),
                )
            )
        db.commit()

    return {
        "success": True,
        "run_id": run_id,
        "summary": result.summary,
        "diagnostics": result.diagnostics,
        "reported": len(reportable),
        "min_report_score": config.min_report_score,
        "findings": [finding.to_dict() for finding in reportable],
    }


@router.get("/dept/{dept_id}/findings")
def list_findings(
    dept_id: str,
    band: str | None = None,
    min_score: float = Query(default=0.0, ge=0, le=100),
    include_resolved: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(ForensicFinding).filter(ForensicFinding.department_id == dept_id)
    if band:
        query = query.filter(ForensicFinding.band == band)
    if min_score:
        query = query.filter(ForensicFinding.risk_score >= min_score)
    if not include_resolved:
        query = query.filter(ForensicFinding.is_resolved.is_(False))

    findings = query.order_by(ForensicFinding.risk_score.desc()).all()
    return [
        {
            "finding_id": finding.finding_id,
            "transaction_id": finding.transaction_id,
            "risk_score": float(finding.risk_score),
            "band": finding.band,
            "corroboration": finding.corroboration,
            "views_triggered": finding.views_triggered,
            "view_scores": finding.view_scores,
            "evidence": finding.evidence,
            "is_resolved": finding.is_resolved,
            "created_at": finding.created_at.isoformat(),
        }
        for finding in findings
    ]


@router.get("/finding/{finding_id}/case-report")
def case_report(finding_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The full investigation packet for one transaction."""
    finding = db.query(ForensicFinding).filter(ForensicFinding.finding_id == finding_id).first()
    if not finding:
        raise HTTPException(status_code=404, detail="Finding not found")

    txn = db.query(Transaction).filter(Transaction.transaction_id == finding.transaction_id).first()

    return {
        "finding_id": finding.finding_id,
        "risk_score": float(finding.risk_score),
        "band": finding.band,
        "headline": f"Transaction scored {float(finding.risk_score):.0f}/100 ({finding.band}) on "
        f"{finding.corroboration} independent forensic view(s)",
        "transaction": None
        if txn is None
        else {
            "transaction_id": txn.transaction_id,
            "transaction_date": txn.transaction_date.isoformat(),
            "amount": float(txn.amount),
            "description": txn.description,
            "chart_acc_head": txn.chart_acc_head,
            "group_name": txn.group_name,
            "invoice_id": txn.invoice_id,
            "po_number": txn.po_number,
            "payment_method": txn.payment_method,
            "approval_status": txn.approval_status,
        },
        "view_scores": finding.view_scores,
        "why_flagged": [item["message"] for item in finding.evidence],
        "evidence": finding.evidence,
        "is_resolved": finding.is_resolved,
        "resolution_note": finding.resolution_note,
    }


@router.patch("/finding/{finding_id}/resolve")
def resolve_finding(
    finding_id: str,
    payload: ResolveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    finding = db.query(ForensicFinding).filter(ForensicFinding.finding_id == finding_id).first()
    if not finding:
        raise HTTPException(status_code=404, detail="Finding not found")
    finding.is_resolved = True
    finding.resolution_note = payload.note
    db.commit()
    return {"success": True, "finding_id": finding_id}


@router.post("/benchmark")
def benchmark(payload: BenchmarkRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Measure the engine by planting known fraud and seeing how much it recovers.

    Nothing is written to the database: injection happens on an in-memory copy of the
    ledger, so this can be run against production data without contaminating it.
    """
    _department_or_404(db, payload.dept_id)
    transactions = _transactions(db, payload.dept_id)
    if not transactions:
        raise HTTPException(status_code=400, detail="No transactions to benchmark")

    unknown = set(payload.scenarios or []) - set(AVAILABLE_SCENARIOS)
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown scenario(s): {', '.join(sorted(unknown))}. Available: {', '.join(AVAILABLE_SCENARIOS)}",
        )

    return run_benchmark(
        transactions,
        scenarios=payload.scenarios,
        threshold=payload.threshold,
        seed=payload.seed,
        approval_limit=payload.approval_limit,
    )
