"""Company-specific alert threshold calibration.

The engine produces a 0-100 risk score for every transaction. This module decides where,
for one particular company, the line between "alert" and "do not alert" sits — and, just
as importantly, when the system is *not yet entitled* to decide that from data.

Three maturity states:

    bootstrap    No reviewer ground truth for this company. Alerts use a predefined
                 threshold that came from reference benchmarks and fraud-control practice.
                 F1 plays no part, and nothing here may claim it does.
    warmup       Reviewers have started labelling alerts and sampled non-alerts. The
                 bootstrap threshold stays in force while labels accumulate.
    calibrated   Enough labels exist. Candidate thresholds are swept on the older labels,
                 the best-F1 candidate is validated on the newer labels, and only a
                 candidate that survives validation becomes the company's active threshold.

Everything here is pure: rows in, decisions out. Persistence lives in the router so the
arithmetic can be tested without a database, and so the synthetic benchmark in
`evaluation.py` (planted fraud, developer evidence) can never leak into a company's real
calibration (human labels on real rows). They share vocabulary — precision, recall, F1 —
and nothing else.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone

from app.forensic_engine.config import CalibrationConfig


LABEL_CONFIRMED = "confirmed"
LABEL_CLEARED = "cleared"
LABEL_UNCERTAIN = "uncertain"
REVIEW_LABELS: tuple[str, ...] = (LABEL_CONFIRMED, LABEL_CLEARED, LABEL_UNCERTAIN)

MODE_BOOTSTRAP = "bootstrap"
MODE_WARMUP = "warmup"
MODE_CALIBRATED = "calibrated"

SOURCE_BOOTSTRAP = "bootstrap"
SOURCE_COMPANY_F1 = "company_f1"
SOURCE_MANUAL = "manual"

SOURCE_LABELS: dict[str, str] = {
    SOURCE_BOOTSTRAP: "Bootstrap — reference benchmark, not this company's data",
    SOURCE_COMPANY_F1: "Company-specific reviewer ground truth — F1-selected and validated",
    SOURCE_MANUAL: "Manual override for this run only",
}

STRATUM_PRIORITY = "priority"
STRATUM_ALERT = "alert"
STRATUM_NEAR = "near_miss"
STRATUM_LOW = "low"
STRATUM_ORDER: tuple[str, ...] = (STRATUM_PRIORITY, STRATUM_ALERT, STRATUM_NEAR, STRATUM_LOW)

STRATUM_META: dict[str, dict[str, str]] = {
    STRATUM_PRIORITY: {
        "label": "Priority alert",
        "why": "Scored at or above the priority line. Every one of them goes into the queue, at the front.",
    },
    STRATUM_ALERT: {
        "label": "Alert",
        "why": "Scored at or above this company's alert threshold. Every alert goes into the queue; none is sampled out.",
    },
    STRATUM_NEAR: {
        "label": "Near-miss sample",
        "why": "Just below the threshold. A larger random sample is reviewed here because this is where "
        "missed fraud is most likely to hide, and without it recall cannot be measured.",
    },
    STRATUM_LOW: {
        "label": "Low-score sample",
        "why": "Well below the threshold. A small random sample is reviewed so the count of true "
        "negatives rests on evidence rather than assumption.",
    },
}


@dataclass(frozen=True)
class LabelledRow:
    """One reviewed transaction: the score the engine gave it and what a human decided."""

    transaction_id: str
    risk_score: float
    label: str
    reviewed_at: datetime


# ----------------------------------------------------------------------------- metrics


def usable_rows(rows: list[LabelledRow]) -> list[LabelledRow]:
    """Drop 'uncertain' verdicts. A reviewer who could not decide has not produced ground
    truth, and counting them either way would corrupt every metric below."""
    return [row for row in rows if row.label in (LABEL_CONFIRMED, LABEL_CLEARED)]


def confusion(rows: list[LabelledRow], threshold: float) -> dict:
    """Confusion table and derived rates for one threshold over labelled rows.

    Only confirmed/cleared rows should be passed in (see `usable_rows`). Rates that have
    no denominator are reported as 0.0 rather than raising, so a sweep over a sparse set
    still produces a full table the UI can show.
    """
    tp = fp = tn = fn = 0
    for row in rows:
        alerted = row.risk_score >= threshold
        if row.label == LABEL_CONFIRMED:
            if alerted:
                tp += 1
            else:
                fn += 1
        elif row.label == LABEL_CLEARED:
            if alerted:
                fp += 1
            else:
                tn += 1

    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    false_positive_rate = fp / (fp + tn) if (fp + tn) else 0.0

    return {
        "threshold": float(threshold),
        "rows": tp + fp + tn + fn,
        "true_positives": tp,
        "false_positives": fp,
        "true_negatives": tn,
        "false_negatives": fn,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "false_positive_rate": round(false_positive_rate, 4),
        "alerts": tp + fp,
    }


def sweep(rows: list[LabelledRow], thresholds: tuple[float, ...]) -> list[dict]:
    """The precision/recall/F1 trade-off across every candidate threshold."""
    return [confusion(rows, threshold) for threshold in thresholds]


def best_threshold(curve: list[dict], current: float) -> float:
    """The candidate with the highest F1.

    Ties go to the candidate *nearest the threshold already in force*, then to the higher
    one. On a small label set several thresholds often share the top F1; picking the edge
    of that plateau chooses the most fragile point on it, and the line would then move for
    no measurable gain. Staying close to the current line means it moves only when the
    labels actually prefer somewhere else.

    Selection is by F1 because that is the project's current objective — the sweep
    carries every other rate so a different objective can be swapped in without touching
    the pipeline.
    """
    if not curve:
        return float(current)
    winner = max(curve, key=lambda point: (round(point["f1"], 6), -abs(point["threshold"] - current), point["threshold"]))
    return float(winner["threshold"])


def _cut(ordered: list[LabelledRow], share: float) -> tuple[list[LabelledRow], list[LabelledRow]]:
    if len(ordered) < 2:
        return ordered, []
    cut = int(round(len(ordered) * share))
    cut = min(max(cut, 1), len(ordered) - 1)
    return ordered[:cut], ordered[cut:]


def split_by_time(rows: list[LabelledRow], share: float) -> tuple[list[LabelledRow], list[LabelledRow]]:
    """Oldest `share` of rows to choose the threshold, newest remainder to validate it.

    Time-ordered rather than random because a threshold chosen today will be judged by
    the rows reviewed after it, and the split should rehearse exactly that.

    The split is made *within each label* and then merged. Reviewers work the alerts
    first and the below-the-line samples later, which means the confirmed rows tend to be
    the oldest reviews and the cleared rows the newest. A single cut across all rows would
    then hand validation a set with no positives at all, and no candidate could ever pass.
    Cutting each label by time separately keeps the temporal discipline while guaranteeing
    both kinds of verdict on both sides whenever there are enough of each.
    """
    by_key = lambda row: (row.reviewed_at, row.transaction_id)  # noqa: E731
    ordered = sorted(rows, key=by_key)
    if len(ordered) < 2:
        return ordered, []

    calibration: list[LabelledRow] = []
    validation: list[LabelledRow] = []
    for label in (LABEL_CONFIRMED, LABEL_CLEARED):
        group = [row for row in ordered if row.label == label]
        older, newer = _cut(group, share)
        calibration.extend(older)
        validation.extend(newer)

    if not validation:
        # Only possible when each label has a single row: fall back to one cut over time
        # so the caller still gets a row on each side.
        calibration, validation = _cut(ordered, share)

    return sorted(calibration, key=by_key), sorted(validation, key=by_key)


# --------------------------------------------------------------------------- readiness


@dataclass
class ReadinessCheck:
    code: str
    label: str
    required: int
    actual: int

    @property
    def passed(self) -> bool:
        return self.actual >= self.required

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "label": self.label,
            "required": self.required,
            "actual": self.actual,
            "passed": self.passed,
        }


def readiness(reviewed: int, positive: int, negative: int, config: CalibrationConfig) -> dict:
    """Is this company allowed to calibrate yet?

    All three minimums must hold. The reviewed total alone is not enough: a hundred
    'cleared' labels and no 'confirmed' ones cannot say anything about recall.
    """
    checks = [
        ReadinessCheck("reviewed", "Transactions reviewed", config.min_reviewed_rows, reviewed),
        ReadinessCheck("confirmed", "Confirmed issues (positives)", config.min_positive_labels, positive),
        ReadinessCheck("cleared", "Cleared as legitimate (negatives)", config.min_negative_labels, negative),
    ]
    return {"ready": all(check.passed for check in checks), "checks": [check.to_dict() for check in checks]}


def maturity_mode(reviewed: int, has_company_threshold: bool) -> str:
    if has_company_threshold:
        return MODE_CALIBRATED
    return MODE_WARMUP if reviewed > 0 else MODE_BOOTSTRAP


def active_threshold(mode: str, company_threshold: float | None, config: CalibrationConfig) -> tuple[float, str]:
    """The alert line for a company, and where it came from.

    This is the whole point of the pipeline in one function: a company only gets its own
    threshold once a calibration has activated one. Everything else — including a company
    that is *ready* to calibrate but has not yet passed validation — alerts at bootstrap.
    """
    if mode == MODE_CALIBRATED and company_threshold is not None:
        return float(company_threshold), SOURCE_COMPANY_F1
    return float(config.bootstrap_threshold), SOURCE_BOOTSTRAP


def recalibration_due(reviews_since_last: int, ever_calibrated: bool, ready: bool, config: CalibrationConfig) -> bool:
    """Whether a review just submitted should trigger a calibration run.

    The first calibration runs as soon as readiness is met. After that, one runs every
    `recalibration_batch` new reviews — often enough to follow drift, rare enough that the
    threshold does not twitch with every verdict.
    """
    if not ready:
        return False
    if not ever_calibrated:
        return True
    return reviews_since_last >= config.recalibration_batch


# -------------------------------------------------------------- runtime settings (P16)


OVERRIDABLE_FIELDS: tuple[str, ...] = (
    "bootstrap_threshold",
    "min_reviewed_rows",
    "min_positive_labels",
    "min_negative_labels",
    "recalibration_batch",
)
"""The knobs a company admin may change from the interface, per company, without a
restart or a configuration file.

