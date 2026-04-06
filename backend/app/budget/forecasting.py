from __future__ import annotations

import itertools
import json
import math
import re
import warnings
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from scipy.special import inv_boxcox
from scipy.stats import boxcox
from statsmodels.tsa.statespace.sarimax import SARIMAX, SARIMAXResults
from statsmodels.tsa.stattools import acf, adfuller, kpss

from app.models import Transaction


ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts"
METADATA_FILE = "metadata.json"
MODEL_FILE = "model.pkl"


@dataclass
class ForecastComputationResult:
    history: list[dict[str, float | str]]
    forecasts: list[dict[str, float | str]]
    diagnostics: dict[str, float | int | str | None]
    model_type: str
    model_version: str


def _pick_spending_side(transactions: list[Transaction]) -> list[Transaction]:
    debit_transactions = [
        txn for txn in transactions
        if (txn.transaction_type or "debit").lower() == "debit" and float(txn.amount or 0) > 0
    ]
    if debit_transactions:
        return debit_transactions
    return [
        txn for txn in transactions
        if (txn.transaction_type or "").lower() == "credit" and float(txn.amount or 0) > 0
    ]


def build_monthly_series(transactions: list[Transaction]) -> pd.Series:
    rows = [
        {"transaction_date": txn.transaction_date, "amount": float(txn.amount)}
        for txn in _pick_spending_side(transactions)
    ]
    if not rows:
        return pd.Series(dtype=float)

    frame = pd.DataFrame(rows)
    frame["transaction_date"] = pd.to_datetime(frame["transaction_date"])
    frame["month"] = frame["transaction_date"].dt.to_period("M").dt.to_timestamp()
    monthly = frame.groupby("month")["amount"].sum().sort_index()
    monthly = monthly.reindex(pd.date_range(monthly.index.min(), monthly.index.max(), freq="MS"))
    monthly = monthly.interpolate(method="linear", limit_direction="both")
    monthly.index.freq = "MS"
    return monthly.astype(float)


def build_monthly_series_from_dataframe(frame: pd.DataFrame) -> pd.Series:
    dataset = frame.copy()
    if "transaction_date" not in dataset.columns:
        raise ValueError("Input data must contain a transaction_date column.")

    if "Debit" in dataset.columns or "debit" in dataset.columns:
        debit_column = "Debit" if "Debit" in dataset.columns else "debit"
        dataset["amount"] = pd.to_numeric(dataset[debit_column], errors="coerce").fillna(0)
        if float(dataset["amount"].sum()) <= 0 and ("Credit" in dataset.columns or "credit" in dataset.columns):
            credit_column = "Credit" if "Credit" in dataset.columns else "credit"
            dataset["amount"] = pd.to_numeric(dataset[credit_column], errors="coerce").fillna(0)
    elif "Credit" in dataset.columns or "credit" in dataset.columns:
        credit_column = "Credit" if "Credit" in dataset.columns else "credit"
        dataset["amount"] = pd.to_numeric(dataset[credit_column], errors="coerce").fillna(0)
    elif "amount" in dataset.columns:
        dataset["amount"] = pd.to_numeric(dataset["amount"], errors="coerce").fillna(0)
    else:
        raise ValueError("Input data must contain Debit, Credit, or amount columns.")

    dataset["transaction_date"] = pd.to_datetime(dataset["transaction_date"], errors="coerce")
    dataset = dataset.dropna(subset=["transaction_date"])

    rows = [
        type("RowTransaction", (), {"transaction_date": row.transaction_date, "amount": row.amount, "transaction_type": "debit"})()
        for row in dataset.loc[dataset["amount"] > 0, ["transaction_date", "amount"]].itertuples(index=False)
    ]
    monthly = build_monthly_series(rows)
    if monthly.empty:
        raise ValueError("No positive spending rows were found in the input data.")
    return monthly


def read_budget_training_data(input_path: str | Path) -> pd.DataFrame:
    source = Path(input_path)
    suffix = source.suffix.lower()
    if suffix in {".xlsx", ".xls"}:
        return pd.read_excel(source)
    if suffix == ".csv":
        return pd.read_csv(source)
    raise ValueError("Unsupported input file. Use .csv, .xls, or .xlsx.")


