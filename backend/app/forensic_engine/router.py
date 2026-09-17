from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.auth.router import get_current_user
from app.database import get_db
from app.forensic_engine import calibration as cal
from app.forensic_engine.benchmark import run_benchmark
from app.forensic_engine.calibration import CalibrationOutcome, LabelledRow
from app.forensic_engine.config import ENGINE_VERSION, CalibrationConfig, EngineConfig, risk_band
from app.forensic_engine.engine import analyse_transactions
from app.forensic_engine.injection import AVAILABLE_SCENARIOS, UNSUPPORTED_SCENARIOS
from app.forensic_engine.models import (
    CompanyForensicConfig,
    ForensicFinding,
    ForensicReview,
    ForensicRun,
    ThresholdCalibrationHistory,
)
from app.models import Company, Department, Transaction, User

router = APIRouter(prefix="/forensic-engine", tags=["Forensic Intelligence Engine"])

CALIBRATION = CalibrationConfig()


# ------------------------------------------------------------------------- requests


class AnalyseRequest(BaseModel):
    dept_id: str
    min_report_score: float | None = Field(default=None, ge=0, le=100)
    """Manual override of the alert threshold for this run only. Leave unset — the normal
    case — and the run alerts at the company's active threshold: bootstrap until the
    company has calibrated, its own validated threshold after."""
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


class ReviewRequest(BaseModel):
    dept_id: str
    transaction_id: str
    label: Literal["confirmed", "cleared", "uncertain"]
    note: str | None = None
    finding_id: str | None = None
    source: Literal["alert", "sample"] = "alert"


class CalibrateRequest(BaseModel):
    dept_id: str


# -------------------------------------------------------------------------- helpers