Everything else in `CalibrationConfig` — the time split, the candidate grid, the three
validation checks, the sampling rates — is the method itself, not a setting, and stays
fixed so that every company's threshold is chosen the same defensible way."""

PRESETS: dict[str, dict[str, float]] = {
    "demo": {
        "min_reviewed_rows": 30,
        "min_positive_labels": 10,
        "min_negative_labels": 17,
        "recalibration_batch": 10,
    },
}
"""Named bundles the UI can apply in one click.

'demo' is close to the smallest setting at which a calibration can still *activate*: the
held-out check needs 3 confirmed and 5 cleared rows, and with the 70/30 time split that
takes at least 9 confirmed and 15 cleared labels in total (see `activation_floors`)."""


def _held_out(count: int, share: float) -> int:
    """How many of `count` rows of one label `_cut` would hold out for validation."""
    if count < 2:
        return 0
    cut = int(round(count * share))
    return count - min(max(cut, 1), count - 1)


def activation_floors(config: CalibrationConfig) -> dict[str, int]:
    """The smallest minimums at which a candidate can ever pass validation.

    Below these a company could reach 'ready', run a calibration, and be rejected every
    time for lack of held-out labels — honest, but useless. The settings endpoint refuses
    values under the floor instead of letting a demo walk into that wall.
    """
    positive = next(n for n in range(2, 10_000) if _held_out(n, config.calibration_share) >= config.min_validation_positive)
    negative = next(n for n in range(2, 10_000) if _held_out(n, config.calibration_share) >= config.min_validation_negative)
    return {
        "min_positive_labels": positive,
        "min_negative_labels": negative,
        "min_reviewed_rows": positive + negative,
        "recalibration_batch": 1,
        "bootstrap_threshold": int(min(config.candidate_thresholds)),
    }


