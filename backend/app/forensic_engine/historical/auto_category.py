"""A category for every row, inferred, so five-year history has something to compare.

Category-level history is the most useful view a long scan has: "Fuel normally costs
eight lakh a month and cost thirty-one in July 2023" is a sentence a finance officer
acts on, where "account head `fac fuel exp.` is anomalous" is one they have to decode.

The problem is that approved categories arrive slowly. They come from the
categorization pipeline, where a suggestion is reviewed and approved one group at a
time, and on a fresh five-year upload almost nothing is approved yet. The scan would
report that category history cannot be examined - truthfully, and uselessly.

So this layer fills the gap, under three rules that keep it honest:

* **An approved category always wins.** This never overrides human judgement.
* **It is never written down.** The inferred value lives in the scan's DataFrame and
  dies with it. No table is touched, no `expense_category_id` is set, and the
  categorization pipeline behaves exactly as it did before.
* **It is never called approved.** Everything it produces is labelled inferred, and
  carries the confidence and the reason it was chosen, so a reviewer can see that a
  machine guessed and on what basis.

The result is a `historical_category` column the aggregate, change-point and
collective layers can group by, alongside the account head rather than instead of it.
"""

from __future__ import annotations

import re

import pandas as pd

# The source of a row's category, in descending order of authority.
SOURCE_APPROVED = "approved"
SOURCE_INFERRED = "inferred"
SOURCE_FALLBACK = "account_head"
SOURCE_NONE = "unclassified"

UNCLASSIFIED = "Unclassified"

# Category -> the words that identify it in an account head or narration. Ordered:
# the first category with a match wins, so the specific ones come before the general.
#
# These are the categories a Bangladeshi manufacturing ledger actually carries. They
# are deliberately coarse - the point is a baseline with enough rows behind it to be
# comparable month on month, not a perfect chart of accounts.
CATEGORY_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Fuel & Energy", ("fuel", "diesel", "petrol", "octane", "lubricant", "furnace oil", "gas bill", "lpg", "cng")),
    ("Utilities", ("electricity", "wasa", "water bill", "utility", "sewerage", "power bill", "demand charge")),
    ("Raw Material", ("raw material", "clinker", "gypsum", "fly ash", "slag", "cement", "limestone", "sand", "aggregate", "material purchase")),
    ("Spares & Consumables", ("spare", "consumable", "bearing", "belt", "lubricating", "tools", "hardware")),
    ("Repairs & Maintenance", ("repair", "maintenance", "maint", "overhaul", "servicing", "refurbish")),
    ("Construction & Civil Works", ("cwip", "civil work", "construction", "road", "shed", "foundation", "erection", "installation")),
    ("Logistics & Transport", ("carriage", "freight", "transport", "truck", "lighterage", "shipping", "cartage", "despatch", "delivery")),
    ("Labour & Wages", ("labour", "labor", "wages", "salary", "overtime", "bonus", "gratuity", "muster")),
    ("Security & Housekeeping", ("security", "guard", "housekeeping", "cleaning", "janitor")),
    ("Rent & Lease", ("rent", "lease", "tenancy", "hire charge")),
    ("Travel & Conveyance", ("travel", "conveyance", "fare", "ticket", "hotel", "lodging", "tada", "da bill")),
    ("IT & Communication", ("internet", "telephone", "mobile", "software", "license", "server", "hosting", "it ", "computer", "network")),
    ("Professional Services", ("audit", "consultanc", "legal", "professional", "advisor", "retainer", "valuation")),
    ("Insurance", ("insurance", "premium", "policy")),
    ("Taxes & Duties", ("vat", "tax", "duty", "customs", "tariff", "revenue stamp", "ait", "tds")),
    ("Bank & Finance Charges", ("bank charge", "interest", "commission", "lc ", "loan", "finance charge", "excise duty on account")),
    ("Marketing & Promotion", ("advertis", "promotion", "marketing", "branding", "publicity", "sponsor")),
    ("Office & Administration", ("stationery", "printing", "office", "postage", "courier", "entertainment", "refreshment", "subscription")),
    ("Welfare & Training", ("training", "welfare", "medical", "canteen", "uniform", "recreation")),
)

# Confidence attached to each way of arriving at a category. A keyword hit on the
# account head is stronger evidence than one found only in a narration, which varies
# line by line and is often a sentence about something else.
CONFIDENCE_HEAD = 0.80
CONFIDENCE_GROUP = 0.65
CONFIDENCE_DESCRIPTION = 0.45
MIN_CONFIDENCE = 0.50
"""Below this the guess is not used; the row keeps its account head instead. A wrong
category is worse than no category, because it puts two unrelated spending patterns
into one baseline and hides both."""


def _normalise(value: object) -> str:
    text = str(value or "").strip().lower()
    return re.sub(r"\s+", " ", text)


def _match(text: str) -> str | None:
    """The first category whose vocabulary appears in this text."""
    if not text:
        return None
    for category, keywords in CATEGORY_KEYWORDS:
        for keyword in keywords:
            if keyword in text:
                return category
    return None


