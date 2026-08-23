from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import LocalOutlierFactor
from sklearn.preprocessing import RobustScaler
from sklearn.svm import OneClassSVM

from app.forensic_engine.config import EngineConfig
from app.forensic_engine.features import EntityBaseline, ensemble_feature_matrix
from app.forensic_engine.signals import Signal, log_ramp, ramp


VIEW = "behavioral"


def run(
    frame: pd.DataFrame,
    baselines: dict[str, dict[str, EntityBaseline]],
    config: EngineConfig,
) -> tuple[list[Signal], dict]:
    """Entity-centric behavioural anomaly detection.

    The question is never "is this a large payment" but "is this large *for this account
    head*". A 480,000 payment is unremarkable for a raw-material head and extraordinary
    for a stationery head, and only the second is worth an auditor's time.
    """
    signals: list[Signal] = []
    if frame.empty:
        return signals, {"ensemble": "skipped", "reason": "no rows"}

    signals += _deviation_signals(frame, baselines, config)
    signals += _new_entity_signals(frame, baselines, config)
    ensemble_signals, ensemble_meta = _ensemble_signals(frame, baselines, config)
    signals += ensemble_signals

    return signals, ensemble_meta


def _deviation_signals(
    frame: pd.DataFrame,
    baselines: dict[str, dict[str, EntityBaseline]],
    config: EngineConfig,
) -> list[Signal]:
    signals: list[Signal] = []
    kinds = [("account_head", "entity_account_head")]
    if not _grouping_is_degenerate(frame, config):
        kinds.append(("account_group", "entity_account_group"))

    for kind, column in kinds:
        per_kind = baselines.get(kind, {})
        if not per_kind:
            continue

        for row in frame[frame["amount"] > 0].itertuples():
            key = getattr(row, column)
            baseline = per_kind.get(key)
            if baseline is None or baseline.count < config.min_baseline_events:
                continue

            score = baseline.robust_z(row.amount)
            strength = log_ramp(score, config.robust_z_soft, config.robust_z_hard)
            if strength <= 0 or row.amount <= baseline.median:
                # Only over-spend is forensically interesting; an unusually small payment
                # is a data-quality question, not a fraud signal.
                continue

            multiple = row.amount / baseline.median if baseline.median > 0 else float("inf")
            signals.append(
                Signal(
                    row.transaction_id,
                    VIEW,
                    f"{kind}_amount_deviation",
                    strength * (1.0 if kind == "account_head" else 0.7),
                    f"{row.amount:,.2f} is {multiple:.1f}x the typical {baseline.median:,.2f} for {kind.replace('_', ' ')} '{key}'",
                    {
                        "entity_kind": kind,
                        "entity_key": key,
                        "amount": float(row.amount),
                        "entity_median": round(baseline.median, 2),
                        "entity_mad": round(baseline.mad, 2),
                        "entity_events": baseline.count,
                        "robust_z": round(score, 2),
                        "multiple_of_median": round(multiple, 2) if np.isfinite(multiple) else None,
                    },
                )
            )
    return signals


def _new_entity_signals(
    frame: pd.DataFrame,
    baselines: dict[str, dict[str, EntityBaseline]],
    config: EngineConfig,
) -> list[Signal]:
    """A head that appears for the first time and immediately takes a large payment.

    This is the ledger-level equivalent of the "new vendor, big invoice" test: a genuine
    new cost centre usually ramps up, a fabricated one does not.
    """
    signals: list[Signal] = []
    positive = frame[frame["amount"] > 0]
    if positive.empty:
        return signals

    overall_p90 = float(positive["amount"].quantile(0.90))
    head_baselines = baselines.get("account_head", {})

    first_rows = positive.sort_values("transaction_date").groupby("entity_account_head").head(1)
    ledger_start = positive["transaction_date"].min()

    for row in first_rows.itertuples():
        baseline = head_baselines.get(row.entity_account_head)
        if baseline is None:
            continue
        # Heads present from the first day of the ledger are not "new" — we just have no
        # history before the extract began.
        if (row.transaction_date - ledger_start).days < 30:
            continue
        if row.amount < overall_p90:
            continue

        strength = ramp(row.amount / max(overall_p90, 1.0), 1.0, 4.0) * 0.8
        if strength <= 0:
            continue
        signals.append(
            Signal(
                row.transaction_id,
                VIEW,
                "new_entity_large_payment",
                strength,
                f"First ever payment to '{row.entity_account_head}' is {row.amount:,.2f}, above the ledger's 90th percentile",
                {
                    "entity_key": row.entity_account_head,
                    "amount": float(row.amount),
                    "ledger_p90": round(overall_p90, 2),
                    "days_after_ledger_start": int((row.transaction_date - ledger_start).days),
                    "total_events_for_entity": baseline.count,
                },
            )
        )
    return signals


