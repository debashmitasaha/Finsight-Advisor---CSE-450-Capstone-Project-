from __future__ import annotations

import random
from dataclasses import dataclass, field

import pandas as pd


@dataclass
class InjectedCase:
    scenario: str
    transaction_ids: list[str]
    description: str
    detail: dict = field(default_factory=dict)


@dataclass
class InjectionResult:
    frame: pd.DataFrame
    cases: list[InjectedCase]

    @property
    def planted_ids(self) -> set[str]:
        return {tid for case in self.cases for tid in case.transaction_ids}

    def summary(self) -> dict:
        by_scenario: dict[str, int] = {}
        for case in self.cases:
            by_scenario[case.scenario] = by_scenario.get(case.scenario, 0) + len(case.transaction_ids)
        return {
            "scenarios_planted": len(self.cases),
            "rows_planted": len(self.planted_ids),
            "by_scenario": by_scenario,
        }


# Scenarios are limited to fraud types this ledger's columns can actually express.
# Vendor collusion and employee-vendor bank matching are deliberately absent: without
# vendor, employee or bank-account columns, planting them would only test a detector
# against data the real pipeline never produces.
AVAILABLE_SCENARIOS: tuple[str, ...] = (
    "duplicate_payment",
    "split_purchase",
    "threshold_avoidance",
    "spending_spike",
    "round_number_abuse",
    "dormant_reactivation",
    "weekend_burst",
    "ghost_account_head",
)

UNSUPPORTED_SCENARIOS: dict[str, str] = {
    "vendor_collusion": "requires a vendor column",
    "employee_vendor_link": "requires employee and bank-account columns",
    "process_bypass": "requires PO / GRN / approval timestamps",
}


def resolve_approval_limit(frame: pd.DataFrame, explicit: float | None = None) -> float:
    """The control the planted schemes will evade.

    Fraud is committed against the organisation's real approval limit, so the planted
    scenarios must target the same figure the ledger is actually governed by. When the
    caller does not supply one, a limit is inferred from the data — but note this is the
    scheme's target, not a hint to the detector: the engine still has to work out which
    specific rows were steered, among the many legitimate payments in the same band.
    """
    if explicit and explicit > 0:
        return float(explicit)

    from app.forensic_engine.config import EngineConfig
    from app.forensic_engine.features import infer_approval_thresholds

    inferred = infer_approval_thresholds(frame, EngineConfig())
    if inferred:
        return float(min(inferred))

    positive = frame[frame["amount"] > 0]["amount"]
    if positive.empty:
        return 100_000.0
    magnitude = float(positive.quantile(0.90))
    step = 10 ** (len(str(int(max(magnitude, 1)))) - 1)
    return float(max(step, round(magnitude / step) * step))


def inject(
    frame: pd.DataFrame,
    scenarios: list[str] | None = None,
    seed: int = 1337,
    approval_limit: float | None = None,
) -> InjectionResult:
    """Plant known fraud into a clean ledger so detection can be measured.

    Real spend data carries no fraud labels, which is exactly the validation gap the 2025
    procurement-fraud review calls out. Planting cases whose ground truth we control turns
    "the engine flagged 40 rows" into a recall and precision figure that survives a viva.

    Every planted row is a *new* row appended to the ledger, never a mutation of a real
    one, so the untouched rows stay valid negatives.
    """
    rng = random.Random(seed)
    selected = list(scenarios) if scenarios else list(AVAILABLE_SCENARIOS)
    limit = resolve_approval_limit(frame, approval_limit)

    working = frame.copy()
    cases: list[InjectedCase] = []

    builders = {
        "duplicate_payment": _duplicate_payment,
        "split_purchase": _split_purchase,
        "threshold_avoidance": _threshold_avoidance,
        "spending_spike": _spending_spike,
        "round_number_abuse": _round_number_abuse,
        "dormant_reactivation": _dormant_reactivation,
        "weekend_burst": _weekend_burst,
        "ghost_account_head": _ghost_account_head,
    }

    for scenario in selected:
        builder = builders.get(scenario)
        if builder is None:
            continue
        working, case = builder(working, rng, limit)
        if case is not None:
            cases.append(case)

    working = working.sort_values("transaction_date").reset_index(drop=True)
    return InjectionResult(frame=working, cases=cases)


def _template(frame: pd.DataFrame, rng: random.Random, min_events: int = 5) -> pd.Series | None:
    """Pick a busy account head to imitate, so planted rows blend into real activity."""
    positive = frame[frame["amount"] > 0]
    if positive.empty:
        return None
    counts = positive["entity_account_head"].value_counts()
    eligible = counts[counts >= min_events]
    if eligible.empty:
        eligible = counts
    head = str(rng.choice(list(eligible.index)))
    candidates = positive[positive["entity_account_head"] == head]
    return candidates.iloc[rng.randrange(len(candidates))]