def _sanitize_artifact_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip())
    cleaned = cleaned.strip("-._")
    return cleaned or "default"


def _artifact_path(name: str) -> Path:
    return ARTIFACTS_DIR / _sanitize_artifact_name(name)


def _history_from_monthly(monthly: pd.Series) -> list[dict[str, float | str]]:
    return [{"month": idx.strftime("%Y-%m"), "amount": round(float(val), 2)} for idx, val in monthly.items()]


def _is_stationary(series: pd.Series) -> bool:
    sample = series.dropna()
    if len(sample) < 8:
        return False
    adf_ok = adfuller(sample, autolag="AIC")[1] < 0.05
    try:
        kpss_ok = kpss(sample, regression="c", nlags="auto")[1] >= 0.05
    except Exception:
        kpss_ok = False
    return adf_ok and kpss_ok


def _estimate_regular_difference(series: pd.Series) -> int:
    current = series.copy()
    d_value = 0
    while d_value <= 3:
        if _is_stationary(current):
            break
        d_value += 1
        current = current.diff(1).dropna()
    return max(1, d_value)


def _estimate_season_length(series: pd.Series) -> int:
    safe_nlags = min(36, len(series) // 2 - 1)
    if safe_nlags < 2:
        return 12
    acf_values = acf(series.dropna(), nlags=safe_nlags, fft=True)
    confidence = 1.96 / np.sqrt(max(len(series), 1))
    significant_lags = [lag for lag in range(2, safe_nlags + 1) if abs(acf_values[lag]) > confidence]
    seasonal_candidates = [lag for lag in significant_lags if lag in [4, 12, 52]]
    return seasonal_candidates[0] if seasonal_candidates else 12


def _estimate_seasonal_difference(series: pd.Series, season_length: int) -> int:
    current = series.copy()
    d_value = 0
    while d_value <= 2:
        if _is_stationary(current):
            break
        if len(current) <= season_length:
            break
        d_value += 1
        current = current.diff(season_length).dropna()
    if season_length == 12:
        d_value = max(1, d_value)
    return d_value


def _boxcox_transform(series: pd.Series) -> tuple[pd.Series, float, float]:
    shift = 0.0
    if (series <= 0).any():
        shift = abs(float(series.min())) + 1.0
    transformed, lam = boxcox(series.values + shift)
    transformed_series = pd.Series(transformed, index=series.index, dtype=float)
    transformed_series.index.freq = "MS"
    return transformed_series, float(lam), shift


def _inverse_boxcox(values: np.ndarray | pd.Series, lam: float, shift: float) -> np.ndarray:
    restored = inv_boxcox(np.asarray(values, dtype=float), lam) - shift
    return np.maximum(restored, 0.0)


def _fallback_forecast(monthly: pd.Series, months_ahead: int) -> ForecastComputationResult:
    rolling_mean = float(monthly.tail(min(len(monthly), 3)).mean()) if len(monthly) else 0.0
    trend = float(monthly.diff().dropna().mean()) if len(monthly) > 1 else 0.0
    future_months = pd.date_range(monthly.index[-1] + pd.DateOffset(months=1), periods=months_ahead, freq="MS")

    forecasts: list[dict[str, float | str]] = []
    for index, month in enumerate(future_months, start=1):
        predicted = max(0.0, rolling_mean + trend * index)
        forecasts.append(
            {
                "month": month.strftime("%Y-%m"),
                "predicted_amount": round(predicted, 2),
                "lower_bound": round(predicted * 0.85, 2),
                "upper_bound": round(predicted * 1.15, 2),
            }
        )

    return ForecastComputationResult(
        history=_history_from_monthly(monthly),
        forecasts=forecasts,
        diagnostics={
            "mape": None,
            "train_months": int(len(monthly)),
            "season_length": None,
            "regular_difference": None,
            "seasonal_difference": None,
            "notes": "Fallback trend forecast used because there was not enough history for SARIMA training.",
        },
        model_type="fallback_trend",
        model_version="v2",
    )


def _forecast_with_fitted_model(
    fitted_model: SARIMAXResults,
    lam: float,
    shift: float,
    months_ahead: int,
) -> list[dict[str, float | str]]:
    forecast = fitted_model.get_forecast(steps=months_ahead)
    mean = _inverse_boxcox(forecast.predicted_mean.values, lam, shift)
    confidence_intervals = forecast.conf_int(alpha=0.05)
    lower_bounds = _inverse_boxcox(confidence_intervals.iloc[:, 0].values, lam, shift)
    upper_bounds = _inverse_boxcox(confidence_intervals.iloc[:, 1].values, lam, shift)
    future_months = pd.date_range(
        fitted_model.data.dates[-1] + pd.DateOffset(months=1),
        periods=months_ahead,
        freq="MS",
    )

    results = []
    for month, predicted, lower, upper in zip(future_months, mean, lower_bounds, upper_bounds):
        lower_value = min(float(lower), float(upper))
        upper_value = max(float(lower), float(upper))
        results.append(
            {
                "month": month.strftime("%Y-%m"),
                "predicted_amount": round(float(predicted), 2),
                "lower_bound": round(max(lower_value, 0.0), 2),
                "upper_bound": round(max(upper_value, 0.0), 2),
            }
        )
    return results


def _train_sarima_model(monthly: pd.Series) -> dict[str, Any] | None:
    if len(monthly) < 12:
        return None

    transformed, lam, shift = _boxcox_transform(monthly)
    regular_difference = _estimate_regular_difference(transformed)
    differenced = transformed.diff(regular_difference).dropna()
    season_length = _estimate_season_length(differenced)
    seasonal_difference = _estimate_seasonal_difference(differenced, season_length)

    test_size = min(6, max(1, len(transformed) // 5))
    if len(transformed) - test_size < max(season_length + 1, 8):
        return None

    train = transformed.iloc[:-test_size]
    test = transformed.iloc[-test_size:]

    best_model: tuple[int, int, int, int] | None = None
    best_bic = math.inf

    for p_value, q_value, seasonal_p, seasonal_q in itertools.product(range(3), range(3), range(2), range(2)):
        if p_value == 0 and q_value == 0 and seasonal_p == 0 and seasonal_q == 0:
            continue
        try:
            fitted = SARIMAX(
                train,
                order=(p_value, regular_difference, q_value),
                seasonal_order=(seasonal_p, seasonal_difference, seasonal_q, season_length),
                enforce_stationarity=False,
                enforce_invertibility=False,
            ).fit(disp=False)
        except Exception:
            continue

        if fitted.bic < best_bic:
            best_bic = float(fitted.bic)
            best_model = (p_value, q_value, seasonal_p, seasonal_q)

    if best_model is None:
        return None

    p_value, q_value, seasonal_p, seasonal_q = best_model
    validation_model = SARIMAX(
        train,
        order=(p_value, regular_difference, q_value),
        seasonal_order=(seasonal_p, seasonal_difference, seasonal_q, season_length),
        enforce_stationarity=False,
        enforce_invertibility=False,
    ).fit(disp=False)

    test_forecast = _inverse_boxcox(validation_model.forecast(steps=len(test)), lam, shift)
    actual_test = _inverse_boxcox(test.values, lam, shift)
    valid_denominator = np.where(actual_test == 0, np.nan, actual_test)
    mape = float(np.nanmean(np.abs((actual_test - test_forecast) / valid_denominator)) * 100)
    if math.isnan(mape):
        mape = 0.0

    full_model = SARIMAX(
        transformed,
        order=(p_value, regular_difference, q_value),
        seasonal_order=(seasonal_p, seasonal_difference, seasonal_q, season_length),
        enforce_stationarity=False,
        enforce_invertibility=False,
    ).fit(disp=False)

    model_type = f"SARIMA({p_value},{regular_difference},{q_value})({seasonal_p},{seasonal_difference},{seasonal_q}){season_length}"
    model_version = "serialized_notebook_sarima_v3"
    diagnostics = {
        "mape": round(mape, 2),
        "train_months": int(len(monthly)),
        "season_length": int(season_length),
        "regular_difference": int(regular_difference),
        "seasonal_difference": int(seasonal_difference),
        "notes": None,
    }

    return {
        "monthly": monthly,
        "fitted_model": full_model,
        "lambda": float(lam),
        "shift": float(shift),
        "order": [p_value, regular_difference, q_value],
        "seasonal_order": [seasonal_p, seasonal_difference, seasonal_q, season_length],
        "diagnostics": diagnostics,
        "model_type": model_type,
        "model_version": model_version,
        "history": _history_from_monthly(monthly),
    }


def load_forecast_artifact(artifact_name: str) -> dict[str, Any] | None:
    artifact_dir = _artifact_path(artifact_name)
    metadata_path = artifact_dir / METADATA_FILE
    model_path = artifact_dir / MODEL_FILE
    if not metadata_path.exists() or not model_path.exists():
        return None

    metadata = json.loads(metadata_path.read_text())
    metadata["artifact_dir"] = str(artifact_dir)
    metadata["model_path"] = str(model_path)
    return metadata


def load_forecast_artifact_for_department(dept_id: str) -> dict[str, Any] | None:
    for candidate in [dept_id, "default"]:
        artifact = load_forecast_artifact(candidate)
        if artifact:
            return artifact
    return None


def forecast_from_artifact(artifact_name: str, months_ahead: int) -> ForecastComputationResult | None:
    artifact = load_forecast_artifact(artifact_name)
    if not artifact:
        return None

    warnings.filterwarnings("ignore")
    model = SARIMAXResults.load(artifact["model_path"])
    forecasts = _forecast_with_fitted_model(
        model,
        float(artifact["boxcox_lambda"]),
        float(artifact.get("boxcox_shift", 0.0)),
        months_ahead,
    )
    diagnostics = dict(artifact["diagnostics"])
    diagnostics["notes"] = f"Loaded serialized forecast artifact: {artifact_name}"

    return ForecastComputationResult(
        history=artifact["history"],
        forecasts=forecasts,
        diagnostics=diagnostics,
        model_type=str(artifact["model_type"]),
        model_version=str(artifact["model_version"]),
    )


def forecast_from_artifact_for_department(dept_id: str, months_ahead: int) -> ForecastComputationResult | None:
    for candidate in [dept_id, "default"]:
        result = forecast_from_artifact(candidate, months_ahead)
        if result:
            return result
    return None


def save_forecast_artifact(
    monthly: pd.Series,
    artifact_name: str,
    *,
    department_id: str | None = None,
    source_name: str | None = None,
) -> Path:
    warnings.filterwarnings("ignore")
    trained = _train_sarima_model(monthly)
    if trained is None:
        raise ValueError("At least 12 months of positive spend history are required to create a serialized SARIMA artifact.")

    artifact_dir = _artifact_path(artifact_name)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    model_path = artifact_dir / MODEL_FILE
    metadata_path = artifact_dir / METADATA_FILE

    trained["fitted_model"].save(model_path)
    metadata = {
        "artifact_name": _sanitize_artifact_name(artifact_name),
        "department_id": department_id,
        "source_name": source_name,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "model_type": trained["model_type"],
        "model_version": trained["model_version"],
        "order": trained["order"],
        "seasonal_order": trained["seasonal_order"],
        "boxcox_lambda": trained["lambda"],
        "boxcox_shift": trained["shift"],
        "history": trained["history"],
        "diagnostics": trained["diagnostics"],
    }
    metadata_path.write_text(json.dumps(metadata, indent=2))
    return artifact_dir


def run_budget_forecast(monthly: pd.Series, months_ahead: int) -> ForecastComputationResult:
    warnings.filterwarnings("ignore")
    trained = _train_sarima_model(monthly)
    if trained is None:
        return _fallback_forecast(monthly, months_ahead)

    forecasts = _forecast_with_fitted_model(
        trained["fitted_model"],
        float(trained["lambda"]),
        float(trained["shift"]),
        months_ahead,
    )
    return ForecastComputationResult(
        history=trained["history"],
        forecasts=forecasts,
        diagnostics=trained["diagnostics"],
        model_type=trained["model_type"],
        model_version=trained["model_version"],
    )
