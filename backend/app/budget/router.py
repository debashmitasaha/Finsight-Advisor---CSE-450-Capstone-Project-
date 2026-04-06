from __future__ import annotations

from datetime import date

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.router import get_current_user
from app.budget.forecasting import (
    build_monthly_series,
    forecast_from_artifact_for_department,
    run_budget_forecast,
)
from app.database import get_db
from app.models import BudgetForecast, Department, Transaction, User

router = APIRouter(prefix="/budget", tags=["Budget"])


class ForecastRequest(BaseModel):
    dept_id: str
    months_ahead: int = 1


@router.post("/forecast")
def generate_forecast(payload: ForecastRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    department = db.query(Department).filter(Department.department_id == payload.dept_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")

    months_ahead = max(1, payload.months_ahead)
    result = forecast_from_artifact_for_department(payload.dept_id, months_ahead)
    if result is None:
        transactions = (
            db.query(Transaction)
            .filter(Transaction.department_id == payload.dept_id)
            .order_by(Transaction.transaction_date.asc())
            .all()
        )
        if not transactions:
            raise HTTPException(status_code=400, detail="No transaction data available and no serialized budget artifact was found")

        monthly = build_monthly_series(transactions)
        if monthly.empty:
            raise HTTPException(status_code=400, detail="No positive spending data available for forecasting")

        result = run_budget_forecast(monthly, months_ahead)

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
        "forecasts": [
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
        ],
    }


@router.get("/dept/{dept_id}/forecasts")
def get_forecasts(dept_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    forecasts = (
        db.query(BudgetForecast)
        .filter(BudgetForecast.department_id == dept_id)
        .order_by(BudgetForecast.forecast_period_start.desc())
        .all()
    )
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
