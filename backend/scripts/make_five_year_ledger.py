"""Write a five-year demo ledger as a spreadsheet you can upload through the app.

This produces the same nine columns the real factory export uses, so it travels the
ordinary path: Dept Control -> upload -> grouping -> categorisation -> forensics. It
is the file to use for a live demonstration, where the point is that the audience
watches the data arrive rather than finding it already in the database.

    cd backend
    .\\venv\\Scripts\\python.exe scripts\\make_five_year_ledger.py

What it contains: sixty months of spending across ten account heads, with ordinary
year-on-year growth, a seasonal lift every fourth quarter, and the round-number habits
real ledgers have. Credit rows are included, because a real export has them and the
engine has to set them aside on its own.

Hidden inside it is one episode - months of raised spending on a single head, paid
partly in repeated amounts that sit just under an approval limit. Nothing in the file
marks it. A companion answer key is written beside the ledger so you can check the
scan against the truth after the demonstration, not before.
"""

from __future__ import annotations

import argparse
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent.parent

# name, account head group, payments per month, mean amount, spread
HEADS = [
    ("Fuel & Lubricant", "Factory Utilities & Consumables", 55, 6_500, 2_400),
    ("Raw Material Purchase", "Direct Material Cost", 120, 22_000, 9_000),
    ("Repairs & Maint-Fac P&M", "Fac Repairs Maintenance", 40, 9_800, 4_100),
    ("Transport & Carriage Inward", "Logistics & Distribution", 35, 5_200, 1_900),
    ("Electricity & Utility Charges", "Factory Utilities & Consumables", 12, 31_000, 5_500),
    ("Printing & Stationery", "Administrative Overhead", 18, 1_400, 600),
    ("Security Service Charge", "Administrative Overhead", 8, 12_500, 1_200),
    ("Labour Bill Payment", "Factory Wages & Labour", 46, 7_300, 3_000),
    ("Spare Parts Purchase", "Direct Material Cost", 28, 15_400, 7_200),
    ("Travel & Conveyance", "Administrative Overhead", 22, 3_100, 1_500),
]

VOUCHER_TYPES = ["Payment[Cash]", "Payment[Bank]", "Journal", "Payment[Cheque]"]

NARRATIONS = {
    "Fuel & Lubricant": ["Diesel purchase for generator", "Lubricant purchase for plant machinery",
                         "Fuel bill settlement for delivery fleet", "Furnace oil purchase for boiler"],
    "Raw Material Purchase": ["Clinker purchase against PO", "Gypsum purchase for grinding unit",
                              "Fly ash purchase against supply order", "Slag purchase for blending"],
    "Repairs & Maint-Fac P&M": ["Repair of packing plant conveyor", "Maintenance of silo extraction system",
                                "Overhaul of mill gearbox", "Repair work of plant compressor"],
    "Transport & Carriage Inward": ["Carriage inward for raw material", "Truck hire charges for despatch",
                                    "Freight bill settlement", "Lighterage charge for jetty unloading"],
    "Electricity & Utility Charges": ["Electricity bill for factory premises", "Water supply charge for plant",
                                      "Gas bill settlement for factory"],
    "Printing & Stationery": ["Office stationery purchase", "Printing of despatch challan books",
                              "Purchase of toner and printing supplies"],
    "Security Service Charge": ["Security service bill for factory gate", "Guard deployment charge for plant"],
    "Labour Bill Payment": ["Labour bill payment for loading and unloading", "Casual labour wages for packing section",
                           "Labour bill for silo cleaning work", "Contract labour payment for shed repair"],
    "Spare Parts Purchase": ["Purchase of bearing and mechanical spares", "Purchase of electrical spares for plant",
                             "Purchase of conveyor belt spares"],
    "Travel & Conveyance": ["Conveyance reimbursement for site visit", "Travel bill for factory inspection",
                            "Local conveyance for material follow-up"],
}

CREDIT_NARRATIONS = [
    ("Customer Receipt", "Trade Receivables", "Collection against despatch invoice"),
    ("Customer Receipt", "Trade Receivables", "Advance received from dealer"),
    ("Bank Interest Received", "Other Income", "Interest credited on current account"),
    ("Scrap Sale Proceeds", "Other Income", "Sale proceeds of scrap material"),
]

# The episode. Nothing in the spreadsheet marks these rows.
PLANTED_HEAD = "Fuel & Lubricant"
PLANTED_FROM = (2023, 7)
PLANTED_TO = (2023, 12)
APPROVAL_LIMIT = 50_000
SPLIT_AMOUNT = 48_000
SPLITS_PER_MONTH = 14


def month_days(year: int, month: int) -> int:
    start = datetime(year, month, 1)
    nxt = datetime(year + (month == 12), month % 12 + 1, 1)
    return (nxt - start).days


