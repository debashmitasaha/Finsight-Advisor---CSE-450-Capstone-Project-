from __future__ import annotations

import os
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from app.models import Base


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
        text(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'department'
                ) AND EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'company'
                ) AND NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'department_company_id_fkey'
                ) THEN
                    ALTER TABLE department
                    ADD CONSTRAINT department_company_id_fkey
                    FOREIGN KEY (company_id) REFERENCES company(company_id) ON DELETE SET NULL;
                END IF;
            END
            $$;
            """
        ),
        text(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'upload_batch'
                ) AND EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'users'
                ) THEN
                    ALTER TABLE upload_batch DROP CONSTRAINT IF EXISTS upload_batch_uploaded_by_fkey;
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conname = 'upload_batch_uploaded_by_fkey'
                    ) THEN
                        ALTER TABLE upload_batch
                        ADD CONSTRAINT upload_batch_uploaded_by_fkey
                        FOREIGN KEY (uploaded_by) REFERENCES users(user_id) ON DELETE SET NULL;
                    END IF;
                END IF;
            END
            $$;
            """
        ),
        text(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'user_role'
                ) AND EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'users'
                ) THEN
                    ALTER TABLE user_role DROP CONSTRAINT IF EXISTS user_role_user_id_fkey;
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conname = 'user_role_user_id_fkey'
                    ) THEN
                        ALTER TABLE user_role
                        ADD CONSTRAINT user_role_user_id_fkey
                        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;
                    END IF;
                END IF;
            END
            $$;
            """
        ),
        text(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'notification_seen'
                ) AND EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'users'
                ) THEN
                    ALTER TABLE notification_seen DROP CONSTRAINT IF EXISTS notification_seen_user_id_fkey;
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conname = 'notification_seen_user_id_fkey'
                    ) THEN
                        ALTER TABLE notification_seen
                        ADD CONSTRAINT notification_seen_user_id_fkey
                        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;
                    END IF;
                END IF;
            END
            $$;
            """
        ),
        text(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'access_log'
                ) AND EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'users'
                ) THEN
                    ALTER TABLE access_log DROP CONSTRAINT IF EXISTS access_log_user_id_fkey;
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conname = 'access_log_user_id_fkey'
                    ) THEN
                        ALTER TABLE access_log
                        ADD CONSTRAINT access_log_user_id_fkey
                        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL;
                    END IF;
                END IF;
            END
            $$;
            """
        ),
    ]

    with engine.begin() as conn:
        for statement in statements:
            conn.execute(statement)
        conn.execute(text("UPDATE transaction SET transaction_type = 'debit' WHERE transaction_type IS NULL"))


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    sync_postgres_schema()


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
