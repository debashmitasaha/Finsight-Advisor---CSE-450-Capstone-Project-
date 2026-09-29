from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
import math
import re
from typing import Iterable

from sqlalchemy.orm import Session

from app.models import Transaction


NECESSARY_SCORE_THRESHOLD = 0.70
UNNECESSARY_SCORE_THRESHOLD = 0.30
MINIMUM_CLASSIFICATION_CONFIDENCE = 0.65
SCORING_VERSION = "deterministic_group_v1"
REVIEWED_CATEGORIES = {"necessary", "unnecessary"}

_TOKEN_PATTERN = re.compile(r"[a-z0-9]+")
_STOP_WORDS = {
    "a",
    "an",
    "and",
    "at",
    "by",
    "for",
    "from",
    "in",
    "of",
    "on",
    "the",
    "to",
    "with",
}


def _round_probability(value: float) -> float:
    return round(min(1.0, max(0.0, value)), 4)


def _normalize_text(value: str | None) -> str:
    return " ".join(_TOKEN_PATTERN.findall(str(value or "").lower()))


def _tokens(value: str | None) -> set[str]:
    return {
        token
        for token in _TOKEN_PATTERN.findall(str(value or "").lower())
        if token not in _STOP_WORDS
    }


def _same_text(left: str | None, right: str | None) -> float | None:
    left_value = _normalize_text(left)
    right_value = _normalize_text(right)
    if not left_value or not right_value:
        return None
    return 1.0 if left_value == right_value else 0.0


def _description_similarity(left: str | None, right: str | None) -> float | None:
    left_tokens = _tokens(left)
    right_tokens = _tokens(right)
    if not left_tokens or not right_tokens:
        return None
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


def _amount_similarity(left: object, right: object) -> float:
    left_amount = abs(float(left or 0))
    right_amount = abs(float(right or 0))
    # Log distance treats 100 vs 200 like 1,000 vs 2,000 and avoids a large
    # ledger value dominating every other raw-field comparison.
    distance = abs(math.log((left_amount + 1.0) / (right_amount + 1.0)))
    return math.exp(-distance)


def _date_pattern_similarity(left: datetime, right: datetime) -> float:
    # A deterministic recurrence hint: payments occurring on nearby days of a
    # month are more alike than payments at opposite ends of a month.
    day_distance = min(abs(left.day - right.day), 31 - abs(left.day - right.day))
    return max(0.0, 1.0 - day_distance / 15.0)


def transaction_similarity(candidate: Transaction, reviewed: Transaction) -> tuple[float, list[str]]:
    """Compare raw transaction fields without embeddings, ML, or expense categories."""
    signals: list[tuple[str, float, float | None]] = [
        ("description", 0.35, _description_similarity(candidate.description, reviewed.description)),
        ("chart_account_head", 0.20, _same_text(candidate.cleaned_chart_acc_head or candidate.chart_acc_head, reviewed.cleaned_chart_acc_head or reviewed.chart_acc_head)),
        ("account_head_group", 0.10, _same_text(candidate.account_head_group, reviewed.account_head_group)),
        ("voucher_type", 0.07, _same_text(candidate.voucher_type, reviewed.voucher_type)),
        ("payment_method", 0.05, _same_text(candidate.payment_method, reviewed.payment_method)),
        ("transaction_type", 0.05, _same_text(candidate.transaction_type, reviewed.transaction_type)),
        ("amount", 0.13, _amount_similarity(candidate.amount, reviewed.amount)),
        ("date_pattern", 0.05, _date_pattern_similarity(candidate.transaction_date, reviewed.transaction_date)),
    ]

    available_weight = sum(weight for _, weight, value in signals if value is not None)
    if not available_weight:
        return 0.0, []

    weighted_score = sum(weight * float(value) for _, weight, value in signals if value is not None)
    matched = [
        name
        for name, _, value in signals
        if value is not None and value >= (0.5 if name == "description" else 0.75)
    ]
    return _round_probability(weighted_score / available_weight), matched


def _group_key(transaction: Transaction) -> tuple[str, object] | None:
    if transaction.group_no is not None:
        return ("group_no", float(transaction.group_no))
    return None


def is_review_anchor(transaction: Transaction) -> bool:
    return bool(
        transaction.necessity_locked
        and transaction.necessity_source == "admin_override"
        and transaction.category in REVIEWED_CATEGORIES
    )


def _set_unreviewed(transaction: Transaction, summary: str) -> None:
    transaction.necessity_score = 0.5
    transaction.necessity_confidence = 0.0
    transaction.necessity_source = "unreviewed"
    transaction.necessity_reason = {
        "version": SCORING_VERSION,
        "summary": summary,
        "reviewed_count": 0,
    }
    transaction.category = "uncategorized"


def _label_value(transaction: Transaction) -> float:
    return 1.0 if transaction.category == "necessary" else 0.0


