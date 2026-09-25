"""Which cases a reviewer should open first.

Deliberately a transparent weighted sum rather than the row engine's noisy-OR. The
row engine fuses opinions about one fact; this combines quantities that are not
the same kind of thing at all, and a formula somebody can read and argue with is
worth more here than a more elegant one nobody can check.

The output is a priority, not a probability. It says "look at this first", never
"this is fraud".
"""

from __future__ import annotations

import pandas as pd

from app.forensic_engine.historical.case_builder import Case
from app.forensic_engine.historical.materiality import (
    materiality_score,
    novelty_score,
    persistence_score,
)
from app.forensic_engine.historical.types import HistoricalConfig

BANDS = ((75.0, "critical"), (55.0, "high"), (35.0, "medium"))

# Which entity level a reviewer can act on most directly. A named account head is a
# line somebody owns and can be asked about; the group it rolls up into is an
# accounting convenience. When two cases score the same, the specific one goes first
# - and it is then the one that survives restatement dropping.
ENTITY_SPECIFICITY = {
    "account_head": 0,
    "expense_category": 1,
    "vendor": 2,
    "employee": 3,
    "approver": 4,
    "account_group": 5,
}

TITLES = {
    "regime_change": "spending regime shift",
    "spend_surge": "spend surge",
    "volume_surge": "surge in payment volume",
    "payment_burst": "clustered payments",
    "repeated_amount": "repeated identical amounts",
    "near_threshold_cluster": "payments just under an approval limit",
    "near_threshold_shift": "shift towards the approval limit",
    "weekend_shift": "shift to weekend posting",
    "round_number_shift": "shift to round amounts",
    "concentration_shift": "concentration in single payments",
    "large_payment_shift": "larger payments than usual",
    "transaction_alert": "individually flagged payments",
}


def _title(case: Case) -> str:
    """A sentence naming the two strongest things the case is about."""
    ranked = sorted(case.evidence, key=lambda item: item.strength, reverse=True)
    parts: list[str] = []
    for item in ranked:
        label = TITLES.get(item.code, item.code.replace("_", " "))
        if label not in parts:
            parts.append(label)
        if len(parts) == 2:
            break
    subject = case.entity_id if len(case.entity_id) <= 48 else f"{case.entity_id[:45]}…"
    return f"{subject}: {' + '.join(parts)}" if parts else subject


def _money(amount: float) -> str:
    """A figure a reader takes in at a glance, not to the paisa."""
    if amount >= 10_000_000:
        return f"Tk {amount / 10_000_000:.1f} crore"
    if amount >= 100_000:
        return f"Tk {amount / 100_000:.1f} lakh"
    if amount >= 1_000:
        return f"Tk {amount / 1_000:.0f}k"
    return f"Tk {amount:,.0f}"


def _reasons(
    case: Case,
    anomaly: float,
    layers: int,
    materiality: float,
    persistence: float,
    novelty: float,
    monthly_scale: float,
) -> list[dict]:
    """Why this case sits where it does, in four words at a time.

    A priority of 71 tells a reviewer nothing on its own. "Spend 4.9x normal",
    "3 independent layers agree", "6 months" and "Tk 80 lakh" tell them whether to
    open it, and they are the same numbers the score was computed from - not a
    separate story written alongside it.
    """
    out: list[dict] = []

    # The loudest thing a detector actually measured, quoted rather than paraphrased.
    strongest = max(case.evidence, key=lambda item: item.strength, default=None)
    if strongest is not None:
        multiple = strongest.detail.get("multiple")
        if multiple:
            out.append({
                "kind": "anomaly",
                "label": f"{multiple:.1f}x normal",
                "detail": f"The strongest signal on this case measured {multiple:.1f} times this entity's own usual level.",
            })
        else:
            out.append({
                "kind": "anomaly",
                "label": f"{anomaly * 100:.0f}/100 signal",
                "detail": "How strongly the detectors fired, combined, with the loudest counting most.",
            })

    if layers >= 2:
        out.append({
            "kind": "corroboration",
            "label": f"{layers} layers agree",
            "detail": (
                f"{layers} independent detectors reached this case by different routes. "
                "Agreement between methods is harder to produce by chance than one loud detector."
            ),
        })
    elif layers == 1:
        out.append({
            "kind": "corroboration",
            "label": "1 layer only",
            "detail": "Only one detector produced this case, so it ranks below cases several methods agree on.",
        })

    if case.amount > 0:
        share = case.amount / monthly_scale if monthly_scale else 0.0
        detail = f"{_money(case.amount)} of spending sits inside this case."
        if share >= 1:
            detail += f" That is about {share:.1f} months of this company's typical total spend."
        out.append({"kind": "materiality", "label": _money(case.amount), "detail": detail})

    days = max((case.end - case.start).days, 0)
    if days >= 28:
        months = days / 30.44
        out.append({
            "kind": "persistence",
            "label": f"{months:.0f} months" if months >= 1.5 else f"{days} days",
            "detail": f"The pattern held for {days} days. A one-off month is easier to explain away than a run.",
        })
    elif days > 0:
        out.append({
            "kind": "persistence",
            "label": f"{days} days",
            "detail": f"The pattern covers {days} days.",
        })

    if novelty >= 0.5:
        out.append({
            "kind": "novelty",
            "label": "new to the ledger",
            "detail": "This entity had no history before this case, so there is no long record to judge it against.",
        })

    out.append({
        "kind": "rows",
        "label": f"{len(case.member_ids):,} rows",
        "detail": f"{len(case.member_ids):,} transactions belong to this case and are listed underneath it.",
    })
    return out


