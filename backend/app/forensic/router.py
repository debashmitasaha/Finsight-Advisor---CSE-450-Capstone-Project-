from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime
from statistics import mean, median, stdev

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.router import get_current_user
from app.database import get_db
from app.models import Anomaly, CaseAssignment, CaseTransaction, Department, Transaction, User

router = APIRouter(prefix="/forensic", tags=["Forensic"])

BENFORD = {1: 0.301, 2: 0.176, 3: 0.125, 4: 0.097, 5: 0.079, 6: 0.067, 7: 0.058, 8: 0.051, 9: 0.046}
FORENSIC_ANOMALY_TYPES = ("benford", "zscore", "rsf")


class ForensicRequest(BaseModel):
    dept_id: str
    month: int
    year: int
    zscore_threshold: float = 3.0
    rsf_threshold: float = 10.0
    benford_threshold: float = 0.2


def month_bounds(year: int, month: int):
    start = datetime(year, month, 1)
    if month == 12:
        end = datetime(year + 1, 1, 1)
    else:
        end = datetime(year, month + 1, 1)
    return start, end


def ensure_case(db: Session, dept_id: str, anomaly_type: str, period_label: str) -> CaseAssignment:
    case_name = f"{anomaly_type.title()} review {period_label}"
    case = db.query(CaseAssignment).filter(CaseAssignment.dept_id == dept_id, CaseAssignment.case_name == case_name).first()
    if case:
        return case
    case = CaseAssignment(dept_id=dept_id, case_name=case_name, resolved=False)
    db.add(case)
    db.flush()
    return case


def cohort_key(txn: Transaction) -> str:
    return txn.cleaned_chart_acc_head or txn.chart_acc_head or txn.group_name or "ungrouped"


def reset_period_forensic_flags(db: Session, transactions: list[Transaction]) -> None:
    transaction_ids = [txn.transaction_id for txn in transactions]
    if not transaction_ids:
        return

    stale_anomalies = (
        db.query(Anomaly)
        .filter(Anomaly.transaction_id.in_(transaction_ids))
        .filter(Anomaly.anomaly_type.in_(FORENSIC_ANOMALY_TYPES))
        .filter(Anomaly.is_resolved.is_(False))
        .all()
    )
    stale_transaction_ids = {anomaly.transaction_id for anomaly in stale_anomalies}

    for anomaly in stale_anomalies:
        anomaly.is_resolved = True

    for txn in transactions:
        if txn.transaction_id in stale_transaction_ids:
            txn.is_flagged = False
            txn.flagged_reason = None
            txn.risk_score = 0


def upsert_anomaly(db: Session, txn: Transaction, anomaly_type: str, score: float, threshold: float, evidence: dict):
    existing = (
        db.query(Anomaly)
        .filter(Anomaly.transaction_id == txn.transaction_id, Anomaly.anomaly_type == anomaly_type, Anomaly.is_resolved.is_(False))
        .first()
    )
    if existing:
        existing.score = score
        existing.threshold = threshold
        existing.evidence_snapshot = evidence
        return existing, False

    anomaly = Anomaly(
        transaction_id=txn.transaction_id,
        department_id=txn.department_id,
        anomaly_type=anomaly_type,
        score=score,
        threshold=threshold,
        evidence_snapshot=evidence,
    )
    db.add(anomaly)
    return anomaly, True


