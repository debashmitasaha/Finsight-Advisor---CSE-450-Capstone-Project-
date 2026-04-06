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
