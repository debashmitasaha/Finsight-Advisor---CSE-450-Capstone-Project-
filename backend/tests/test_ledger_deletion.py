from __future__ import annotations

from datetime import date, datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

import app.transaction.router as transaction_router
from app.forensic_engine.historical.models import AnomalyCase, AnomalyCaseMember, HistoricalScanRun
from app.forensic_engine.models import CompanyForensicConfig, ForensicFinding, ForensicReview, ForensicRun
from app.models import (
    AccessLog,
    Anomaly,
    Base,
    BudgetForecast,
    CaseAssignment,
    CaseTransaction,
    Company,
    Department,
    Group,
    Notification,
    NotificationSeen,
    Transaction,
    UploadBatch,
    User,
)


@pytest.fixture()
def db() -> Session:
    # Foreign keys intentionally remain disabled here. The service must provide
    # the same explicit cleanup even for an older SQLite connection.
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def make_user(email: str, *, company_id: str | None, is_admin: bool = True) -> User:
    return User(
        username=email.replace("@", "-").replace(".", "-"),
        email=email,
        password_hash="not-used-by-this-test",
        company_id=company_id,
        is_admin=is_admin,
    )


def add_transaction(
    db: Session,
    *,
    department: Department,
    batch: UploadBatch,
    number: int,
    group_no: int,
    head: str,
) -> Transaction:
    transaction = Transaction(
        department_id=department.department_id,
        upload_batch_id=batch.upload_batch_id,
        transaction_date=datetime(2025, 1, number),
        amount=number * 100,
        description=f"Transaction {number}",
        cleaned_chart_acc_head=head,
        chart_acc_head=head,
        group_no=group_no,
        group_name=f"Group {group_no}",
    )
    db.add(transaction)
    db.flush()
    return transaction


