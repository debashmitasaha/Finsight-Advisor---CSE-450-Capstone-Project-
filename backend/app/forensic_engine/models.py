from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, Numeric, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import Base, Company, Transaction, User, UUIDString, new_id


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

    is_alert: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    """Whether the score cleared the company's alert threshold at the time of the run.

    Every scored row is stored, not only the alerts: the review queue must be able to hand
    reviewers a sample of rows *below* the line, or recall can never be measured."""

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
    alerts_stored: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    min_report_score: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False, default=65)
    """The alert threshold this run used. Kept under its historical column name."""
    threshold_source: Mapped[str | None] = mapped_column(Text, nullable=True)
    """'bootstrap', 'company_f1' or 'manual' — where that threshold came from."""
    diagnostics: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ForensicReview(Base):
    """A human reviewer's verdict on one transaction: the company's ground truth.

    One row per (company, transaction). Re-reviewing overwrites the label rather than
    stacking a second row, because calibration needs exactly one answer per transaction
    and an auditor wants the current verdict, not a history of hesitation. Calibration
    history — the thing that *should* be append-only — lives in its own table below.

    `finding_id` is a convenience link to the finding that was on screen when the review
    was made. Findings are replaced on every run, so the link may go null; the review
    itself is keyed by transaction and survives.
    """

    __tablename__ = "forensic_review"
    __table_args__ = (UniqueConstraint("company_id", "transaction_id", name="forensic_review_company_txn_key"),)

    review_id: Mapped[str] = mapped_column(UUIDString(), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("company.company_id", ondelete="CASCADE"), nullable=False)
    department_id: Mapped[str | None] = mapped_column(ForeignKey("department.department_id", ondelete="SET NULL"), nullable=True)
    transaction_id: Mapped[str] = mapped_column(ForeignKey("transaction.transaction_id", ondelete="CASCADE"), nullable=False)
    finding_id: Mapped[str | None] = mapped_column(ForeignKey("forensic_finding.finding_id", ondelete="SET NULL"), nullable=True)
    reviewer_id: Mapped[str | None] = mapped_column(ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)

    label: Mapped[str] = mapped_column(Text, nullable=False)
    """'confirmed' (genuine issue), 'cleared' (legitimate) or 'uncertain' (excluded from
    every metric)."""
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_source: Mapped[str] = mapped_column(Text, nullable=False, default="alert")
    """'alert' when the row was above the threshold, 'sample' when it was drawn from below
    it. Reported so the UI can show that recall rests on real below-the-line reviews."""

    risk_score_at_review: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    threshold_at_review: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    engine_version: Mapped[str] = mapped_column(Text, nullable=False, default="")

    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    reviewer: Mapped[User | None] = relationship("User", foreign_keys=[reviewer_id])
    transaction: Mapped[Transaction] = relationship("Transaction", foreign_keys=[transaction_id])


class CompanyForensicConfig(Base):
    """Where one company's alert line sits right now, and why.

    A company without a row here is in bootstrap. The row is created on the first review
    and updated by every review and every calibration, so it is always the single place to
    ask "what threshold applies to this company and where did it come from".
    """

    __tablename__ = "company_forensic_config"

    company_id: Mapped[str] = mapped_column(ForeignKey("company.company_id", ondelete="CASCADE"), primary_key=True)

    calibration_mode: Mapped[str] = mapped_column(Text, nullable=False, default="bootstrap")
    """'bootstrap', 'warmup' or 'calibrated'."""
    active_threshold: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    """Company-specific threshold. Null until a calibration has been activated; the
    bootstrap value is deliberately *not* copied here so nobody mistakes it for a result."""
    threshold_source: Mapped[str] = mapped_column(Text, nullable=False, default="bootstrap")
    """'bootstrap' or 'company_f1'."""

    candidate_threshold: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    candidate_status: Mapped[str | None] = mapped_column(Text, nullable=True)
    """Outcome of the most recent calibration: 'activated' or 'rejected'."""

    # Validation metrics of the *active* threshold, measured on held-out reviewed rows.
    precision: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    recall: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    f1: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    false_positive_rate: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)

    reviewed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    positive_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    negative_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    uncertain_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reviews_at_last_calibration: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    """Review count when the last calibration ran; the recalibration trigger counts from here."""

    calibrated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    engine_version: Mapped[str | None] = mapped_column(Text, nullable=True)

    calibration_overrides: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    """Settings an admin changed for this company from the interface — the minimums, the
    recalibration batch, the bootstrap line — stored as {field: value}. Null means the
    deployment defaults apply. Read on every request, so a change takes effect at once,
    with no restart and no configuration file to edit on the server."""

    company: Mapped[Company] = relationship("Company", foreign_keys=[company_id])


class ThresholdCalibrationHistory(Base):
    """Append-only record of every calibration attempt, activated or not.

    This is what makes a threshold defensible: "why does Company A alert at 52?" is
    answered by the row that activated 52 — the sweep it won, the held-out rows it was
    checked on, and the checks it passed.
    """

    __tablename__ = "threshold_calibration_history"

    calibration_id: Mapped[str] = mapped_column(UUIDString(), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("company.company_id", ondelete="CASCADE"), nullable=False)

    old_threshold: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    candidate_threshold: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    activated_threshold: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    outcome: Mapped[str] = mapped_column(Text, nullable=False)
    """'activated' or 'rejected'."""
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    triggered_by: Mapped[str] = mapped_column(Text, nullable=False, default="manual")
    """'auto' (review count crossed the batch) or 'manual' (an admin asked)."""

    # Held-out validation metrics of the candidate.
    precision: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    recall: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    f1: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    false_positive_rate: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    calibration_f1: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    """F1 of the candidate on the rows it was chosen from, for comparison with `f1`."""

    review_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    positive_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    negative_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    calibration_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    validation_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    calibration_data_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    calibration_data_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    sweep: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    checks: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    metrics: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    """Calibration, validation and current-threshold confusion tables, in full."""

    engine_version: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


Index("idx_forensic_finding_dept", ForensicFinding.department_id)
Index("idx_forensic_finding_run", ForensicFinding.run_id)
Index("idx_forensic_finding_txn", ForensicFinding.transaction_id)
Index("idx_forensic_run_dept", ForensicRun.department_id)
Index("idx_forensic_review_company", ForensicReview.company_id)
Index("idx_forensic_review_dept", ForensicReview.department_id)
Index("idx_forensic_review_txn", ForensicReview.transaction_id)
Index("idx_threshold_calibration_company", ThresholdCalibrationHistory.company_id)