def setting_bounds(config: CalibrationConfig) -> dict[str, tuple[float, float]]:
    """Inclusive (low, high) per overridable field, derived from the method's own limits."""
    floors = activation_floors(config)
    return {
        "bootstrap_threshold": (float(min(config.candidate_thresholds)), float(max(config.candidate_thresholds))),
        "min_reviewed_rows": (float(floors["min_reviewed_rows"]), 10_000.0),
        "min_positive_labels": (float(floors["min_positive_labels"]), 10_000.0),
        "min_negative_labels": (float(floors["min_negative_labels"]), 10_000.0),
        "recalibration_batch": (1.0, 10_000.0),
    }


def with_overrides(base: CalibrationConfig, overrides: dict | None) -> CalibrationConfig:
    """A copy of `base` with one company's stored overrides applied, after validation.

    Raises ValueError naming the offending field, so the API turns it into a 400 and
    nothing half-applied is ever stored. `base` is never mutated.
    """
    if not overrides:
        return base
    bounds = setting_bounds(base)
    values: dict[str, float | int] = {}
    for key, raw in overrides.items():
        if key not in OVERRIDABLE_FIELDS:
            raise ValueError(f"'{key}' is not a setting that can be changed at runtime")
        if raw is None:
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            raise ValueError(f"'{key}' must be a number") from None
        low, high = bounds[key]
        if not low <= value <= high:
            raise ValueError(f"'{key}' must be between {low:g} and {high:g}")
        values[key] = value if key == "bootstrap_threshold" else int(value)
    return replace(base, **values) if values else base


