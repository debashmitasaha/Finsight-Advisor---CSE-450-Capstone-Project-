from __future__ import annotations

# Bug 3 fix: use date.fromisoformat() instead of datetime.strptime() for cleaner parsing.
from datetime import date, datetime
from typing import Literal

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.router import get_current_user
from app.budget.forecasting import (
    build_monthly_series,
    forecast_from_artifact_for_department,
    run_budget_forecast,
)
from app.database import get_db
from app.models import BudgetForecast, Department, Transaction, UploadBatch, User

router = APIRouter(prefix="/budget", tags=["Budget"])


ForecastSourceMode = Literal["latest_batch", "full_history", "upload_batch", "date_range"]


class ForecastRequest(BaseModel):
    dept_id: str
    months_ahead: int = 1
    source_mode: ForecastSourceMode = "latest_batch"
    upload_batch_id: str | None = None
    date_from: date | None = None
    date_to: date | None = None


class UploadBatchSummary(BaseModel):
    upload_batch_id: str
    source_file_name: str
    uploaded_at: str
    row_count: int
    status: str
    transaction_count: int
    first_transaction_date: str | None
    last_transaction_date: str | None


def _latest_batch_transactions(db: Session, dept_id: str) -> tuple[list[Transaction], str]:
    recent_batches = (
        db.query(UploadBatch)
        .filter(UploadBatch.department_id == dept_id, UploadBatch.status.in_(["completed", "completed_with_errors"]))
        .order_by(UploadBatch.uploaded_at.desc(), UploadBatch.upload_batch_id.desc())
        .all()
    )

    for latest_batch in recent_batches:
        batch_transactions = (
            db.query(Transaction)
            .filter(Transaction.department_id == dept_id, Transaction.upload_batch_id == latest_batch.upload_batch_id)
            .order_by(Transaction.transaction_date.asc())
            .all()
        )
        if batch_transactions:
            return batch_transactions, f"latest upload batch: {latest_batch.source_file_name}"

    transactions = (
        db.query(Transaction)
        .filter(Transaction.department_id == dept_id)
        .order_by(Transaction.transaction_date.asc())
        .all()
    )
    return transactions, "full department history"


def _full_history_transactions(db: Session, dept_id: str) -> tuple[list[Transaction], str]:
    transactions = (
        db.query(Transaction)
        .filter(Transaction.department_id == dept_id)
        .order_by(Transaction.transaction_date.asc())
        .all()
    )
    return transactions, "full department history"


def _batch_transactions(db: Session, dept_id: str, upload_batch_id: str) -> tuple[list[Transaction], str]:
    batch = (
        db.query(UploadBatch)
        .filter(UploadBatch.department_id == dept_id, UploadBatch.upload_batch_id == upload_batch_id)
        .first()
    )
    if not batch:
        raise HTTPException(status_code=404, detail="Upload batch not found for department")

    transactions = (
        db.query(Transaction)
        .filter(Transaction.department_id == dept_id, Transaction.upload_batch_id == upload_batch_id)
        .order_by(Transaction.transaction_date.asc())
        .all()
    )
    return transactions, f"selected upload batch: {batch.source_file_name}"


def _date_range_transactions(db: Session, dept_id: str, start_date: date, end_date: date) -> tuple[list[Transaction], str]:
    start_dt = datetime.combine(start_date, datetime.min.time())
    end_dt = datetime.combine(end_date + relativedelta(days=1), datetime.min.time())
    transactions = (
        db.query(Transaction)
        .filter(
            Transaction.department_id == dept_id,
            Transaction.transaction_date >= start_dt,
            Transaction.transaction_date < end_dt,
        )
        .order_by(Transaction.transaction_date.asc())
        .all()
    )
    return transactions, f"selected date range: {start_date.isoformat()} to {end_date.isoformat()}"