def _department_or_404(db: Session, dept_id: str) -> Department:
    department = db.query(Department).filter(Department.department_id == dept_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")
    return department


def _company_or_400(department: Department) -> Company:
    if department.company is None:
        raise HTTPException(
            status_code=400,
            detail="This department is not attached to a company. Reviewer ground truth and alert "
            "thresholds are pooled per company, so attach it to one first.",
        )
    return department.company


def _transactions(db: Session, dept_id: str) -> list[Transaction]:
    # The approved expense category is loaded with the rows so the engine can use it as an
    # entity without a query per transaction.
    return (
        db.query(Transaction)
        .options(joinedload(Transaction.expense_category))
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


def _config_row(db: Session, company_id: str, create: bool) -> CompanyForensicConfig | None:
    row = db.get(CompanyForensicConfig, company_id)
    if row is None and create:
        row = CompanyForensicConfig(company_id=company_id)
        db.add(row)
        db.flush()
    return row


def _threshold_for(config_row: CompanyForensicConfig | None) -> tuple[float, str, str]:
    """(value, source, mode) that applies to a company right now."""
    mode = config_row.calibration_mode if config_row else cal.MODE_BOOTSTRAP
    stored = float(config_row.active_threshold) if config_row and config_row.active_threshold is not None else None
    value, source = cal.active_threshold(mode, stored, CALIBRATION)
    return value, source, mode


def _threshold_payload(value: float, source: str, mode: str) -> dict:
    return {"value": value, "source": source, "label": cal.SOURCE_LABELS.get(source, source), "mode": mode}


def _as_utc(stamp: datetime | None) -> datetime:
    if stamp is None:
        return cal.utcnow()
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)


def _iso(stamp: datetime | None) -> str | None:
    return _as_utc(stamp).isoformat() if stamp else None


def _labelled_rows(db: Session, company_id: str) -> list[LabelledRow]:
    reviews = db.query(ForensicReview).filter(ForensicReview.company_id == company_id).all()
    return [
        LabelledRow(
            transaction_id=review.transaction_id,
            risk_score=float(review.risk_score_at_review),
            label=review.label,
            reviewed_at=_as_utc(review.reviewed_at),
        )
        for review in reviews
    ]


def _count_labels(rows: list[LabelledRow]) -> dict:
    confirmed = sum(1 for row in rows if row.label == cal.LABEL_CONFIRMED)
    cleared = sum(1 for row in rows if row.label == cal.LABEL_CLEARED)
    uncertain = sum(1 for row in rows if row.label == cal.LABEL_UNCERTAIN)
    return {
        "reviewed": len(rows),
        "confirmed": confirmed,
        "cleared": cleared,
        "uncertain": uncertain,
        "usable": confirmed + cleared,
    }


def _refresh_counts(config_row: CompanyForensicConfig, rows: list[LabelledRow]) -> None:
    counts = _count_labels(rows)
    config_row.reviewed_count = counts["reviewed"]
    config_row.positive_count = counts["confirmed"]
    config_row.negative_count = counts["cleared"]
    config_row.uncertain_count = counts["uncertain"]
    config_row.calibration_mode = cal.maturity_mode(counts["reviewed"], config_row.active_threshold is not None)


def _txn_summary(txn: Transaction) -> dict:
    return {
        "transaction_id": txn.transaction_id,
        "transaction_date": txn.transaction_date.isoformat(),
        "amount": float(txn.amount),
        "transaction_type": (getattr(txn, "transaction_type", None) or "debit").lower(),
        "description": txn.description,
        "chart_acc_head": txn.chart_acc_head,
        "group_name": txn.group_name,
        "invoice_id": txn.invoice_id,
        "po_number": txn.po_number,
        "payment_method": txn.payment_method,
        "approval_status": txn.approval_status,
    }


def _serialize_review(review: ForensicReview) -> dict:
    return {
        "review_id": review.review_id,
        "transaction_id": review.transaction_id,
        "finding_id": review.finding_id,
        "label": review.label,
        "note": review.review_note,
        "source": review.review_source,
        "risk_score_at_review": float(review.risk_score_at_review),
        "threshold_at_review": float(review.threshold_at_review),
        "engine_version": review.engine_version,
        "reviewed_at": _iso(review.reviewed_at),
        "reviewer": review.reviewer.username if review.reviewer else None,
    }


def _serialize_finding(finding: ForensicFinding, review: ForensicReview | None) -> dict:
    return {
        "finding_id": finding.finding_id,
        "transaction_id": finding.transaction_id,
        "risk_score": float(finding.risk_score),
        "band": finding.band,
        "corroboration": finding.corroboration,
        "views_triggered": finding.views_triggered,
        "view_scores": finding.view_scores,
        "evidence": finding.evidence,
        "is_alert": finding.is_alert,
        "is_resolved": finding.is_resolved,
        "created_at": _iso(finding.created_at),
        "review": _serialize_review(review) if review else None,
    }


def _serialize_history(entry: ThresholdCalibrationHistory) -> dict:
    metrics = entry.metrics or {}
    return {
        "calibration_id": entry.calibration_id,
        "created_at": _iso(entry.created_at),
        "triggered_by": entry.triggered_by,
        "outcome": entry.outcome,
        "reason": entry.reason,
        "old_threshold": float(entry.old_threshold),
        "candidate_threshold": float(entry.candidate_threshold),
        "activated_threshold": float(entry.activated_threshold) if entry.activated_threshold is not None else None,
        "validation": metrics.get("validation"),
        "calibration": metrics.get("calibration"),
        "current_validation": metrics.get("current_validation"),
        "review_count": entry.review_count,
        "positive_count": entry.positive_count,
        "negative_count": entry.negative_count,
        "calibration_rows": entry.calibration_rows,
        "validation_rows": entry.validation_rows,
        "calibration_data_start": _iso(entry.calibration_data_start),
        "calibration_data_end": _iso(entry.calibration_data_end),
        "sweep": entry.sweep,
        "checks": entry.checks,
        "engine_version": entry.engine_version,
    }


def _requirements() -> dict:
    return {
        "bootstrap_threshold": CALIBRATION.bootstrap_threshold,
        "min_reviewed_rows": CALIBRATION.min_reviewed_rows,
        "min_positive_labels": CALIBRATION.min_positive_labels,
        "min_negative_labels": CALIBRATION.min_negative_labels,
        "calibration_share": CALIBRATION.calibration_share,
        "candidate_thresholds": list(CALIBRATION.candidate_thresholds),
        "min_validation_positive": CALIBRATION.min_validation_positive,
        "min_validation_negative": CALIBRATION.min_validation_negative,
        "max_validation_drop": CALIBRATION.max_validation_drop,
        "recalibration_batch": CALIBRATION.recalibration_batch,
    }


def _sampling() -> dict:
    return {
        "near_miss_share": CALIBRATION.near_miss_share,
        "sample_rate_near": CALIBRATION.sample_rate_near,
        "sample_rate_low": CALIBRATION.sample_rate_low,
        "sample_min_near": CALIBRATION.sample_min_near,
        "sample_min_low": CALIBRATION.sample_min_low,
        "priority_score": CALIBRATION.priority_score,
    }


def _narrative(
    company_name: str,
    mode: str,
    value: float,
    counts: dict,
    ready: dict,
    config_row: CompanyForensicConfig | None,
    last: ThresholdCalibrationHistory | None,
    since: int,
) -> tuple[str, str, list[str]]:
    """Plain-language account of where the company stands: what is happening, and — just
    as important for anyone reading the screen — what is *not*."""
    benchmark_note = (
        "The synthetic benchmark (planted fraud) does not feed this threshold. "
        "It only checks that the engine can find fraud it is known to contain."
    )
    stamp = lambda entry: _as_utc(entry.created_at).strftime("%Y-%m-%d") if entry else "?"  # noqa: E731

    if mode == cal.MODE_BOOTSTRAP:
        return (
            "Not enough company ground truth",
            f"No transaction in {company_name} has been reviewed yet, so there is no company-specific ground "
            f"truth. Alerts use the bootstrap threshold of {value:.0f}, which comes from the reference benchmark "
            f"and fraud-control practice — not from this company's data.",
            [
                "F1 is not being used to choose the threshold. There are no company labels to compute it from.",
                "The threshold has not been tuned to this company. It is the same starting line every new company gets.",
                benchmark_note,
            ],
        )

    if mode == cal.MODE_WARMUP:
        explanation = (
            f"{counts['reviewed']} of {company_name}'s transactions have been reviewed "
            f"({counts['confirmed']} confirmed, {counts['cleared']} cleared, {counts['uncertain']} uncertain). "
            f"The bootstrap threshold of {value:.0f} stays in force until at least "
            f"{CALIBRATION.min_reviewed_rows} reviews with {CALIBRATION.min_positive_labels} confirmed and "
            f"{CALIBRATION.min_negative_labels} cleared exist."
        )
        not_happening = [
            "The threshold is still the bootstrap value. It has not been tuned to this company.",
            benchmark_note,
        ]
        if ready["ready"]:
            explanation += " Those minimums are now met, so a calibration can run."
            if last and last.outcome == "rejected":
                explanation += (
                    f" The last attempt on {stamp(last)} proposed {float(last.candidate_threshold):.0f}, but it failed "
                    f"validation, so bootstrap remains."
                )
                not_happening.insert(
                    0,
                    "F1 has been computed, but no candidate threshold has passed held-out validation yet, "
                    "so the alert line has not moved.",
                )
            else:
                not_happening.insert(0, "F1 has not yet been used: no calibration has run since the minimums were met.")
        else:
            not_happening.insert(0, "F1 is not yet being used to choose the threshold. The minimums are not all met.")
        return "Collecting reviewer ground truth", explanation, not_happening

    # calibrated
    calibrated_on = _as_utc(config_row.calibrated_at).strftime("%Y-%m-%d") if config_row and config_row.calibrated_at else "?"
    activated = next((entry for entry in [last] if entry and entry.outcome == "activated"), None)
    at_the_time = f" ({activated.review_count} reviews at the time)" if activated else ""
    precision = float(config_row.precision or 0) if config_row else 0.0
    recall = float(config_row.recall or 0) if config_row else 0.0
    f1 = float(config_row.f1 or 0) if config_row else 0.0
    explanation = (
        f"Threshold {value:.0f} was selected from {company_name}'s own reviewed ground truth on {calibrated_on}"
        f"{at_the_time}. It gave the best F1 on the older labels and held up on the newer ones: held-out precision "
        f"{precision:.0%}, recall {recall:.0%}, F1 {f1:.2f}. It recalibrates automatically after every "
        f"{CALIBRATION.recalibration_batch} new reviews ({since} so far)."
    )
    if last and last.outcome == "rejected":
        explanation += (
            f" The most recent attempt on {stamp(last)} proposed {float(last.candidate_threshold):.0f}, but it failed "
            f"validation, so {value:.0f} remains."
        )
    return (
        "Company-specific threshold active",
        explanation,
        [
            f"The bootstrap threshold of {CALIBRATION.bootstrap_threshold:.0f} is no longer used for this company.",
            "The threshold is not re-chosen on every review. It only changes after a recalibration passes validation.",
            benchmark_note,
        ],
    )


def _calibration_status(db: Session, department: Department, company: Company | None) -> dict:
    """Everything the UI needs to explain the company's alert line in one payload."""
    if company is None:
        value, source = CALIBRATION.bootstrap_threshold, cal.SOURCE_BOOTSTRAP
        empty = _count_labels([])
        return {
            "company": None,
            "department": {"department_id": department.department_id, "department_name": department.department_name},
            "engine_version": ENGINE_VERSION,
            "mode": cal.MODE_BOOTSTRAP,
            "threshold": _threshold_payload(value, source, cal.MODE_BOOTSTRAP),
            "bootstrap_threshold": CALIBRATION.bootstrap_threshold,
            "counts": empty,
            "readiness": cal.readiness(0, 0, 0, CALIBRATION),
            "requirements": _requirements(),
            "sampling": _sampling(),
            "recalibration": {"reviews_since_last": 0, "batch": CALIBRATION.recalibration_batch, "due": False, "ever_calibrated": False},
            "active_metrics": None,
            "calibrated_at": None,
            "candidate": None,
            "last_calibration": None,
            "history": [],
            "status_text": "Department is not attached to a company",
            "explanation": "Reviewer ground truth and alert thresholds are pooled per company. Attach this department "
            "to a company to start collecting reviews; until then the bootstrap threshold applies.",
            "not_happening": ["No reviews can be recorded for this department yet."],
        }

    config_row = _config_row(db, company.company_id, create=False)
    rows = _labelled_rows(db, company.company_id)
    counts = _count_labels(rows)
    ready = cal.readiness(counts["reviewed"], counts["confirmed"], counts["cleared"], CALIBRATION)
    value, source, mode = _threshold_for(config_row)
    if config_row is None:
        mode = cal.maturity_mode(counts["reviewed"], False)

    history = (
        db.query(ThresholdCalibrationHistory)
        .filter(ThresholdCalibrationHistory.company_id == company.company_id)
        .order_by(ThresholdCalibrationHistory.created_at.desc())
        .limit(12)
        .all()
    )
    last = history[0] if history else None
    since = counts["reviewed"] - (config_row.reviews_at_last_calibration if config_row else 0)
    ever = bool(config_row and config_row.candidate_status)
    due = cal.recalibration_due(since, ever, ready["ready"], CALIBRATION)
    status_text, explanation, not_happening = _narrative(company.company_name, mode, value, counts, ready, config_row, last, since)

    active_metrics = None
    if config_row and config_row.threshold_source == cal.SOURCE_COMPANY_F1 and config_row.f1 is not None:
        active_metrics = {
            "precision": float(config_row.precision or 0),
            "recall": float(config_row.recall or 0),
            "f1": float(config_row.f1 or 0),
            "false_positive_rate": float(config_row.false_positive_rate or 0),
        }

    candidate = None
    if config_row and config_row.candidate_threshold is not None:
        candidate = {"threshold": float(config_row.candidate_threshold), "status": config_row.candidate_status}

    return {
        "company": {"company_id": company.company_id, "company_name": company.company_name},
        "department": {"department_id": department.department_id, "department_name": department.department_name},
        "engine_version": ENGINE_VERSION,
        "mode": mode,
        "threshold": _threshold_payload(value, source, mode),
        "bootstrap_threshold": CALIBRATION.bootstrap_threshold,
        "counts": counts,
        "readiness": ready,
        "requirements": _requirements(),
        "sampling": _sampling(),
        "recalibration": {
            "reviews_since_last": max(since, 0),
            "batch": CALIBRATION.recalibration_batch,
            "due": due,
            "ever_calibrated": ever,
        },
        "active_metrics": active_metrics,
        "calibrated_at": _iso(config_row.calibrated_at) if config_row else None,
        "candidate": candidate,
        "last_calibration": _serialize_history(last) if last else None,
        "history": [_serialize_history(entry) for entry in history],
        "status_text": status_text,
        "explanation": explanation,
        "not_happening": not_happening,
    }


def _run_calibration(
    db: Session,
    company: Company,
    config_row: CompanyForensicConfig,
    triggered_by: str,
) -> tuple[CalibrationOutcome, ThresholdCalibrationHistory | None]:
    """Run one calibration for a company and persist the outcome.

    A not-ready outcome writes nothing: it is an answer ("too few labels"), not an event.
    A ready outcome is always recorded, activated or rejected, so the history shows every
    time the question was asked and what the data said.
    """
    rows = _labelled_rows(db, company.company_id)
    _refresh_counts(config_row, rows)
    current, _, _ = _threshold_for(config_row)

    outcome = cal.calibrate(rows, current_threshold=current, config=CALIBRATION)
    if not outcome.ready:
        return outcome, None

    validation = outcome.validation_metrics or {}
    entry = ThresholdCalibrationHistory(
        company_id=company.company_id,
        old_threshold=current,
        candidate_threshold=outcome.candidate_threshold,
        activated_threshold=outcome.candidate_threshold if outcome.activated else None,
        outcome="activated" if outcome.activated else "rejected",
        reason=outcome.reason,
        triggered_by=triggered_by,
        precision=validation.get("precision"),
        recall=validation.get("recall"),
        f1=validation.get("f1"),
        false_positive_rate=validation.get("false_positive_rate"),
        calibration_f1=(outcome.calibration_metrics or {}).get("f1"),
        review_count=outcome.reviewed_count,
        positive_count=outcome.positive_count,
        negative_count=outcome.negative_count,
        calibration_rows=outcome.calibration_rows,
        validation_rows=outcome.validation_rows,
        calibration_data_start=outcome.data_start,
        calibration_data_end=outcome.data_end,
        sweep=outcome.sweep,
        checks=[check.to_dict() for check in outcome.checks],
        metrics={
            "calibration": outcome.calibration_metrics,
            "validation": outcome.validation_metrics,
            "current_validation": outcome.current_validation_metrics,
        },
        engine_version=ENGINE_VERSION,
    )
    db.add(entry)

    config_row.candidate_threshold = outcome.candidate_threshold
    config_row.candidate_status = entry.outcome
    config_row.reviews_at_last_calibration = len(rows)
    config_row.engine_version = ENGINE_VERSION
    if outcome.activated:
        config_row.active_threshold = outcome.candidate_threshold
        config_row.threshold_source = cal.SOURCE_COMPANY_F1
        config_row.calibration_mode = cal.MODE_CALIBRATED
        config_row.precision = validation.get("precision")
        config_row.recall = validation.get("recall")
        config_row.f1 = validation.get("f1")
        config_row.false_positive_rate = validation.get("false_positive_rate")
        config_row.calibrated_at = cal.utcnow()
    db.flush()
    return outcome, entry


# ------------------------------------------------------------------------ endpoints


@router.get("/capabilities")
def capabilities(dept_id: str | None = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """What this engine can and cannot do on the data currently loaded.

    Exposed as an endpoint because the honest answer depends on the ledger: views that need
    vendor or approval-workflow columns stay dark until those columns arrive, and a UI that
    cannot tell the difference will present an empty result as a clean result.
    """
    payload = {
        "engine_version": ENGINE_VERSION,
        "views": {
            "rule": "ACFE control tests: duplicate payment, repeated amounts, threshold avoidance, split purchasing, round-amount outliers",
            "behavioral": "Entity-relative anomaly detection with an Isolation Forest / LOF / One-Class SVM ensemble",
            "temporal": "Payment bursts, dormant reactivation, spending velocity, off-cycle activity",
            "relational": "Co-posting graph over vouchers: rare pairings, spend concentration, structural bridges",
        },
        "injection_scenarios": list(AVAILABLE_SCENARIOS),
        "unsupported_scenarios": UNSUPPORTED_SCENARIOS,
        "entities": (
            "Account head and semantic group always; approved expense category (from the categorization "
            "pipeline) as a fallback cohort for heads with too little history; vendor, employee and approver "
            "the day the ledger carries those columns"
        ),
        "calibration": _requirements(),
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
    """Score every transaction in a department and alert at the company's threshold.

    The engine's scoring is unchanged by calibration — baselines are still built only from
    this department's own history. What calibration changes is the line: which scores
    count as alerts. That line is looked up per company here, never hard-coded.
    """
    department = _department_or_404(db, payload.dept_id)
    company = department.company
    config_row = _config_row(db, company.company_id, create=False) if company else None
    threshold, source, mode = _threshold_for(config_row)
    if payload.min_report_score is not None:
        threshold, source = float(payload.min_report_score), cal.SOURCE_MANUAL
    threshold_info = _threshold_payload(threshold, source, mode)
    if company:
        threshold_info["company_id"] = company.company_id
        threshold_info["company_name"] = company.company_name

    transactions = _transactions(db, payload.dept_id)
    if not transactions:
        return {
            "success": True,
            "message": "No transactions for department",
            "findings": [],
            "summary": {},
            "threshold": threshold_info,
        }

    config = _config(threshold, payload.approval_thresholds)
    result = analyse_transactions(transactions, config)
    scored = result.findings
    alerts = result.top(config.max_findings, threshold)

    run_id = None
    if payload.persist:
        run = ForensicRun(
            department_id=payload.dept_id,
            rows_analysed=int(result.diagnostics.get("rows_analysed", 0)),
            findings_stored=len(scored),
            alerts_stored=len(alerts),
            min_report_score=threshold,
            threshold_source=source,
            diagnostics=result.diagnostics,
            summary=result.summary,
        )
        db.add(run)
        db.flush()
        run_id = run.run_id

        # A run is a snapshot, so the previous one for this department is cleared rather
        # than accumulated: leaving both would show an auditor the same transaction twice
        # with two different scores and no way to tell which is current. Reviews outlive
        # findings — they are keyed by transaction — so their finding link is detached
        # first and re-attached to the fresh finding for the same transaction below.
        old_ids = [fid for (fid,) in db.query(ForensicFinding.finding_id).filter(ForensicFinding.department_id == payload.dept_id)]
        if old_ids:
            db.query(ForensicReview).filter(ForensicReview.finding_id.in_(old_ids)).update(
                {ForensicReview.finding_id: None}, synchronize_session=False
            )
        db.query(ForensicFinding).filter(ForensicFinding.department_id == payload.dept_id).delete(synchronize_session=False)

        stored: dict[str, ForensicFinding] = {}
        for finding in scored:
            row = ForensicFinding(
                run_id=run_id,
                transaction_id=finding.transaction_id,
                department_id=payload.dept_id,
                risk_score=finding.risk_score,
                band=finding.band,
                corroboration=finding.corroboration,
                views_triggered=finding.views_triggered,
                view_scores={view: round(score, 2) for view, score in finding.view_scores.items()},
                evidence=finding.explanation(),
                is_alert=finding.risk_score >= threshold,
            )
            db.add(row)
            stored[finding.transaction_id] = row
        db.flush()

        if company:
            for review in db.query(ForensicReview).filter(ForensicReview.department_id == payload.dept_id).all():
                fresh = stored.get(review.transaction_id)
                if fresh is not None:
                    review.finding_id = fresh.finding_id
        db.commit()

    return {
        "success": True,
        "run_id": run_id,
        "summary": result.summary,
        "diagnostics": result.diagnostics,
        "reported": len(alerts),
        "scored_total": len(scored),
        "min_report_score": threshold,
        "threshold": threshold_info,
        "findings": [finding.to_dict() for finding in alerts],
    }


@router.get("/dept/{dept_id}/findings")
def list_findings(
    dept_id: str,
    band: str | None = None,
    min_score: float = Query(default=0.0, ge=0, le=100),
    include_resolved: bool = False,
    alerts_only: bool = True,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(ForensicFinding).filter(ForensicFinding.department_id == dept_id)
    if alerts_only:
        query = query.filter(ForensicFinding.is_alert.is_(True))
    if band:
        query = query.filter(ForensicFinding.band == band)
    if min_score:
        query = query.filter(ForensicFinding.risk_score >= min_score)
    if not include_resolved:
        query = query.filter(ForensicFinding.is_resolved.is_(False))

    findings = query.order_by(ForensicFinding.risk_score.desc()).all()
    reviews = {
        review.transaction_id: review
        for review in db.query(ForensicReview).filter(ForensicReview.department_id == dept_id).all()
    }
    return [_serialize_finding(finding, reviews.get(finding.transaction_id)) for finding in findings]


@router.get("/finding/{finding_id}/case-report")
def case_report(finding_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The full investigation packet for one transaction."""
    finding = db.query(ForensicFinding).filter(ForensicFinding.finding_id == finding_id).first()
    if not finding:
        raise HTTPException(status_code=404, detail="Finding not found")

    txn = db.query(Transaction).filter(Transaction.transaction_id == finding.transaction_id).first()
    review = (
        db.query(ForensicReview)
        .filter(ForensicReview.transaction_id == finding.transaction_id)
        .order_by(ForensicReview.reviewed_at.desc())
        .first()
    )

    return {
        "finding_id": finding.finding_id,
        "risk_score": float(finding.risk_score),
        "band": finding.band,
        "is_alert": finding.is_alert,
        "headline": f"Transaction scored {float(finding.risk_score):.0f}/100 ({finding.band}) on "
        f"{finding.corroboration} independent forensic view(s)",
        "transaction": None if txn is None else _txn_summary(txn),
        "view_scores": finding.view_scores,
        "why_flagged": [item["message"] for item in finding.evidence],
        "evidence": finding.evidence,
        "is_resolved": finding.is_resolved,
        "resolution_note": finding.resolution_note,
        "review": _serialize_review(review) if review else None,
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
    ledger, so this can be run against production data without contaminating it. And
    nothing here touches calibration: the benchmark is developer evidence that the engine
    works, never a company's ground truth. A company's threshold comes only from human
    reviews of its own real rows.
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

    report = run_benchmark(
        transactions,
        scenarios=payload.scenarios,
        threshold=payload.threshold,
        seed=payload.seed,
        approval_limit=payload.approval_limit,
    )
    report["synthetic"] = True
    report["scope_note"] = (
        "Synthetic benchmark: fraud planted by the system into a copy of the ledger. It tests the engine; "
        "it is not this company's ground truth and never sets its alert threshold."
    )
    return report


# --------------------------------------------------------- calibration & reviews


@router.get("/dept/{dept_id}/calibration")
def calibration_status(dept_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Where this department's company stands: mode, active threshold and why, progress
    towards calibration, and every calibration that has been attempted."""
    department = _department_or_404(db, dept_id)
    return _calibration_status(db, department, department.company)


@router.post("/calibrate")
def calibrate(payload: CalibrateRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Run a calibration now, instead of waiting for the automatic trigger.

    Readiness is never bypassed: a company below the minimums gets a clear 'not enough
    ground truth' answer and its threshold does not move.
    """
    department = _department_or_404(db, payload.dept_id)
    company = _company_or_400(department)
    config_row = _config_row(db, company.company_id, create=True)

    outcome, entry = _run_calibration(db, company, config_row, triggered_by="manual")
    db.commit()

    return {
        "ready": outcome.ready,
        "activated": outcome.activated,
        "reason": outcome.reason,
        "outcome": outcome.to_dict(),
        "record": _serialize_history(entry) if entry else None,
        "status": _calibration_status(db, department, company),
    }


@router.get("/dept/{dept_id}/review-queue")
def review_queue(dept_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """What reviewers should look at next: every alert, plus a stratified sample of rows
    below the threshold so that recall can be measured, not assumed.

    Built from the latest stored run so the sample stays put between page loads; it only
    changes when the engine is re-run and the scores change with it.
    """
    department = _department_or_404(db, dept_id)
    company = department.company
    config_row = _config_row(db, company.company_id, create=False) if company else None
    threshold, source, mode = _threshold_for(config_row)
    threshold_info = _threshold_payload(threshold, source, mode)

    run = (
        db.query(ForensicRun)
        .filter(ForensicRun.department_id == dept_id)
        .order_by(ForensicRun.created_at.desc())
        .first()
    )
    if run is None:
        return {
            "run_id": None,
            "run_at": None,
            "run_threshold": None,
            "threshold": threshold_info,
            "items": [],
            "strata": {},
            "pending": 0,
            "reviewed": 0,
            "message": "Run the analysis first. The review queue is built from the latest run's scores.",
        }

    findings = {
        finding.transaction_id: finding
        for finding in db.query(ForensicFinding).filter(ForensicFinding.department_id == dept_id).all()
    }
    transactions = {txn.transaction_id: txn for txn in _transactions(db, dept_id)}
    spending = [txn for txn in transactions.values() if (getattr(txn, "transaction_type", None) or "debit").lower() != "credit"]
    candidates = [
        (txn.transaction_id, float(findings[txn.transaction_id].risk_score) if txn.transaction_id in findings else 0.0)
        for txn in spending
    ]
    selected, strata = cal.sample_for_review(candidates, threshold, CALIBRATION, seed=run.run_id)

    reviews = {
        review.transaction_id: review
        for review in db.query(ForensicReview).filter(ForensicReview.department_id == dept_id).all()
    }

    items = []
    for pick in selected:
        txn = transactions[pick["transaction_id"]]
        finding = findings.get(pick["transaction_id"])
        review = reviews.get(pick["transaction_id"])
        items.append(
            {
                "transaction_id": pick["transaction_id"],
                "finding_id": finding.finding_id if finding else None,
                "risk_score": pick["risk_score"],
                "band": risk_band(pick["risk_score"]),
                "stratum": pick["stratum"],
                "stratum_label": cal.STRATUM_META[pick["stratum"]]["label"],
                "transaction": _txn_summary(txn),
                "top_evidence": finding.evidence[0]["message"] if finding and finding.evidence else None,
                "views_triggered": finding.views_triggered if finding else [],
                "corroboration": finding.corroboration if finding else 0,
                "review": _serialize_review(review) if review else None,
            }
        )

    reviewed = sum(1 for item in items if item["review"])
    return {
        "run_id": run.run_id,
        "run_at": _iso(run.created_at),
        "run_threshold": float(run.min_report_score),
        "threshold": threshold_info,
        "items": items,
        "strata": strata,
        "pending": len(items) - reviewed,
        "reviewed": reviewed,
    }


@router.post("/review")
def submit_review(payload: ReviewRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Record a reviewer's verdict on one transaction — the company's ground truth.

    Every review updates the company's counts and maturity mode. When the counts cross
    the minimums for the first time, or grow by another batch after that, a calibration
    runs in the same request and its result comes back alongside the review.
    """
    department = _department_or_404(db, payload.dept_id)
    company = _company_or_400(department)
    txn = (
        db.query(Transaction)
        .filter(Transaction.transaction_id == payload.transaction_id, Transaction.department_id == department.department_id)
        .first()
    )
    if txn is None:
        raise HTTPException(status_code=404, detail="Transaction not found in this department")

    config_row = _config_row(db, company.company_id, create=True)
    threshold, _, _ = _threshold_for(config_row)

    finding = None
    if payload.finding_id:
        finding = db.get(ForensicFinding, payload.finding_id)
    if finding is None:
        finding = (
            db.query(ForensicFinding)
            .filter(ForensicFinding.transaction_id == txn.transaction_id)
            .order_by(ForensicFinding.created_at.desc())
            .first()
        )
    score = float(finding.risk_score) if finding else 0.0

    review = (
        db.query(ForensicReview)
        .filter(ForensicReview.company_id == company.company_id, ForensicReview.transaction_id == txn.transaction_id)
        .first()
    )
    if review is None:
        review = ForensicReview(company_id=company.company_id, transaction_id=txn.transaction_id)
        db.add(review)
    review.department_id = department.department_id
    review.finding_id = finding.finding_id if finding else None
    review.reviewer_id = current_user.user_id
    review.label = payload.label
    review.review_note = payload.note
    review.review_source = payload.source
    review.risk_score_at_review = score
    review.threshold_at_review = threshold
    review.engine_version = ENGINE_VERSION
    review.reviewed_at = cal.utcnow()
    db.flush()

    rows = _labelled_rows(db, company.company_id)
    _refresh_counts(config_row, rows)
    counts = _count_labels(rows)
    ready = cal.readiness(counts["reviewed"], counts["confirmed"], counts["cleared"], CALIBRATION)
    since = counts["reviewed"] - config_row.reviews_at_last_calibration
    due = cal.recalibration_due(since, bool(config_row.candidate_status), ready["ready"], CALIBRATION)

    entry = None
    if due:
        _, entry = _run_calibration(db, company, config_row, triggered_by="auto")
    db.commit()

    return {
        "success": True,
        "review": _serialize_review(review),
        "calibration_triggered": entry is not None,
        "calibration": _serialize_history(entry) if entry else None,
        "status": _calibration_status(db, department, company),
    }


@router.delete("/review/{review_id}")
def delete_review(review_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Withdraw a verdict. Counts and mode are recomputed; past calibrations stay on record."""
    review = db.get(ForensicReview, review_id)
    if review is None:
        raise HTTPException(status_code=404, detail="Review not found")

    company = db.get(Company, review.company_id)
    department = db.get(Department, review.department_id) if review.department_id else None
    db.delete(review)
    db.flush()

    config_row = _config_row(db, review.company_id, create=False)
    if config_row is not None:
        _refresh_counts(config_row, _labelled_rows(db, review.company_id))
    db.commit()

    status = _calibration_status(db, department, company) if department is not None else None
    return {"success": True, "review_id": review_id, "status": status}
