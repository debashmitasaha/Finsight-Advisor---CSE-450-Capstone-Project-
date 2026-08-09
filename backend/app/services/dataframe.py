from __future__ import annotations

from io import BytesIO

import pandas as pd
from sqlalchemy.orm import Session

from app.models import Transaction


SUPPORTED_EXTENSIONS = {".csv", ".xls", ".xlsx"}
UPLOAD_COLUMN_ALIASES = {
    "transaction_date": ("transaction_date", "date", "txn_date"),
    "amount": ("amount", "debit", "debit_amount", "transaction_amount"),
    "description": ("description", "narration", "details", "remarks"),
    "chart_acc_head": ("chart_acc_head", "chart_of_acc_head", "account_head", "chart_account_head"),
}


def _normalize_column_name(column: object) -> str:
    return str(column).strip().lower()


def normalize_upload_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    normalized = df.copy()
    normalized.columns = [_normalize_column_name(column) for column in normalized.columns]

    rename_map: dict[str, str] = {}
    for canonical, aliases in UPLOAD_COLUMN_ALIASES.items():
        if canonical in normalized.columns:
            continue
        for alias in aliases:
            if alias in normalized.columns:
                rename_map[alias] = canonical
                break

    if rename_map:
        normalized = normalized.rename(columns=rename_map)
    return normalized


def read_uploaded_file(filename: str, content: bytes) -> pd.DataFrame:
    lower = filename.lower()
    if lower.endswith(".csv"):
        return normalize_upload_dataframe(pd.read_csv(BytesIO(content)))
    if lower.endswith(".xlsx") or lower.endswith(".xls"):
        return normalize_upload_dataframe(pd.read_excel(BytesIO(content)))
    raise ValueError("Only CSV, XLS, and XLSX files are supported")


def department_transactions_df(db: Session, department_id: str) -> pd.DataFrame:
    transactions = (
        db.query(Transaction)
        .filter(Transaction.department_id == department_id)
        .order_by(Transaction.transaction_date.asc())
        .all()
    )

    rows = []
    for txn in transactions:
        rows.append(
            {
                "transaction_id": txn.transaction_id,
                "department_id": txn.department_id,
                "transaction_date": txn.transaction_date,
                "amount": float(txn.amount),
                "description": txn.description,
                "category": txn.category,
                "chart_acc_head": txn.chart_acc_head,
                "cleaned_chart_acc_head": txn.cleaned_chart_acc_head,
                "group_no": float(txn.group_no) if txn.group_no is not None else None,
                "group_name": txn.group_name,
                "semantic_confidence": float(txn.semantic_confidence) if txn.semantic_confidence is not None else None,
                "risk_score": float(txn.risk_score or 0),
                "is_flagged": txn.is_flagged,
            }
        )
    return pd.DataFrame(rows)
