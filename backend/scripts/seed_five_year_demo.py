"""Build a five-year demo ledger so the historical scan has something to find.

The development database holds a few days of one month, which is the right size for
testing the row-level engine and far too small for the historical one: with no
history to compare against, the scan correctly reports that it cannot judge anything.
This script produces the ledger the historical scan was built for.

It never touches your own database. It copies it - so the company, departments and
logins all come across - and seeds the five years into the copy. Point the backend at
the copy to explore, and at your real database to go back to normal.

    cd backend
    .\\venv\\Scripts\\python.exe scripts\\seed_five_year_demo.py

Then run the backend against the copy:

    $env:DATABASE_URL = "sqlite:///./finsight_demo5y.db"
    .\\venv\\Scripts\\python.exe -m uvicorn app.main:app --port 8010

What gets seeded: sixty months of spending across ten account heads, with ordinary
year-on-year growth, a seasonal lift every fourth quarter, and the round-number habits
real ledgers have. Into that, one planted episode - months of raised spending on a
single head, paid partly in repeated amounts that sit just under an approval limit.
Nothing tells the scanner where it is. Finding it is the test.
"""

from __future__ import annotations

import argparse
import random
import shutil
import sqlite3
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent

# name, group, payments per month, mean amount, spread
HEADS = [
    ("fuel and lubricant", "group_fuel", 55, 6_500, 2_400),
    ("raw material purchase", "group_material", 120, 22_000, 9_000),
    ("factory repair and maintenance", "group_repair", 40, 9_800, 4_100),
    ("transport and carriage", "group_logistics", 35, 5_200, 1_900),
    ("electricity and utility", "group_utility", 12, 31_000, 5_500),
    ("office stationery", "group_admin", 18, 1_400, 600),
    ("security service charge", "group_admin", 8, 12_500, 1_200),
    ("labour bill payment", "group_labour", 46, 7_300, 3_000),
    ("spare parts purchase", "group_material", 28, 15_400, 7_200),
    ("travel and conveyance", "group_admin", 22, 3_100, 1_500),
]
METHODS = ["Payment[Cash]", "Payment[Bank]", "Journal", "Payment[Cheque]"]

PLANTED_HEAD = "fuel and lubricant"
PLANTED_FROM = (2023, 7)
PLANTED_TO = (2023, 12)
APPROVAL_LIMIT = 50_000
SPLIT_AMOUNT = 48_000       # just under the limit, paid over and over
SPLITS_PER_MONTH = 14


def month_days(year: int, month: int) -> int:
    start = datetime(year, month, 1)
    nxt = datetime(year + (month == 12), month % 12 + 1, 1)
    return (nxt - start).days