def test_delete_upload_batch_cleans_derived_data_and_preserves_shared_records(db: Session):
    company = Company(company_name="Acme")
    department = Department(department_name="Finance", company=company)
    admin = make_user("admin@acme.test", company_id=None)
    db.add_all([company, department, admin])
    db.flush()
    admin.company_id = company.company_id

    target_batch = UploadBatch(
        department_id=department.department_id,
        source_file_name="january.csv",
        source_file_hash="january-hash",
        uploaded_by=admin.user_id,
        row_count=2,
        status="completed",
    )
    remaining_batch = UploadBatch(
        department_id=department.department_id,
        source_file_name="february.csv",
        source_file_hash="february-hash",
        uploaded_by=admin.user_id,
        row_count=1,
        status="completed",
    )
    db.add_all([target_batch, remaining_batch])
    db.flush()

    target_only_group = Group(
        dept_id=department.department_id,
        chart_acc_head_name="target only",
        group_no=1,
        group_name="Target only",
    )
    shared_group = Group(
        dept_id=department.department_id,
        chart_acc_head_name="shared",
        group_no=2,
        group_name="Shared",
    )
    db.add_all([target_only_group, shared_group])
    db.flush()

    target_transaction = add_transaction(
        db,
        department=department,
        batch=target_batch,
        number=1,
        group_no=1,
        head="target only",
    )
    second_target_transaction = add_transaction(
        db,
        department=department,
        batch=target_batch,
        number=2,
        group_no=2,
        head="shared",
    )
    remaining_transaction = add_transaction(
        db,
        department=department,
        batch=remaining_batch,
        number=3,
        group_no=2,
        head="shared",
    )

    access_log = AccessLog(
        user_id=admin.user_id,
        dept_id=department.department_id,
        transaction_id=target_transaction.transaction_id,
        action="viewed",
    )
    anomaly = Anomaly(
        transaction_id=target_transaction.transaction_id,
        department_id=department.department_id,
        anomaly_type="amount",
        score=0.9,
    )
    case_transaction = CaseTransaction(transaction_id=target_transaction.transaction_id)
    case_assignment = CaseAssignment(dept_id=department.department_id, case_name="Amount review 2025-01")
    forecast = BudgetForecast(
        department_id=department.department_id,
        forecast_period_start=date(2025, 2, 1),
        forecast_period_end=date(2025, 2, 28),
        predicted_amount=1000,
        source_mode="latest_batch",
        upload_batch_id=target_batch.upload_batch_id,
    )
    notification = Notification(
        department_id=department.department_id,
        type="budget_pace",
        message="Forecast-derived warning",
    )
    db.add_all([access_log, anomaly, case_transaction, case_assignment, forecast, notification])
    db.flush()
    notification_seen = NotificationSeen(
        notification_id=notification.notification_id,
        user_id=admin.user_id,
    )
    db.add(notification_seen)

    forensic_run = ForensicRun(
        department_id=department.department_id,
        rows_analysed=3,
        findings_stored=2,
        alerts_stored=2,
        min_report_score=65,
        diagnostics={},
        summary={},
    )
    db.add(forensic_run)
    db.flush()
    deleted_finding = ForensicFinding(
        run_id=forensic_run.run_id,
        transaction_id=target_transaction.transaction_id,
        department_id=department.department_id,
        risk_score=90,
        band="high",
        corroboration=2,
        views_triggered=[],
        view_scores={},
        evidence=[],
    )
    retained_transaction_finding = ForensicFinding(
        run_id=forensic_run.run_id,
        transaction_id=remaining_transaction.transaction_id,
        department_id=department.department_id,
        risk_score=70,
        band="high",
        corroboration=2,
        views_triggered=[],
        view_scores={},
        evidence=[],
    )
    db.add_all([deleted_finding, retained_transaction_finding])
    db.flush()
    deleted_review = ForensicReview(
        company_id=company.company_id,
        department_id=department.department_id,
        transaction_id=target_transaction.transaction_id,
        finding_id=deleted_finding.finding_id,
        reviewer_id=admin.user_id,
        label="confirmed",
    )
    retained_review = ForensicReview(
        company_id=company.company_id,
        department_id=department.department_id,
        transaction_id=remaining_transaction.transaction_id,
        finding_id=retained_transaction_finding.finding_id,
        reviewer_id=admin.user_id,
        label="cleared",
    )
    config = CompanyForensicConfig(
        company_id=company.company_id,
        calibration_mode="calibrated",
        active_threshold=52,
        threshold_source="company_f1",
        reviewed_count=2,
        positive_count=1,
        negative_count=1,
        reviews_at_last_calibration=2,
    )
    db.add_all([deleted_review, retained_review, config])

    scan = HistoricalScanRun(
        company_id=company.company_id,
        started_by=admin.user_id,
        start_date=date(2025, 1, 1),
        end_date=date(2025, 1, 31),
        status="ok",
        engine_version="test",
        row_count=3,
        case_count=1,
        config_json={},
        diagnostics_json={},
    )
    db.add(scan)
    db.flush()
    historical_case = AnomalyCase(
        scan_id=scan.scan_id,
        company_id=company.company_id,
        title="January case",
        entity_type="vendor",
        entity_id="vendor-1",
        start_date=date(2025, 1, 1),
        end_date=date(2025, 1, 31),
        priority_score=80,
        band="high",
        total_amount=600,
        member_count=2,
        layer_count=2,
        codes=[],
        scores_json={},
        evidence_json=[],
        explanation_json={},
    )
    db.add(historical_case)
    db.flush()
    db.add_all([
        AnomalyCaseMember(
            case_id=historical_case.case_id,
            transaction_id=target_transaction.transaction_id,
        ),
        AnomalyCaseMember(
            case_id=historical_case.case_id,
            transaction_id=remaining_transaction.transaction_id,
        ),
    ])
    db.commit()

    target_batch_id = str(target_batch.upload_batch_id)
    remaining_batch_id = str(remaining_batch.upload_batch_id)
    target_transaction_id = str(target_transaction.transaction_id)
    remaining_transaction_id = str(remaining_transaction.transaction_id)

    result = transaction_router.delete_upload_batch(
        target_batch_id,
        current_user=admin,
        db=db,
    )

    db.expire_all()
    assert result["success"] is True
    assert result["transactions_deleted"] == 2
    assert result["groups_deleted"] == 1
    assert db.query(UploadBatch).filter(UploadBatch.upload_batch_id == target_batch_id).count() == 0
    assert db.query(UploadBatch).filter(UploadBatch.upload_batch_id == remaining_batch_id).count() == 1
    assert db.query(Transaction).filter(Transaction.upload_batch_id == target_batch_id).count() == 0
    assert db.query(Transaction).filter(Transaction.transaction_id == remaining_transaction_id).count() == 1

    assert db.query(Anomaly).count() == 0
    assert db.query(CaseTransaction).count() == 0
    assert db.query(CaseAssignment).count() == 0
    assert db.query(BudgetForecast).count() == 0
    assert db.query(Notification).count() == 0
    assert db.query(NotificationSeen).count() == 0

    retained_log = db.query(AccessLog).filter(AccessLog.action == "viewed").one()
    assert retained_log.transaction_id is None
    deletion_log = db.query(AccessLog).filter(
        AccessLog.action == f"delete_upload_batch:{target_batch_id}"
    ).one()
    assert deletion_log.transaction_id is None
    assert deletion_log.dept_id == department.department_id
    assert db.query(ForensicRun).count() == 0
    assert db.query(ForensicFinding).count() == 0
    assert db.query(ForensicReview).filter(
        ForensicReview.transaction_id == target_transaction_id
    ).count() == 0
    remaining_review = db.query(ForensicReview).filter(
        ForensicReview.transaction_id == remaining_transaction_id
    ).one()
    assert remaining_review.finding_id is None

    assert db.query(HistoricalScanRun).count() == 0
    assert db.query(AnomalyCase).count() == 0
    assert db.query(AnomalyCaseMember).count() == 0
    assert db.query(Group).filter(Group.group_no == 1).count() == 0
    assert db.query(Group).filter(Group.group_no == 2).count() == 1

    refreshed_config = db.get(CompanyForensicConfig, company.company_id)
    assert refreshed_config.calibration_mode == "warmup"
    assert refreshed_config.active_threshold is None
    assert refreshed_config.reviewed_count == 1
    assert refreshed_config.positive_count == 0
    assert refreshed_config.negative_count == 1