def _score_group(transactions: list[Transaction]) -> None:
    anchors = [transaction for transaction in transactions if is_review_anchor(transaction)]
    unlocked = [transaction for transaction in transactions if not transaction.necessity_locked]
    if not unlocked:
        return
    if not anchors:
        for transaction in unlocked:
            _set_unreviewed(transaction, "No manually reviewed transactions are available in this group.")
        return

    necessary_count = sum(1 for transaction in anchors if transaction.category == "necessary")
    reviewed_count = len(anchors)
    unnecessary_count = reviewed_count - necessary_count
    reviewed_ratio = necessary_count / reviewed_count
    # Beta(1, 1) smoothing keeps a tiny review sample from producing a 0 or 1
    # baseline. The locked review rows themselves retain their exact manual score.
    group_baseline = (necessary_count + 1.0) / (reviewed_count + 2.0)
    agreement = abs(reviewed_ratio - 0.5) * 2.0
    sample_strength = reviewed_count / (reviewed_count + 4.0)

    for transaction in unlocked:
        comparisons = []
        matched_fields: set[str] = set()
        for anchor in anchors:
            similarity, matched = transaction_similarity(transaction, anchor)
            comparisons.append((anchor, similarity))
            matched_fields.update(matched)

        similarity_weight = sum(similarity for _, similarity in comparisons)
        if similarity_weight > 0:
            similarity_label = sum(
                _label_value(anchor) * similarity
                for anchor, similarity in comparisons
            ) / similarity_weight
            average_similarity = similarity_weight / reviewed_count
        else:
            similarity_label = group_baseline
            average_similarity = 0.0

        # Similarity can refine a reviewed group baseline, but never outweigh
        # it. This prevents one superficially similar row from becoming a rule.
        similarity_blend = min(0.45, average_similarity * 0.45)
        score = group_baseline * (1.0 - similarity_blend) + similarity_label * similarity_blend
        confidence = (
            sample_strength
            * (0.65 + 0.35 * agreement)
            * (0.75 + 0.25 * average_similarity)
        )
        score = _round_probability(score)
        confidence = _round_probability(confidence)

        if confidence >= MINIMUM_CLASSIFICATION_CONFIDENCE and score >= NECESSARY_SCORE_THRESHOLD:
            category = "necessary"
        elif confidence >= MINIMUM_CLASSIFICATION_CONFIDENCE and score <= UNNECESSARY_SCORE_THRESHOLD:
            category = "unnecessary"
        else:
            category = "uncategorized"

        transaction.necessity_score = score
        transaction.necessity_confidence = confidence
        uses_similarity = average_similarity >= 0.35
        transaction.necessity_source = "combined_evidence" if uses_similarity else "group_consensus"
        transaction.necessity_reason = {
            "version": SCORING_VERSION,
            "summary": (
                "Calculated from locked admin reviews in this group and deterministic raw-field similarity."
                if uses_similarity
                else "Calculated from locked admin reviews in this group."
            ),
            "reviewed_count": reviewed_count,
            "necessary_count": necessary_count,
            "unnecessary_count": unnecessary_count,
            "group_baseline": _round_probability(group_baseline),
            "similarity_score": _round_probability(average_similarity),
            "matched_fields": sorted(matched_fields),
            "classification_thresholds": {
                "necessary_at_or_above": NECESSARY_SCORE_THRESHOLD,
                "unnecessary_at_or_below": UNNECESSARY_SCORE_THRESHOLD,
                "minimum_confidence": MINIMUM_CLASSIFICATION_CONFIDENCE,
            },
        }
        transaction.category = category


def recalculate_transactions(transactions: Iterable[Transaction]) -> dict[str, int]:
    rows = list(transactions)
    groups: dict[tuple[str, object], list[Transaction]] = defaultdict(list)
    for transaction in rows:
        key = _group_key(transaction)
        if key is None:
            if not transaction.necessity_locked:
                _set_unreviewed(transaction, "This transaction has not been grouped.")
            continue
        groups[key].append(transaction)

    for group_transactions in groups.values():
        _score_group(group_transactions)

    return {
        "categorized_count": len(rows),
        "necessary_count": sum(1 for transaction in rows if transaction.category == "necessary"),
        "unnecessary_count": sum(1 for transaction in rows if transaction.category == "unnecessary"),
        "uncategorized_count": sum(1 for transaction in rows if transaction.category not in REVIEWED_CATEGORIES),
        "locked_review_count": sum(1 for transaction in rows if is_review_anchor(transaction)),
    }


def recalculate_department(db: Session, department_id: str) -> dict[str, int]:
    transactions = (
        db.query(Transaction)
        .filter(Transaction.department_id == department_id)
        .order_by(Transaction.transaction_date.asc())
        .all()
    )
    return recalculate_transactions(transactions)


def set_manual_review(transaction: Transaction, category: str, reviewer_id: str) -> None:
    if category not in REVIEWED_CATEGORIES:
        raise ValueError("A manual review must be necessary or unnecessary")
    transaction.category = category
    transaction.necessity_score = 1.0 if category == "necessary" else 0.0
    transaction.necessity_confidence = 1.0
    transaction.necessity_source = "admin_override"
    transaction.necessity_reason = {
        "version": SCORING_VERSION,
        "summary": f"Manually reviewed as {category}.",
    }
    transaction.necessity_locked = True
    transaction.necessity_reviewed_by = reviewer_id
    transaction.necessity_reviewed_at = datetime.now(timezone.utc)


def clear_manual_review(transaction: Transaction) -> None:
    transaction.necessity_locked = False
    transaction.necessity_reviewed_by = None
    transaction.necessity_reviewed_at = None
    _set_unreviewed(transaction, "Manual review cleared; awaiting recalculation.")
