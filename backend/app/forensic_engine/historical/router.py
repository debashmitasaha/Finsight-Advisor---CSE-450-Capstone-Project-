"""HTTP surface for historical full-population scanning.

Kept in its own router rather than bolted onto the row-level engine's: the two
answer different questions and their request shapes have nothing in common. The
prefix is shared so the client sees one coherent API.
"""

from __future__ import annotations

import time
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app import audit
from app.auth.router import get_current_user
from app.database import get_db
from app.forensic_engine.config import EngineConfig
from app.forensic_engine.engine import analyse_transactions
from app.forensic_engine.historical import case_calibration
from app.forensic_engine.historical.models import AnomalyCase, AnomalyCaseMember, HistoricalScanRun
from app.forensic_engine.historical.scan import run_scan
from app.forensic_engine.historical.types import HistoricalConfig
from app.models import Company, Department, Transaction, User

router = APIRouter(prefix="/forensic-engine", tags=["Historical Scan"])

REVIEW_STATUSES = {"pending", "confirmed", "cleared", "uncertain"}


class ScanRequest(BaseModel):
    company_id: str | None = None
    dept_id: str | None = None
    """Either identifies the company. A department is accepted because that is what
    the workspace has in hand; the scan always covers the whole company."""
    start_date: date | None = None
    end_date: date | None = None
    max_cases: int | None = Field(default=None, ge=5, le=500)


class CaseReviewRequest(BaseModel):
    status: str
    note: str | None = None


def _company_for(db: Session, payload_company: str | None, payload_dept: str | None, user: User) -> Company:
    if payload_company:
        company = db.query(Company).filter(Company.company_id == payload_company).first()
    elif payload_dept:
        department = db.query(Department).filter(Department.department_id == payload_dept).first()
        if not department:
            raise HTTPException(status_code=404, detail="Department not found")
        company = department.company
    else:
        company = db.query(Company).filter(Company.company_id == user.company_id).first() if user.company_id else None

    if not company:
        raise HTTPException(status_code=400, detail="A company is required for a historical scan")
    if user.company_id and str(user.company_id) != str(company.company_id):
        raise HTTPException(status_code=403, detail="That company belongs to a different organisation")
    return company


def _load_transactions(db: Session, company: Company, start: date | None, end: date | None) -> list[Transaction]:
    """Every department of the company, in one window.

    Ordered by date so the frame arrives already sorted, which every later stage
    assumes and none of them should have to redo.
    """
    department_ids = [row.department_id for row in db.query(Department).filter(Department.company_id == company.company_id)]
    if not department_ids:
        return []

    query = (
        db.query(Transaction)
        .options(joinedload(Transaction.expense_category))
        .filter(Transaction.department_id.in_(department_ids))
    )
    if start:
        query = query.filter(Transaction.transaction_date >= datetime.combine(start, datetime.min.time()))
    if end:
        query = query.filter(Transaction.transaction_date <= datetime.combine(end, datetime.max.time()))
    return query.order_by(Transaction.transaction_date.asc()).all()


def _serialize_scan(scan: HistoricalScanRun, cases: list[AnomalyCase] | None = None) -> dict:
    return {
        "scan_id": str(scan.scan_id),
        "company_id": str(scan.company_id),
        "status": scan.status,
        "engine_version": scan.engine_version,
        "start_date": scan.start_date.isoformat() if scan.start_date else None,
        "end_date": scan.end_date.isoformat() if scan.end_date else None,
        "row_count": scan.row_count,
        "case_count": scan.case_count,
        "config": scan.config_json,
        "diagnostics": scan.diagnostics_json,
        "created_at": scan.created_at.isoformat() if scan.created_at else None,
        "cases": [_serialize_case(case) for case in cases] if cases is not None else None,
    }


def _serialize_case(case: AnomalyCase, include_explanation: bool = False) -> dict:
    payload = {
        "case_id": str(case.case_id),
        "scan_id": str(case.scan_id),
        "title": case.title,
        "entity_type": case.entity_type,
        "entity_id": case.entity_id,
        "start_date": case.start_date.isoformat(),
        "end_date": case.end_date.isoformat(),
        "priority_score": float(case.priority_score),
        "band": case.band,
        "total_amount": float(case.total_amount),
        "member_count": case.member_count,
        "layer_count": case.layer_count,
        "codes": case.codes,
        "scores": case.scores_json,
        "review_status": case.review_status,
        "review_note": case.review_note,
        "reviewed_at": case.reviewed_at.isoformat() if case.reviewed_at else None,
    }
    if include_explanation:
        payload["explanation"] = case.explanation_json
        payload["evidence"] = case.evidence_json
    return payload