# ------------------------------------------------------------------------- calibration


@dataclass
class ValidationCheck:
    code: str
    label: str
    passed: bool
    detail: str

    def to_dict(self) -> dict:
        return {"code": self.code, "label": self.label, "passed": self.passed, "detail": self.detail}


@dataclass
class CalibrationOutcome:
    ready: bool
    readiness: dict
    current_threshold: float
    candidate_threshold: float | None
    activated: bool
    reason: str
    reviewed_count: int
    positive_count: int
    negative_count: int
    calibration_rows: int = 0
    validation_rows: int = 0
    calibration_metrics: dict | None = None
    validation_metrics: dict | None = None
    current_validation_metrics: dict | None = None
    sweep: list[dict] = field(default_factory=list)
    checks: list[ValidationCheck] = field(default_factory=list)
    data_start: datetime | None = None
    data_end: datetime | None = None

    def to_dict(self) -> dict:
        return {
            "ready": self.ready,
            "readiness": self.readiness,
            "current_threshold": self.current_threshold,
            "candidate_threshold": self.candidate_threshold,
            "activated": self.activated,
            "reason": self.reason,
            "reviewed_count": self.reviewed_count,
            "positive_count": self.positive_count,
            "negative_count": self.negative_count,
            "calibration_rows": self.calibration_rows,
            "validation_rows": self.validation_rows,
            "calibration_metrics": self.calibration_metrics,
            "validation_metrics": self.validation_metrics,
            "current_validation_metrics": self.current_validation_metrics,
            "sweep": self.sweep,
            "checks": [check.to_dict() for check in self.checks],
            "data_start": self.data_start.isoformat() if self.data_start else None,
            "data_end": self.data_end.isoformat() if self.data_end else None,
        }


