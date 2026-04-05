from __future__ import annotations

from io import BytesIO

import pandas as pd
from sqlalchemy.orm import Session

from app.models import Transaction


SUPPORTED_EXTENSIONS = {".csv", ".xls", ".xlsx"}


def read_uploaded_file(filename: str, content: bytes) -> pd.DataFrame:
    lower = filename.lower()
    if lower.endswith(".csv"):
        return pd.read_csv(BytesIO(content))
    if lower.endswith(".xlsx") or lower.endswith(".xls"):
        return pd.read_excel(BytesIO(content))
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