def test_delete_upload_batch_rejects_another_company_admin(db: Session):
    company = Company(company_name="Acme")
    other_company = Company(company_name="Other")
    department = Department(department_name="Finance", company=company)
    outsider = make_user("admin@other.test", company_id=None)
    db.add_all([company, other_company, department, outsider])
    db.flush()
    outsider.company_id = other_company.company_id
    batch = UploadBatch(
        department_id=department.department_id,
        source_file_name="ledger.csv",
        row_count=0,
        status="completed",
    )
    db.add(batch)
    db.commit()

    with pytest.raises(HTTPException) as error:
        transaction_router.delete_upload_batch(
            str(batch.upload_batch_id),
            current_user=outsider,
            db=db,
        )

    assert error.value.status_code == 403
    assert db.query(UploadBatch).filter(UploadBatch.upload_batch_id == batch.upload_batch_id).count() == 1


def test_delete_upload_batch_rolls_back_everything_on_failure(db: Session, monkeypatch):
    company = Company(company_name="Acme")
    department = Department(department_name="Finance", company=company)
    admin = make_user("admin@acme.test", company_id=None)
    db.add_all([company, department, admin])
    db.flush()
    admin.company_id = company.company_id
    batch = UploadBatch(
        department_id=department.department_id,
        source_file_name="ledger.csv",
        row_count=1,
        status="completed",
    )
    db.add(batch)
    db.flush()
    transaction = add_transaction(
        db,
        department=department,
        batch=batch,
        number=1,
        group_no=1,
        head="software",
    )
    db.commit()

    def fail_after_delete(session: Session, _batch: UploadBatch, _department: Department):
        session.query(Transaction).filter(
            Transaction.upload_batch_id == batch.upload_batch_id
        ).delete(synchronize_session=False)
        session.flush()
        raise RuntimeError("simulated cleanup failure")

    monkeypatch.setattr(transaction_router, "delete_upload_batch_data", fail_after_delete)

    with pytest.raises(RuntimeError, match="simulated cleanup failure"):
        transaction_router.delete_upload_batch(
            str(batch.upload_batch_id),
            current_user=admin,
            db=db,
        )

    assert db.query(UploadBatch).filter(UploadBatch.upload_batch_id == batch.upload_batch_id).count() == 1
    assert db.query(Transaction).filter(Transaction.transaction_id == transaction.transaction_id).count() == 1


def test_delete_empty_upload_only_removes_batch_metadata(db: Session):
    company = Company(company_name="Acme")
    department = Department(department_name="Finance", company=company)
    admin = make_user("admin@acme.test", company_id=None)
    db.add_all([company, department, admin])
    db.flush()
    admin.company_id = company.company_id

    empty_batch = UploadBatch(
        department_id=department.department_id,
        source_file_name="failed.csv",
        source_file_hash="failed-hash",
        row_count=10,
        status="completed_with_errors",
    )
    forecast = BudgetForecast(
        department_id=department.department_id,
        forecast_period_start=date(2025, 2, 1),
        forecast_period_end=date(2025, 2, 28),
        predicted_amount=1000,
        source_mode="full_history",
    )
    forensic_run = ForensicRun(
        department_id=department.department_id,
        rows_analysed=1,
        findings_stored=0,
        alerts_stored=0,
        min_report_score=65,
        diagnostics={},
        summary={},
    )
    db.add_all([empty_batch, forecast, forensic_run])
    db.commit()
    empty_batch_id = str(empty_batch.upload_batch_id)

    result = transaction_router.delete_upload_batch(
        empty_batch_id,
        current_user=admin,
        db=db,
    )

    assert result["transactions_deleted"] == 0
    assert db.query(UploadBatch).filter(UploadBatch.upload_batch_id == empty_batch_id).count() == 0
    assert db.query(BudgetForecast).count() == 1
    assert db.query(ForensicRun).count() == 1
