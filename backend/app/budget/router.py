from __future__ import annotations

from datetime import date
from typing import Optional

import numpy as np
import pandas as pd
from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.router import get_current_user
from app.database import get_db
from app.models import BudgetForecast, Department, Transaction, User

try:
    from statsmodels.tsa.arima.model import ARIMA
except Exception:  # pragma: no cover
    ARIMA = None

router = APIRouter(prefix="/budget", tags=["Budget"])


class ForecastRequest(BaseModel):
    dept_id: str
    months_ahead: int = 1


def build_monthly_series(transactions: list[Transaction]) -> pd.Series:
    rows = [
        {"transaction_date": txn.transaction_date, "amount": float(txn.amount)}
        for txn in transactions
    ]
    frame = pd.DataFrame(rows)
    frame["transaction_date"] = pd.to_datetime(frame["transaction_date"])
    monthly = frame.groupby(frame["transaction_date"].dt.to_period("M"))["amount"].sum().sort_index()
    monthly.index = monthly.index.to_timestamp()
    monthly = monthly.asfreq("MS")
    if monthly.isna().any():
        monthly = monthly.interpolate(method="linear", limit_direction="both")
    return monthly


def forecast_amounts(monthly: pd.Series, months_ahead: int) -> list[float]:
    if len(monthly) >= 6 and ARIMA is not None:
        try:
            model = ARIMA(monthly, order=(1, 1, 1))
            fitted = model.fit()
            values = fitted.forecast(steps=months_ahead)
            return [max(0.0, float(value)) for value in values]
        except Exception:
            pass

    rolling_mean = float(monthly.tail(min(len(monthly), 3)).mean()) if len(monthly) else 0.0
    trend = float(monthly.diff().dropna().mean()) if len(monthly) > 1 else 0.0
    return [max(0.0, rolling_mean + trend * (index + 1)) for index in range(months_ahead)]


@router.post("/forecast")
def generate_forecast(payload: ForecastRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    department = db.query(Department).filter(Department.department_id == payload.dept_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")

    transactions = (
        db.query(Transaction)
        .filter(Transaction.department_id == payload.dept_id)
        .order_by(Transaction.transaction_date.asc())
        .all()
    )
    if not transactions:
        raise HTTPException(status_code=400, detail="No transaction data available")

    monthly = build_monthly_series(transactions)
    predicted_values = forecast_amounts(monthly, payload.months_ahead)
    last_month = monthly.index[-1].date().replace(day=1)

    forecasts = []
    for offset, predicted in enumerate(predicted_values, start=1):
        period_start = last_month + relativedelta(months=offset)
        period_end = period_start + relativedelta(months=1, days=-1)
        forecast = BudgetForecast(
            department_id=payload.dept_id,
            forecast_period_start=period_start,
            forecast_period_end=period_end,
            predicted_amount=predicted,
            model_type="ARIMA" if len(monthly) >= 6 and ARIMA is not None else "fallback_trend",
            model_version="v1",
            lower_bound=predicted * 0.85,
            upper_bound=predicted * 1.15,
        )
        db.add(forecast)
        forecasts.append(forecast)

    db.commit()
    return {
        "success": True,
        "history": [{"month": idx.strftime("%Y-%m"), "amount": float(val)} for idx, val in monthly.items()],
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
