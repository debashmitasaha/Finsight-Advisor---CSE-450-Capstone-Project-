from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.forensic_engine.historical.models import AnomalyCase, AnomalyCaseMember, HistoricalScanRun
from app.forensic_engine.models import CompanyForensicConfig, ForensicFinding, ForensicReview, ForensicRun
from app.models import (
    AccessLog,
    Anomaly,
    BudgetForecast,
    CaseAssignment,
    CaseTransaction,
    Department,
    Group,
    Notification,
    NotificationSeen,
    Transaction,
    UploadBatch,
)
from app.necessity.service import recalculate_department


def _reset_forensic_calibration(
    db: Session,
    company_id: str | None,
    deleted_review_count: int,
) -> bool:
    if not company_id or deleted_review_count == 0:
        return False

    config = db.get(CompanyForensicConfig, company_id)
    if not config:
        return False

    counts = {
        label: int(count or 0)
        for label, count in (
            db.query(ForensicReview.label, func.count(ForensicReview.review_id))
            .filter(ForensicReview.company_id == company_id)
            .group_by(ForensicReview.label)
            .all()
        )
    }
    reviewed_count = sum(counts.values())
    config.reviewed_count = reviewed_count
    config.positive_count = counts.get("confirmed", 0)
    config.negative_count = counts.get("cleared", 0)
    config.uncertain_count = counts.get("uncertain", 0)

    # A learned threshold is no longer defensible after some of its labelled
    # evidence is removed. Preserve company overrides and append-only history,
    # but require calibration to be run again on the remaining reviews.
    config.calibration_mode = "bootstrap" if reviewed_count == 0 else "warmup"
    config.active_threshold = None
    config.threshold_source = "bootstrap"
    config.candidate_threshold = None
    config.candidate_status = None
    config.precision = None
    config.recall = None
    config.f1 = None
    config.false_positive_rate = None
    config.reviews_at_last_calibration = 0
    config.calibrated_at = None
    config.engine_version = None
    return True


