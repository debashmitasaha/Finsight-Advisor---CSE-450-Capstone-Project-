"""Turn a company's raw ledger rows into one analysis frame, and say what is wrong with it.

The data-quality gate is not a formality. A five-year scan that finds little
because a third of the rows carry no amount looks exactly like a five-year scan of
a clean company, unless the difference is stated. Nothing is dropped silently:
every exclusion is counted and reported.
"""

from __future__ import annotations

import pandas as pd

from app.forensic_engine.features import build_frame


def canonicalize(transactions: list) -> tuple[pd.DataFrame, dict]:
    """Build the scan frame and its data-quality report.

    Returns the spending frame (debits only) and diagnostics describing everything
    that was set aside on the way there.
    """
    raw = build_frame(transactions)
    if raw.empty:
        return raw, {
            "rows_in_ledger": 0,
            "rows_scanned": 0,
            "reason": "no transactions in the requested window",
            "warnings": ["The company has no transactions in this date range."],
        }

    warnings: list[str] = []
    rows_total = int(len(raw))

    # Receipts belong in the ledger but they are not disbursements. Scoring them
    # would report a large customer payment as suspicious spending.
    credit_rows = 0
    frame = raw
    if "transaction_type" in raw.columns:
        spending = raw[raw["transaction_type"].str.lower() != "credit"]
        credit_rows = rows_total - int(len(spending))
        if not spending.empty:
            frame = spending.reset_index(drop=True)

    zero_rows = int((frame["amount"] <= 0).sum())
    if zero_rows:
        share = zero_rows / max(len(frame), 1)
        if share > 0.05:
            warnings.append(
                f"{share:.0%} of scanned rows carry no positive amount. They cannot contribute to any "
                "spend statistic. If the source file has a separate Credit column, it is not being ingested."
            )

    working = frame[frame["amount"] > 0].reset_index(drop=True)

    span_start = working["transaction_date"].min()
    span_end = working["transaction_date"].max()
    span_days = int((span_end - span_start).days) if len(working) else 0
    months = working["month"].nunique() if len(working) else 0

    if months < 12:
        warnings.append(
            f"The ledger covers {months} month(s). Seasonal comparison needs at least a couple of years "
            "before December can be judged against other Decembers."
        )

    # A voucher reference is what lets related lines be recognised as one posting.
    voucher_share = 0.0
    if "invoice_id" in working.columns and len(working):
        voucher_share = float((working["invoice_id"].astype(str).str.len() > 0).mean())
    if voucher_share < 0.5:
        warnings.append(
            f"Only {voucher_share:.0%} of rows carry a voucher reference, so lines belonging to one posting "
            "cannot reliably be grouped."
        )

    category_share = 0.0
    if "entity_expense_category" in working.columns and len(working):
        category_share = float((working["entity_expense_category"].astype(str).str.len() > 0).mean())
    if category_share == 0:
        warnings.append(
            "No expense category has been approved by a reviewer yet, so category-level history is built "
            "from categories this scan inferred from the account heads. They are a reasonable grouping, not "
            "an approved one; working through the approval queue replaces them with human judgement."
        )

    duplicates = 0
    if len(working):
        keys = ["transaction_date", "amount", "entity_account_head", "invoice_id"]
        available = [key for key in keys if key in working.columns]
        duplicates = int(working.duplicated(subset=available).sum())
    if duplicates:
        warnings.append(
            f"{duplicates} row(s) repeat the same date, amount, account head and voucher. That may be a "
            "genuine duplicate payment or a double import; the scan reports them either way."
        )

    diagnostics = {
        "rows_in_ledger": rows_total,
        "rows_scanned": int(len(working)),
        "credit_rows_excluded": credit_rows,
        "zero_or_negative_excluded": zero_rows,
        "exact_duplicate_rows": duplicates,
        "date_from": span_start.date().isoformat() if len(working) else None,
        "date_to": span_end.date().isoformat() if len(working) else None,
        "span_days": span_days,
        "months_covered": int(months),
        "distinct_account_heads": int(working["entity_account_head"].nunique()) if len(working) else 0,
        "voucher_coverage": round(voucher_share, 3),
        "expense_category_coverage": round(category_share, 3),
        "warnings": warnings,
    }
    return working, diagnostics
