from __future__ import annotations

import os
from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from app.models import Base

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - python-dotenv is included in requirements
    load_dotenv = None


if load_dotenv:
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")


DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite:///./finsight_dev.db",
)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    future=True,
    echo=os.getenv("SQL_ECHO", "False") == "True",
    connect_args=connect_args,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def sqlite_table_exists(conn, table_name: str) -> bool:
    return bool(
        conn.execute(
            text("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = :table_name"),
            {"table_name": table_name},
        ).fetchone()
    )


def prepare_sqlite_schema() -> None:
    if engine.dialect.name != "sqlite":
        return

    with engine.begin() as conn:
        legacy_user_exists = sqlite_table_exists(conn, "user")
        users_exists = sqlite_table_exists(conn, "users")

        if legacy_user_exists and not users_exists:
            conn.execute(text('ALTER TABLE "user" RENAME TO users'))
        elif legacy_user_exists and users_exists:
            users_count = conn.execute(text("SELECT COUNT(*) FROM users")).scalar() or 0
            legacy_users_count = conn.execute(text('SELECT COUNT(*) FROM "user"')).scalar() or 0
            if users_count == 0 and legacy_users_count > 0:
                conn.execute(
                    text(
                        """
                        INSERT OR IGNORE INTO users (
                            user_id,
                            username,
                            company_id,
                            email,
                            password_hash,
                            is_admin,
                            is_active,
                            last_login,
                            created_at,
                            updated_at
                        )
                        SELECT
                            user_id,
                            username,
                            company_id,
                            email,
                            password_hash,
                            is_admin,
                            is_active,
                            last_login,
                            created_at,
                            updated_at
                        FROM "user"
                        """
                    )
                )

            conflicting_indexes = conn.execute(
                text(
                    """
                    SELECT name
                    FROM sqlite_master
                    WHERE type = 'index'
                      AND name = 'idx_user_company_id'
                      AND tbl_name != 'users'
                    """
                )
            ).fetchall()
            for (index_name,) in conflicting_indexes:
                conn.execute(text(f'DROP INDEX "{index_name}"'))


def sync_postgres_schema() -> None:
    if not engine.dialect.name.startswith("postgresql"):
        return

    statements = [
        text('ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS company_id UUID'),
        text('ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ'),
        text('ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()'),
        text('ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()'),
        text('ALTER TABLE IF EXISTS department ADD COLUMN IF NOT EXISTS company_id UUID'),
        text('ALTER TABLE IF EXISTS company ADD COLUMN IF NOT EXISTS dept_id UUID'),
        text('ALTER TABLE IF EXISTS "group" ADD COLUMN IF NOT EXISTS representative_text TEXT'),
        text('ALTER TABLE IF EXISTS "group" ADD COLUMN IF NOT EXISTS embedding JSONB'),
        text('ALTER TABLE IF EXISTS "group" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()'),
        text('ALTER TABLE IF EXISTS upload_batch ADD COLUMN IF NOT EXISTS department_id UUID'),
        text('ALTER TABLE IF EXISTS upload_batch ADD COLUMN IF NOT EXISTS uploaded_by UUID'),
        text('ALTER TABLE IF EXISTS upload_batch ADD COLUMN IF NOT EXISTS row_count INTEGER NOT NULL DEFAULT 0'),
        text("ALTER TABLE IF EXISTS upload_batch ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'processing'"),
        text('ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS department_id UUID'),
        text("ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS transaction_type TEXT NOT NULL DEFAULT 'debit'"),
        text('ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS payment_method TEXT'),
        text('ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS invoice_id TEXT'),
        text('ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS voucher_number TEXT'),
        text('ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS account_head_group TEXT'),
        text('ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS voucher_type TEXT'),
        text('ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS po_number TEXT'),
        text('ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS has_receipt BOOLEAN NOT NULL DEFAULT FALSE'),
        text("ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending'"),
        text('ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS chart_acc_head TEXT'),
        text('ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS cleaned_chart_acc_head TEXT'),
        text('ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS group_no NUMERIC(10, 2)'),
        text('ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS group_name TEXT'),
        text('ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS semantic_confidence NUMERIC(10, 4)'),
        text('ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS risk_score NUMERIC(10, 4) NOT NULL DEFAULT 0'),
        text('ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN NOT NULL DEFAULT FALSE'),
        text('ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS flagged_reason TEXT'),
        text('ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS source_file_name TEXT'),
        text('ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS upload_batch_id UUID'),
        text('ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS dedupe_hash VARCHAR(128)'),
        text('ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()'),
        text('ALTER TABLE IF EXISTS transaction ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()'),
        text('ALTER TABLE IF EXISTS budget_forecast ADD COLUMN IF NOT EXISTS model_type TEXT'),
        text('ALTER TABLE IF EXISTS budget_forecast ADD COLUMN IF NOT EXISTS model_version TEXT'),
        text('ALTER TABLE IF EXISTS budget_forecast ADD COLUMN IF NOT EXISTS lower_bound NUMERIC(15, 2)'),
        text('ALTER TABLE IF EXISTS budget_forecast ADD COLUMN IF NOT EXISTS upper_bound NUMERIC(15, 2)'),
        text('ALTER TABLE IF EXISTS budget_forecast ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()'),
        text('ALTER TABLE IF EXISTS anomaly ADD COLUMN IF NOT EXISTS evidence_snapshot JSONB'),
        text('ALTER TABLE IF EXISTS anomaly ADD COLUMN IF NOT EXISTS is_resolved BOOLEAN NOT NULL DEFAULT FALSE'),
        text('ALTER TABLE IF EXISTS anomaly ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()'),
        text('ALTER TABLE IF EXISTS anomaly ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()'),
        text("UPDATE transaction SET transaction_type = 'debit' WHERE transaction_type IS NULL"),
    ]

    with engine.begin() as conn:
        for statement in statements:
            conn.execute(statement)


def sync_sqlite_schema() -> None:
    if engine.dialect.name != "sqlite":
        return

    table_columns = {
        "transaction": {
            "transaction_type": "TEXT NOT NULL DEFAULT 'debit'",
            "voucher_number": "TEXT",
            "account_head_group": "TEXT",
            "voucher_type": "TEXT",
        },
    }

    with engine.begin() as conn:
        for table_name, columns in table_columns.items():
            existing_columns = {
                row[1]
                for row in conn.execute(text(f'PRAGMA table_info("{table_name}")')).fetchall()
            }
            for column_name, definition in columns.items():
                if column_name not in existing_columns:
                    conn.execute(text(f'ALTER TABLE "{table_name}" ADD COLUMN {column_name} {definition}'))


def init_db() -> None:
    prepare_sqlite_schema()
    Base.metadata.create_all(bind=engine)
    sync_postgres_schema()
    sync_sqlite_schema()


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
