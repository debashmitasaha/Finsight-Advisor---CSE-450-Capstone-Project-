from __future__ import annotations

from datetime import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.categorization.router import (
    ExpenseGroupBulkApprovalItem,
    ExpenseGroupBulkApprovalRequest,
    approve_all_expense_category_groups,
)
from app.models import Base, Company, Department, ExpenseCategory, Group, Transaction, User


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


def make_user(email: str, *, company_id: str | None, is_admin: bool) -> User:
    return User(
        username=email.replace("@", "-").replace(".", "-"),
        email=email,
        password_hash="not-used-by-this-test",
        company_id=company_id,
        is_admin=is_admin,
    )


def add_pending_group(db: Session, department: Department, number: int, head: str) -> tuple[Group, Transaction]:
    group = Group(
        dept_id=department.department_id,
        chart_acc_head_name=head,
        group_no=number,
        group_name=f"Group {number}",
        expense_category_status="pending_review",
        suggested_category_name="Gemini suggestion",
        suggested_category_is_new=True,
    )
    transaction = Transaction(
        department_id=department.department_id,
        transaction_date=datetime(2025, 1, 1),
        amount=number * 100,
        description=f"Transaction {number}",
        cleaned_chart_acc_head=head,
        chart_acc_head=head,
        group_no=number,
        group_name=group.group_name,
    )
    db.add_all([group, transaction])
    return group, transaction


def test_approve_all_is_department_scoped_and_reuses_categories(db: Session):
    company = Company(company_name="Acme")
    db.add(company)
    db.flush()
    department = Department(department_name="Finance", company_id=company.company_id)
    other_department = Department(department_name="Operations", company_id=company.company_id)
    admin = make_user("admin@acme.test", company_id=company.company_id, is_admin=True)
    db.add_all([department, other_department, admin])
    db.flush()

    existing = ExpenseCategory(
        company_id=company.company_id,
        department_id=None,
        name="Software",
        category_key="software",
        is_active=True,
    )
    db.add(existing)
    first_group, first_transaction = add_pending_group(db, department, 1, "software subscriptions")
    second_group, second_transaction = add_pending_group(db, department, 2, "site costs")
    third_group, third_transaction = add_pending_group(db, department, 3, "remote site costs")
    other_group, other_transaction = add_pending_group(db, other_department, 1, "other department")
    db.commit()

    result = approve_all_expense_category_groups(
        ExpenseGroupBulkApprovalRequest(
            dept_id=str(department.department_id),
            approvals=[
                ExpenseGroupBulkApprovalItem(chart_acc_head_name=first_group.chart_acc_head_name, category_name="Software"),
                ExpenseGroupBulkApprovalItem(chart_acc_head_name=second_group.chart_acc_head_name, category_name="Field Operations"),
                ExpenseGroupBulkApprovalItem(chart_acc_head_name=third_group.chart_acc_head_name, category_name="Field Operations"),
            ],
        ),
        current_user=admin,
        db=db,
    )

    db.expire_all()
    assert result["success"] is True
    assert result["approved_count"] == 3
    assert len(result["categories"]) == 2
    assert first_group.expense_category_status == "approved"
    assert first_group.expense_category_id == existing.category_id
    assert first_transaction.expense_category_id == existing.category_id

    new_categories = (
        db.query(ExpenseCategory)
        .filter(
            ExpenseCategory.company_id == company.company_id,
            ExpenseCategory.category_key == "field operations",
        )
        .all()
    )
    assert len(new_categories) == 1
    assert second_group.expense_category_id == new_categories[0].category_id
    assert third_group.expense_category_id == new_categories[0].category_id
    assert second_transaction.expense_category_id == new_categories[0].category_id
    assert third_transaction.expense_category_id == new_categories[0].category_id

    assert other_group.expense_category_status == "pending_review"
    assert other_group.expense_category_id is None
    assert other_transaction.expense_category_id is None


def test_approve_all_rejects_an_incomplete_stale_list_before_changes(db: Session):
    company = Company(company_name="Acme")
    department = Department(department_name="Finance", company=company)
    admin = make_user("admin@acme.test", company_id=None, is_admin=True)
    db.add_all([company, department, admin])
    db.flush()
    first_group, first_transaction = add_pending_group(db, department, 1, "software")
    second_group, second_transaction = add_pending_group(db, department, 2, "travel")
    admin.company_id = company.company_id
    db.commit()

    with pytest.raises(HTTPException) as error:
        approve_all_expense_category_groups(
            ExpenseGroupBulkApprovalRequest(
                dept_id=str(department.department_id),
                approvals=[
                    ExpenseGroupBulkApprovalItem(
                        chart_acc_head_name=first_group.chart_acc_head_name,
                        category_name="Software",
                    )
                ],
            ),
            current_user=admin,
            db=db,
        )

    assert error.value.status_code == 409
    db.expire_all()
    assert first_group.expense_category_status == "pending_review"
    assert second_group.expense_category_status == "pending_review"
    assert first_transaction.expense_category_id is None
    assert second_transaction.expense_category_id is None


def test_approve_all_requires_an_admin_from_the_department_company(db: Session):
    first_company = Company(company_name="Acme")
    second_company = Company(company_name="Other")
    department = Department(department_name="Finance", company=first_company)
    outsider = make_user("admin@other.test", company_id=None, is_admin=True)
    db.add_all([first_company, second_company, department, outsider])
    db.flush()
    outsider.company_id = second_company.company_id
    group, _ = add_pending_group(db, department, 1, "software")
    db.commit()

    with pytest.raises(HTTPException) as error:
        approve_all_expense_category_groups(
            ExpenseGroupBulkApprovalRequest(
                dept_id=str(department.department_id),
                approvals=[
                    ExpenseGroupBulkApprovalItem(
                        chart_acc_head_name=group.chart_acc_head_name,
                        category_name="Software",
                    )
                ],
            ),
            current_user=outsider,
            db=db,
        )

    assert error.value.status_code == 403
    assert group.expense_category_status == "pending_review"
