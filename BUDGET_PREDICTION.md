# Budget Prediction Feature

This document explains how FinSight Advisor's budget forecasting feature works end to end:
the API surface, the data pipeline that turns raw transactions into a forecast, and the
statistical model underneath it.

Source files:
- `backend/app/budget/forecasting.py` — the forecasting engine (data prep, model selection, SARIMA training)
- `backend/app/budget/router.py` — the `/budget` API endpoints
- `backend/app/budget/train_artifact.py` — offline CLI for pre-training a serialized model
- `backend/app/models.py` — `BudgetForecast`, `UploadBatch`, `Transaction` tables
- `frontend/lib/api.ts`, `frontend/pages/AdminDashboard.tsx` — the forecast UI

## 1. What it does

Given a department's transaction history, the feature predicts total spend for the next
*N* months, with a confidence interval, and explains (via diagnostics) how confident that
prediction is and why a particular model was chosen. It is a **univariate time-series
forecast**: it only looks at one number per month (total department spend) and has no
knowledge of budgets, categories, or external factors.

## 2. API surface

All endpoints live under `/budget` and require an authenticated user (`Depends(get_current_user)`).

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/budget/forecast` | Runs a forecast, **persists** it (replacing prior forecasts for the department), and returns it |
| `GET` | `/budget/dept/{dept_id}/forecasts` | Returns the persisted forecast rows for a department |
| `GET` | `/budget/dept/{dept_id}/upload-batches` | Lists upload batches for a department, for use with `source_mode=upload_batch` |
| `GET` | `/budget/dept/{dept_id}/forecast-context` | Re-runs the forecast **without persisting**, for previewing a different horizon/source before committing |

### Request body (`POST /budget/forecast`)

```json
{
  "dept_id": "uuid",
  "months_ahead": 3,
  "source_mode": "latest_batch",
  "upload_batch_id": null,
  "date_from": null,
  "date_to": null
}
```

`source_mode` controls **which transactions feed the model** (see `_resolve_forecast_source`
in `router.py`):

| `source_mode` | Behavior |
|---|---|
| `latest_batch` (default) | Uses only the transactions from the most recently *completed* upload batch for the department. Falls back to the department's entire history if that batch has no rows. |
| `full_history` | Uses every transaction ever imported for the department. |
| `upload_batch` | Uses one specific upload batch, given by `upload_batch_id` (404 if it doesn't belong to the department). |
| `date_range` | Uses transactions between `date_from` and `date_to` (inclusive). |

### Response shape

```json
{
  "success": true,
  "history": [{ "month": "2025-11", "amount": 20678.44 }, ...],
  "diagnostics": {
    "mape": 8.4,
    "train_months": 14,
    "season_length": 12,
    "regular_difference": 1,
    "seasonal_difference": 1,
    "notes": "Using latest upload batch: august_ledger.csv."
  },
  "model": { "model_type": "SARIMA(1,1,1)(0,1,1)12", "model_version": "serialized_notebook_sarima_v3" },
  "forecasts": [
    { "forecast_id": "uuid", "forecast_period_start": "2025-12-01", "forecast_period_end": "2025-12-31",
      "predicted_amount": 21344.10, "lower_bound": 17890.00, "upper_bound": 24798.20,
      "model_type": "SARIMA(1,1,1)(0,1,1)12", "model_version": "serialized_notebook_sarima_v3" }
  ]
}
```

`history` is the monthly actuals the model was trained on; `forecasts` is the projection.
`diagnostics.notes` always ends with a sentence naming which `source_mode` scope was used
(added by `_append_scope_note`), so the UI can show *why* a particular history was forecast from.

## 3. Data pipeline: transactions → monthly time series

This happens in `build_monthly_series()` (forecasting.py:60), called with whatever list of
`Transaction` rows the chosen `source_mode` resolved to.

1. **Pick the spending side** (`_pick_spending_side`): only `transaction_type == "debit"`
   rows with a positive amount are used, since forecasting is about *spend*, not net cash
   flow. If a department genuinely has zero debit rows, credit rows are used instead as a
   fallback (so a ledger with only inflows still produces *something*).
2. **Aggregate to calendar months**: transaction dates are truncated to the month
   (`dt.to_period("M")`) and summed, giving one total-spend figure per month.
3. **Fill gaps**: the series is reindexed to a *continuous* monthly range from the first to
   the last transaction month (`pd.date_range(..., freq="MS")`), and any month with no
   transactions is **linearly interpolated** rather than treated as zero. This matters a lot —
   a department that skipped uploading one month's ledger would otherwise look like it had a
   real spending collapse that month, which would corrupt both the seasonality detection and
   the SARIMA fit.

There's a second entry point, `build_monthly_series_from_dataframe()`, used only by the
offline training CLI (`train_artifact.py`) to build the same kind of series directly from a
CSV/Excel file instead of ORM rows — it does case-insensitive `Debit`/`Credit`/`amount`
column detection with the same debit→credit fallback logic.

## 4. Model selection: two tracks, best validated MAPE wins

`run_budget_forecast(monthly, months_ahead)` (forecasting.py:562) is the entry point used by
the API. It always computes **two independent forecasts** and returns whichever one performed
better on a holdout validation window:

```
run_budget_forecast
 ├── _best_baseline_result(monthly, months_ahead)   → always runs
 └── _train_sarima_model(monthly)                    → only if ≥12 months of history
       └── if SARIMA validation MAPE < baseline MAPE → use SARIMA, else use baseline
