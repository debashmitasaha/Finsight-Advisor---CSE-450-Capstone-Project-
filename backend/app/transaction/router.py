from __future__ import annotations

from datetime import datetime
import hashlib
from typing import Optional
import uuid

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.router import get_current_user
from app.database import get_db
from app.models import Anomaly, Department, ExpenseCategory, Transaction, UploadBatch, User
from app.services.common import (
    CATEGORY_VALUES,
    clean_chart_account_head,
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


class TransactionPageResponse(BaseModel):
    items: list[TransactionResponse]
    total: int
    limit: int
    offset: int


class TransactionUpdate(BaseModel):
    category: Optional[str] = None
    approval_status: Optional[str] = None
    is_flagged: Optional[bool] = None
    flagged_reason: Optional[str] = None


REQUIRED_COLUMNS = ["transaction_date", "description", "chart_acc_head"]

# How many rows go into the database per statement during an upload.
UPLOAD_INSERT_CHUNK = 2_000


def normalize_upload_columns(dataframe: pd.DataFrame) -> pd.DataFrame:
    normalized = dataframe.copy()
    column_aliases = {
        "amount": ["Debit", "debit"],
        "credit": ["Credit", "credit"],
        "description": ["narration", "Narration"],
        "chart_acc_head": ["chart_of_acc_head", "Chart of Account Head", "chart_account_head"],
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


def normalize_document_key_part(value: str | None) -> str:
    return " ".join(str(value or "").strip().lower().split())


def transaction_document_key(voucher_number: str | None, ref_number: str | None) -> str | None:
    voucher = normalize_document_key_part(voucher_number)
    reference = normalize_document_key_part(ref_number)
    if voucher and reference:
        return f"{voucher}|{reference}"
    if voucher:
        return voucher
    if reference:
        return reference
    return None


def _clean_series(dataframe: pd.DataFrame, column: str) -> pd.Series:
    """One column as trimmed strings, with every flavour of blank as the empty string.

    Done column-wise on purpose. The same work per row costs a pandas scalar lookup
    each time, which is what made a five-year upload take a minute.
    """
    if column not in dataframe.columns:
        return pd.Series("", index=dataframe.index, dtype="object")
    series = dataframe[column]
    return series.where(series.notna(), "").astype(str).str.strip()


def dataframe_document_keys(dataframe: pd.DataFrame) -> set[str]:
    voucher = _clean_series(dataframe, "voucher_number").str.lower().str.split().str.join(" ")
    reference = _clean_series(dataframe, "po_number").str.lower().str.split().str.join(" ")

    both = voucher + "|" + reference
    keys = both.where(
        (voucher != "") & (reference != ""),
        voucher.where(voucher != "", reference),
    )
    return set(keys[keys != ""].unique())


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


def _month_bucket(db: Session):
    if db.bind and db.bind.dialect.name == "sqlite":
        return func.strftime("%Y-%m", Transaction.transaction_date)
    return func.to_char(Transaction.transaction_date, "YYYY-MM")


def _serialize_category_name(name: str | None) -> str:
    return name or "Unassigned"


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
        source_file_hash = hashlib.sha256(contents).hexdigest()
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

    existing_file = (
        db.query(UploadBatch)
        .filter(UploadBatch.department_id == dept_id, UploadBatch.source_file_hash == source_file_hash)
        .first()
    )
    if existing_file:
        raise HTTPException(status_code=409, detail="This exact ledger file has already been uploaded for this department.")

    uploaded_document_keys = dataframe_document_keys(dataframe)
    if uploaded_document_keys:
        existing_document_keys = {
            key
            for key in (
                transaction_document_key(voucher_number, po_number)
                for voucher_number, po_number in db.query(Transaction.voucher_number, Transaction.po_number)
                .filter(
                    Transaction.department_id == dept_id,
                    (Transaction.voucher_number.isnot(None)) | (Transaction.po_number.isnot(None)),
                )
                .all()
            )
            if key
        }
        overlap_count = len(uploaded_document_keys & existing_document_keys)
        overlap_ratio = overlap_count / len(uploaded_document_keys)
        if overlap_ratio >= 0.8:
            raise HTTPException(
                status_code=409,
                detail=(
                    "This ledger overlaps a previous upload for this department "
                    f"({overlap_count}/{len(uploaded_document_keys)} voucher/reference keys already exist)."
                ),
            )

    batch = UploadBatch(
        department_id=dept_id,
        source_file_name=file.filename or "upload.csv",
        source_file_hash=source_file_hash,
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

    # Parse the whole column at a time rather than the same field 34,000 times over.
    # A five-year ledger is the normal case this endpoint has to survive, and row-wise
    # parsing spent most of a minute in `pd.to_datetime` on single values.
    dates = pd.to_datetime(dataframe["transaction_date"], utc=True, errors="coerce")
    amounts = pd.to_numeric(dataframe.get("amount"), errors="coerce")

    kinds = _clean_series(dataframe, "transaction_type").str.lower()
    kinds = kinds.where(kinds.isin(("debit", "credit")), "debit")

    statuses = _clean_series(dataframe, "approval_status").str.lower()
    statuses = statuses.where(statuses != "", "pending")

    text_columns = {
        name: _clean_series(dataframe, name)
        for name in ("description", "chart_acc_head", "invoice_id", "voucher_number",
                     "account_head_group", "voucher_type", "po_number", "payment_method")
    }
    # A ledger has a handful of distinct account heads and tens of thousands of rows,
    # so the regex cleaning runs once per distinct head rather than once per row.
    heads = text_columns["chart_acc_head"]
    cleaned_lookup = {value: clean_chart_account_head(value) for value in heads.unique()}
    cleaned_heads = heads.map(cleaned_lookup)

    receipts = (
        dataframe["has_receipt"].map(normalize_bool)
        if "has_receipt" in dataframe.columns
        else pd.Series(False, index=dataframe.index)
    )

    def none_if_blank(value: str) -> Optional[str]:
        return value or None

    mappings: list[dict] = []
    for position, row_index in enumerate(dataframe.index):
        transaction_date = dates.iat[position]
        amount = amounts.iat[position] if amounts is not None else None
        if pd.isna(transaction_date):
            rows_failed += 1
            failed_rows.append({"row": int(position) + 2, "error": "transaction_date is missing or unreadable"})
            continue
        if amount is None or pd.isna(amount):
            rows_failed += 1
            failed_rows.append({"row": int(position) + 2, "error": "amount is missing or not a number"})
            continue

        mappings.append({
            # Supplying the primary key avoids PostgreSQL/SQLAlchemy bulk
            # insert sentinel mismatches when many transactions are uploaded.
            "transaction_id": uuid.uuid4(),
            "department_id": dept_id,
            "transaction_date": transaction_date.to_pydatetime(),
            "amount": float(amount),
            "transaction_type": kinds.iat[position],
            "description": none_if_blank(text_columns["description"].iat[position]),
            "category": "uncategorized",
            "chart_acc_head": none_if_blank(text_columns["chart_acc_head"].iat[position]),
            "cleaned_chart_acc_head": cleaned_heads.iat[position],
            "payment_method": none_if_blank(text_columns["payment_method"].iat[position]),
            "invoice_id": none_if_blank(text_columns["invoice_id"].iat[position]),
            "voucher_number": none_if_blank(text_columns["voucher_number"].iat[position]),
            "account_head_group": none_if_blank(text_columns["account_head_group"].iat[position]),
            "voucher_type": none_if_blank(text_columns["voucher_type"].iat[position]),
            "po_number": none_if_blank(text_columns["po_number"].iat[position]),
            "has_receipt": bool(receipts.iat[position]),
            "approval_status": statuses.iat[position],
            "risk_score": 0,
            "is_flagged": False,
            "source_file_name": file.filename,
            "upload_batch_id": batch.upload_batch_id,
        })
        rows_processed += 1

    # In chunks, so a large ledger never builds one enormous statement.
    for start in range(0, len(mappings), UPLOAD_INSERT_CHUNK):
        db.bulk_insert_mappings(Transaction, mappings[start:start + UPLOAD_INSERT_CHUNK])

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


@router.get("/dept/{dept_id}/summary")
def get_department_transaction_summary(
    dept_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    department = db.query(Department).filter(Department.department_id == dept_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")

    summary = (
        db.query(
            func.count(Transaction.transaction_id).label("transaction_count"),
            func.coalesce(func.sum(Transaction.amount), 0).label("total_spend"),
            func.max(Transaction.transaction_date).label("latest_transaction_date"),
        )
        .filter(Transaction.department_id == dept_id)
        .one()
    )
    category_rows = (
        db.query(
            func.coalesce(Transaction.category, "uncategorized").label("category"),
            func.count(Transaction.transaction_id).label("count"),
        )
        .filter(Transaction.department_id == dept_id)
        .group_by(func.coalesce(Transaction.category, "uncategorized"))
        .all()
    )
    expense_rows = (
        db.query(
            ExpenseCategory.name.label("name"),
            func.count(Transaction.transaction_id).label("count"),
            func.coalesce(func.sum(Transaction.amount), 0).label("amount"),
        )
        .outerjoin(ExpenseCategory, Transaction.expense_category_id == ExpenseCategory.category_id)
        .filter(Transaction.department_id == dept_id)
        .group_by(ExpenseCategory.name)
        .order_by(func.coalesce(func.sum(Transaction.amount), 0).desc())
        .limit(12)
        .all()
    )
    month_expr = _month_bucket(db)
    trend_rows = (
        db.query(
            month_expr.label("month"),
            func.coalesce(func.sum(Transaction.amount), 0).label("amount"),
        )
        .filter(Transaction.department_id == dept_id)
        .group_by(month_expr)
        .order_by(month_expr.desc())
        .limit(6)
        .all()
    )
    unresolved_anomalies = int(
        db.query(func.count(Anomaly.anomaly_id))
        .filter(Anomaly.department_id == dept_id, Anomaly.is_resolved.is_(False))
        .scalar()
        or 0
    )
    flagged_transactions = int(
        db.query(func.count(Transaction.transaction_id))
        .filter(Transaction.department_id == dept_id, Transaction.is_flagged.is_(True))
        .scalar()
        or 0
    )

    category_counts = {row.category or "uncategorized": int(row.count or 0) for row in category_rows}
    return {
        "department_id": dept_id,
        "transaction_count": int(summary.transaction_count or 0),
        "total_spend": float(summary.total_spend or 0),
        "latest_transaction_date": summary.latest_transaction_date.isoformat() if summary.latest_transaction_date else None,
        "active_anomaly_count": unresolved_anomalies,
        "flagged_transaction_count": flagged_transactions,
        "necessity": {
            "necessary": category_counts.get("necessary", 0),
            "unnecessary": category_counts.get("unnecessary", 0),
            "uncategorized": category_counts.get("uncategorized", 0),
            "total": int(summary.transaction_count or 0),
        },
        "expense_category_breakdown": [
            {
                "name": _serialize_category_name(row.name),
                "count": int(row.count or 0),
                "amount": float(row.amount or 0),
            }
            for row in expense_rows
        ],
        "spend_trend": [
            {"month": row.month, "amount": float(row.amount or 0)}
            for row in reversed(trend_rows)
        ],
    }


@router.get("/dept/{dept_id}", response_model=list[TransactionResponse])
def get_transactions_by_department(
    dept_id: str,
    month: Optional[int] = None,
    year: Optional[int] = None,
    category: Optional[str] = None,
    flagged: Optional[bool] = None,
    upload_batch_id: Optional[str] = None,
    group_no: Optional[float] = None,
    chart_acc_head_name: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
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
    if upload_batch_id:
        query = query.filter(Transaction.upload_batch_id == upload_batch_id)
    if group_no is not None:
        query = query.filter(Transaction.group_no == group_no)
    elif chart_acc_head_name:
        query = query.filter(Transaction.cleaned_chart_acc_head == chart_acc_head_name)
    transactions = query.order_by(Transaction.transaction_date.desc()).offset(offset).limit(limit).all()
    return [serialize_transaction(txn) for txn in transactions]


@router.get("/dept/{dept_id}/page", response_model=TransactionPageResponse)
def get_transactions_page_by_department(
    dept_id: str,
    month: Optional[int] = None,
    year: Optional[int] = None,
    category: Optional[str] = None,
    flagged: Optional[bool] = None,
    upload_batch_id: Optional[str] = None,
    group_no: Optional[float] = None,
    chart_acc_head_name: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
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
    if upload_batch_id:
        query = query.filter(Transaction.upload_batch_id == upload_batch_id)
    if group_no is not None:
        query = query.filter(Transaction.group_no == group_no)
    elif chart_acc_head_name:
        query = query.filter(Transaction.cleaned_chart_acc_head == chart_acc_head_name)
    total = query.count()
    transactions = query.order_by(Transaction.transaction_date.desc()).offset(offset).limit(limit).all()
    return {
        "items": [serialize_transaction(txn) for txn in transactions],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


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
