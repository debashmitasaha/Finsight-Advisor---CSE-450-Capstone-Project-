from __future__ import annotations

from datetime import datetime
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.router import get_current_user
from app.database import get_db
from app.models import Department, Transaction, UploadBatch, User
from app.services.common import (
    CATEGORY_VALUES,
    clean_chart_account_head,
    compute_dedupe_hash,
    ensure_dataframe_columns,
    normalize_bool,
)
from app.services.dataframe import read_uploaded_file, resolve_amount_and_type

router = APIRouter(prefix="/transactions", tags=["Transactions"])


class TransactionResponse(BaseModel):
    transaction_id: str
    department_id: Optional[str]
    transaction_date: str
    amount: float
    transaction_type: str
    description: Optional[str]
    category: Optional[str]
    chart_acc_head: Optional[str]
    cleaned_chart_acc_head: Optional[str]
    group_no: Optional[float]
    group_name: Optional[str]
    expense_category_id: Optional[str]
    expense_category_name: Optional[str]
    semantic_confidence: Optional[float]
    payment_method: Optional[str]
    invoice_id: Optional[str]
    voucher_number: Optional[str]
    account_head_group: Optional[str]
    voucher_type: Optional[str]
    po_number: Optional[str]
    approval_status: str
    has_receipt: bool
    risk_score: float
    is_flagged: bool
    flagged_reason: Optional[str]
    source_file_name: Optional[str]
    upload_batch_id: Optional[str]


class UploadResponse(BaseModel):
    success: bool
    upload_batch_id: str
    rows_processed: int
    rows_failed: int
    duplicate_rows: int
    failed_rows: list[dict]


class TransactionUpdate(BaseModel):
    category: Optional[str] = None
    approval_status: Optional[str] = None
    is_flagged: Optional[bool] = None
    flagged_reason: Optional[str] = None


REQUIRED_COLUMNS = ["transaction_date", "description", "chart_acc_head"]


def normalize_upload_columns(dataframe: pd.DataFrame) -> pd.DataFrame:
    normalized = dataframe.copy()
    column_aliases = {
        "amount": ["Debit", "debit"],
        "credit": ["Credit", "credit"],
        "description": ["narration", "Narration"],
        "chart_acc_head": ["chart_of_acc_head", "Chart of Account Head", "chart_account_head"],
        "group_name": ["account_head_group", "Account Head Group"],
        "group_no": ["Group No", "group", "group_number"],
        "payment_method": ["Voucher_Type", "voucher_type"],
        "invoice_id": ["voucher_number", "Voucher Number"],
        "voucher_number": ["voucher_number", "Voucher Number"],
        "account_head_group": ["account_head_group", "Account Head Group"],
        "voucher_type": ["Voucher_Type", "voucher_type"],
        "po_number": ["ref_number", "Reference Number"],
    }

    for target, aliases in column_aliases.items():
        if target in normalized.columns:
            continue
        source = next((alias for alias in aliases if alias in normalized.columns), None)
        if source:
            normalized[target] = normalized[source]

    return normalized


def optional_text(row: pd.Series, column: str) -> Optional[str]:
    value = row.get(column)
    if value is None or pd.isna(value):
        return None
    text = str(value).strip()
    return text or None


def optional_float(row: pd.Series, column: str) -> Optional[float]:
    value = row.get(column)
    if value is None or pd.isna(value):
        return None
    return float(value)


def serialize_transaction(txn: Transaction) -> TransactionResponse:
    return TransactionResponse(
        transaction_id=txn.transaction_id,
        department_id=txn.department_id,
        transaction_date=txn.transaction_date.isoformat(),
        amount=float(txn.amount),
        transaction_type=getattr(txn, "transaction_type", None) or "debit",
        description=txn.description,
        category=txn.category,
        chart_acc_head=txn.chart_acc_head,
        cleaned_chart_acc_head=txn.cleaned_chart_acc_head,
        group_no=float(txn.group_no) if txn.group_no is not None else None,
        group_name=txn.group_name,
        expense_category_id=txn.expense_category_id,
        expense_category_name=txn.expense_category.name if txn.expense_category else None,
        semantic_confidence=float(txn.semantic_confidence) if txn.semantic_confidence is not None else None,
        payment_method=txn.payment_method,
        invoice_id=txn.invoice_id,
        voucher_number=txn.voucher_number,
        account_head_group=txn.account_head_group,
        voucher_type=txn.voucher_type,
        po_number=txn.po_number,
        approval_status=txn.approval_status,
        has_receipt=txn.has_receipt,
        risk_score=float(txn.risk_score or 0),
        is_flagged=txn.is_flagged,
        flagged_reason=txn.flagged_reason,
        source_file_name=txn.source_file_name,
        upload_batch_id=txn.upload_batch_id,
    )