def delete_upload_batch_data(
    db: Session,
    batch: UploadBatch,
    department: Department,
) -> dict:
    """Delete one uploaded ledger and every derived artifact that it invalidates.

    All operations use SQLAlchemy expressions shared by SQLite and PostgreSQL.
    The caller owns the transaction and must commit or roll back this whole unit.
    """

    batch_id = batch.upload_batch_id
    department_id = department.department_id
    company_id = department.company_id
    transaction_ids = select(Transaction.transaction_id).where(Transaction.upload_batch_id == batch_id)

    transaction_count = int(
        db.query(func.count(Transaction.transaction_id))
        .filter(Transaction.upload_batch_id == batch_id)
        .scalar()
        or 0
    )
    source_file_name = batch.source_file_name

    # A failed or duplicate-only upload has no derived data. Removing its
    # metadata/hash must not invalidate valid analysis for other ledgers.
    if transaction_count == 0:
        db.delete(batch)
        db.flush()
        return {
            "success": True,
            "upload_batch_id": str(batch_id),
            "source_file_name": source_file_name,
            "transactions_deleted": 0,
            "anomalies_deleted": 0,
            "case_transactions_deleted": 0,
            "case_assignments_deleted": 0,
            "forensic_findings_deleted": 0,
            "forensic_runs_deleted": 0,
            "forensic_reviews_deleted": 0,
            "historical_scans_deleted": 0,
            "historical_cases_deleted": 0,
            "forecasts_deleted": 0,
            "notifications_deleted": 0,
            "access_logs_unlinked": 0,
            "groups_deleted": 0,
            "forensic_calibration_reset": False,
            "necessity": None,
        }

    first_date, last_date = (
        db.query(func.min(Transaction.transaction_date), func.max(Transaction.transaction_date))
        .filter(Transaction.upload_batch_id == batch_id)
        .one()
    )
    affected_group_refs = (
        db.query(Transaction.group_no, Transaction.cleaned_chart_acc_head)
        .filter(Transaction.upload_batch_id == batch_id)
        .distinct()
        .all()
    )

    # Historical scans cover a company and date window, rather than one upload.
    # Any overlapping snapshot was computed from the soon-to-be-deleted rows.
    historical_scan_ids: list[str] = []
    if company_id and first_date and last_date:
        first_day = first_date.date()
        last_day = last_date.date()
        historical_scan_ids = [
            scan_id
            for (scan_id,) in (
                db.query(HistoricalScanRun.scan_id)
                .filter(
                    HistoricalScanRun.company_id == company_id,
                    or_(HistoricalScanRun.start_date.is_(None), HistoricalScanRun.start_date <= last_day),
                    or_(HistoricalScanRun.end_date.is_(None), HistoricalScanRun.end_date >= first_day),
                )
                .all()
            )
        ]

    historical_cases_deleted = 0
    if historical_scan_ids:
        affected_case_ids = select(AnomalyCase.case_id).where(AnomalyCase.scan_id.in_(historical_scan_ids))
        db.query(AnomalyCaseMember).filter(
            AnomalyCaseMember.case_id.in_(affected_case_ids)
        ).delete(synchronize_session=False)
        historical_cases_deleted = db.query(AnomalyCase).filter(
            AnomalyCase.scan_id.in_(historical_scan_ids)
        ).delete(synchronize_session=False)
        db.query(HistoricalScanRun).filter(
            HistoricalScanRun.scan_id.in_(historical_scan_ids)
        ).delete(synchronize_session=False)

    # Remove any direct historical membership as a final guard even when old
    # scan metadata has an incorrect or missing date window.
    db.query(AnomalyCaseMember).filter(
        AnomalyCaseMember.transaction_id.in_(transaction_ids)
    ).delete(synchronize_session=False)

    reviews_deleted = db.query(ForensicReview).filter(
        ForensicReview.transaction_id.in_(transaction_ids)
    ).delete(synchronize_session=False)

    # A forensic run is a snapshot of the department. Once the ledger changes,
    # all of its findings and summary counts are stale. Reviews on transactions
    # that remain are retained as ground truth, with only their finding link cleared.
    department_finding_ids = select(ForensicFinding.finding_id).where(
        ForensicFinding.department_id == department_id
    )
    db.query(ForensicReview).filter(
        ForensicReview.finding_id.in_(department_finding_ids)
    ).update({ForensicReview.finding_id: None}, synchronize_session=False)
    forensic_findings_deleted = db.query(ForensicFinding).filter(
        ForensicFinding.department_id == department_id
    ).delete(synchronize_session=False)
    forensic_runs_deleted = db.query(ForensicRun).filter(
        ForensicRun.department_id == department_id
    ).delete(synchronize_session=False)

    anomalies_deleted = db.query(Anomaly).filter(
        Anomaly.transaction_id.in_(transaction_ids)
    ).delete(synchronize_session=False)
    case_transactions_deleted = db.query(CaseTransaction).filter(
        CaseTransaction.transaction_id.in_(transaction_ids)
    ).delete(synchronize_session=False)

    # Audit records are retained, but must not point at a transaction that no
    # longer exists. This mirrors the schema's ON DELETE SET NULL behavior.
    access_logs_unlinked = db.query(AccessLog).filter(
        AccessLog.transaction_id.in_(transaction_ids)
    ).update({AccessLog.transaction_id: None}, synchronize_session=False)

    forecasts_deleted = db.query(BudgetForecast).filter(
        BudgetForecast.department_id == department_id
    ).delete(synchronize_session=False)
    case_assignments_deleted = db.query(CaseAssignment).filter(
        CaseAssignment.dept_id == department_id
    ).delete(synchronize_session=False)

    budget_notification_ids = select(Notification.notification_id).where(
        Notification.department_id == department_id,
        Notification.type == "budget_pace",
    )
    db.query(NotificationSeen).filter(
        NotificationSeen.notification_id.in_(budget_notification_ids)
    ).delete(synchronize_session=False)
    notifications_deleted = db.query(Notification).filter(
        Notification.department_id == department_id,
        Notification.type == "budget_pace",
    ).delete(synchronize_session=False)

    db.query(Transaction).filter(
        Transaction.upload_batch_id == batch_id
    ).delete(synchronize_session=False)
    db.flush()

    groups_deleted = 0
    for group_no, chart_acc_head_name in affected_group_refs:
        if group_no is not None:
            group_query = db.query(Group).filter(
                Group.dept_id == department_id,
                Group.group_no == group_no,
            )
            remaining_count = db.query(func.count(Transaction.transaction_id)).filter(
                Transaction.department_id == department_id,
                Transaction.group_no == group_no,
            ).scalar()
        elif chart_acc_head_name:
            group_query = db.query(Group).filter(
                Group.dept_id == department_id,
                Group.chart_acc_head_name == chart_acc_head_name,
            )
            remaining_count = db.query(func.count(Transaction.transaction_id)).filter(
                Transaction.department_id == department_id,
                Transaction.cleaned_chart_acc_head == chart_acc_head_name,
            ).scalar()
        else:
            continue

        if int(remaining_count or 0) == 0:
            groups_deleted += group_query.delete(synchronize_session=False)

    calibration_reset = _reset_forensic_calibration(db, company_id, reviews_deleted)
    db.delete(batch)
    db.flush()

    # Remaining unlocked rows may have depended on deleted group-review anchors.
    necessity_summary = recalculate_department(db, str(department_id))

    return {
        "success": True,
        "upload_batch_id": str(batch_id),
        "source_file_name": source_file_name,
        "transactions_deleted": transaction_count,
        "anomalies_deleted": anomalies_deleted,
        "case_transactions_deleted": case_transactions_deleted,
        "case_assignments_deleted": case_assignments_deleted,
        "forensic_findings_deleted": forensic_findings_deleted,
        "forensic_runs_deleted": forensic_runs_deleted,
        "forensic_reviews_deleted": reviews_deleted,
        "historical_scans_deleted": len(historical_scan_ids),
        "historical_cases_deleted": historical_cases_deleted,
        "forecasts_deleted": forecasts_deleted,
        "notifications_deleted": notifications_deleted,
        "access_logs_unlinked": access_logs_unlinked,
        "groups_deleted": groups_deleted,
        "forensic_calibration_reset": calibration_reset,
        "necessity": necessity_summary,
    }