```

This is a deliberate hedge: SARIMA is more powerful but can overfit or fail to converge on
noisy, short, or irregular financial data, so it's never trusted blindly — it has to *beat*
a much simpler baseline on real holdout months before it's allowed to be used.

### 4.1 Baseline track (`_best_baseline_result`)

Requires only 2+ months of history. It holds out the last `min(6, len // 5)` months as a test
set, and tries 2–3 simple candidate models against that holdout:

| Candidate | Logic | Available when |
|---|---|---|
| `rolling_mean_3` | Predicts the average of the last 3 months, updated with each actual holdout value as it "arrives" | always |
| `rolling_mean_6` | Same, but a 6-month window | always |
| `seasonal_naive_12` | Predicts "the same month last year" | only if ≥12 months of training data |

Whichever candidate has the lowest MAPE on the holdout wins, and that candidate is then
**re-run over the real forecast horizon** (`_build_non_sarima_result`) to produce the actual
future months. If there isn't even enough data for this (< 2 months total), a
`fallback_trend` model is used instead: a rolling-mean anchor plus a linear trend term
(average month-over-month change), floored at zero.

Confidence intervals for every baseline model are **not statistically derived** — they're a
flat `± 1.96 × stdev(last 6 months)` band around the point forecast (roughly a 95% interval
under a normal-distribution assumption), floored at zero on the lower side.

### 4.2 SARIMA track (`_train_sarima_model`)

Only attempted when there are **≥ 12 months** of history (a hard requirement for
seasonal modeling to make sense) and returns `None` (falling back to baseline) if any step
below fails.

1. **Box-Cox transform** (`_boxcox_transform`): stabilizes variance. If the series has any
   zero/negative values (shouldn't normally happen post-interpolation, but is guarded
   anyway), it's shifted positive first. The fitted `lambda` and `shift` are carried through
   the whole pipeline so predictions can be inverse-transformed back to real currency units
   at the end (`_inverse_boxcox`), with predictions clamped at 0.
2. **Estimate regular (non-seasonal) differencing order `d`** (`_estimate_regular_difference`):
   repeatedly difference the series and test each version with **both** the Augmented
   Dickey-Fuller test (rejects a unit root, i.e. non-stationarity) **and** the KPSS test
   (fails to reject stationarity) — a series only counts as stationary once both agree, up to
   `d = 3`.
3. **Estimate the seasonal period `s`** (`_estimate_season_length`): computes the
   autocorrelation function (ACF) up to `min(36, n/2 - 1)` lags, finds lags whose
   autocorrelation exceeds the standard ~95% significance band (`1.96/√n`), and narrows that
   down to whichever of `{3, 6, 12}` (quarterly, half-yearly, yearly) is significant, defaulting
   to `12` (monthly seasonality) if none are.
4. **Estimate seasonal differencing order `D`** (`_estimate_seasonal_difference`): same
   ADF+KPSS stationarity loop, but differencing at lag `s` instead of lag 1, up to `D = 2`.
   If the detected season is 12 months, `D` is forced to be at least 1, since yearly seasonality
   in spending data is assumed present by default.
5. **Grid search over `(p, q, P, Q)`**: rather than a full grid search (which the code
   comments note could take 5+ minutes), a **fixed shortlist of 10 candidate orders** —
   chosen as generally strong performers for monthly financial series — is tried:
   `(1,0,1,0)`, `(1,0,0,1)`, `(1,0,1,1)`, `(2,0,1,0)`, `(0,0,1,1)`, `(1,0,0,0)`, `(2,0,0,1)`,
   `(0,0,1,0)`, `(1,0,2,0)`, `(2,0,2,1)`. `d` and `D` are fixed from steps 2 and 4; each
   candidate is fit with `statsmodels.tsa.statespace.SARIMAX` on a train split (holding out
   the same `min(6, n/5)`-month window as the baseline track), and scored by MAPE against
   that holdout. Any candidate that throws (fails to converge, etc.) is silently skipped.
6. **Pick the best order**, refit it once more on the train split to get an honest holdout
   MAPE for the diagnostics, then **refit again on the full series** (train + holdout) so the
   final model used for forecasting has seen all available history.
7. **Forecast**: `SARIMAXResults.get_forecast(steps=months_ahead)` gives both a point forecast
   and proper model-based 95% confidence intervals (`conf_int(alpha=0.05)`) in the Box-Cox
   space, which are inverse-transformed back to currency units.

The resulting `model_type` string encodes the full order for transparency, e.g.
`SARIMA(1,1,1)(0,1,1)12` = non-seasonal `(p,d,q)=(1,1,1)`, seasonal `(P,D,Q,s)=(0,1,1,12)`.

## 5. Persisted / pre-trained artifacts

Besides training a model live on every request, the system supports **serialized SARIMA
artifacts** that can be trained once (offline) and reused without retraining:

- **Training**: `python -m app.budget.train_artifact --input file.csv --artifact-name <dept_id_or_name>`
  reads a CSV/Excel file, builds the monthly series, trains a SARIMA model via
  `save_forecast_artifact()`, and writes `backend/app/budget/artifacts/<name>/model.pkl` +
  `metadata.json` (order, seasonal order, Box-Cox params, diagnostics, history).
- **Loading**: `load_forecast_artifact_for_department(dept_id)` looks for an artifact named
  after the department ID first, then falls back to one named `default` — so you can seed a
  generic "cold start" model for departments with no history yet.
- **When it's used**: only as a last resort, inside `POST /budget/forecast`, when the
  resolved `source_mode` produced **zero transactions** (e.g. a brand-new department). If
  there are transactions, the live pipeline (`run_budget_forecast`) always runs instead —
  artifacts are never blended with live data.

Note this is one of the few places where the historical grid-search comments in the code
(`Bug 8 fix`, `Bug 7 fix`, etc.) reference earlier fixes made to this same forecasting module;
those comments explain *why* the current heuristics look the way they do (e.g. the 10-order
shortlist exists because an exhaustive grid was too slow).

## 6. Persistence and the `/forecast-context` preview endpoint

`POST /budget/forecast` **deletes all existing `BudgetForecast` rows for the department** and
inserts the new ones — there's no history of past forecast runs, only the latest one per
department. This is intentional: forecasts are meant to reflect the current data and horizon
choice, not accumulate stale runs.

`GET /budget/dept/{dept_id}/forecast-context` exists so the frontend can show what a forecast
*would* look like for a different `months_ahead`/`source_mode` combination without
committing it — it runs the exact same `run_budget_forecast` pipeline but never writes to the
database. If the department already has persisted forecasts and the live re-run also
succeeds, the response mixes live diagnostics/history with the **persisted** forecast rows
(so switching the preview horizon doesn't make the currently-committed forecast rows
disappear); if nothing has ever been persisted, it fabricates row shapes from the live
result instead (with synthetic `forecast_id`s like `"{dept_id}:{month}"`).

## 7. Diagnostics field reference

| Field | Meaning |
|---|---|
| `mape` | Mean Absolute Percentage Error on the holdout validation months (`null` for `fallback_trend`, which has no holdout to validate against) |
| `train_months` | How many months of (possibly interpolated) history the model was trained on |
| `season_length` | Detected seasonal period in months (SARIMA/`seasonal_naive_12` only; `null` otherwise) |
| `regular_difference` / `seasonal_difference` | The `d` / `D` orders used (SARIMA only; `null` for baseline models) |
| `notes` | Human-readable explanation — why a baseline model was chosen over SARIMA, why a fallback was used, or (always) which data scope (`source_mode`) fed the model |

The frontend (`UserDashboard.tsx`, `AdminDashboard.tsx`) turns `mape` into a rough
"confidence score" as `max(0, 100 - mape)` for display, and turns `notes` into a
plain-language narrative for non-technical users via `employeeForecastNarrative()`.

## 8. Known limitations

- **Univariate only** — no awareness of allocated budget, category mix, seasonality drivers,
  or macro factors; it purely extrapolates past total spend.
- **MAPE is undefined when actuals include zero** — those months are excluded from the MAPE
  average (`np.where(actual == 0, nan, actual)`), which can make MAPE look better than it is
  on sparse data.
- **Confidence intervals for baseline models are heuristic**, not derived from the model
  itself, unlike SARIMA's proper statistical intervals.
- **No cross-department learning** — each department is forecast independently; a new
  department with no history and no matching/`default` artifact simply can't be forecast
  until it has at least one upload with transactions.
- **Forecast history isn't versioned** — re-running `/budget/forecast` discards the previous
  persisted forecast for that department.
