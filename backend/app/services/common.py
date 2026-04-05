from __future__ import annotations

import hashlib
import re
from typing import Iterable

import pandas as pd
from sqlalchemy.orm import Session

from app.models import Department, User, UserRole


CATEGORY_VALUES = {"necessary", "unnecessary", "uncategorized"}


def clean_chart_account_head(text: str | None) -> str:
    if not text:
        return ""
    cleaned = re.sub(r"\(.*?\)|\[.*?\]", " ", str(text).lower())
    cleaned = re.sub(r"\d+", " ", cleaned)
    cleaned = re.sub(r"[^a-z\s&/.-]", " ", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def compute_dedupe_hash(
    department_id: str,
    transaction_date: str,
    amount: float,
    description: str | None,
    invoice_id: str | None,
    po_number: str | None,
) -> str:
    payload = "|".join(
        [
            department_id or "",
            str(transaction_date or ""),
            f"{float(amount):.2f}",
            (description or "").strip().lower(),
            (invoice_id or "").strip().lower(),
            (po_number or "").strip().lower(),
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def ensure_dataframe_columns(df: pd.DataFrame, required_columns: Iterable[str]) -> None:
    missing = [column for column in required_columns if column not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(missing)}")


def normalize_bool(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def get_department_or_404(db: Session, department_id: str) -> Department:
    department = db.query(Department).filter(Department.department_id == department_id).first()
    if not department:
        raise ValueError("Department not found")
    return department


def serialize_user(user: User) -> dict:
    roles = []
    for role in user.roles:
        roles.append(
            {
                "department_id": role.dept_id,
                "department_name": role.department.department_name if role.department else None,
                "permissions": role.permissions or [],
            }
        )

    if user.is_admin and not roles:
        account_type = "SUPER_ADMIN" if user.company_id is None else "ADMIN"
    elif user.is_admin:
        account_type = "ADMIN"
    else:
        account_type = "EMPLOYEE"

    return {
        "user_id": user.user_id,
        "username": user.username,
        "name": user.username,
        "email": user.email,
        "company_id": user.company_id,
        "is_admin": user.is_admin,
        "is_active": user.is_active,
        "account_type": account_type,
        "departments": roles,
    }
