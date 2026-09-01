from __future__ import annotations

from io import BytesIO

import pandas as pd
from sqlalchemy.orm import Session

from app.models import Transaction


SUPPORTED_EXTENSIONS = {".csv", ".xls", ".xlsx"}
UPLOAD_COLUMN_ALIASES = {
    "transaction_date": ("transaction_date", "date", "txn_date"),
    "amount": ("amount", "debit", "debit_amount", "transaction_amount"),
    "credit": ("credit", "credit_amount"),
    "description": ("description", "narration", "details", "remarks"),
    "chart_acc_head": ("chart_acc_head", "chart_of_acc_head", "account_head", "chart_account_head"),
    "voucher_number": ("voucher_number", "voucher number"),
    "account_head_group": ("account_head_group", "account head group"),
    "voucher_type": ("voucher_type", "voucher_type", "voucher type"),
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


DEBIT_ALIASES = ("debit", "debit_amount", "dr", "withdrawal")
CREDIT_ALIASES = ("credit", "credit_amount", "cr", "deposit")


def resolve_amount_and_type(df: pd.DataFrame) -> pd.DataFrame:
    """Turn a two-column debit/credit ledger into a signed-by-type single amount.

    A double-entry export carries money-out in Debit and money-in in Credit, with the
    unused side left at zero. Mapping only Debit to `amount` silently discards every
    credit row — it lands as amount = 0, invisible to forensics and forecasting alike,
    which is how half a ledger can disappear without a single error being raised.

    Each row keeps its own side in `transaction_type`, which is what
    `forecasting._pick_spending_side()` has always expected to read.
    """
    resolved = df.copy()
    lower = {str(column).strip().lower(): column for column in resolved.columns}

    debit_column = next((lower[name] for name in DEBIT_ALIASES if name in lower), None)
    credit_column = next((lower[name] for name in CREDIT_ALIASES if name in lower), None)

    # `normalize_upload_dataframe` renames a Debit column to `amount` before this runs, so
    # by the time we get here the debit side usually survives only under that name. Treat
    # an existing `amount` as the debit side rather than as "no debit column", which would
    # otherwise zero out every genuine payment.
    if debit_column is None and "amount" in lower:
        debit_column = lower["amount"]

    if debit_column is None and credit_column is None:
        # Single-amount ledger: nothing to reconcile, but every row still needs a side.
        if "transaction_type" not in resolved.columns:
            resolved["transaction_type"] = "debit"
        return resolved

    debit = (
        pd.to_numeric(resolved[debit_column], errors="coerce").fillna(0.0)
        if debit_column is not None
        else pd.Series(0.0, index=resolved.index)
    )
    credit = (
        pd.to_numeric(resolved[credit_column], errors="coerce").fillna(0.0)
        if credit_column is not None
        else pd.Series(0.0, index=resolved.index)
    )

    is_credit = (debit <= 0) & (credit > 0)
    resolved["amount"] = debit.where(~is_credit, credit).abs()
    resolved["transaction_type"] = pd.Series("debit", index=resolved.index).where(~is_credit, "credit")
    return resolved


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
                "transaction_type": txn.transaction_type,
                "description": txn.description,
                "category": txn.category,
                "chart_acc_head": txn.chart_acc_head,
                "cleaned_chart_acc_head": txn.cleaned_chart_acc_head,
                "group_no": float(txn.group_no) if txn.group_no is not None else None,
                "group_name": txn.group_name,
                "semantic_confidence": float(txn.semantic_confidence) if txn.semantic_confidence is not None else None,
                "voucher_number": txn.voucher_number,
                "account_head_group": txn.account_head_group,
                "voucher_type": txn.voucher_type,
                "risk_score": float(txn.risk_score or 0),
                "is_flagged": txn.is_flagged,
            }
        )
    return pd.DataFrame(rows)