def _new_row(template: pd.Series, transaction_id: str, when: pd.Timestamp, amount: float, **overrides) -> dict:
    row = template.to_dict()
    row.update(
        {
            "transaction_id": transaction_id,
            "transaction_date": when,
            "amount": float(amount),
            "day": when.normalize(),
            "weekday": when.weekday(),
            "is_weekend": when.weekday() >= 5,
            "month": when.to_period("M").strftime("%Y-%m"),
            "days_in_month": when.days_in_month,
            "day_of_month": when.day,
            "is_month_end": (when.days_in_month - when.day) < 3,
        }
    )
    row.update(overrides)
    return row


def _append(frame: pd.DataFrame, rows: list[dict]) -> pd.DataFrame:
    return pd.concat([frame, pd.DataFrame(rows)], ignore_index=True)


def _duplicate_payment(frame: pd.DataFrame, rng: random.Random, limit: float):
    template = _template(frame, rng)
    if template is None:
        return frame, None

    when = template["transaction_date"] + pd.Timedelta(days=rng.randint(1, 5))
    tid = "INJ-DUP-001"
    row = _new_row(template, tid, when, float(template["amount"]), invoice_id=template["invoice_id"])
    return _append(frame, [row]), InjectedCase(
        scenario="duplicate_payment",
        transaction_ids=[tid],
        description=f"Re-posted {template['amount']:,.2f} to '{template['entity_account_head']}' under the same invoice reference",
        detail={"account_head": template["entity_account_head"], "amount": float(template["amount"])},
    )


def _split_purchase(frame: pd.DataFrame, rng: random.Random, limit: float):
    template = _template(frame, rng)
    if template is None:
        return frame, None

    parts = 4
    # Each slice must clear the limit on its own while the four together breach it - that
    # gap is the whole point of the scheme and what the rule view looks for.
    slice_amount = limit * 0.88
    start = template["transaction_date"] + pd.Timedelta(days=rng.randint(2, 20))

    rows, ids = [], []
    for index in range(parts):
        tid = f"INJ-SPLIT-{index + 1:03d}"
        ids.append(tid)
        rows.append(
            _new_row(
                template,
                tid,
                start + pd.Timedelta(days=index),
                round(slice_amount * rng.uniform(0.97, 1.03), 2),
                invoice_id=f"SPLIT-{index + 1:03d}",
            )
        )
    return _append(frame, rows), InjectedCase(
        scenario="split_purchase",
        transaction_ids=ids,
        description=f"{parts} near-equal payments to '{template['entity_account_head']}' inside 4 days, each just under {limit:,.0f} but {slice_amount * parts:,.0f} combined",
        detail={"parts": parts, "each_about": round(slice_amount, 2), "combined": round(slice_amount * parts, 2), "approval_limit": limit},
    )


def _threshold_avoidance(frame: pd.DataFrame, rng: random.Random, limit: float):
    template = _template(frame, rng)
    if template is None:
        return frame, None

    # Six rows rather than three: a habit of steering under a control is a pattern, and a
    # pattern is what makes it detectable. Two or three rows lost among the legitimate
    # payments already sitting in that band are genuinely not recoverable, and pretending
    # otherwise would flatter the evaluation.
    rows, ids = [], []
    for index in range(6):
        tid = f"INJ-THRESH-{index + 1:03d}"
        ids.append(tid)
        when = template["transaction_date"] + pd.Timedelta(days=rng.randint(5, 120))
        rows.append(_new_row(template, tid, when, round(limit * rng.uniform(0.955, 0.995), 2), invoice_id=f"THR-{index + 1:03d}"))
    return _append(frame, rows), InjectedCase(
        scenario="threshold_avoidance",
        transaction_ids=ids,
        description=f"6 payments landing 0.5-4.5% below a {limit:,.0f} approval limit",
        detail={"limit": limit, "rows": 6},
    )


def _spending_spike(frame: pd.DataFrame, rng: random.Random, limit: float):
    template = _template(frame, rng, min_events=6)
    if template is None:
        return frame, None

    head = template["entity_account_head"]
    median = float(frame[(frame["entity_account_head"] == head) & (frame["amount"] > 0)]["amount"].median())
    amount = median * rng.uniform(12, 25)
    when = template["transaction_date"] + pd.Timedelta(days=rng.randint(3, 30))
    tid = "INJ-SPIKE-001"
    return _append(frame, [_new_row(template, tid, when, amount, invoice_id="SPIKE-001")]), InjectedCase(
        scenario="spending_spike",
        transaction_ids=[tid],
        description=f"Single payment of {amount:,.2f} against a {median:,.2f} median for '{head}'",
        detail={"account_head": head, "entity_median": round(median, 2), "amount": round(amount, 2)},
    )