def _ensemble_signals(
    frame: pd.DataFrame,
    baselines: dict[str, dict[str, EntityBaseline]],
    config: EngineConfig,
) -> tuple[list[Signal], dict]:
    """Unsupervised ensemble over entity-relative features.

    Three detectors with different inductive biases vote: Isolation Forest isolates by
    random splits, LOF compares local density, One-Class SVM learns a boundary. Agreement
    between them is what we score, so a row flagged by one quirky detector alone stays
    low — which is the practical lever on false positives.
    """
    if len(frame) < config.ensemble_min_rows:
        return [], {
            "ensemble": "skipped",
            "reason": f"needs at least {config.ensemble_min_rows} rows, got {len(frame)}",
        }

    matrix, feature_names = ensemble_feature_matrix(frame, baselines)
    scaled = RobustScaler().fit_transform(matrix)

    detector_scores: dict[str, np.ndarray] = {}

    forest = IsolationForest(
        n_estimators=200,
        contamination=config.contamination,
        random_state=config.random_state,
    ).fit(scaled)
    detector_scores["isolation_forest"] = -forest.score_samples(scaled)

    # Ledgers repeat amounts heavily (fixed fees, recurring charges), so a small
    # neighbourhood collapses onto duplicate points and LOF warns its result is unreliable.
    neighbours = min(50, max(20, len(scaled) // 10))
    lof = LocalOutlierFactor(n_neighbors=neighbours, contamination=config.contamination)
    lof.fit_predict(scaled)
    detector_scores["local_outlier_factor"] = -lof.negative_outlier_factor_

    try:
        svm = OneClassSVM(nu=min(0.5, max(0.01, config.contamination)), kernel="rbf", gamma="scale").fit(scaled)
        detector_scores["one_class_svm"] = -svm.score_samples(scaled)
    except Exception:
        # The SVM is the fragile member of the trio on degenerate data; the other two
        # still carry the view rather than failing the whole run.
        pass

    normalised = {name: _rank_normalise(values) for name, values in detector_scores.items()}
    agreement = np.mean(np.column_stack(list(normalised.values())), axis=1)

    signals: list[Signal] = []
    for position, row in enumerate(frame.itertuples()):
        consensus = float(agreement[position])
        strength = ramp(consensus, 0.90, 0.995) * config.ensemble_max_strength
        if strength <= 0:
            continue
        votes = {name: round(float(values[position]), 4) for name, values in normalised.items()}
        signals.append(
            Signal(
                row.transaction_id,
                VIEW,
                "ensemble_outlier",
                strength,
                f"Unsupervised ensemble ranks this in the top {100 * (1 - consensus):.1f}% most unusual rows for its profile",
                {
                    "consensus_percentile": round(consensus, 4),
                    "detector_percentiles": votes,
                    "features": feature_names,
                },
            )
        )

    meta = {
        "ensemble": "fitted",
        "detectors": list(detector_scores.keys()),
        "rows_scored": int(len(frame)),
        "features": feature_names,
        "contamination": config.contamination,
    }
    return signals, meta


def _rank_normalise(values: np.ndarray) -> np.ndarray:
    """Convert raw detector scores to percentiles so the three become comparable."""
    order = values.argsort().argsort().astype(float)
    return order / max(len(values) - 1, 1)


def grouping_ratio(frame: pd.DataFrame) -> float:
    heads = frame["entity_account_head"].nunique()
    if heads == 0:
        return 0.0
    return frame["entity_account_group"].nunique() / heads


def _grouping_is_degenerate(frame: pd.DataFrame, config: EngineConfig) -> bool:
    """True when the grouping stage produced roughly one group per account head.

    In that state a group-level deviation is literally the same observation as the
    head-level one, and emitting both would inflate a transaction's score on a single
    piece of evidence counted twice.
    """
    return grouping_ratio(frame) >= config.degenerate_group_ratio
