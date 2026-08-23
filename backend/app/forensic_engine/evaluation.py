from __future__ import annotations

from dataclasses import dataclass

from app.forensic_engine.fusion import FusedFinding
from app.forensic_engine.injection import InjectionResult


@dataclass
class EvaluationReport:
    total_rows: int
    planted: int
    flagged: int
    true_positives: int
    false_positives: int
    false_negatives: int
    precision: float
    recall: float
    f1: float
    false_positive_rate: float
    top_k_precision: dict[str, float]
    mean_rank_of_planted: float | None
    median_rank_of_planted: float | None
    per_scenario: dict[str, dict]
    threshold: float

    def to_dict(self) -> dict:
        return {
            "threshold": self.threshold,
            "total_rows": self.total_rows,
            "planted_rows": self.planted,
            "flagged_rows": self.flagged,
            "true_positives": self.true_positives,
            "false_positives": self.false_positives,
            "false_negatives": self.false_negatives,
            "precision": round(self.precision, 4),
            "recall": round(self.recall, 4),
            "f1": round(self.f1, 4),
            "false_positive_rate": round(self.false_positive_rate, 4),
            "top_k_precision": self.top_k_precision,
            "mean_rank_of_planted": self.mean_rank_of_planted,
            "median_rank_of_planted": self.median_rank_of_planted,
            "per_scenario": self.per_scenario,
        }


def evaluate(
    findings: list[FusedFinding],
    injection: InjectionResult,
    total_rows: int,
    threshold: float = 40.0,
) -> EvaluationReport:
    """Score the engine against ground truth we planted ourselves.

    Two complementary readings are produced. The threshold metrics answer "if we alert on
    everything above 40, what do we get". The ranking metrics answer "if an auditor works
    down the list, how far must they read" — which is closer to how the tool is actually
    used, and is why mean rank is reported alongside precision.
    """
    planted = injection.planted_ids
    scored = {finding.transaction_id: finding for finding in findings}

    flagged = {finding.transaction_id for finding in findings if finding.risk_score >= threshold}
    true_positives = flagged & planted
    false_positives = flagged - planted
    false_negatives = planted - flagged

    clean_rows = max(total_rows - len(planted), 1)
    precision = len(true_positives) / len(flagged) if flagged else 0.0
    recall = len(true_positives) / len(planted) if planted else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0

    # Ranking view: every row the engine scored, best first. Unscored rows rank last.
    ranked = [finding.transaction_id for finding in findings]
    rank_of = {tid: index + 1 for index, tid in enumerate(ranked)}
    unscored_rank = len(ranked) + 1

    planted_ranks = sorted(rank_of.get(tid, unscored_rank) for tid in planted)
    mean_rank = sum(planted_ranks) / len(planted_ranks) if planted_ranks else None
    median_rank = planted_ranks[len(planted_ranks) // 2] if planted_ranks else None

    top_k_precision: dict[str, float] = {}
    for k in (10, 20, 50, 100):
        if k > len(ranked):
            continue
        hits = sum(1 for tid in ranked[:k] if tid in planted)
        top_k_precision[f"P@{k}"] = round(hits / k, 4)

    per_scenario: dict[str, dict] = {}
    for case in injection.cases:
        detected = [tid for tid in case.transaction_ids if tid in flagged]
        ranks = [rank_of.get(tid, unscored_rank) for tid in case.transaction_ids]
        scores = [scored[tid].risk_score if tid in scored else 0.0 for tid in case.transaction_ids]
        per_scenario[case.scenario] = {
            "planted": len(case.transaction_ids),
            "detected": len(detected),
            "recall": round(len(detected) / len(case.transaction_ids), 4) if case.transaction_ids else 0.0,
            "best_rank": min(ranks) if ranks else None,
            "best_score": round(max(scores), 2) if scores else 0.0,
            "description": case.description,
            "triggered_views": sorted(
                {
                    signal.view
                    for tid in case.transaction_ids
                    if tid in scored
                    for signal in scored[tid].signals
                }
            ),
        }

    return EvaluationReport(
        total_rows=total_rows,
        planted=len(planted),
        flagged=len(flagged),
        true_positives=len(true_positives),
        false_positives=len(false_positives),
        false_negatives=len(false_negatives),
        precision=precision,
        recall=recall,
        f1=f1,
        false_positive_rate=len(false_positives) / clean_rows,
        top_k_precision=top_k_precision,
        mean_rank_of_planted=round(mean_rank, 2) if mean_rank is not None else None,
        median_rank_of_planted=median_rank,
        per_scenario=per_scenario,
        threshold=threshold,
    )


def sweep_thresholds(
    findings: list[FusedFinding],
    injection: InjectionResult,
    total_rows: int,
    thresholds: tuple[float, ...] = (20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0),
) -> list[dict]:
    """Precision/recall trade-off across alert thresholds.

    Reported because the right cut-off is an operational choice — an audit team with time
    for twenty reviews a month wants a different threshold than one running continuous
    monitoring — and the engine should show the curve rather than hard-code a preference.
    """
    curve = []
    for threshold in thresholds:
        report = evaluate(findings, injection, total_rows, threshold)
        curve.append(
            {
                "threshold": threshold,
                "precision": round(report.precision, 4),
                "recall": round(report.recall, 4),
                "f1": round(report.f1, 4),
                "false_positive_rate": round(report.false_positive_rate, 4),
                "flagged": report.flagged,
            }
        )
    return curve