def infer_one(account_head: str, account_group: str = "", description: str = "") -> tuple[str, float, str]:
    """Infer a category for a single row's text. Returns (category, confidence, reason).

    Exposed separately from the frame version so it can be tested, and read, on its own.
    """
    head = _normalise(account_head)
    category = _match(head)
    if category:
        return category, CONFIDENCE_HEAD, f"account head mentions '{category.split(' &')[0].lower()}'"

    group = _normalise(account_group)
    category = _match(group)
    if category:
        return category, CONFIDENCE_GROUP, f"account group mentions '{category.split(' &')[0].lower()}'"

    text = _normalise(description)
    category = _match(text)
    if category:
        return category, CONFIDENCE_DESCRIPTION, f"narration mentions '{category.split(' &')[0].lower()}'"

    return UNCLASSIFIED, 0.0, "no recognisable category vocabulary"


def attach_historical_categories(frame: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Add `historical_category` to the scan frame, and report how it was filled.

    Approved categories are carried through untouched. Rows without one get an
    inferred category where the evidence is strong enough, and fall back to their own
    account head where it is not, so those rows are still grouped with their like.

    Returns the frame and a diagnostics block naming exactly how many rows came from
    each source - which is what lets the UI say "inferred, not approved" honestly.
    """
    if frame.empty:
        return frame, {"rows": 0, "approved": 0, "inferred": 0, "fallback": 0, "unclassified": 0, "categories": {}}

    working = frame.copy()

    approved = (
        working["entity_expense_category"].astype(str).str.strip()
        if "entity_expense_category" in working.columns
        else pd.Series("", index=working.index)
    )
    heads = working["entity_account_head"] if "entity_account_head" in working.columns else pd.Series("", index=working.index)
    groups = working["entity_account_group"] if "entity_account_group" in working.columns else pd.Series("", index=working.index)
    descriptions = working["description"] if "description" in working.columns else pd.Series("", index=working.index)

    # A ledger has a few dozen distinct account heads and tens of thousands of rows, so
    # the inference runs once per distinct (head, group) pair.
    pairs = pd.Series(list(zip(heads.astype(str), groups.astype(str))), index=working.index)
    lookup: dict[tuple[str, str], tuple[str, float, str]] = {}
    for pair in pairs.unique():
        lookup[pair] = infer_one(pair[0], pair[1])

    categories: list[str] = []
    sources: list[str] = []
    confidences: list[float] = []
    reasons: list[str] = []

    for position, index in enumerate(working.index):
        approved_name = approved.iat[position]
        if approved_name:
            categories.append(approved_name)
            sources.append(SOURCE_APPROVED)
            confidences.append(1.0)
            reasons.append("approved by a reviewer")
            continue

        category, confidence, reason = lookup[pairs.iat[position]]
        if category == UNCLASSIFIED or confidence < MIN_CONFIDENCE:
            # The narration is per-row, so it is only consulted once the head and group
            # have both failed - and only to rescue a row, never to override them.
            category, confidence, reason = infer_one("", "", str(descriptions.iat[position] or ""))

        if category != UNCLASSIFIED and confidence >= MIN_CONFIDENCE:
            categories.append(category)
            sources.append(SOURCE_INFERRED)
            confidences.append(confidence)
            reasons.append(reason)
        else:
            head = str(heads.iat[position] or "").strip()
            if head:
                # Still groupable: the head is its own category of one.
                categories.append(head.title())
                sources.append(SOURCE_FALLBACK)
                confidences.append(0.0)
                reasons.append("no category vocabulary matched; grouped by account head")
            else:
                categories.append(UNCLASSIFIED)
                sources.append(SOURCE_NONE)
                confidences.append(0.0)
                reasons.append("no account head and no category vocabulary")

    working["historical_category"] = categories
    working["historical_category_source"] = sources
    working["historical_category_confidence"] = confidences
    working["historical_category_reason"] = reasons

    counts = pd.Series(sources).value_counts().to_dict()
    named = (
        working.loc[working["historical_category_source"].isin((SOURCE_APPROVED, SOURCE_INFERRED)), "historical_category"]
        .value_counts()
        .head(20)
        .to_dict()
    )

    diagnostics = {
        "rows": int(len(working)),
        "approved": int(counts.get(SOURCE_APPROVED, 0)),
        "inferred": int(counts.get(SOURCE_INFERRED, 0)),
        "fallback": int(counts.get(SOURCE_FALLBACK, 0)),
        "unclassified": int(counts.get(SOURCE_NONE, 0)),
        "distinct_categories": int(working["historical_category"].nunique()),
        "categories": {str(name): int(count) for name, count in named.items()},
        "note": (
            "Categories shown as inferred were derived from account-head vocabulary during this "
            "scan only. Nothing was written to the database and no approved category was changed."
        ),
    }
    return working, diagnostics
