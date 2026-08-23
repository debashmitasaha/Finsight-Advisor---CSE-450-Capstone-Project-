from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from app.forensic_engine.config import EngineConfig, risk_band
from app.forensic_engine.signals import Signal, noisy_or


@dataclass
class FusedFinding:
    transaction_id: str
    risk_score: float
    band: str
    view_scores: dict[str, float]
    views_triggered: list[str]
    corroboration: int
    signals: list[Signal] = field(default_factory=list)

    def explanation(self) -> list[dict]:
        """The evidence chain, strongest first.

        Deliberately returns structured rows rather than prose: the UI renders them as a
        checklist, and the LLM narrator (see `narrative.py`) consumes the same structure,
        so the explanation an auditor reads always traces back to these numbers.
        """
        ordered = sorted(self.signals, key=lambda item: item.strength, reverse=True)
        return [
            {
                "view": signal.view,
                "code": signal.code,
                "strength": round(signal.strength, 3),
                "message": signal.message,
                "detail": signal.detail,
            }
            for signal in ordered
        ]

    def to_dict(self) -> dict:
        return {
            "transaction_id": self.transaction_id,
            "risk_score": round(self.risk_score, 2),
            "band": self.band,
            "view_scores": {view: round(score, 2) for view, score in self.view_scores.items()},
            "views_triggered": self.views_triggered,
            "corroboration": self.corroboration,
            "evidence": self.explanation(),
        }


def fuse(signals: list[Signal], config: EngineConfig) -> list[FusedFinding]:
    """Combine every view's evidence into one score per transaction.

    Two stages of the same union rule. Within a view, signals fuse by noisy-OR because
    they are alternative symptoms of the same underlying view; summing them would let a
    view stack many weak tests into a false certainty. Across views, each verdict is first
    discounted by that view's credibility and the results fuse by noisy-OR again, so
    independent methods agreeing raises the score without any one view being able to claim
    certainty on its own.
    """
    by_transaction: dict[str, list[Signal]] = defaultdict(list)
    for signal in signals:
        by_transaction[signal.transaction_id].append(signal)

    findings: list[FusedFinding] = []
    for transaction_id, transaction_signals in by_transaction.items():
        by_view: dict[str, list[Signal]] = defaultdict(list)
        for signal in transaction_signals:
            by_view[signal.view].append(signal)

        view_scores: dict[str, float] = {}
        for view, view_signals in by_view.items():
            view_scores[view] = noisy_or([signal.strength for signal in view_signals])

        # Each view's verdict is discounted by how much that view can be trusted alone,
        # then the discounted verdicts combine by noisy-OR — the same union rule used
        # inside a view, applied one level up. Corroboration therefore falls out of the
        # arithmetic instead of needing a bonus bolted on: two views at 0.8 land higher
        # than either alone, without any single view being able to reach certainty.
        effective = [
            view_scores[view] * config.view_credibility.get(view, 0.5)
            for view in view_scores
            if view_scores[view] >= config.min_view_score
        ]
        combined = noisy_or(effective)
        corroboration = sum(1 for score in view_scores.values() if score >= 0.25)

        score = round(100.0 * min(1.0, combined), 4)

        findings.append(
            FusedFinding(
                transaction_id=transaction_id,
                risk_score=score,
                band=risk_band(score),
                view_scores={view: 100.0 * value for view, value in view_scores.items()},
                views_triggered=sorted(by_view.keys()),
                corroboration=corroboration,
                signals=transaction_signals,
            )
        )

    findings.sort(key=lambda item: item.risk_score, reverse=True)
    return findings


def summarise(findings: list[FusedFinding]) -> dict:
    bands: dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    view_hits: dict[str, int] = defaultdict(int)
    code_hits: dict[str, int] = defaultdict(int)

    for finding in findings:
        bands[finding.band] = bands.get(finding.band, 0) + 1
        for view in finding.views_triggered:
            view_hits[view] += 1
        for signal in finding.signals:
            code_hits[signal.code] += 1

    return {
        "total_scored": len(findings),
        "bands": bands,
        "by_view": dict(sorted(view_hits.items(), key=lambda item: -item[1])),
        "top_codes": dict(sorted(code_hits.items(), key=lambda item: -item[1])[:12]),
    }
