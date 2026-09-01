from __future__ import annotations

from datetime import date, datetime
import uuid

from sqlalchemy import (
    JSON,
    Boolean,
    CHAR,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    PrimaryKeyConstraint,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PostgresUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator


class Base(DeclarativeBase):
    pass


def new_id() -> str:
    return str(uuid.uuid4())


class UUIDString(TypeDecorator):
    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PostgresUUID(as_uuid=False))
        return dialect.type_descriptor(String(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return str(value)


class Department(Base):
    __tablename__ = "department"

    department_id: Mapped[str] = mapped_column(UUIDString(), primary_key=True, default=new_id)
    department_name: Mapped[str] = mapped_column(Text, nullable=False)
    annual_budget: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    company_id: Mapped[str | None] = mapped_column(ForeignKey("company.company_id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    company: Mapped[Company | None] = relationship("Company", back_populates="departments", foreign_keys=[company_id])
    users: Mapped[list[UserRole]] = relationship("UserRole", back_populates="department", cascade="all, delete-orphan")
    transactions: Mapped[list[Transaction]] = relationship("Transaction", back_populates="department")
    groups: Mapped[list[Group]] = relationship("Group", back_populates="department")
    forecasts: Mapped[list[BudgetForecast]] = relationship("BudgetForecast", back_populates="department")
    notifications: Mapped[list[Notification]] = relationship("Notification", back_populates="department")
    upload_batches: Mapped[list[UploadBatch]] = relationship("UploadBatch", back_populates="department")
    anomalies: Mapped[list[Anomaly]] = relationship("Anomaly", back_populates="department")


class Company(Base):
    __tablename__ = "company"

    company_id: Mapped[str] = mapped_column(UUIDString(), primary_key=True, default=new_id)
    company_name: Mapped[str] = mapped_column(Text, nullable=False)
    dept_id: Mapped[str | None] = mapped_column(ForeignKey("department.department_id", ondelete="SET NULL"), nullable=True)

    legacy_department: Mapped[Department | None] = relationship("Department", foreign_keys=[dept_id])
    departments: Mapped[list[Department]] = relationship("Department", back_populates="company", foreign_keys=[Department.company_id])
    users: Mapped[list[User]] = relationship("User", back_populates="company")


class User(Base):
    # Bug fix: "user" is a reserved word in Postgres and causes cryptic errors at runtime.
    # Renamed to "users" to be safe across all supported databases.
    __tablename__ = "users"

    user_id: Mapped[str] = mapped_column(UUIDString(), primary_key=True, default=new_id)
    username: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    company_id: Mapped[str | None] = mapped_column(ForeignKey("company.company_id", ondelete="SET NULL"), nullable=True)
    email: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    company: Mapped[Company | None] = relationship("Company", back_populates="users")
    roles: Mapped[list[UserRole]] = relationship("UserRole", back_populates="user", cascade="all, delete-orphan")
    access_logs: Mapped[list[AccessLog]] = relationship("AccessLog", back_populates="user")
    notifications_seen: Mapped[list[NotificationSeen]] = relationship("NotificationSeen", back_populates="user", cascade="all, delete-orphan")
    uploaded_batches: Mapped[list[UploadBatch]] = relationship("UploadBatch", back_populates="uploader")


class UserRole(Base):
    __tablename__ = "user_role"
    __table_args__ = (PrimaryKeyConstraint("dept_id", "user_id", name="user_role_pkey"),)

    dept_id: Mapped[str] = mapped_column(ForeignKey("department.department_id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    permissions: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)

    department: Mapped[Department] = relationship("Department", back_populates="users")
    user: Mapped[User] = relationship("User", back_populates="roles")


class Group(Base):
    __tablename__ = "group"
    __table_args__ = (
        PrimaryKeyConstraint("dept_id", "chart_acc_head_name", name="group_pkey"),
        UniqueConstraint("dept_id", "group_no", name="group_dept_group_no_key"),
    )

    dept_id: Mapped[str] = mapped_column(ForeignKey("department.department_id", ondelete="CASCADE"), nullable=False)
    chart_acc_head_name: Mapped[str] = mapped_column(Text, nullable=False)
    group_no: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    group_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    representative_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding: Mapped[list[float] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    department: Mapped[Department] = relationship("Department", back_populates="groups")


class Transaction(Base):
    __tablename__ = "transaction"

    transaction_id: Mapped[str] = mapped_column(UUIDString(), primary_key=True, default=new_id)
    transaction_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    amount: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    # Bug 1 fix: transaction_type distinguishes money-out (debit) from money-in (credit).
    # Required by _pick_spending_side() in forecasting.py so forecasts use spend only.
    # Defaults to "debit" so existing rows without this column still behave correctly.
    transaction_type: Mapped[str] = mapped_column(Text, nullable=False, default="debit")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(Text, nullable=True, default="uncategorized")
    department_id: Mapped[str | None] = mapped_column(ForeignKey("department.department_id", ondelete="SET NULL"), nullable=True)
    payment_method: Mapped[str | None] = mapped_column(Text, nullable=True)
    invoice_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    voucher_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    account_head_group: Mapped[str | None] = mapped_column(Text, nullable=True)
    voucher_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    po_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    has_receipt: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    approval_status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    chart_acc_head: Mapped[str | None] = mapped_column(Text, nullable=True)
    cleaned_chart_acc_head: Mapped[str | None] = mapped_column(Text, nullable=True)
    group_no: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    group_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    semantic_confidence: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    risk_score: Mapped[float] = mapped_column(Numeric(10, 4), nullable=False, default=0)
    is_flagged: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    flagged_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_file_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    upload_batch_id: Mapped[str | None] = mapped_column(ForeignKey("upload_batch.upload_batch_id", ondelete="SET NULL"), nullable=True)
    dedupe_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    department: Mapped[Department | None] = relationship("Department", back_populates="transactions")
    upload_batch: Mapped[UploadBatch | None] = relationship("UploadBatch", back_populates="transactions")
    access_logs: Mapped[list[AccessLog]] = relationship("AccessLog", back_populates="transaction")
    case_transactions: Mapped[list[CaseTransaction]] = relationship("CaseTransaction", back_populates="transaction", cascade="all, delete-orphan")
    anomalies: Mapped[list[Anomaly]] = relationship("Anomaly", back_populates="transaction", cascade="all, delete-orphan")


class Notification(Base):
    __tablename__ = "notification"

    notification_id: Mapped[str] = mapped_column(UUIDString(), primary_key=True, default=new_id)
    department_id: Mapped[str | None] = mapped_column(ForeignKey("department.department_id", ondelete="SET NULL"), nullable=True)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    department: Mapped[Department | None] = relationship("Department", back_populates="notifications")
    seen_records: Mapped[list[NotificationSeen]] = relationship("NotificationSeen", back_populates="notification", cascade="all, delete-orphan")


class NotificationSeen(Base):
    __tablename__ = "notification_seen"
    __table_args__ = (PrimaryKeyConstraint("notification_id", "user_id", name="notification_seen_pkey"),)

    notification_id: Mapped[str] = mapped_column(ForeignKey("notification.notification_id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    notification: Mapped[Notification] = relationship("Notification", back_populates="seen_records")
    user: Mapped[User] = relationship("User", back_populates="notifications_seen")


class AccessLog(Base):
    __tablename__ = "access_log"

    log_id: Mapped[str] = mapped_column(UUIDString(), primary_key=True, default=new_id)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    dept_id: Mapped[str | None] = mapped_column(ForeignKey("department.department_id", ondelete="SET NULL"), nullable=True)
    transaction_id: Mapped[str | None] = mapped_column(ForeignKey("transaction.transaction_id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    access_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    user: Mapped[User | None] = relationship("User", back_populates="access_logs")
    transaction: Mapped[Transaction | None] = relationship("Transaction", back_populates="access_logs")


class CaseTransaction(Base):
    __tablename__ = "case_transaction"

    ct_id: Mapped[str] = mapped_column(UUIDString(), primary_key=True, default=new_id)
    transaction_id: Mapped[str] = mapped_column(ForeignKey("transaction.transaction_id", ondelete="CASCADE"), nullable=False)
    resolved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    transaction: Mapped[Transaction] = relationship("Transaction", back_populates="case_transactions")


class CaseAssignment(Base):
    __tablename__ = "case_assignment"

    assignment_id: Mapped[str] = mapped_column(UUIDString(), primary_key=True, default=new_id)
    dept_id: Mapped[str | None] = mapped_column(ForeignKey("department.department_id", ondelete="SET NULL"), nullable=True)
    case_name: Mapped[str] = mapped_column(Text, nullable=False)
    resolved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class BudgetForecast(Base):
    __tablename__ = "budget_forecast"

    forecast_id: Mapped[str] = mapped_column(UUIDString(), primary_key=True, default=new_id)
    department_id: Mapped[str | None] = mapped_column(ForeignKey("department.department_id", ondelete="CASCADE"), nullable=True)
    forecast_period_start: Mapped[date] = mapped_column(Date, nullable=False)
    forecast_period_end: Mapped[date] = mapped_column(Date, nullable=False)
    predicted_amount: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    model_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_version: Mapped[str | None] = mapped_column(Text, nullable=True)
    lower_bound: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    upper_bound: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    department: Mapped[Department | None] = relationship("Department", back_populates="forecasts")


class UploadBatch(Base):
    __tablename__ = "upload_batch"

    upload_batch_id: Mapped[str] = mapped_column(UUIDString(), primary_key=True, default=new_id)
    department_id: Mapped[str | None] = mapped_column(ForeignKey("department.department_id", ondelete="SET NULL"), nullable=True)
    source_file_name: Mapped[str] = mapped_column(Text, nullable=False)
    uploaded_by: Mapped[str | None] = mapped_column(ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="processing")

    department: Mapped[Department | None] = relationship("Department", back_populates="upload_batches")
    uploader: Mapped[User | None] = relationship("User", back_populates="uploaded_batches")
    transactions: Mapped[list[Transaction]] = relationship("Transaction", back_populates="upload_batch")


class Anomaly(Base):
    __tablename__ = "anomaly"

    anomaly_id: Mapped[str] = mapped_column(UUIDString(), primary_key=True, default=new_id)
    transaction_id: Mapped[str] = mapped_column(ForeignKey("transaction.transaction_id", ondelete="CASCADE"), nullable=False)
    department_id: Mapped[str | None] = mapped_column(ForeignKey("department.department_id", ondelete="SET NULL"), nullable=True)
    anomaly_type: Mapped[str] = mapped_column(Text, nullable=False)
    score: Mapped[float] = mapped_column(Numeric(10, 4), nullable=False)
    threshold: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    evidence_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    is_resolved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    transaction: Mapped[Transaction] = relationship("Transaction", back_populates="anomalies")
    department: Mapped[Department | None] = relationship("Department", back_populates="anomalies")


Index("idx_user_company_id", User.company_id)
Index("idx_user_role_user_id", UserRole.user_id)
Index("idx_notification_department_id", Notification.department_id)
Index("idx_notification_seen_user_id", NotificationSeen.user_id)
Index("idx_access_log_user_id", AccessLog.user_id)
Index("idx_access_log_dept_id", AccessLog.dept_id)
Index("idx_access_log_transaction_id", AccessLog.transaction_id)
Index("idx_transaction_department_id", Transaction.department_id)
Index("idx_transaction_batch_id", Transaction.upload_batch_id)
Index("idx_transaction_dedupe_hash", Transaction.dedupe_hash)
Index("idx_case_transaction_transaction_id", CaseTransaction.transaction_id)
Index("idx_case_assignment_dept_id", CaseAssignment.dept_id)
Index("idx_budget_forecast_department_id", BudgetForecast.department_id)
Index("idx_anomaly_department_id", Anomaly.department_id)
Index("idx_anomaly_transaction_type", Anomaly.transaction_id, Anomaly.anomaly_type, unique=False)
