"""The layer that turns findings into something a person can work through.

Eighty-three fuel payments, a category velocity spike, a change point in March and
a pile of near-threshold amounts are not four problems. They are one problem
described four ways, and a reviewer handed them as four separate alerts will work
harder and understand less.

A case is evidence about the same entity whose time windows overlap or sit close
together. Merging is deliberately conservative: two different entities never merge,
however similar their stories, because an auditor investigates one head at a time.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from app.forensic_engine.historical.types import Evidence

# Windows this far apart still describe one episode. Two months is about the
# resolution at which a reviewer stops calling something "the same thing".
MERGE_GAP = timedelta(days=62)


@dataclass
class Case:
    entity_type: str
    entity_id: str
    start: date
    end: date
    evidence: list[Evidence] = field(default_factory=list)
    member_ids: list[str] = field(default_factory=list)
    amount: float = 0.0

    # Filled in by the ranker.
    priority: float = 0.0
    band: str = "low"
    scores: dict = field(default_factory=dict)
    reasons: list = field(default_factory=list)
    """Short, readable grounds for the priority: "4.9x normal", "3 layers agree"."""
    title: str = ""
    explanation: dict = field(default_factory=dict)

    @property
    def layers(self) -> set[str]:
        return {item.layer for item in self.evidence}

    @property
    def codes(self) -> list[str]:
        return sorted({item.code for item in self.evidence})


def _overlaps(case: Case, item: Evidence) -> bool:
    return item.period_start <= case.end + MERGE_GAP and case.start <= item.period_end + MERGE_GAP


def build_cases(evidence: list[Evidence]) -> list[Case]:
    """Group evidence into audit episodes, one entity at a time."""
    by_entity: dict[tuple[str, str], list[Evidence]] = {}
    for item in evidence:
        by_entity.setdefault((item.entity_type, item.entity_id), []).append(item)

    cases: list[Case] = []
    for (entity_type, entity_id), items in by_entity.items():
        items.sort(key=lambda entry: entry.period_start)
        open_cases: list[Case] = []

        for item in items:
            target = next((case for case in open_cases if _overlaps(case, item)), None)
            if target is None:
                target = Case(
                    entity_type=entity_type,
                    entity_id=entity_id,
                    start=item.period_start,
                    end=item.period_end,
                )
                open_cases.append(target)

            target.evidence.append(item)
            target.start = min(target.start, item.period_start)
            target.end = max(target.end, item.period_end)

        cases.extend(open_cases)

    for case in cases:
        # One transaction can be named by several detectors. It is one member.
        seen: set[str] = set()
        ordered: list[str] = []
        for item in case.evidence:
            for transaction_id in item.member_ids:
                if transaction_id not in seen:
                    seen.add(transaction_id)
                    ordered.append(transaction_id)
        case.member_ids = ordered
        # The largest single claim, not the sum: the same money is often counted by
        # more than one detector, and adding them would inflate every case.
        case.amount = max((item.amount for item in case.evidence), default=0.0)

    return cases
