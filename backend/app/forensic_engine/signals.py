from __future__ import annotations

import math

from dataclasses import dataclass, field


@dataclass
class Signal:
    """One piece of forensic evidence attached to one transaction.

    A signal is deliberately small: a view emits many of them and fusion decides what the
    combination means. `strength` is always 0..1 so signals from different views stay
    comparable, and `detail` carries the raw numbers an auditor would want to verify.
    """

    transaction_id: str
    view: str
    code: str
    strength: float
    message: str
    detail: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.strength = max(0.0, min(1.0, float(self.strength)))


def ramp(value: float, soft: float, hard: float) -> float:
    """Map a raw statistic onto 0..1, starting at `soft` and saturating at `hard`.

    Used everywhere so that "slightly over the line" and "wildly over the line" do not
    both collapse to a single binary flag.
    """
    if hard <= soft:
        return 1.0 if value >= hard else 0.0
    if value <= soft:
        return 0.0
    if value >= hard:
        return 1.0
    return (value - soft) / (hard - soft)


def log_ramp(value: float, soft: float, hard: float) -> float:
    """A ramp on the log scale, for statistics that span orders of magnitude.

    Amount deviations range from "3x the usual" to "140x the usual" in the same ledger. A
    linear ramp saturates almost immediately and then cannot tell those two apart, which
    destroys the ranking an auditor works down. On the log scale both stay separated.
    """
    if value <= soft:
        return 0.0
    if hard <= soft:
        return 1.0
    numerator = math.log(value) - math.log(soft)
    denominator = math.log(hard) - math.log(soft)
    return max(0.0, min(1.0, numerator / denominator))


def noisy_or(strengths: list[float]) -> float:
    """Combine independent evidence within a view.

    Chosen over a sum (which would let five weak signals outrank one damning signal) and
    over a max (which would throw away corroboration entirely). Two 0.5 signals fuse to
    0.75: more than either alone, still short of certainty.
    """
    product = 1.0
    for strength in strengths:
        product *= 1.0 - max(0.0, min(1.0, strength))
    return 1.0 - product