def rank_cases(
    cases: list[Case],
    config: HistoricalConfig,
    monthly_scale: float,
    first_seen: dict[str, pd.Timestamp],
    ledger_start: pd.Timestamp | None,
    data_quality_confidence: float = 1.0,
) -> list[Case]:
    """Score every case and return them worst-first."""
    for case in cases:
        strengths = sorted((item.strength for item in case.evidence), reverse=True)
        anomaly = strengths[0] if strengths else 0.0
        # A second independent signal adds, but never as much as the first.
        for position, value in enumerate(strengths[1:4], start=1):
            anomaly += value * (0.35 / position)
        anomaly = min(anomaly, 1.0)

        layers = len(case.layers)
        corroboration = {0: 0.0, 1: 0.25, 2: 0.65, 3: 0.9}.get(layers, 1.0)

        materiality = materiality_score(case.amount, monthly_scale)
        persistence = persistence_score(pd.Timestamp(case.start), pd.Timestamp(case.end), config)
        novelty = novelty_score(case.entity_id, first_seen, pd.Timestamp(case.start), ledger_start) if ledger_start is not None else 0.0

        weights = config.weights
        raw = (
            weights["anomaly"] * anomaly
            + weights["corroboration"] * corroboration
            + weights["materiality"] * materiality
            + weights["persistence"] * persistence
            + weights["novelty"] * novelty
        )
        # Thin or dirty data should lower confidence in the ordering, not hide it.
        priority = round(100.0 * raw * max(0.5, min(1.0, data_quality_confidence)), 2)

        case.priority = priority
        case.reasons = _reasons(case, anomaly, layers, materiality, persistence, novelty, monthly_scale)
        case.scores = {
            "anomaly": round(anomaly, 3),
            "corroboration": round(corroboration, 3),
            "materiality": round(materiality, 3),
            "persistence": round(persistence, 3),
            "novelty": round(novelty, 3),
            "data_quality_confidence": round(data_quality_confidence, 3),
            "independent_layers": layers,
            "weights": dict(weights),
            # Carried inside the scores so they are stored and served with the case,
            # rather than recomputed differently by whatever reads it next.
            "reasons": case.reasons,
        }
        case.band = next((name for floor, name in BANDS if priority >= floor), "low")
        case.title = _title(case)

    cases.sort(
        key=lambda case: (
            -case.priority,
            ENTITY_SPECIFICITY.get(case.entity_type, 9),
            case.start,
            case.entity_id,
        )
    )
    return cases


def drop_restatements(cases: list[Case], config: HistoricalConfig) -> tuple[list[Case], int]:
    """Remove cases that are a higher-ranked case's rows under a different label.

    An account head and the group it sits in are the same money seen at two levels.
    When a group has one head misbehaving, both produce a case over the same rows,
    and a reviewer who clears one still has the other in the queue with identical
    figures. The more specific, better corroborated case is the one that ranks
    higher, so it is kept and the restatement is dropped.

    Cases must already be sorted worst-first.
    """
    kept: list[Case] = []
    kept_members: list[set[str]] = []
    dropped = 0

    for case in cases:
        members = set(case.member_ids)
        if members:
            covered = any(
                len(members & seen) / len(members) >= config.restatement_overlap
                for seen in kept_members
            )
            if covered:
                dropped += 1
                continue
        kept.append(case)
        kept_members.append(members)
        if len(kept) >= config.max_cases:
            break

    return kept, dropped