@router.post("/historical-scans")
def start_historical_scan(
    payload: ScanRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mine a company's whole history and store the ranked cases.

    Runs inline. The scan is bounded by a row limit and reports its own timings, so
    a caller always learns what it did; moving it to a worker changes where it runs,
    not what it returns.
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Only an administrator can start a historical scan")

    company = _company_for(db, payload.company_id, payload.dept_id, current_user)
    transactions = _load_transactions(db, company, payload.start_date, payload.end_date)

    config = HistoricalConfig()
    if payload.max_cases:
        config.max_cases = payload.max_cases

    result = run_scan(transactions, config)
    diagnostics = result.diagnostics
    status = diagnostics.get("status", "ok")

    scan = HistoricalScanRun(
        company_id=company.company_id,
        started_by=current_user.user_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        status=status,
        engine_version=diagnostics.get("engine_version", "unknown"),
        row_count=int(diagnostics.get("data_quality", {}).get("rows_scanned", len(transactions))),
        case_count=len(result.cases),
        config_json=config.to_dict(),
        diagnostics_json=diagnostics,
    )
    db.add(scan)
    db.flush()

    stored: list[AnomalyCase] = []
    for case in result.cases:
        row = AnomalyCase(
            scan_id=scan.scan_id,
            company_id=company.company_id,
            title=case.title,
            entity_type=case.entity_type,
            entity_id=case.entity_id,
            start_date=case.start,
            end_date=case.end,
            priority_score=case.priority,
            band=case.band,
            total_amount=case.amount,
            member_count=len(case.member_ids),
            layer_count=len(case.layers),
            codes=case.codes,
            scores_json=case.scores,
            evidence_json=[item.to_dict() for item in case.evidence],
            explanation_json=case.explanation,
        )
        db.add(row)
        db.flush()
        stored.append(row)
        # Members are capped per case: a case holding ten thousand rows is still
        # reviewed through its explanation and its strongest examples, and writing
        # every link would dominate the table for no benefit.
        for transaction_id in case.member_ids[:500]:
            db.add(AnomalyCaseMember(case_id=row.case_id, transaction_id=transaction_id))

    db.commit()

    audit.record(
        db,
        current_user.user_id,
        f"Ran a historical scan · {len(result.cases)} case{'' if len(result.cases) == 1 else 's'}",
    )

    return _serialize_scan(scan, stored)


@router.get("/historical-scans")
def list_historical_scans(
    company_id: str | None = None,
    limit: int = Query(default=10, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(HistoricalScanRun)
    scope = company_id or current_user.company_id
    if scope:
        query = query.filter(HistoricalScanRun.company_id == str(scope))
    scans = query.order_by(HistoricalScanRun.created_at.desc()).limit(limit).all()
    return [_serialize_scan(scan) for scan in scans]


@router.get("/historical-scans/{scan_id}")
def get_historical_scan(
    scan_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    scan = db.query(HistoricalScanRun).filter(HistoricalScanRun.scan_id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    if current_user.company_id and str(current_user.company_id) != str(scan.company_id):
        raise HTTPException(status_code=403, detail="That scan belongs to a different company")
    return _serialize_scan(scan)


@router.get("/historical-scans/{scan_id}/cases")
def list_cases(
    scan_id: str,
    band: str | None = None,
    review_status: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    scan = db.query(HistoricalScanRun).filter(HistoricalScanRun.scan_id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    if current_user.company_id and str(current_user.company_id) != str(scan.company_id):
        raise HTTPException(status_code=403, detail="That scan belongs to a different company")

    query = db.query(AnomalyCase).filter(AnomalyCase.scan_id == scan_id)
    if band:
        query = query.filter(AnomalyCase.band == band)
    if review_status:
        query = query.filter(AnomalyCase.review_status == review_status)
    cases = query.order_by(AnomalyCase.priority_score.desc()).limit(limit).all()
    return [_serialize_case(case) for case in cases]


@router.get("/cases/{case_id}")
def get_case(
    case_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """One case with its full explanation packet and its member transactions."""
    case = db.query(AnomalyCase).filter(AnomalyCase.case_id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    if current_user.company_id and str(current_user.company_id) != str(case.company_id):
        raise HTTPException(status_code=403, detail="That case belongs to a different company")

    member_ids = [row.transaction_id for row in db.query(AnomalyCaseMember).filter(AnomalyCaseMember.case_id == case_id)]
    members = []
    if member_ids:
        rows = (
            db.query(Transaction)
            .filter(Transaction.transaction_id.in_(member_ids))
            .order_by(Transaction.transaction_date.asc())
            .all()
        )
        members = [
            {
                "transaction_id": str(row.transaction_id),
                "transaction_date": row.transaction_date.isoformat() if row.transaction_date else None,
                "amount": float(row.amount or 0),
                "description": row.description,
                "chart_acc_head": row.chart_acc_head,
                "invoice_id": row.invoice_id,
                "group_name": row.group_name,
                "is_flagged": bool(row.is_flagged),
            }
            for row in rows
        ]

    payload = _serialize_case(case, include_explanation=True)
    payload["members"] = members
    payload["members_truncated"] = case.member_count > len(members)
    return payload


@router.get("/case-calibration")
def get_case_calibration(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Where the case priority line sits for this company, and what moved it.

    Learned from case verdicts only. The row-level engine's threshold is a separate
    number learned from separate evidence, and neither is allowed to stand in for the
    other.
    """
    if not current_user.company_id:
        raise HTTPException(status_code=400, detail="A company is required")

    rows = (
        db.query(AnomalyCase.priority_score, AnomalyCase.review_status)
        .filter(AnomalyCase.company_id == current_user.company_id)
        .all()
    )
    result = case_calibration.calibrate([(float(priority), status) for priority, status in rows])
    payload = result.to_dict()
    payload["cases_total"] = len(rows)
    payload["awaiting_review"] = sum(1 for _, status in rows if status == "pending")
    return payload


@router.post("/cases/{case_id}/detailed-analysis")
def analyse_case_in_detail(
    case_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Zoom in: run the four row-level views on this case's transactions alone.

    The five-year scan answers "where is the problem?". It has to skip the row-level
    views on a large ledger because they cost minutes there. But a case is small - a
    few hundred rows at most - so the views that were too slow for the whole history
    are cheap here, and they answer the second question: *which* of these payments is
    suspicious, and on what grounds.

    The alternative was asking the reviewer to cut the case out into a spreadsheet and
    upload it again, which is the kind of step that quietly never gets done.
    """
    case = db.query(AnomalyCase).filter(AnomalyCase.case_id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    if current_user.company_id and str(current_user.company_id) != str(case.company_id):
        raise HTTPException(status_code=403, detail="That case belongs to a different company")

    member_ids = [row.transaction_id for row in db.query(AnomalyCaseMember).filter(AnomalyCaseMember.case_id == case_id)]
    if not member_ids:
        return {
            "case_id": str(case.case_id),
            "status": "empty",
            "reason": "This case has no stored member transactions to examine.",
            "findings": [],
        }

    transactions = (
        db.query(Transaction)
        .filter(Transaction.transaction_id.in_(member_ids))
        .order_by(Transaction.transaction_date.asc())
        .all()
    )
    if not transactions:
        return {
            "case_id": str(case.case_id),
            "status": "empty",
            "reason": "The transactions behind this case are no longer in the ledger.",
            "findings": [],
        }

    started = time.perf_counter()
    result = analyse_transactions(transactions, EngineConfig())
    took = round(time.perf_counter() - started, 2)

    # Every view's opinion on every row, ordered worst first. The case is the context,
    # so even rows the views consider clean are worth being able to see.
    findings = []
    for finding in sorted(result.findings, key=lambda item: item.risk_score, reverse=True):
        findings.append(
            {
                "transaction_id": str(finding.transaction_id),
                "risk_score": round(float(finding.risk_score), 2),
                "band": finding.band,
                "views_triggered": list(finding.views_triggered),
                "view_scores": {view: round(float(score), 3) for view, score in finding.view_scores.items()},
                "corroboration": int(finding.corroboration),
                "signals": [
                    {
                        "view": signal.view,
                        "code": signal.code,
                        "strength": round(float(signal.strength), 3),
                        "message": signal.message,
                    }
                    for signal in sorted(finding.signals, key=lambda item: item.strength, reverse=True)
                ],
            }
        )

    by_view: dict[str, int] = {}
    for finding in result.findings:
        for view in finding.views_triggered:
            by_view[view] = by_view.get(view, 0) + 1

    flagged = [row for row in findings if row["risk_score"] >= 60]
    audit.record(
        db,
        current_user.user_id,
        f"Ran detailed row analysis on a case · {len(flagged)} row(s) above the alert line",
    )

    return {
        "case_id": str(case.case_id),
        "status": "ok",
        "rows_examined": len(transactions),
        "seconds": took,
        "alert_line": 60,
        "rows_above_alert_line": len(flagged),
        "views_that_fired": by_view,
        "findings": findings,
        "caveat": (
            "These scores rank the rows inside one case against each other and against this "
            "company's own history. They do not re-open the question of whether the case itself "
            "is a problem - only a reviewer decides that."
        ),
    }


@router.post("/cases/{case_id}/review")
def review_case(
    case_id: str,
    payload: CaseReviewRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Record a verdict on a case.

    Ground truth is collected here, at the level the auditor actually investigates.
    Row-level verdicts stay where they are; the two are different judgements and
    mixing them would make either one impossible to measure.
    """
    if payload.status not in REVIEW_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of {sorted(REVIEW_STATUSES)}")

    case = db.query(AnomalyCase).filter(AnomalyCase.case_id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    if current_user.company_id and str(current_user.company_id) != str(case.company_id):
        raise HTTPException(status_code=403, detail="That case belongs to a different company")

    case.review_status = payload.status
    case.review_note = (payload.note or "").strip() or None
    case.reviewed_by = current_user.user_id
    case.reviewed_at = datetime.now(timezone.utc)
    db.commit()

    audit.record(db, current_user.user_id, f"Reviewed a historical case · {payload.status}")

    return {"success": True, "case": _serialize_case(case)}
