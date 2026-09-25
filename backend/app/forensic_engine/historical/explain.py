"""The packet a reviewer reads before deciding anything.

Every case has to answer the same six questions, in the same order, whichever
detectors produced it: what changed, compared with what, when it started, who it
affects, how many rows and how much money, and which independent layers agree.

Structured rather than prose, because the same object feeds the screen, the case
report and any future narrator, and all three must say the same thing.
"""

from __future__ import annotations

import pandas as pd

from app.forensic_engine.historical.case_builder import Case

LAYER_NAMES = {
    "aggregate": "period behaviour",
    "changepoint": "a dated change in level",
    "collective": "a group pattern",
    "transaction": "individual rows",
}


def explain(case: Case, frame: pd.DataFrame | None = None, top_rows: int = 5) -> dict:
    """Build the explanation packet for one case."""
    ordered = sorted(case.evidence, key=lambda item: item.strength, reverse=True)
    lead = ordered[0] if ordered else None

    baseline_line = None
    if lead and lead.detail.get("baseline_used"):
        baseline_line = (
            f"Compared with {lead.detail['baseline_used']} "
            f"({lead.detail.get('baseline_periods', 0)} period(s) of reference)."
        )
    elif lead and lead.code == "regime_change":
        baseline_line = "Compared with this entity's own level before the break."
    elif lead and lead.layer == "collective":
        baseline_line = "Compared with this entity's own rate of payment over the whole ledger."

    examples: list[dict] = []
    if frame is not None and not frame.empty and case.member_ids:
        members = frame[frame["transaction_id"].astype(str).isin(case.member_ids)]
        if not members.empty:
            for _, row in members.nlargest(top_rows, "amount").iterrows():
                examples.append(
                    {
                        "transaction_id": str(row["transaction_id"]),
                        "date": pd.Timestamp(row["transaction_date"]).date().isoformat(),
                        "amount": round(float(row["amount"]), 2),
                        "description": str(row.get("description") or ""),
                        "account_head": str(row.get("chart_acc_head") or ""),
                        "voucher": str(row.get("invoice_id") or ""),
                    }
                )

    return {
        "what_changed": lead.message if lead else "",
        "compared_with": baseline_line,
        "when_it_started": case.start.isoformat(),
        "when_it_ended": case.end.isoformat(),
        "who_it_affects": {"entity_type": case.entity_type, "entity_id": case.entity_id},
        "how_many_transactions": len(case.member_ids),
        "how_much": round(float(case.amount), 2),
        "which_layers_agree": sorted(LAYER_NAMES.get(layer, layer) for layer in case.layers),
        "evidence": [item.to_dict() for item in ordered],
        "strongest_examples": examples,
        "caveat": (
            "A case is a prioritised audit lead, not a finding of fraud. The ranking says where to look "
            "first; only a reviewer decides what it means."
        ),
    }