@router.post("/analyze")
def run_forensic_analysis(payload: ForensicRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    department = db.query(Department).filter(Department.department_id == payload.dept_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")

    start, end = month_bounds(payload.year, payload.month)
    transactions = (
        db.query(Transaction)
        .filter(Transaction.department_id == payload.dept_id)
        .filter(Transaction.transaction_date >= start, Transaction.transaction_date < end)
        .all()
    )
    if not transactions:
        return {"success": True, "message": "No transactions for period", "total_anomalies": 0}

    reset_period_forensic_flags(db, transactions)

    total_created = 0
    benford_count = 0
    zscore_count = 0
    rsf_count = 0
    period_label = f"{payload.year}-{payload.month:02d}"

    analysis_transactions = [txn for txn in transactions if float(txn.amount) > 0]

    digits = [int(str(int(abs(float(txn.amount))))[0]) for txn in analysis_transactions]
    digit_counts = Counter(digits)
    total_digits = len(digits) or 1
    deviating_digits = {
        digit
        for digit, expected in BENFORD.items()
        if abs((digit_counts.get(digit, 0) / total_digits) - expected) >= payload.benford_threshold
    }
    if deviating_digits:
        ensure_case(db, payload.dept_id, "benford", period_label)
    for txn in analysis_transactions:
        leading_digit = int(str(int(abs(float(txn.amount))))[0])
        if leading_digit in deviating_digits:
            evidence = {
                "digit": leading_digit,
                "observed_frequency": digit_counts.get(leading_digit, 0) / total_digits,
                "expected_frequency": BENFORD[leading_digit],
                "period": period_label,
            }
            _, created = upsert_anomaly(db, txn, "benford", evidence["observed_frequency"], payload.benford_threshold, evidence)
            txn.is_flagged = True
            txn.flagged_reason = f"Benford deviation for first digit {leading_digit}"
            txn.risk_score = max(float(txn.risk_score or 0), 0.7)
            if created:
                benford_count += 1
                total_created += 1

    cohorts = defaultdict(list)
    for txn in analysis_transactions:
        cohorts[cohort_key(txn)].append(txn)

    for group_name, cohort in cohorts.items():
        amounts = [float(txn.amount) for txn in cohort]
        if len(amounts) >= 5:
            avg = mean(amounts)
            std = stdev(amounts)
            if std > 0:
                for txn in cohort:
                    z_score = abs((float(txn.amount) - avg) / std)
                    if z_score > payload.zscore_threshold:
                        evidence = {"group_name": group_name, "mean": avg, "std": std, "period": period_label}
                        _, created = upsert_anomaly(db, txn, "zscore", z_score, payload.zscore_threshold, evidence)
                        txn.is_flagged = True
                        txn.flagged_reason = f"Z-score anomaly in {group_name}"
                        txn.risk_score = max(float(txn.risk_score or 0), min(1.0, z_score / 5))
                        if created:
                            zscore_count += 1
                            total_created += 1

        if len(amounts) >= 2:
            cohort_median = median(amounts)
            if cohort_median > 0:
                for txn in cohort:
                    rsf = float(txn.amount) / cohort_median
                    if rsf > payload.rsf_threshold:
                        evidence = {"group_name": group_name, "median": cohort_median, "period": period_label}
                        _, created = upsert_anomaly(db, txn, "rsf", rsf, payload.rsf_threshold, evidence)
                        txn.is_flagged = True
                        txn.flagged_reason = f"Relative size factor anomaly in {group_name}"
                        txn.risk_score = max(float(txn.risk_score or 0), min(1.0, rsf / 5))
                        if created:
                            rsf_count += 1
                            total_created += 1

    if total_created:
        case = ensure_case(db, payload.dept_id, "forensic", period_label)
        for txn in transactions:
            if txn.is_flagged and not db.query(CaseTransaction).filter(CaseTransaction.transaction_id == txn.transaction_id).first():
                db.add(CaseTransaction(transaction_id=txn.transaction_id, resolved=False))

    db.commit()
    return {
        "success": True,
        "benford_anomalies": benford_count,
        "zscore_anomalies": zscore_count,
        "rsf_anomalies": rsf_count,
        "total_anomalies": total_created,
    }


@router.get("/dept/{dept_id}/anomalies")
def get_anomalies(dept_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    anomalies = db.query(Anomaly).filter(Anomaly.department_id == dept_id).order_by(Anomaly.created_at.desc()).all()
    return [
        {
            "anomaly_id": anomaly.anomaly_id,
            "transaction_id": anomaly.transaction_id,
            "department_id": anomaly.department_id,
            "anomaly_type": anomaly.anomaly_type,
            "score": float(anomaly.score),
            "threshold": float(anomaly.threshold or 0),
            "evidence_snapshot": anomaly.evidence_snapshot,
            "is_resolved": anomaly.is_resolved,
            "created_at": anomaly.created_at.isoformat(),
        }
        for anomaly in anomalies
    ]


@router.patch("/anomaly/{anomaly_id}/resolve")
def resolve_anomaly(anomaly_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    anomaly = db.query(Anomaly).filter(Anomaly.anomaly_id == anomaly_id).first()
    if not anomaly:
        raise HTTPException(status_code=404, detail="Anomaly not found")
    anomaly.is_resolved = True
    txn = db.query(Transaction).filter(Transaction.transaction_id == anomaly.transaction_id).first()
    if txn and not any(item for item in txn.anomalies if item.anomaly_id != anomaly_id and not item.is_resolved):
        txn.is_flagged = False
        txn.flagged_reason = None
        txn.risk_score = 0
    db.commit()
    return {"success": True, "anomaly_id": anomaly_id}
