"""Clear one department back to empty, so the same ledger can be uploaded again.

The app refuses a file it has already taken, which is right in normal use and a
nuisance when rehearsing a demonstration. This puts a department back to the state it
was in before the upload: no transactions, no batches, no groups, no scan output.

    cd backend
    .\\venv\\Scripts\\python.exe scripts\\reset_department.py --db finsight_demo5y.db

It asks before deleting anything unless --yes is given, and it names the database and
the row counts first, because the one thing worse than a failed demonstration is a
cleared production table.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent

# table -> the column that ties a row to a department, or None for rows keyed by
# transaction instead.
DEPARTMENT_TABLES = [
    ("anomaly", None),
    ("case_transaction", None),
    ("forensic_finding", None),
    ("forensic_review", None),
    ("transaction", "department_id"),
    ("upload_batch", "department_id"),
    ("group", "dept_id"),
    ("forensic_run", "dept_id"),
    ("budget_forecast", "dept_id"),
]

# Scan output describes a ledger that is about to disappear.
SCAN_TABLES = ["anomaly_case_member", "anomaly_case", "historical_scan_run"]


def table_exists(db: sqlite3.Connection, table: str) -> bool:
    return db.execute(
        "select 1 from sqlite_master where type='table' and name=?", (table,)
    ).fetchone() is not None


def column_exists(db: sqlite3.Connection, table: str, column: str) -> bool:
    return any(row[1] == column for row in db.execute(f'PRAGMA table_info("{table}")'))


def main() -> int:
    parser = argparse.ArgumentParser(description="Clear a department so its ledger can be uploaded again.")
    parser.add_argument("--db", default=str(BACKEND / "finsight_demo5y.db"),
                        help="the database to clear (default: finsight_demo5y.db)")
    parser.add_argument("--department", default="Operations", help="which department (default: Operations)")
    parser.add_argument("--yes", action="store_true", help="do not ask for confirmation")
    args = parser.parse_args()

    path = Path(args.db)
    if not path.is_absolute():
        path = BACKEND / path
    if not path.exists():
        print(f"No such database: {path}", file=sys.stderr)
        return 1

    db = sqlite3.connect(path)
    row = db.execute("select department_id from department where department_name = ?", (args.department,)).fetchone()
    if row is None:
        names = [r[0] for r in db.execute("select department_name from department")]
        print(f"No department called {args.department!r}. This database has: {', '.join(names) or '(none)'}", file=sys.stderr)
        return 1
    dept_id = row[0]

    transactions = db.execute('select count(*) from "transaction" where department_id = ?', (dept_id,)).fetchone()[0]
    batches = db.execute("select count(*) from upload_batch where department_id = ?", (dept_id,)).fetchone()[0]

    print(f"Database   {path}")
    print(f"Department {args.department}")
    print(f"About to delete {transactions:,} transactions and {batches} upload batch(es), with their groups and scan output.")
    if not args.yes:
        answer = input("Type 'clear' to go ahead: ").strip().lower()
        if answer != "clear":
            print("Nothing was deleted.")
            return 1

    transaction_ids = [r[0] for r in db.execute(
        'select transaction_id from "transaction" where department_id = ?', (dept_id,))]

    deleted: dict[str, int] = {}
    for table, column in DEPARTMENT_TABLES:
        if not table_exists(db, table):
            continue
        if column and column_exists(db, table, column):
            cursor = db.execute(f'delete from "{table}" where {column} = ?', (dept_id,))
        elif column_exists(db, table, "transaction_id") and transaction_ids:
            cursor = db.cursor()
            for start in range(0, len(transaction_ids), 500):
                chunk = transaction_ids[start:start + 500]
                cursor.execute(
                    f'delete from "{table}" where transaction_id in ({",".join("?" * len(chunk))})', chunk)
        else:
            continue
        if cursor.rowcount and cursor.rowcount > 0:
            deleted[table] = deleted.get(table, 0) + cursor.rowcount

    for table in SCAN_TABLES:
        if table_exists(db, table):
            cursor = db.execute(f"delete from {table}")
            if cursor.rowcount and cursor.rowcount > 0:
                deleted[table] = cursor.rowcount

    db.commit()
    db.execute("VACUUM")
    db.close()

    if deleted:
        for table, count in sorted(deleted.items()):
            print(f"  cleared {count:>7,} from {table}")
    else:
        print("  nothing to clear - the department was already empty")
    print(f"\n{args.department} is ready for the ledger to be uploaded again.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