def _resolve_forecast_source(
    db: Session,
    dept_id: str,
    source_mode: ForecastSourceMode,
    upload_batch_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> tuple[list[Transaction], str]:
    if source_mode == "latest_batch":
        return _latest_batch_transactions(db, dept_id)
    if source_mode == "full_history":
        return _full_history_transactions(db, dept_id)
    if source_mode == "upload_batch":
        if not upload_batch_id:
            raise HTTPException(status_code=400, detail="upload_batch_id is required when source_mode is upload_batch")
        return _batch_transactions(db, dept_id, upload_batch_id)
    if source_mode == "date_range":
        if not date_from or not date_to:
            raise HTTPException(status_code=400, detail="date_from and date_to are required when source_mode is date_range")
        if date_from > date_to:
            raise HTTPException(status_code=400, detail="date_from cannot be after date_to")
        return _date_range_transactions(db, dept_id, date_from, date_to)
    raise HTTPException(status_code=400, detail="Unsupported source_mode")


def _append_scope_note(result, scope_note: str):
    diagnostics = dict(result.diagnostics)
    existing_notes = diagnostics.get("notes")
    diagnostics["notes"] = f"{existing_notes} Using {scope_note}." if existing_notes else f"Using {scope_note}."
    result.diagnostics = diagnostics
    return result


def _serialize_forecast_rows(forecasts: list[BudgetForecast]) -> list[dict]:
    return [
        {
            "forecast_id": str(forecast.forecast_id),
            "forecast_period_start": forecast.forecast_period_start.isoformat(),
            "forecast_period_end": forecast.forecast_period_end.isoformat(),
            "predicted_amount": float(forecast.predicted_amount),
            "lower_bound": float(forecast.lower_bound or 0),
            "upper_bound": float(forecast.upper_bound or 0),
            "model_type": forecast.model_type,
            "model_version": forecast.model_version,
        }
        for forecast in forecasts
    ]


def _serialize_upload_batch(batch_row) -> dict:
    return {
        "upload_batch_id": str(batch_row.upload_batch_id),
        "source_file_name": batch_row.source_file_name,
        "uploaded_at": batch_row.uploaded_at.isoformat(),
        "row_count": int(batch_row.row_count or 0),
        "status": batch_row.status,
        "transaction_count": int(batch_row.transaction_count or 0),
        "first_transaction_date": batch_row.first_transaction_date.date().isoformat() if batch_row.first_transaction_date else None,
        "last_transaction_date": batch_row.last_transaction_date.date().isoformat() if batch_row.last_transaction_date else None,
    }


@router.post("/forecast")
def generate_forecast(payload: ForecastRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    department = db.query(Department).filter(Department.department_id == payload.dept_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")

    months_ahead = max(1, payload.months_ahead)
    transactions, scope_note = _resolve_forecast_source(
        db,
        payload.dept_id,
        payload.source_mode,
        payload.upload_batch_id,
        payload.date_from,
        payload.date_to,
    )
    if not transactions:
        result = forecast_from_artifact_for_department(payload.dept_id, months_ahead)
        if result is None:
            raise HTTPException(status_code=400, detail="No transaction data available and no serialized budget artifact was found")
    else:
        monthly = build_monthly_series(transactions)
        if monthly.empty:
            raise HTTPException(status_code=400, detail="No positive spending data available for forecasting")
        result = run_budget_forecast(monthly, months_ahead)
        result = _append_scope_note(result, scope_note)

    (
        db.query(BudgetForecast)
        .filter(BudgetForecast.department_id == payload.dept_id)
        .delete(synchronize_session=False)
    )

    forecasts = []
    for predicted in result.forecasts:
        period_start = date.fromisoformat(f"{predicted['month']}-01")
        period_end = period_start + relativedelta(months=1, days=-1)
        forecast = BudgetForecast(
            department_id=payload.dept_id,
            forecast_period_start=period_start,
            forecast_period_end=period_end,
            predicted_amount=float(predicted["predicted_amount"]),
            model_type=result.model_type,
            model_version=result.model_version,
            lower_bound=float(predicted["lower_bound"]),
            upper_bound=float(predicted["upper_bound"]),
        )
        db.add(forecast)
        forecasts.append(forecast)

    db.commit()
    for forecast in forecasts:
        db.refresh(forecast)

    return {
        "success": True,
        "history": result.history,
        "diagnostics": result.diagnostics,
        "model": {
            "model_type": result.model_type,
            "model_version": result.model_version,
        },
        "forecasts": _serialize_forecast_rows(forecasts),
    }


@router.get("/dept/{dept_id}/forecasts")
def get_forecasts(dept_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    forecasts = (
        db.query(BudgetForecast)
        .filter(BudgetForecast.department_id == dept_id)
        .order_by(BudgetForecast.forecast_period_start.desc())
        .all()
    )
    return _serialize_forecast_rows(forecasts)


@router.get("/dept/{dept_id}/upload-batches", response_model=list[UploadBatchSummary])
def list_upload_batches(
    dept_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    batch_rows = (
        db.query(
            UploadBatch.upload_batch_id,
            UploadBatch.source_file_name,
            UploadBatch.uploaded_at,
            UploadBatch.row_count,
            UploadBatch.status,
            func.count(Transaction.transaction_id).label("transaction_count"),
            func.min(Transaction.transaction_date).label("first_transaction_date"),
            func.max(Transaction.transaction_date).label("last_transaction_date"),
        )
        .outerjoin(Transaction, Transaction.upload_batch_id == UploadBatch.upload_batch_id)
        .filter(UploadBatch.department_id == dept_id)
        .group_by(
            UploadBatch.upload_batch_id,
            UploadBatch.source_file_name,
            UploadBatch.uploaded_at,
            UploadBatch.row_count,
            UploadBatch.status,
        )
        .order_by(UploadBatch.uploaded_at.desc(), UploadBatch.upload_batch_id.desc())
        .all()
    )
    return [_serialize_upload_batch(batch_row) for batch_row in batch_rows]


@router.get("/dept/{dept_id}/forecast-context")
def get_forecast_context(
    dept_id: str,
    months_ahead: int = 3,
    source_mode: ForecastSourceMode = "latest_batch",
    upload_batch_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    months_ahead = max(1, months_ahead)
    forecast_rows = (
        db.query(BudgetForecast)
        .filter(BudgetForecast.department_id == dept_id)
        .order_by(BudgetForecast.forecast_period_start.asc())
        .all()
    )

    transactions, scope_note = _resolve_forecast_source(
        db,
        dept_id,
        source_mode,
        upload_batch_id,
        date_from,
        date_to,
    )

    history = build_monthly_series(transactions)
    if history.empty:
        return {
            "history": [],
            "diagnostics": None,
            "model": None,
            "forecasts": _serialize_forecast_rows(list(reversed(forecast_rows))),
        }

    result = run_budget_forecast(history, months_ahead)
    result = _append_scope_note(result, scope_note)
    serialized_rows = _serialize_forecast_rows(list(reversed(forecast_rows)))
    if not forecast_rows:
        serialized_rows = [
            {
                "forecast_id": f"{dept_id}:{forecast['month']}",
                "forecast_period_start": f"{forecast['month']}-01",
                "forecast_period_end": f"{forecast['month']}-28",
                "predicted_amount": float(forecast["predicted_amount"]),
                "lower_bound": float(forecast["lower_bound"]),
                "upper_bound": float(forecast["upper_bound"]),
                "model_type": result.model_type,
                "model_version": result.model_version,
            }
            for forecast in reversed(result.forecasts)
        ]

    return {
        "history": result.history,
        "diagnostics": result.diagnostics,
        "model": {
            "model_type": result.model_type,
            "model_version": result.model_version,
        },
        "forecasts": serialized_rows,
    }
