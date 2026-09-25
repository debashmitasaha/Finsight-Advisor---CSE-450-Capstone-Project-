from __future__ import annotations

# Bug 3 fix: use date.fromisoformat() instead of datetime.strptime() for cleaner parsing.
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.admin.router import get_budget_reference_date, get_department_budget_snapshot
from app.auth.router import get_current_user
from app.budget.forecasting import (
    build_monthly_series,
    forecast_from_artifact_for_department,
    run_budget_forecast,
)
from app.database import get_db
from app.models import BudgetForecast, Department, Notification, Transaction, UploadBatch, User

router = APIRouter(prefix="/budget", tags=["Budget"])


ForecastSourceMode = Literal["latest_batch", "full_history", "upload_batch", "date_range"]

# Scopes that represent an ongoing, department-wide prediction rather than a
# one-off run against a specific uploaded file or date range. Accuracy
# tracking and budget-pace alerts only ever consider runs made in these
# scopes, so testing a forecast against an arbitrary old file never pollutes
# either.
ONGOING_FORECAST_SCOPES = ("latest_batch", "full_history")


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
            "source_mode": forecast.source_mode,
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


def _maybe_create_budget_pace_alert(db: Session, department: Department, forecasts: list[BudgetForecast]) -> None:
    """Warn when actual spend so far this year plus the forecasted remaining
    months of the year is on pace to cross the department's annual budget.

    Only called for ongoing-scope forecasts (see ONGOING_FORECAST_SCOPES) --
    a one-off run against an arbitrary old file should never trigger this.
    """
    annual_budget = float(department.annual_budget or 0)
    if annual_budget <= 0:
        return

    reference_date = get_budget_reference_date(db, department.department_id).date()
    snapshot = get_department_budget_snapshot(db, department)
    projected_remaining = sum(
        float(forecast.predicted_amount)
        for forecast in forecasts
        if forecast.forecast_period_start.year == reference_date.year
        and forecast.forecast_period_start > reference_date
    )
    projected_total = snapshot["used_budget_current_year"] + projected_remaining
    pace_pct = projected_total / annual_budget * 100

    if pace_pct >= 100:
        severity = "over pace"
    elif pace_pct >= 90:
        severity = "approaching budget"
    else:
        return

    # Avoid re-alerting on every re-run: skip if we already warned about this
    # department's pace in the last day.
    recent_cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    already_alerted = (
        db.query(Notification)
        .filter(
            Notification.department_id == department.department_id,
            Notification.type == "budget_pace",
            Notification.created_at >= recent_cutoff,
        )
        .first()
    )
    if already_alerted:
        return

    db.add(
        Notification(
            department_id=department.department_id,
            type="budget_pace",
            message=(
                f"{department.department_name} is {severity}: projected to spend "
                f"TK {projected_total:,.0f} of its TK {annual_budget:,.0f} annual budget "
                f"({pace_pct:.0f}%) by year end."
            ),
        )
    )


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

    # Past runs are kept (not deleted) so accuracy tracking can later compare
    # what was predicted for a month against what that month actually turned
    # out to be. Each row is tagged with the scope it was computed from, so a
    # one-off run against a specific uploaded file never gets confused with an
    # ongoing department-wide prediction.
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
            source_mode=payload.source_mode,
            upload_batch_id=payload.upload_batch_id if payload.source_mode == "upload_batch" else None,
        )
        db.add(forecast)
        forecasts.append(forecast)

    if payload.source_mode in ONGOING_FORECAST_SCOPES:
        _maybe_create_budget_pace_alert(db, department, forecasts)

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


