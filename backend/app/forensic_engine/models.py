from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, Numeric, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base, UUIDString, new_id


class ForensicFinding(Base):
    """A fused, multi-view assessment of one transaction.

    Kept separate from the existing `anomaly` table rather than folded into it: that table
    stores one row per single-method hit, whereas a finding here is the *combination* of
    every view's evidence for one transaction. Writing these as anomaly rows would either
    lose the fusion or corrupt the meaning of the older records.
    """

    __tablename__ = "forensic_finding"

    finding_id: Mapped[str] = mapped_column(UUIDString(), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(UUIDString(), nullable=False)
    transaction_id: Mapped[str] = mapped_column(ForeignKey("transaction.transaction_id", ondelete="CASCADE"), nullable=False)
    department_id: Mapped[str | None] = mapped_column(ForeignKey("department.department_id", ondelete="SET NULL"), nullable=True)

    risk_score: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    band: Mapped[str] = mapped_column(Text, nullable=False)
    corroboration: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    views_triggered: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    view_scores: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    evidence: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    is_resolved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ForensicRun(Base):
    """One execution of the engine, so findings can be traced to the settings that made them."""

    __tablename__ = "forensic_run"

    run_id: Mapped[str] = mapped_column(UUIDString(), primary_key=True, default=new_id)
    department_id: Mapped[str | None] = mapped_column(ForeignKey("department.department_id", ondelete="SET NULL"), nullable=True)
    rows_analysed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    findings_stored: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    min_report_score: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False, default=65)
    diagnostics: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


Index("idx_forensic_finding_dept", ForensicFinding.department_id)
Index("idx_forensic_finding_run", ForensicFinding.run_id)
Index("idx_forensic_finding_txn", ForensicFinding.transaction_id)
Index("idx_forensic_run_dept", ForensicRun.department_id)