def build_rows(dept_id: str, batch_id: str, first_year: int, years: int, rng: random.Random):
    """Every transaction row, ordinary spending and the planted episode together."""
    rows = []
    seq = 0
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def add(date, amount, head, group, method, receipt, description):
        nonlocal seq
        seq += 1
        rows.append((
            str(uuid.uuid4()), date.strftime("%Y-%m-%d %H:%M:%S.%f"), round(float(amount), 2), "debit",
            description, "uncategorized", dept_id,
            method, f"CPV{date:%y%m}{seq:05d}", f"CPV{date:%y%m}{seq:05d}",
            f"{group}:DO/{date.year}/{date.month:02d}", method, f"BD-{rng.randint(100, 999)}",
            receipt, "approved", head.title(), head,
            None, group, None, None, 0, 0, None,
            "operations_ledger_five_years.xlsx", batch_id, None, stamp, stamp,
        ))

    for year in range(first_year, first_year + years):
        for month in range(1, 13):
            start = datetime(year, month, 1)
            days = month_days(year, month)
            elapsed = (year - first_year) * 12 + month

            for head, group, base_count, mean, spread in HEADS:
                # A company that grows a little every year, and runs hot in Q4.
                count = max(1, int(rng.gauss(base_count * (1 + 0.012 * elapsed), base_count * 0.12)))
                amount_mean = float(mean)
                if month in (10, 11, 12):
                    count = int(count * 1.35)
                    amount_mean *= 1.15

                planted = head == PLANTED_HEAD and PLANTED_FROM <= (year, month) <= PLANTED_TO
                if planted:
                    count = int(count * 1.6)
                    amount_mean *= 2.2

                for _ in range(count):
                    day = rng.randint(1, days)
                    date = start + timedelta(days=day - 1, hours=rng.randint(9, 17))
                    amount = max(120.0, rng.lognormvariate(0, 0.45) * amount_mean + rng.gauss(0, spread * 0.3))
                    # Real ledgers round a fair share of their payments.
                    if rng.random() < 0.18:
                        amount = round(amount / 500) * 500 or 500
                    add(date, amount, head, group, rng.choice(METHODS),
                        1 if rng.random() < 0.82 else 0,
                        f"{head.title()} settlement for {date:%B %Y}")

                # The episode also splits payments to stay under the approval limit.
                if planted:
                    for _ in range(SPLITS_PER_MONTH):
                        day = rng.randint(2, min(days, 20))
                        date = start + timedelta(days=day - 1, hours=11)
                        add(date, SPLIT_AMOUNT, head, group, "Payment[Cash]", 0,
                            f"{head.title()} advance settlement for {date:%B %Y}")

    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed a five-year demo ledger into a copy of your database.")
    parser.add_argument("--source", default=str(BACKEND / "finsight_dev.db"),
                        help="the database to copy (default: finsight_dev.db)")
    parser.add_argument("--out", default=str(BACKEND / "finsight_demo5y.db"),
                        help="the copy to write (default: finsight_demo5y.db)")
    parser.add_argument("--department", default="Operations",
                        help="which department receives the ledger (default: Operations)")
    parser.add_argument("--years", type=int, default=5, help="how many years to generate (default: 5)")
    parser.add_argument("--first-year", type=int, default=2020, help="the first year (default: 2020)")
    parser.add_argument("--seed", type=int, default=96, help="random seed, so runs repeat (default: 96)")
    parser.add_argument("--clean", action="store_true", help="also clear ordinary demo data other scripts left")
    args = parser.parse_args()

    source, out = Path(args.source), Path(args.out)
    if not source.exists():
        print(f"Cannot find {source}. Run the backend once so the database exists.", file=sys.stderr)
        return 1
    if source.resolve() == out.resolve():
        print("The copy would overwrite the source. Choose a different --out.", file=sys.stderr)
        return 1

    shutil.copyfile(source, out)
    db = sqlite3.connect(out)

    row = db.execute("select department_id from department where department_name = ?", (args.department,)).fetchone()
    if row is None:
        names = [r[0] for r in db.execute("select department_name from department")]
        print(f"No department called {args.department!r}. This database has: {', '.join(names) or '(none)'}", file=sys.stderr)
        return 1
    dept_id = row[0]

    db.execute('delete from "transaction" where department_id = ?', (dept_id,))
    if args.clean:
        db.execute("delete from upload_batch where department_id = ?", (dept_id,))
    # Old scan output describes a ledger that is about to be replaced.
    for table in ("anomaly_case_member", "anomaly_case", "historical_scan_run"):
        try:
            db.execute(f"delete from {table}")
        except sqlite3.OperationalError:
            pass  # the table only exists once the new backend has started

    rng = random.Random(args.seed)
    batch_id = str(uuid.uuid4())
    rows = build_rows(dept_id, batch_id, args.first_year, args.years, rng)

    db.execute(
        "insert or replace into upload_batch"
        " (upload_batch_id, department_id, source_file_name, uploaded_at, row_count, status)"
        " values (?,?,?,?,?,?)",
        (batch_id, dept_id, "operations_ledger_five_years.xlsx",
         datetime.now().strftime("%Y-%m-%d %H:%M:%S"), len(rows), "processed"),
    )
    columns = [r[1] for r in db.execute('PRAGMA table_info("transaction")')]
    placeholders = ",".join("?" * len(columns))
    quoted = ",".join(f'"{c}"' for c in columns)
    db.executemany(f'insert into "transaction" ({quoted}) values ({placeholders})', rows)
    db.commit()

    span = db.execute('select min(transaction_date), max(transaction_date) from "transaction"'
                      ' where department_id = ?', (dept_id,)).fetchone()
    planted = sum(1 for r in rows if r[2] == float(SPLIT_AMOUNT))

    print(f"Wrote {out.name}: {len(rows):,} transactions for {args.department}")
    print(f"  covering {span[0][:10]} to {span[1][:10]}  ({args.years * 12} months, {len(HEADS)} account heads)")
    print(f"  planted episode: {PLANTED_HEAD}, {PLANTED_FROM[1]}/{PLANTED_FROM[0]} to {PLANTED_TO[1]}/{PLANTED_TO[0]},"
          f" including {planted} payments of {SPLIT_AMOUNT:,} under the {APPROVAL_LIMIT:,} limit")
    print()
    print("Run the backend against it:")
    print(f'  $env:DATABASE_URL = "sqlite:///./{out.name}"')
    print("  .\\venv\\Scripts\\python.exe -m uvicorn app.main:app --port 8010")
    print()
    print("Then: Forensics -> Intelligence Engine -> 5-year scan -> Run the scan.")
    print("Your own database is untouched. Close that terminal, or clear DATABASE_URL, to go back to it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
