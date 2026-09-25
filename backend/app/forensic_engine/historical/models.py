"""Tables for historical scans and the cases they produce.

Separate from `forensic_finding` on purpose. A finding is one transaction's fused
score; a case is an episode spanning many transactions, several detectors and a
date range. Storing cases as findings would either lose the episode or corrupt the
meaning of the row-level records that the calibration pipeline depends on.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Index, Integer, Numeric, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base, UUIDString, new_id


class HistoricalScanRun(Base):
    """One execution of the historical scanner over one company and window.

    The configuration snapshot is stored with the run so a scan can be reproduced,
    and so two scans that disagree can be explained by their settings rather than
    by guesswork.
    """

    __tablename__ = "historical_scan_run"

    scan_id: Mapped[str] = mapped_column(UUIDString(), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("company.company_id", ondelete="CASCADE"), nullable=False)
    started_by: Mapped[str | None] = mapped_column(ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)

    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    status: Mapped[str] = mapped_column(Text, nullable=False, default="ok")
    engine_version: Mapped[str] = mapped_column(Text, nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    case_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    config_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    diagnostics_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class AnomalyCase(Base):
    """One audit episode: an entity, a window, and every reason it was raised."""

    __tablename__ = "anomaly_case"

    case_id: Mapped[str] = mapped_column(UUIDString(), primary_key=True, default=new_id)
    scan_id: Mapped[str] = mapped_column(ForeignKey("historical_scan_run.scan_id", ondelete="CASCADE"), nullable=False)
    company_id: Mapped[str] = mapped_column(ForeignKey("company.company_id", ondelete="CASCADE"), nullable=False)

    title: Mapped[str] = mapped_column(Text, nullable=False)
    entity_type: Mapped[str] = mapped_column(Text, nullable=False)
    entity_id: Mapped[str] = mapped_column(Text, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)

    priority_score: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    band: Mapped[str] = mapped_column(Text, nullable=False)
    total_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    member_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    layer_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    """How many independent layers agree. The single most useful column when sorting
    by hand: one layer is a lead, three is an episode."""

    codes: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    scores_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    evidence_json: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    explanation_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    # Reviewer ground truth lives at the case level, because that is the unit the
    # auditor actually investigates.
    review_status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class AnomalyCaseMember(Base):
    """A transaction that belongs to a case."""

    __tablename__ = "anomaly_case_member"

    member_id: Mapped[str] = mapped_column(UUIDString(), primary_key=True, default=new_id)
    case_id: Mapped[str] = mapped_column(ForeignKey("anomaly_case.case_id", ondelete="CASCADE"), nullable=False)
    transaction_id: Mapped[str] = mapped_column(ForeignKey("transaction.transaction_id", ondelete="CASCADE"), nullable=False)
    member_role: Mapped[str] = mapped_column(Text, nullable=False, default="member")


Index("idx_historical_scan_company", HistoricalScanRun.company_id)
Index("idx_anomaly_case_scan", AnomalyCase.scan_id)
Index("idx_anomaly_case_company", AnomalyCase.company_id)
Index("idx_anomaly_case_member_case", AnomalyCaseMember.case_id)
Index("idx_anomaly_case_member_transaction", AnomalyCaseMember.transaction_id)