def build(first_year: int, years: int, rng: random.Random) -> tuple[pd.DataFrame, dict]:
    rows: list[dict] = []
    planted_vouchers: list[str] = []
    counters: dict[str, int] = {}

    def voucher(date: datetime, prefix: str) -> str:
        key = f"{prefix}{date:%y%m}"
        counters[key] = counters.get(key, 0) + 1
        return f"{key}{counters[key]:05d}"

    for year in range(first_year, first_year + years):
        for month in range(1, 13):
            start = datetime(year, month, 1)
            days = month_days(year, month)
            elapsed = (year - first_year) * 12 + month

            for head, group, base_count, mean, spread in HEADS:
                count = max(1, int(rng.gauss(base_count * (1 + 0.012 * elapsed), base_count * 0.12)))
                amount_mean = float(mean)
                if month in (10, 11, 12):          # the plant runs hot in the last quarter
                    count = int(count * 1.35)
                    amount_mean *= 1.15

                planted = head == PLANTED_HEAD and PLANTED_FROM <= (year, month) <= PLANTED_TO
                if planted:
                    count = int(count * 1.6)
                    amount_mean *= 2.2

                for _ in range(count):
                    date = start + timedelta(days=rng.randint(1, days) - 1)
                    amount = max(120.0, rng.lognormvariate(0, 0.45) * amount_mean + rng.gauss(0, spread * 0.3))
                    if rng.random() < 0.18:
                        amount = round(amount / 500) * 500 or 500
                    kind = rng.choice(VOUCHER_TYPES)
                    rows.append({
                        "transaction_date": date.strftime("%Y-%m-%d"),
                        "voucher_number": voucher(date, "CPV"),
                        "ref_number": f"BD-{rng.randint(1000, 9999)}",
                        "narration": rng.choice(NARRATIONS[head]),
                        "chart_of_acc_head": head,
                        "account_head_group": group,
                        "Debit": round(amount, 2),
                        "Credit": 0.0,
                        "Voucher_Type": kind,
                    })

                if planted:
                    for _ in range(SPLITS_PER_MONTH):
                        date = start + timedelta(days=rng.randint(2, min(days, 20)) - 1)
                        number = voucher(date, "CPV")
                        planted_vouchers.append(number)
                        rows.append({
                            "transaction_date": date.strftime("%Y-%m-%d"),
                            "voucher_number": number,
                            "ref_number": f"BD-{rng.randint(1000, 9999)}",
                            "narration": "Advance settlement against fuel supply",
                            "chart_of_acc_head": PLANTED_HEAD,
                            "account_head_group": "Factory Utilities & Consumables",
                            "Debit": float(SPLIT_AMOUNT),
                            "Credit": 0.0,
                            "Voucher_Type": "Payment[Cash]",
                        })

            # Receipts. A real export carries them; the engine must exclude them itself.
            for _ in range(rng.randint(6, 12)):
                date = start + timedelta(days=rng.randint(1, days) - 1)
                head, group, text = rng.choice(CREDIT_NARRATIONS)
                rows.append({
                    "transaction_date": date.strftime("%Y-%m-%d"),
                    "voucher_number": voucher(date, "CRV"),
                    "ref_number": f"RC-{rng.randint(1000, 9999)}",
                    "narration": text,
                    "chart_of_acc_head": head,
                    "account_head_group": group,
                    "Debit": 0.0,
                    "Credit": round(rng.lognormvariate(0, 0.5) * 180_000, 2),
                    "Voucher_Type": "Receipt[Bank]",
                })

    frame = pd.DataFrame(rows).sort_values("transaction_date", kind="stable").reset_index(drop=True)

    debits = frame[frame["Debit"] > 0]
    answer = {
        "planted account head": PLANTED_HEAD,
        "planted months": f"{PLANTED_FROM[1]}/{PLANTED_FROM[0]} to {PLANTED_TO[1]}/{PLANTED_TO[0]}",
        "what was done": (
            "monthly spend on this head raised roughly 3.5x, paid across more and larger payments, "
            f"with {SPLITS_PER_MONTH} payments a month of exactly {SPLIT_AMOUNT:,} - just under the "
            f"{APPROVAL_LIMIT:,} approval limit"
        ),
        "rows belonging to the episode": int(
            len(debits[(debits["chart_of_acc_head"] == PLANTED_HEAD)
                       & (debits["transaction_date"] >= f"{PLANTED_FROM[0]}-{PLANTED_FROM[1]:02d}-01")
                       & (debits["transaction_date"] <= f"{PLANTED_TO[0]}-{PLANTED_TO[1]:02d}-31")])
        ),
        "split payments at the limit": len(planted_vouchers),
        "total rows in file": int(len(frame)),
        "debit rows": int(len(debits)),
        "credit rows": int(len(frame) - len(debits)),
        "date range": f"{frame['transaction_date'].min()} to {frame['transaction_date'].max()}",
        "what the scan should say": (
            "one high-priority case on this head, opening on the first planted month, "
            "corroborated by more than one independent layer"
        ),
    }
    return frame, answer


def main() -> int:
    parser = argparse.ArgumentParser(description="Write a five-year demo ledger in the app's upload format.")
    parser.add_argument("--out", default=str(ROOT / "docs" / "demo" / "FinSight_Operations_Ledger_2020_2024.xlsx"),
                        help="where to write the spreadsheet")
    parser.add_argument("--years", type=int, default=5)
    parser.add_argument("--first-year", type=int, default=2020)
    parser.add_argument("--seed", type=int, default=96, help="random seed, so the file repeats exactly")
    parser.add_argument("--csv", action="store_true", help="also write a .csv beside the .xlsx")
    args = parser.parse_args()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    frame, answer = build(args.first_year, args.years, random.Random(args.seed))
    frame.to_excel(out, index=False)
    if args.csv:
        frame.to_csv(out.with_suffix(".csv"), index=False)

    key = out.with_name(out.stem + "_ANSWER_KEY.txt")
    with key.open("w", encoding="utf-8") as handle:
        handle.write("FinSight demo ledger - answer key\n")
        handle.write("Do not open this before the demonstration.\n\n")
        for label, value in answer.items():
            handle.write(f"{label:32s} {value}\n")

    size_mb = out.stat().st_size / (1024 * 1024)
    print(f"Wrote {out}")
    print(f"  {len(frame):,} rows · {answer['debit rows']:,} debit · {answer['credit rows']:,} credit · {size_mb:.1f} MB")
    print(f"  {answer['date range']}, {len(HEADS)} account heads")
    if args.csv:
        print(f"Wrote {out.with_suffix('.csv')}")
    print(f"Wrote {key.name} - the answer key, for after the demonstration")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