def calibrate(rows: list[LabelledRow], current_threshold: float, config: CalibrationConfig) -> CalibrationOutcome:
    """Choose, validate and (maybe) activate a company-specific threshold.

    Steps, in the order the design note lays them out:

    1. Readiness — refuse politely if the labels are too few. Nothing is chosen from thin
       evidence, and the outcome says exactly which minimum is unmet.
    2. Split — oldest labels choose, newest labels judge.
    3. Sweep — every candidate threshold on the calibration rows; the best F1 is the
       candidate.
    4. Validate — the candidate on the held-out rows, against three checks:
         * the held-out set is big enough to mean anything;
         * the candidate is at least as good as the threshold currently in force, on the
           same held-out rows (never trade a working line for a worse one);
         * the candidate's F1 does not collapse between the rows it was chosen from and
           the rows it was not — a collapse means it was fitted to noise.
    5. Activate only when all three pass. Otherwise the current threshold stays, and the
       attempt is recorded so the next one can be compared with it.
    """
    usable = usable_rows(rows)
    positive = sum(1 for row in usable if row.label == LABEL_CONFIRMED)
    negative = sum(1 for row in usable if row.label == LABEL_CLEARED)
    reviewed = len(rows)

    ready = readiness(reviewed, positive, negative, config)
    base = dict(
        readiness=ready,
        current_threshold=float(current_threshold),
        reviewed_count=reviewed,
        positive_count=positive,
        negative_count=negative,
    )

    if not ready["ready"]:
        unmet = [check for check in ready["checks"] if not check["passed"]]
        shortfall = "; ".join(f"{check['label'].lower()}: {check['actual']} of {check['required']}" for check in unmet)
        return CalibrationOutcome(
            ready=False,
            candidate_threshold=None,
            activated=False,
            reason=f"Not enough company ground truth to calibrate ({shortfall}). "
            f"Alerts continue at {current_threshold:.0f}.",
            **base,
        )

    calibration_set, validation_set = split_by_time(usable, config.calibration_share)
    curve = sweep(calibration_set, config.candidate_thresholds)
    candidate = best_threshold(curve, current=current_threshold)

    calibration_metrics = confusion(calibration_set, candidate)
    validation_metrics = confusion(validation_set, candidate)
    current_metrics = confusion(validation_set, current_threshold)

    held_positive = sum(1 for row in validation_set if row.label == LABEL_CONFIRMED)
    held_negative = sum(1 for row in validation_set if row.label == LABEL_CLEARED)

    checks = [
        ValidationCheck(
            code="validation_labels",
            label="Enough held-out labels to judge the candidate",
            passed=held_positive >= config.min_validation_positive and held_negative >= config.min_validation_negative,
            detail=f"{held_positive} confirmed and {held_negative} cleared rows held out "
            f"(need {config.min_validation_positive} and {config.min_validation_negative})",
        ),
        ValidationCheck(
            code="no_regression",
            label=f"At least as good as the current threshold ({current_threshold:.0f}) on held-out rows",
            passed=validation_metrics["f1"] + 1e-9 >= current_metrics["f1"],
            detail=f"held-out F1 {validation_metrics['f1']:.2f} at {candidate:.0f} "
            f"vs {current_metrics['f1']:.2f} at {current_threshold:.0f}",
        ),
        ValidationCheck(
            code="holds_up",
            label="F1 holds up on rows it was not chosen from",
            passed=validation_metrics["f1"] + 1e-9 >= calibration_metrics["f1"] - config.max_validation_drop,
            detail=f"F1 {calibration_metrics['f1']:.2f} on calibration rows, "
            f"{validation_metrics['f1']:.2f} on held-out rows (allowed drop {config.max_validation_drop:.2f})",
        ),
    ]
    activated = all(check.passed for check in checks)

    if activated:
        reason = (
            f"Threshold {candidate:.0f} gave the best F1 ({calibration_metrics['f1']:.2f}) of "
            f"{len(curve)} candidates on the {len(calibration_set)} oldest reviewed rows, and held up on the "
            f"{len(validation_set)} newest (F1 {validation_metrics['f1']:.2f}, precision "
            f"{validation_metrics['precision']:.0%}, recall {validation_metrics['recall']:.0%}). "
            f"It is now the company's active alert threshold."
        )
    else:
        failed = next(check for check in checks if not check.passed)
        reason = (
            f"Threshold {candidate:.0f} scored best on the calibration rows but failed validation. "
            f"Check not passed: \"{failed.label}\" ({failed.detail}). "
            f"The current threshold of {current_threshold:.0f} stays in force."
        )

    stamps = [row.reviewed_at for row in usable]
    return CalibrationOutcome(
        ready=True,
        candidate_threshold=candidate,
        activated=activated,
        reason=reason,
        calibration_rows=len(calibration_set),
        validation_rows=len(validation_set),
        calibration_metrics=calibration_metrics,
        validation_metrics=validation_metrics,
        current_validation_metrics=current_metrics,
        sweep=curve,
        checks=checks,
        data_start=min(stamps) if stamps else None,
        data_end=max(stamps) if stamps else None,
        **base,
    )