def _round_number_abuse(frame: pd.DataFrame, rng: random.Random, limit: float):
    template = _template(frame, rng)
    if template is None:
        return frame, None

    step = 10 ** (len(str(int(max(limit, 1)))) - 1)
    amount = float(max(step, round(limit * 0.8 / step) * step))
    rows, ids = [], []
    for index in range(2):
        tid = f"INJ-ROUND-{index + 1:03d}"
        ids.append(tid)
        when = template["transaction_date"] + pd.Timedelta(days=rng.randint(4, 45))
        rows.append(_new_row(template, tid, when, amount, invoice_id=f"RND-{index + 1:03d}"))
    return _append(frame, rows), InjectedCase(
        scenario="round_number_abuse",
        transaction_ids=ids,
        description=f"Perfectly round {amount:,.0f} payments to a head that normally invoices irregular amounts",
        detail={"amount": amount},
    )


def _dormant_reactivation(frame: pd.DataFrame, rng: random.Random, limit: float):
    positive = frame[frame["amount"] > 0]
    if positive.empty:
        return frame, None

    span = (positive["transaction_date"].max() - positive["transaction_date"].min()).days
    if span < 200:
        # Not enough calendar for dormancy to be meaningful.
        return frame, None

    counts = positive["entity_account_head"].value_counts()
    eligible = counts[counts >= 3]
    if eligible.empty:
        return frame, None

    head = str(rng.choice(list(eligible.index)))
    history = positive[positive["entity_account_head"] == head].sort_values("transaction_date")
    template = history.iloc[0]
    median = float(history["amount"].median())

    when = history["transaction_date"].iloc[0] + pd.Timedelta(days=rng.randint(150, max(151, span)))
    if when > positive["transaction_date"].max():
        when = positive["transaction_date"].max()

    tid = "INJ-DORMANT-001"
    amount = median * rng.uniform(4, 9)
    return _append(frame, [_new_row(template, tid, when, amount, invoice_id="DORM-001")]), InjectedCase(
        scenario="dormant_reactivation",
        transaction_ids=[tid],
        description=f"'{head}' reactivated after a long gap with {amount:,.2f} ({amount / median:.1f}x its median)",
        detail={"account_head": head, "amount": round(amount, 2), "entity_median": round(median, 2)},
    )


def _weekend_burst(frame: pd.DataFrame, rng: random.Random, limit: float):
    template = _template(frame, rng)
    if template is None:
        return frame, None

    positive = frame[frame["amount"] > 0]
    base = float(positive["amount"].quantile(0.88))

    saturday = template["transaction_date"]
    while saturday.weekday() != 5:
        saturday += pd.Timedelta(days=1)

    rows, ids = [], []
    for index in range(3):
        tid = f"INJ-WKND-{index + 1:03d}"
        ids.append(tid)
        rows.append(
            _new_row(
                template,
                tid,
                saturday + pd.Timedelta(days=index % 2),
                round(base * rng.uniform(0.9, 1.6), 2),
                invoice_id=f"WKND-{index + 1:03d}",
            )
        )
    return _append(frame, rows), InjectedCase(
        scenario="weekend_burst",
        transaction_ids=ids,
        description="3 large payments clustered on a weekend in an otherwise weekday ledger",
        detail={"weekend_start": str(saturday.date())},
    )


def _ghost_account_head(frame: pd.DataFrame, rng: random.Random, limit: float):
    template = _template(frame, rng)
    if template is None:
        return frame, None

    positive = frame[frame["amount"] > 0]
    amount = float(positive["amount"].quantile(0.97)) * rng.uniform(1.2, 2.0)
    start = positive["transaction_date"].min()
    latest = positive["transaction_date"].max()
    when = latest - pd.Timedelta(days=rng.randint(0, 20))
    if (when - start).days < 40:
        when = latest

    tid = "INJ-GHOST-001"
    row = _new_row(
        template,
        tid,
        when,
        amount,
        entity_account_head="consultancy retainer special",
        chart_acc_head="Consultancy Retainer (Special)",
        invoice_id="GHOST-001",
    )
    return _append(frame, [row]), InjectedCase(
        scenario="ghost_account_head",
        transaction_ids=[tid],
        description=f"Brand-new account head taking {amount:,.2f} on its first and only appearance",
        detail={"amount": round(amount, 2), "account_head": "consultancy retainer special"},
    )
