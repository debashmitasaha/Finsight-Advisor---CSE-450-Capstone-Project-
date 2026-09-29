from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app import database
from app.models import Base, Company, Department, Transaction, User
from app.necessity.service import (
    clear_manual_review,
    recalculate_transactions,
    set_manual_review,
    transaction_similarity,
)
from app.transaction.router import TransactionUpdate, update_transaction


START = datetime(2025, 1, 5)


def make_transaction(
    index: int,
    *,
    group_no: float | None = 1,
    category: str = "uncategorized",
    locked: bool = False,
    source: str = "unreviewed",
    description: str = "monthly generator maintenance",
    amount: float = 10_000,
) -> Transaction:
    return Transaction(
        transaction_date=START + timedelta(days=index * 30),
        amount=amount,
        transaction_type="debit",
        description=description,
        category=category,
        chart_acc_head="Maintenance",
        cleaned_chart_acc_head="maintenance",
        account_head_group="Operations",
        voucher_type="Journal",
        payment_method="bank",
        group_no=group_no,
        group_name=f"group_{int(group_no)}" if group_no is not None else None,
        necessity_score=1.0 if category == "necessary" and locked else 0.0 if category == "unnecessary" and locked else 0.5,
        necessity_confidence=1.0 if locked else 0.0,
        necessity_source=source,
        necessity_locked=locked,
    )


def test_no_reviewed_evidence_stays_unknown():
    old_rule_label = make_transaction(0, category="unnecessary")
    candidate = make_transaction(1)

    summary = recalculate_transactions([old_rule_label, candidate])

    assert summary["locked_review_count"] == 0
    assert summary["uncategorized_count"] == 2
    for transaction in (old_rule_label, candidate):
        assert transaction.category == "uncategorized"
        assert transaction.necessity_score == 0.5
        assert transaction.necessity_confidence == 0
        assert transaction.necessity_source == "unreviewed"


def test_ungrouped_transaction_never_borrows_reviewed_evidence():
    anchor = make_transaction(0, category="necessary", locked=True, source="admin_override")
    ungrouped = make_transaction(1, group_no=None)

    recalculate_transactions([anchor, ungrouped])

    assert ungrouped.category == "uncategorized"
    assert ungrouped.necessity_score == 0.5
    assert ungrouped.necessity_confidence == 0
    assert "not been grouped" in ungrouped.necessity_reason["summary"]


def test_consistent_reviewed_group_can_classify_a_similar_transaction():
    anchors = [
        make_transaction(index, category="necessary", locked=True, source="admin_override")
        for index in range(10)
    ]
    candidate = make_transaction(11)

    summary = recalculate_transactions([*anchors, candidate])

    assert summary["locked_review_count"] == 10
    assert candidate.category == "necessary"
    assert float(candidate.necessity_score) >= 0.70
    assert float(candidate.necessity_confidence) >= 0.65
    assert candidate.necessity_source == "combined_evidence"
    assert candidate.necessity_reason["reviewed_count"] == 10
    assert "expense_category" not in candidate.necessity_reason


def test_conflicting_reviews_leave_candidate_for_review():
    necessary = [
        make_transaction(index, category="necessary", locked=True, source="admin_override")
        for index in range(5)
    ]
    unnecessary = [
        make_transaction(index + 5, category="unnecessary", locked=True, source="admin_override")
        for index in range(5)
    ]
    candidate = make_transaction(12)

    recalculate_transactions([*necessary, *unnecessary, candidate])

    assert candidate.category == "uncategorized"
    assert 0.45 <= float(candidate.necessity_score) <= 0.55
    assert float(candidate.necessity_confidence) < 0.65


def test_similarity_uses_raw_fields_without_expense_category():
    left = make_transaction(0)
    right = make_transaction(1)
    left.expense_category_id = "category-a"
    right.expense_category_id = "category-b"

    score_with_different_categories, fields = transaction_similarity(left, right)
    right.expense_category_id = "category-a"
    score_with_same_category, _ = transaction_similarity(left, right)

    assert score_with_same_category == score_with_different_categories
    assert "description" in fields
    assert "chart_account_head" in fields


def test_manual_review_is_locked_and_can_be_cleared():
    transaction = make_transaction(0)

    set_manual_review(transaction, "unnecessary", "reviewer-1")

    assert transaction.category == "unnecessary"
    assert transaction.necessity_score == 0
    assert transaction.necessity_confidence == 1
    assert transaction.necessity_source == "admin_override"
    assert transaction.necessity_locked is True
    assert transaction.necessity_reviewed_by == "reviewer-1"
    assert transaction.necessity_reviewed_at is not None

    clear_manual_review(transaction)

    assert transaction.category == "uncategorized"
    assert transaction.necessity_score == 0.5
    assert transaction.necessity_confidence == 0
    assert transaction.necessity_source == "unreviewed"
    assert transaction.necessity_locked is False
    assert transaction.necessity_reviewed_by is None
    assert transaction.necessity_reviewed_at is None


def test_sqlite_schema_sync_adds_necessity_columns(monkeypatch):
    legacy_engine = create_engine("sqlite:///:memory:")
    with legacy_engine.begin() as connection:
        connection.execute(text('CREATE TABLE "transaction" (transaction_id VARCHAR(36) PRIMARY KEY)'))

    monkeypatch.setattr(database, "engine", legacy_engine)
    database.sync_sqlite_schema()

    with legacy_engine.connect() as connection:
        columns = {
            row[1]: row
            for row in connection.execute(text('PRAGMA table_info("transaction")')).fetchall()
        }

    expected = {
        "necessity_score",
        "necessity_confidence",
        "necessity_source",
        "necessity_reason",
        "necessity_locked",
        "necessity_reviewed_by",
        "necessity_reviewed_at",
    }
    assert expected <= set(columns)
    assert str(columns["necessity_score"][4]) == "0.5000"
    assert str(columns["necessity_confidence"][4]) == "0.0000"
    assert str(columns["necessity_locked"][4]) == "0"
    legacy_engine.dispose()


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def test_transaction_review_endpoint_propagates_evidence_and_rejects_employee(db: Session):
    company = Company(company_name="Acme")
    department = Department(department_name="Operations", company=company)
    admin = User(
        username="admin",
        email="admin@example.test",
        password_hash="unused",
        company=company,
        is_admin=True,
    )
    employee = User(
        username="employee",
        email="employee@example.test",
        password_hash="unused",
        company=company,
        is_admin=False,
    )
    anchor = make_transaction(0)
    anchor.department = department
    candidate = make_transaction(1)
    candidate.department = department
    db.add_all([company, department, admin, employee, anchor, candidate])
    db.commit()

    response = update_transaction(
        str(anchor.transaction_id),
        TransactionUpdate(category="necessary"),
        current_user=admin,
        db=db,
    )

    db.refresh(candidate)
    assert response.necessity_locked is True
    assert response.necessity_source == "admin_override"
    assert float(candidate.necessity_score) > 0.5
    assert candidate.necessity_locked is False

    with pytest.raises(HTTPException) as error:
        update_transaction(
            str(candidate.transaction_id),
            TransactionUpdate(category="unnecessary"),
            current_user=employee,
            db=db,
        )
    assert error.value.status_code == 403