# ---------------------------------------------------------------- review sampling (P6)


def review_stratum(score: float, threshold: float, config: CalibrationConfig) -> str:
    """Which review lane a score falls into, relative to the company's own threshold."""
    if score >= threshold:
        return STRATUM_PRIORITY if score >= max(config.priority_score, threshold) else STRATUM_ALERT
    if score >= threshold * config.near_miss_share:
        return STRATUM_NEAR
    return STRATUM_LOW


def _draw_key(seed: str, transaction_id: str) -> float:
    """A stable pseudo-random number in [0, 1) for one row of one run.

    Hashing (run, transaction) instead of calling a random generator means the sample a
    reviewer sees does not reshuffle every time the page reloads — it changes only when
    the engine is re-run, which is when the scores change too.
    """
    digest = hashlib.sha256(f"{seed}:{transaction_id}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") / float(2**64)


def sample_for_review(
    candidates: list[tuple[str, float]],
    threshold: float,
    config: CalibrationConfig,
    seed: str,
) -> tuple[list[dict], dict[str, dict]]:
    """Every alert, plus a stratified random sample of rows below the line.

    Reviewing only alerts can measure false positives but never false negatives — the
    rows the engine missed are, by construction, the ones nobody looked at. So a slice of
    the near misses and a thinner slice of the low scorers go into the queue as well. That
    is what turns "precision" into "precision *and recall*" for this company.
    """
    by_stratum: dict[str, list[tuple[str, float]]] = {stratum: [] for stratum in STRATUM_ORDER}
    for transaction_id, score in candidates:
        by_stratum[review_stratum(score, threshold, config)].append((transaction_id, score))

    selected: list[dict] = []
    summary: dict[str, dict] = {}
    for stratum in STRATUM_ORDER:
        members = by_stratum[stratum]
        if stratum in (STRATUM_PRIORITY, STRATUM_ALERT):
            chosen = sorted(members, key=lambda item: -item[1])
            rate: float | None = None
        else:
            rate = config.sample_rate_near if stratum == STRATUM_NEAR else config.sample_rate_low
            minimum = config.sample_min_near if stratum == STRATUM_NEAR else config.sample_min_low
            wanted = max(int(round(len(members) * rate)), min(minimum, len(members)))
            drawn = sorted(members, key=lambda item: _draw_key(seed, item[0]))
            chosen = sorted(drawn[:wanted], key=lambda item: -item[1])

        for transaction_id, score in chosen:
            selected.append({"transaction_id": transaction_id, "risk_score": float(score), "stratum": stratum})
        summary[stratum] = {
            "population": len(members),
            "sampled": len(chosen),
            "rate": rate,
            "label": STRATUM_META[stratum]["label"],
            "why": STRATUM_META[stratum]["why"],
        }

    return selected, summary


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
