"""Where to draw the line on case priority, learned from what reviewers decided.

The row-level engine calibrates its alert score against row-level verdicts. Cases are
a different judgement at a different grain, and mixing the two would make neither
measurable, so they get their own line learned from their own ground truth: the
Confirmed / Cleared verdicts a reviewer records on cases.

The method is deliberately the plainest thing that can work and be argued with. It
sweeps candidate thresholds, scores each on the reviewed cases, and picks the one with
the best F1 - then refuses to use it unless three things hold:

* enough reviewed cases to mean anything,
* both verdicts present, because a queue of all-confirmed teaches nothing about where
  to stop,
* and a result measurably better than the default line.

When any check fails the default stands and the reason is reported. A calibration that
cannot say why it moved is worse than no calibration.
"""

from __future__ import annotations

from dataclasses import dataclass

DEFAULT_CASE_THRESHOLD = 55.0
"""The 'high' band floor. Cases at or above it are the ones worth opening first."""

MIN_REVIEWED_CASES = 12
MIN_OF_EACH_VERDICT = 3
MIN_F1_IMPROVEMENT = 0.05

SWEEP_LOW = 20.0
SWEEP_HIGH = 85.0
SWEEP_STEP = 2.5

STATUS_BOOTSTRAP = "bootstrap"
"""Not enough reviewed cases yet; the default line is in use."""
STATUS_ONE_SIDED = "one_sided"
"""Reviewers have confirmed everything, or cleared everything; nothing to learn from."""
STATUS_NO_GAIN = "no_gain"
"""A line was found but it is no better than the default, so the default stands."""
STATUS_CALIBRATED = "calibrated"


@dataclass
class CaseCalibration:
    threshold: float
    status: str
    reason: str
    reviewed: int = 0
    confirmed: int = 0
    cleared: int = 0
    precision: float = 0.0
    recall: float = 0.0
    f1: float = 0.0
    default_f1: float = 0.0

    def to_dict(self) -> dict:
        return {
            "threshold": round(self.threshold, 2),
            "status": self.status,
            "reason": self.reason,
            "reviewed_cases": self.reviewed,
            "confirmed": self.confirmed,
            "cleared": self.cleared,
            "precision": round(self.precision, 3),
            "recall": round(self.recall, 3),
            "f1": round(self.f1, 3),
            "default_f1": round(self.default_f1, 3),
            "default_threshold": DEFAULT_CASE_THRESHOLD,
        }


def _score_at(threshold: float, labelled: list[tuple[float, bool]]) -> tuple[float, float, float]:
    """Precision, recall and F1 for one candidate line."""
    true_positive = sum(1 for priority, confirmed in labelled if priority >= threshold and confirmed)
    false_positive = sum(1 for priority, confirmed in labelled if priority >= threshold and not confirmed)
    false_negative = sum(1 for priority, confirmed in labelled if priority < threshold and confirmed)

    precision = true_positive / (true_positive + false_positive) if (true_positive + false_positive) else 0.0
    recall = true_positive / (true_positive + false_negative) if (true_positive + false_negative) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    return precision, recall, f1


def calibrate(reviewed: list[tuple[float, str]]) -> CaseCalibration:
    """Learn the case priority line from (priority, verdict) pairs.

    Only `confirmed` and `cleared` teach anything. `uncertain` means the reviewer could
    not tell, which is not evidence in either direction, and `pending` has not been
    looked at - counting either as a negative would train the line on silence.
    """
    labelled = [
        (float(priority), status == "confirmed")
        for priority, status in reviewed
        if status in ("confirmed", "cleared")
    ]
    confirmed = sum(1 for _, is_confirmed in labelled if is_confirmed)
    cleared = len(labelled) - confirmed

    if len(labelled) < MIN_REVIEWED_CASES:
        return CaseCalibration(
            threshold=DEFAULT_CASE_THRESHOLD,
            status=STATUS_BOOTSTRAP,
            reason=(
                f"{len(labelled)} case(s) reviewed so far. The line moves once "
                f"{MIN_REVIEWED_CASES} have a confirmed or cleared verdict."
            ),
            reviewed=len(labelled),
            confirmed=confirmed,
            cleared=cleared,
        )

    if confirmed < MIN_OF_EACH_VERDICT or cleared < MIN_OF_EACH_VERDICT:
        return CaseCalibration(
            threshold=DEFAULT_CASE_THRESHOLD,
            status=STATUS_ONE_SIDED,
            reason=(
                f"{confirmed} confirmed and {cleared} cleared. Moving the line needs at least "
                f"{MIN_OF_EACH_VERDICT} of each, otherwise it only learns to agree with whichever exists."
            ),
            reviewed=len(labelled),
            confirmed=confirmed,
            cleared=cleared,
        )

    default_precision, default_recall, default_f1 = _score_at(DEFAULT_CASE_THRESHOLD, labelled)

    best = (DEFAULT_CASE_THRESHOLD, default_precision, default_recall, default_f1)
    steps = int((SWEEP_HIGH - SWEEP_LOW) / SWEEP_STEP) + 1
    for step in range(steps):
        candidate = SWEEP_LOW + step * SWEEP_STEP
        precision, recall, f1 = _score_at(candidate, labelled)
        if f1 > best[3]:
            best = (candidate, precision, recall, f1)

    threshold, precision, recall, f1 = best
    if f1 - default_f1 < MIN_F1_IMPROVEMENT:
        return CaseCalibration(
            threshold=DEFAULT_CASE_THRESHOLD,
            status=STATUS_NO_GAIN,
            reason=(
                f"The best line found scores {f1:.2f} against the default's {default_f1:.2f}. "
                f"That is inside the noise, so the default stays."
            ),
            reviewed=len(labelled),
            confirmed=confirmed,
            cleared=cleared,
            precision=default_precision,
            recall=default_recall,
            f1=default_f1,
            default_f1=default_f1,
        )

    direction = "raised" if threshold > DEFAULT_CASE_THRESHOLD else "lowered"
    return CaseCalibration(
        threshold=threshold,
        status=STATUS_CALIBRATED,
        reason=(
            f"Line {direction} to {threshold:.0f} from {len(labelled)} reviewed case(s): "
            f"precision {precision:.0%}, recall {recall:.0%}, against the default's F1 of {default_f1:.2f}."
        ),
        reviewed=len(labelled),
        confirmed=confirmed,
        cleared=cleared,
        precision=precision,
        recall=recall,
        f1=f1,
        default_f1=default_f1,
    )
