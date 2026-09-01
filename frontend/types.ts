export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  EMPLOYEE = 'EMPLOYEE',
}

export type TransactionCategory = 'necessary' | 'unnecessary' | 'uncategorized';

export interface DepartmentRole {
  department_id: string;
  department_name: string | null;
  permissions: string[];
}

export interface UserAccount {
  user_id: string;
  username: string;
  name: string;
  email: string;
  company_id: string | null;
  is_admin: boolean;
  is_active: boolean;
  last_login?: string | null;
  account_type: UserRole;
  departments: DepartmentRole[];
}

export interface Company {
  company_id: string;
  company_name: string;
  department_count?: number;
  user_count?: number;
  is_active?: boolean;
  purchase_date?: string | null;
}

export interface Department {
  department_id: string;
  department_name: string;
  annual_budget: number;
  is_active?: boolean;
  company_id?: string | null;
  transaction_count?: number;
  used_budget_current_year?: number;
  annual_budget_utilization_pct?: number;
}

export interface Transaction {
  transaction_id: string;
  department_id: string | null;
  transaction_date: string;
  amount: number;
  transaction_type: 'debit' | 'credit';
  description: string | null;
  category: TransactionCategory | null;
  chart_acc_head: string | null;
  cleaned_chart_acc_head: string | null;
  group_no: number | null;
  group_name: string | null;
  semantic_confidence: number | null;
  payment_method: string | null;
  invoice_id: string | null;
  voucher_number?: string | null;
  account_head_group?: string | null;
  voucher_type?: string | null;
  po_number: string | null;
  approval_status: string;
  has_receipt: boolean;
  risk_score: number;
  is_flagged: boolean;
  flagged_reason: string | null;
  source_file_name: string | null;
  upload_batch_id: string | null;
}

export interface Forecast {
  forecast_id: string;
  forecast_period_start: string;
  forecast_period_end: string;
  predicted_amount: number;
  lower_bound: number;
  upper_bound: number;
  model_type: string | null;
  model_version: string | null;
}

export type ForecastSourceMode = 'latest_batch' | 'full_history' | 'upload_batch' | 'date_range';

export interface ForecastDiagnostics {
  mape: number | null;
  train_months: number;
  season_length: number | null;
  regular_difference: number | null;
  seasonal_difference: number | null;
  notes: string | null;
}

export interface ForecastRunResponse {
  success: boolean;
  history: { month: string; amount: number }[];
  diagnostics: ForecastDiagnostics;
  model: {
    model_type: string;
    model_version: string;
  };
  forecasts: Forecast[];
}

export interface ForecastContextResponse {
  history: { month: string; amount: number }[];
  diagnostics: ForecastDiagnostics | null;
  model: {
    model_type: string;
    model_version: string;
  } | null;
  forecasts: Forecast[];
}

export interface UploadBatchSummary {
  upload_batch_id: string;
  source_file_name: string;
  uploaded_at: string;
  row_count: number;
  status: string;
  transaction_count: number;
  first_transaction_date: string | null;
  last_transaction_date: string | null;
}

export interface ForensicRunResponse {
  success: boolean;
  message?: string;
  benford_anomalies?: number;
  zscore_anomalies?: number;
  rsf_anomalies?: number;
  total_anomalies: number;
}

export interface Anomaly {
  anomaly_id: string;
  transaction_id: string;
  department_id: string | null;
  anomaly_type: string;
  score: number;
  threshold: number;
  evidence_snapshot?: Record<string, unknown> | null;
  is_resolved: boolean;
  created_at: string;
}

export interface AdminOverview {
  companies: number;
  departments: number;
  users: number;
  transactions: number;
  uploads: number;
  department_summaries: Department[];
}

// --- Forensic Intelligence Engine (multi-view) ---

export type RiskBand = 'critical' | 'high' | 'medium' | 'low';
export type ForensicView = 'rule' | 'behavioral' | 'temporal' | 'relational';

