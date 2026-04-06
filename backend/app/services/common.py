from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import re
from typing import Iterable

import pandas as pd
from sqlalchemy.orm import Session

from app.models import Department, Transaction, User, UserRole


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


def calculate_department_budget_usage(transactions: list[Transaction], annual_budget: float | None) -> dict[str, float]:
    current_year = datetime.now(timezone.utc).year
    current_year_transactions = [
        txn for txn in transactions
        if txn.transaction_date and txn.transaction_date.year == current_year
    ]

    grouped: dict[str, list[Transaction]] = {}
    for txn in current_year_transactions:
        group_key = txn.invoice_id or str(txn.transaction_id)
        grouped.setdefault(group_key, []).append(txn)

    used_budget = 0.0
    for group in grouped.values():
        debit_amount = sum(float(txn.amount or 0) for txn in group if (txn.transaction_type or "debit").lower() == "debit")
        credit_amount = sum(float(txn.amount or 0) for txn in group if (txn.transaction_type or "").lower() == "credit")
        if debit_amount > 0:
            used_budget += debit_amount
        elif credit_amount > 0:
            used_budget += credit_amount

    budget_value = float(annual_budget or 0)
    utilization_pct = (used_budget / budget_value) * 100 if budget_value > 0 else 0.0
    return {
        "used_budget_current_year": round(used_budget, 2),
        "annual_budget_utilization_pct": round(utilization_pct, 2),
    }


def serialize_user(user: User) -> dict:
    roles = []
    for role in user.roles:
        roles.append(
            {
                "department_id": str(role.dept_id),
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
        "user_id": str(user.user_id),
        "username": user.username,
        "name": user.username,
        "email": user.email,
        "company_id": str(user.company_id) if user.company_id else None,
        "is_admin": user.is_admin,
        "is_active": user.is_active,
        "last_login": user.last_login.isoformat() if user.last_login else None,
        "account_type": account_type,
        "departments": roles,
    }
