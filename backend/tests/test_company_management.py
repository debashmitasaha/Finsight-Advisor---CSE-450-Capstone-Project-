from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app import database
from app.admin.router import (
    CompanyStatusUpdate,
    CompanyUpdate,
    UserStatusUpdate,
    update_company,
    update_company_status,
    update_user_status,
)
from app.models import Base, Company, User


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


def test_sqlite_schema_sync_adds_company_status_to_existing_database(monkeypatch):
    legacy_engine = create_engine("sqlite:///:memory:")
    with legacy_engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE company ("
                "company_id VARCHAR(36) PRIMARY KEY, "
                "company_name TEXT NOT NULL"
                ")"
            )
        )

    monkeypatch.setattr(database, "engine", legacy_engine)
    database.sync_sqlite_schema()

    with legacy_engine.connect() as connection:
        columns = {
            row[1]: row
            for row in connection.execute(text('PRAGMA table_info("company")')).fetchall()
        }
    assert "is_active" in columns
    assert columns["is_active"][3] == 1
    assert str(columns["is_active"][4]) == "1"
    legacy_engine.dispose()


def make_user(
    email: str,
    *,
    company_id: str | None,
    is_admin: bool,
    is_active: bool = True,
) -> User:
    return User(
        username=email.replace("@", "-").replace(".", "-"),
        email=email,
        password_hash="not-used-by-this-test",
        company_id=company_id,
        is_admin=is_admin,
        is_active=is_active,
    )


def test_disabling_company_disables_only_its_active_accounts(db: Session):
    company = Company(company_name="Acme", is_active=True)
    other_company = Company(company_name="Other", is_active=True)
    db.add_all([company, other_company])
    db.flush()

    company_admin = make_user("admin@acme.test", company_id=company.company_id, is_admin=True)
    employee = make_user("employee@acme.test", company_id=company.company_id, is_admin=False)
    already_disabled = make_user(
        "disabled@acme.test",
        company_id=company.company_id,
        is_admin=False,
        is_active=False,
    )
    outsider = make_user("admin@other.test", company_id=other_company.company_id, is_admin=True)
    super_admin = make_user("super@finsight.test", company_id=None, is_admin=True)
    db.add_all([company_admin, employee, already_disabled, outsider, super_admin])
    db.commit()

    result = update_company_status(
        str(company.company_id),
        CompanyStatusUpdate(is_active=False),
        current_user=super_admin,
        db=db,
    )

    db.expire_all()
    assert result["is_active"] is False
    assert result["affected_user_count"] == 2
    assert db.get(Company, company.company_id).is_active is False
    assert db.get(User, company_admin.user_id).is_active is False
    assert db.get(User, employee.user_id).is_active is False
    assert db.get(User, already_disabled.user_id).is_active is False
    assert db.get(User, outsider.user_id).is_active is True
    assert db.get(User, super_admin.user_id).is_active is True


def test_enabling_company_does_not_reactivate_accounts(db: Session):
    company = Company(company_name="Acme", is_active=False)
    db.add(company)
    db.flush()
    employee = make_user(
        "employee@acme.test",
        company_id=company.company_id,
        is_admin=False,
        is_active=False,
    )
    super_admin = make_user("super@finsight.test", company_id=None, is_admin=True)
    db.add_all([employee, super_admin])
    db.commit()

    result = update_company_status(
        str(company.company_id),
        CompanyStatusUpdate(is_active=True),
        current_user=super_admin,
        db=db,
    )

    db.expire_all()
    assert result["is_active"] is True
    assert result["affected_user_count"] == 0
    assert db.get(User, employee.user_id).is_active is False


def test_super_admin_can_edit_company_name(db: Session):
    company = Company(company_name="Old name", is_active=True)
    super_admin = make_user("super@finsight.test", company_id=None, is_admin=True)
    db.add_all([company, super_admin])
    db.commit()

    result = update_company(
        str(company.company_id),
        CompanyUpdate(company_name="  New name  "),
        current_user=super_admin,
        db=db,
    )

    assert result["company_name"] == "New name"
    assert db.get(Company, company.company_id).company_name == "New name"


def test_company_admin_cannot_edit_or_disable_company(db: Session):
    company = Company(company_name="Acme", is_active=True)
    db.add(company)
    db.flush()
    company_admin = make_user("admin@acme.test", company_id=company.company_id, is_admin=True)
    db.add(company_admin)
    db.commit()

    with pytest.raises(HTTPException) as edit_error:
        update_company(
            str(company.company_id),
            CompanyUpdate(company_name="Changed"),
            current_user=company_admin,
            db=db,
        )
    assert edit_error.value.status_code == 403

    with pytest.raises(HTTPException) as status_error:
        update_company_status(
            str(company.company_id),
            CompanyStatusUpdate(is_active=False),
            current_user=company_admin,
            db=db,
        )
    assert status_error.value.status_code == 403


def test_user_cannot_be_reactivated_while_company_is_disabled(db: Session):
    company = Company(company_name="Acme", is_active=False)
    db.add(company)
    db.flush()
    employee = make_user(
        "employee@acme.test",
        company_id=company.company_id,
        is_admin=False,
        is_active=False,
    )
    super_admin = make_user("super@finsight.test", company_id=None, is_admin=True)
    db.add_all([employee, super_admin])
    db.commit()

    with pytest.raises(HTTPException) as error:
        update_user_status(
            str(employee.user_id),
            UserStatusUpdate(is_active=True),
            current_user=super_admin,
            db=db,
        )

    assert error.value.status_code == 409
    assert db.get(User, employee.user_id).is_active is False