@router.post("/upload", response_model=UploadResponse)
async def upload_transactions(
    file: UploadFile = File(...),
    dept_id: str = Form(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    department = db.query(Department).filter(Department.department_id == dept_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")

    try:
        contents = await file.read()
        dataframe = read_uploaded_file(file.filename or "upload.csv", contents)
        dataframe = normalize_upload_columns(dataframe)
        dataframe = resolve_amount_and_type(dataframe)
        ensure_dataframe_columns(dataframe, REQUIRED_COLUMNS)
        if "amount" not in dataframe.columns and "credit" not in dataframe.columns:
            raise ValueError("Missing required columns: amount or credit")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to read upload: {exc}") from exc

    batch = UploadBatch(
        department_id=dept_id,
        source_file_name=file.filename or "upload.csv",
        uploaded_by=current_user.user_id,
        row_count=len(dataframe.index),
        status="processing",
    )
    db.add(batch)
    db.flush()

    rows_processed = 0
    rows_failed = 0
    duplicate_rows = 0
    failed_rows: list[dict] = []

    for row_index, row in dataframe.iterrows():
        try:
            transaction_date = pd.to_datetime(row["transaction_date"], utc=True).to_pydatetime()
            amount = float(row["amount"])
            transaction_type = str(row.get("transaction_type") or "debit").strip().lower()
            description = optional_text(row, "description")
            chart_acc_head = optional_text(row, "chart_acc_head")
            cleaned_chart = clean_chart_account_head(chart_acc_head)
            invoice_id = optional_text(row, "invoice_id")
            voucher_number = optional_text(row, "voucher_number")
            account_head_group = optional_text(row, "account_head_group")
            voucher_type = optional_text(row, "voucher_type")
            po_number = optional_text(row, "po_number")
            group_name = optional_text(row, "group_name")
            group_no = optional_float(row, "group_no")

            dedupe_hash = compute_dedupe_hash(
                dept_id,
                transaction_date.isoformat(),
                amount,
                description,
                invoice_id,
                po_number,
            )
            if db.query(Transaction).filter(Transaction.dedupe_hash == dedupe_hash).first():
                duplicate_rows += 1
                continue

            txn = Transaction(
                department_id=dept_id,
                transaction_date=transaction_date,
                amount=amount,
                transaction_type=transaction_type if transaction_type in {"debit", "credit"} else "debit",
                description=description,
                category="uncategorized",
                chart_acc_head=chart_acc_head,
                cleaned_chart_acc_head=cleaned_chart,
                group_no=group_no,
                group_name=group_name,
                payment_method=optional_text(row, "payment_method"),
                invoice_id=invoice_id,
                voucher_number=voucher_number,
                account_head_group=account_head_group,
                voucher_type=voucher_type,
                po_number=po_number,
                has_receipt=normalize_bool(row.get("has_receipt")),
                approval_status=str(row.get("approval_status", "pending") or "pending").lower(),
                source_file_name=file.filename,
                upload_batch_id=batch.upload_batch_id,
                dedupe_hash=dedupe_hash,
            )
            db.add(txn)
            rows_processed += 1
        except Exception as exc:  # pragma: no cover - row-specific data issues
            rows_failed += 1
            failed_rows.append({"row": int(row_index) + 2, "error": str(exc)})

    batch.status = "completed" if rows_failed == 0 else "completed_with_errors"
    db.commit()

    return UploadResponse(
        success=rows_failed == 0,
        upload_batch_id=batch.upload_batch_id,
        rows_processed=rows_processed,
        rows_failed=rows_failed,
        duplicate_rows=duplicate_rows,
        failed_rows=failed_rows[:50],
    )


@router.get("/dept/{dept_id}", response_model=list[TransactionResponse])
def get_transactions_by_department(
    dept_id: str,
    month: Optional[int] = None,
    year: Optional[int] = None,
    category: Optional[str] = None,
    flagged: Optional[bool] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Transaction).filter(Transaction.department_id == dept_id)
    if month is not None and year is not None:
        query = query.filter(
            Transaction.transaction_date >= datetime(year, month, 1),
            Transaction.transaction_date < datetime(year + (month // 12), (month % 12) + 1, 1),
        )
    if category:
        query = query.filter(Transaction.category == category)
    if flagged is not None:
        query = query.filter(Transaction.is_flagged == flagged)
    transactions = query.order_by(Transaction.transaction_date.desc()).all()
    return [serialize_transaction(txn) for txn in transactions]


@router.get("/{transaction_id}", response_model=TransactionResponse)
def get_transaction(transaction_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    txn = db.query(Transaction).filter(Transaction.transaction_id == transaction_id).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return serialize_transaction(txn)


@router.patch("/{transaction_id}", response_model=TransactionResponse)
def update_transaction(
    transaction_id: str,
    payload: TransactionUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    txn = db.query(Transaction).filter(Transaction.transaction_id == transaction_id).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    if payload.category is not None:
        if payload.category not in CATEGORY_VALUES:
            raise HTTPException(status_code=400, detail="Invalid category")
        txn.category = payload.category
    if payload.approval_status is not None:
        txn.approval_status = payload.approval_status.lower()
    if payload.is_flagged is not None:
        txn.is_flagged = payload.is_flagged
    if payload.flagged_reason is not None:
        txn.flagged_reason = payload.flagged_reason

    db.commit()
    db.refresh(txn)
    return serialize_transaction(txn)