@router.get("/dept/{dept_id}/forecast-accuracy")
def get_forecast_accuracy(dept_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Compare each historical month's forecast against what that month
    actually turned out to be, using only ongoing-scope forecasts (see
    ONGOING_FORECAST_SCOPES) so a one-off test run against an old file never
    skews the accuracy read-out.
    """
    today = date.today()
    rows = (
        db.query(BudgetForecast)
        .filter(
            BudgetForecast.department_id == dept_id,
            BudgetForecast.source_mode.in_(ONGOING_FORECAST_SCOPES),
            BudgetForecast.forecast_period_end < today,
        )
        .order_by(BudgetForecast.forecast_period_start.asc(), BudgetForecast.created_at.asc())
        .all()
    )

    # A month can have been forecasted more than once before it arrived (the
    # department re-ran "Forecast Budget" between runs). The earliest one is
    # the purest test of forecast usefulness, since it was made without
    # benefit of any of the data that came in closer to that month.
    earliest_by_period: dict[date, BudgetForecast] = {}
    for row in rows:
        earliest_by_period.setdefault(row.forecast_period_start, row)

    entries = []
    errors = []
    for period_start in sorted(earliest_by_period):
        forecast = earliest_by_period[period_start]
        period_end = forecast.forecast_period_end
        actual = float(
            db.query(func.coalesce(func.sum(Transaction.amount), 0))
            .filter(
                Transaction.department_id == dept_id,
                Transaction.transaction_date >= datetime.combine(period_start, datetime.min.time()),
                Transaction.transaction_date < datetime.combine(period_end + relativedelta(days=1), datetime.min.time()),
                func.lower(func.coalesce(Transaction.transaction_type, "debit")) == "debit",
            )
            .scalar()
            or 0
        )
        predicted = float(forecast.predicted_amount)
        error_pct = round(abs(actual - predicted) / actual * 100, 2) if actual > 0 else None
        if error_pct is not None:
            errors.append(error_pct)
        entries.append(
            {
                "month": period_start.strftime("%Y-%m"),
                "predicted_amount": predicted,
                "actual_amount": round(actual, 2),
                "error_pct": error_pct,
                "model_type": forecast.model_type,
                "source_mode": forecast.source_mode,
            }
        )

    return {
        "entries": entries,
        "average_error_pct": round(sum(errors) / len(errors), 2) if errors else None,
        "months_evaluated": len(errors),
    }


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
    transactions, scope_note = _resolve_forecast_source(
        db,
        dept_id,
        source_mode,
        upload_batch_id,
        date_from,
        date_to,
    )

    monthly = build_monthly_series(transactions)
    if monthly.empty:
        # Nothing to forecast live from this source (e.g. an empty date range,
        # or a brand-new department). Fall back to whatever was last actually
        # persisted, rather than showing nothing.
        forecast_rows = (
            db.query(BudgetForecast)
            .filter(BudgetForecast.department_id == dept_id)
            .order_by(BudgetForecast.forecast_period_start.asc())
            .all()
        )
        latest_forecast = forecast_rows[-1] if forecast_rows else None
        return {
            "history": [],
            "diagnostics": None,
            "model": {
                "model_type": latest_forecast.model_type,
                "model_version": latest_forecast.model_version,
            } if latest_forecast else None,
            "forecasts": _serialize_forecast_rows(forecast_rows),
        }

    result = run_budget_forecast(monthly, months_ahead)
    result = _append_scope_note(result, scope_note)

    # Build the returned forecast rows from this same live computation rather
    # than from whatever is sitting in BudgetForecast. That table is only
    # updated when someone actually runs "Forecast Budget" (POST /forecast),
    # so if new transactions have landed since then, a persisted forecast can
    # cover a month that history now also has real data for -- the last
    # historical month and the first forecast month must always come from one
    # coherent run, or they can overlap and silently disagree with each other.
    live_forecasts = [
        {
            "forecast_id": f"preview:{dept_id}:{forecast['month']}",
            "forecast_period_start": f"{forecast['month']}-01",
            "forecast_period_end": (
                date.fromisoformat(f"{forecast['month']}-01") + relativedelta(months=1, days=-1)
            ).isoformat(),
            "predicted_amount": float(forecast["predicted_amount"]),
            "lower_bound": float(forecast["lower_bound"]),
            "upper_bound": float(forecast["upper_bound"]),
            "model_type": result.model_type,
            "model_version": result.model_version,
        }
        for forecast in result.forecasts
    ]

    return {
        "history": result.history,
        "diagnostics": result.diagnostics,
        "model": {
            "model_type": result.model_type,
            "model_version": result.model_version,
        },
        "forecasts": live_forecasts,
    }