export interface EvidenceItem {
  view: ForensicView;
  code: string;
  strength: number;
  message: string;
  detail: Record<string, unknown>;
}

export interface EngineFinding {
  finding_id?: string;
  transaction_id: string;
  risk_score: number;
  band: RiskBand;
  corroboration: number;
  views_triggered: ForensicView[];
  view_scores: Partial<Record<ForensicView, number>>;
  evidence: EvidenceItem[];
  is_resolved?: boolean;
  created_at?: string;
}

export interface EngineDataQuality {
  grouping_ratio: number;
  zero_amount_share: number;
  ledger_span_days: number;
  distinct_vouchers: number;
  warnings: string[];
}

export interface EngineSummary {
  total_scored: number;
  bands: Record<RiskBand, number>;
  by_view: Partial<Record<ForensicView, number>>;
  top_codes: Record<string, number>;
}

export interface EngineDiagnostics {
  rows_analysed: number;
  positive_rows: number;
  zero_amount_rows: number;
  date_range: { from: string; to: string };
  entity_kinds_active: string[];
  entity_counts: Record<string, number>;
  data_quality: EngineDataQuality;
  views: Record<string, { status: string; signals?: number; error?: string; [key: string]: unknown }>;
  signals_total: number;
  view_credibility: Record<ForensicView, number>;
}

export interface EngineAnalyzeResponse {
  success: boolean;
  run_id: string | null;
  summary: EngineSummary;
  diagnostics: EngineDiagnostics;
  reported: number;
  min_report_score: number;
  findings: EngineFinding[];
  message?: string;
}

export interface EngineCapabilities {
  views: Record<ForensicView, string>;
  injection_scenarios: string[];
  unsupported_scenarios: Record<string, string>;
  ledger?: { rows: number; entity_kinds_active?: string[]; data_quality?: EngineDataQuality };
}

export interface ScenarioResult {
  planted: number;
  detected: number;
  recall: number;
  best_rank: number | null;
  best_score: number;
  description: string;
  triggered_views: ForensicView[];
}

export interface BenchmarkMetrics {
  threshold: number;
  total_rows: number;
  planted_rows: number;
  flagged_rows: number;
  true_positives: number;
  false_positives: number;
  false_negatives: number;
  precision: number;
  recall: number;
  f1: number;
  false_positive_rate: number;
  top_k_precision: Record<string, number>;
  mean_rank_of_planted: number | null;
  median_rank_of_planted: number | null;
  per_scenario: Record<string, ScenarioResult>;
}

export interface ThresholdPoint {
  threshold: number;
  precision: number;
  recall: number;
  f1: number;
  false_positive_rate: number;
  flagged: number;
}

export interface BenchmarkResponse {
  injection: { scenarios_planted: number; rows_planted: number; by_scenario: Record<string, number> };
  planted_cases: { scenario: string; rows: number; description: string; detail: Record<string, unknown> }[];
  metrics: BenchmarkMetrics;
  threshold_curve: ThresholdPoint[];
  clean_ledger: { rows: number; scored: number; bands: Record<RiskBand, number> };
  injected_ledger: { rows: number; scored: number; bands: Record<RiskBand, number> };
  scenarios_available: string[];
  scenarios_unsupported: Record<string, string>;
  data_quality: EngineDataQuality;
  seed: number;
}

export interface EngineCaseReport {
  finding_id: string;
  risk_score: number;
  band: RiskBand;
  headline: string;
  transaction: {
    transaction_id: string;
    transaction_date: string;
    amount: number;
    description: string | null;
    chart_acc_head: string | null;
    group_name: string | null;
    invoice_id: string | null;
    po_number: string | null;
    payment_method: string | null;
    approval_status: string;
  } | null;
  view_scores: Partial<Record<ForensicView, number>>;
  why_flagged: string[];
  evidence: EvidenceItem[];
  is_resolved: boolean;
  resolution_note: string | null;
}
