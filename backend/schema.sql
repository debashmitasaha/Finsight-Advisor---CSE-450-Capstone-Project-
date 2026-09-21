create extension if not exists "pgcrypto";

create table if not exists public.department (
  department_id uuid primary key default gen_random_uuid(),
  department_name text not null,
  annual_budget numeric(15, 2),
  is_active boolean not null default true,
  company_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.company (
  company_id uuid primary key default gen_random_uuid(),
  company_name text not null,
  dept_id uuid references public.department(department_id) on delete set null
);

alter table public.department
  add constraint department_company_id_fkey
  foreign key (company_id) references public.company(company_id) on delete set null;

create table if not exists public.users (
  user_id uuid primary key default gen_random_uuid(),
  username text not null unique,
  company_id uuid references public.company(company_id) on delete set null,
  email text not null unique,
  password_hash text not null,
  is_admin boolean not null default false,
  is_active boolean not null default true,
  last_login timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_role (
  dept_id uuid not null references public.department(department_id) on delete cascade,
  user_id uuid not null references public.users(user_id) on delete cascade,
  permissions text[] not null default '{}',
  primary key (dept_id, user_id)
);

create table if not exists public.expense_category (
  category_id uuid primary key default gen_random_uuid(),
  company_id uuid references public.company(company_id) on delete cascade,
  department_id uuid references public.department(department_id) on delete cascade,
  name text not null,
  category_key text not null,
  description text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.users(user_id) on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id, department_id, category_key)
);

create table if not exists public."group" (
  dept_id uuid not null references public.department(department_id) on delete cascade,
  chart_acc_head_name text not null,
  group_no numeric(10, 2),
  group_name text,
  representative_text text,
  embedding jsonb,
  expense_category_id uuid references public.expense_category(category_id) on delete set null,
  expense_category_status text not null default 'unassigned',
  suggested_category_name text,
  suggested_category_confidence numeric(5, 4),
  suggested_category_is_new boolean not null default false,
  suggested_category_reason text,
  suggested_category_source text,
  suggested_category_payload jsonb,
  created_at timestamptz not null default now(),
  primary key (dept_id, chart_acc_head_name),
  unique (dept_id, group_no)
);

create table if not exists public.upload_batch (
  upload_batch_id uuid primary key default gen_random_uuid(),
  department_id uuid references public.department(department_id) on delete set null,
  source_file_name text not null,
  source_file_hash varchar(128),
  uploaded_by uuid references public.users(user_id) on delete set null,
  uploaded_at timestamptz not null default now(),
  row_count integer not null default 0,
  status text not null default 'processing'
);

create table if not exists public.transaction (
  transaction_id uuid primary key default gen_random_uuid(),
  transaction_date timestamptz not null default now(),
  amount numeric(15, 2) not null,
  transaction_type text not null default 'debit',
  description text,
  category text default 'uncategorized',
  department_id uuid references public.department(department_id) on delete set null,
  payment_method text,
  invoice_id text,
  voucher_number text,
  account_head_group text,
  voucher_type text,
  po_number text,
  has_receipt boolean not null default false,
  approval_status text not null default 'pending',
  chart_acc_head text,
  cleaned_chart_acc_head text,
  group_no numeric(10, 2),
  group_name text,
  expense_category_id uuid references public.expense_category(category_id) on delete set null,
  semantic_confidence numeric(10, 4),
  risk_score numeric(10, 4) not null default 0,
  is_flagged boolean not null default false,
  flagged_reason text,
  source_file_name text,
  upload_batch_id uuid references public.upload_batch(upload_batch_id) on delete set null,
  dedupe_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification (
  notification_id uuid primary key default gen_random_uuid(),
  department_id uuid references public.department(department_id) on delete set null,
  type text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_seen (
  notification_id uuid not null references public.notification(notification_id) on delete cascade,
  user_id uuid not null references public.users(user_id) on delete cascade,
  is_read boolean not null default false,
  read_at timestamptz,
  primary key (notification_id, user_id)
);

create table if not exists public.access_log (
  log_id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(user_id) on delete set null,
  dept_id uuid references public.department(department_id) on delete set null,
  transaction_id uuid references public.transaction(transaction_id) on delete set null,
  action text not null,
  access_timestamp timestamptz not null default now()
);

create table if not exists public.case_transaction (
  ct_id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transaction(transaction_id) on delete cascade,
  resolved boolean not null default false,
  resolved_at timestamptz
);

create table if not exists public.case_assignment (
  assignment_id uuid primary key default gen_random_uuid(),
  dept_id uuid references public.department(department_id) on delete set null,
  case_name text not null,
  resolved boolean not null default false,
  resolved_at timestamptz
);

create table if not exists public.budget_forecast (
  forecast_id uuid primary key default gen_random_uuid(),
  department_id uuid references public.department(department_id) on delete cascade,
  forecast_period_start date not null,
  forecast_period_end date not null,
  predicted_amount numeric(15, 2) not null,
  model_type text,
  model_version text,
  lower_bound numeric(15, 2),
  upper_bound numeric(15, 2),
  created_at timestamptz not null default now()
);

create table if not exists public.anomaly (
  anomaly_id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transaction(transaction_id) on delete cascade,
  department_id uuid references public.department(department_id) on delete set null,
  anomaly_type text not null,
  score numeric(10, 4) not null,
  threshold numeric(10, 4),
  evidence_snapshot jsonb,
  is_resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.forensic_run (
  run_id uuid primary key default gen_random_uuid(),
  department_id uuid references public.department(department_id) on delete set null,
  rows_analysed integer not null default 0,
  findings_stored integer not null default 0,
  alerts_stored integer not null default 0,
  min_report_score numeric(6, 2) not null default 65,
  threshold_source text,
  diagnostics jsonb not null default '{}',
  summary jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.forensic_finding (
  finding_id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  transaction_id uuid not null references public.transaction(transaction_id) on delete cascade,
  department_id uuid references public.department(department_id) on delete set null,
  risk_score numeric(6, 2) not null,
  band text not null,
  corroboration integer not null default 0,
  views_triggered jsonb not null default '[]',
  view_scores jsonb not null default '{}',
  evidence jsonb not null default '[]',
  is_alert boolean not null default true,
  is_resolved boolean not null default false,
  resolution_note text,
  created_at timestamptz not null default now()
);

-- Reviewer ground truth: one verdict per (company, transaction). Re-reviewing overwrites.
create table if not exists public.forensic_review (
  review_id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company(company_id) on delete cascade,
  department_id uuid references public.department(department_id) on delete set null,
  transaction_id uuid not null references public.transaction(transaction_id) on delete cascade,
  finding_id uuid references public.forensic_finding(finding_id) on delete set null,
  reviewer_id uuid references public.users(user_id) on delete set null,
  label text not null check (label in ('confirmed', 'cleared', 'uncertain')),
  review_note text,
  review_source text not null default 'alert',
  risk_score_at_review numeric(6, 2) not null default 0,
  threshold_at_review numeric(6, 2) not null default 0,
  engine_version text not null default '',
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint forensic_review_company_txn_key unique (company_id, transaction_id)
);

-- Where each company's alert line sits and why. No row = bootstrap.
create table if not exists public.company_forensic_config (
  company_id uuid primary key references public.company(company_id) on delete cascade,
  calibration_mode text not null default 'bootstrap' check (calibration_mode in ('bootstrap', 'warmup', 'calibrated')),
  active_threshold numeric(6, 2),
  threshold_source text not null default 'bootstrap',
  candidate_threshold numeric(6, 2),
  candidate_status text,
  precision numeric(6, 4),
  recall numeric(6, 4),
  f1 numeric(6, 4),
  false_positive_rate numeric(6, 4),
  reviewed_count integer not null default 0,
  positive_count integer not null default 0,
  negative_count integer not null default 0,
  uncertain_count integer not null default 0,
  reviews_at_last_calibration integer not null default 0,
  calibrated_at timestamptz,
  updated_at timestamptz not null default now(),
  engine_version text
);

-- Append-only audit trail of every calibration attempt, activated or rejected.
create table if not exists public.threshold_calibration_history (
  calibration_id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company(company_id) on delete cascade,
  old_threshold numeric(6, 2) not null,
  candidate_threshold numeric(6, 2) not null,
  activated_threshold numeric(6, 2),
  outcome text not null check (outcome in ('activated', 'rejected')),
  reason text not null default '',
  triggered_by text not null default 'manual',
  precision numeric(6, 4),
  recall numeric(6, 4),
  f1 numeric(6, 4),
  false_positive_rate numeric(6, 4),
  calibration_f1 numeric(6, 4),
  review_count integer not null default 0,
  positive_count integer not null default 0,
  negative_count integer not null default 0,
  calibration_rows integer not null default 0,
  validation_rows integer not null default 0,
  calibration_data_start timestamptz,
  calibration_data_end timestamptz,
  sweep jsonb not null default '[]',
  checks jsonb not null default '[]',
  metrics jsonb not null default '{}',
  engine_version text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_user_company_id on public.users(company_id);
create index if not exists idx_user_role_user_id on public.user_role(user_id);
create index if not exists idx_expense_category_company on public.expense_category(company_id);
create index if not exists idx_expense_category_department on public.expense_category(department_id);
create index if not exists idx_group_expense_category on public."group"(expense_category_id);
create index if not exists idx_notification_department_id on public.notification(department_id);
create index if not exists idx_notification_seen_user_id on public.notification_seen(user_id);
create index if not exists idx_access_log_user_id on public.access_log(user_id);
create index if not exists idx_access_log_dept_id on public.access_log(dept_id);
create index if not exists idx_access_log_transaction_id on public.access_log(transaction_id);
create index if not exists idx_transaction_department_id on public.transaction(department_id);
create index if not exists idx_transaction_expense_category on public.transaction(expense_category_id);
create index if not exists idx_transaction_batch_id on public.transaction(upload_batch_id);
create index if not exists idx_transaction_dedupe_hash on public.transaction(dedupe_hash);
create index if not exists idx_upload_batch_file_hash on public.upload_batch(department_id, source_file_hash);
create index if not exists idx_case_transaction_transaction_id on public.case_transaction(transaction_id);
create index if not exists idx_case_assignment_dept_id on public.case_assignment(dept_id);
create index if not exists idx_budget_forecast_department_id on public.budget_forecast(department_id);
create index if not exists idx_anomaly_department_id on public.anomaly(department_id);
create index if not exists idx_forensic_run_dept on public.forensic_run(department_id);
create index if not exists idx_forensic_finding_dept on public.forensic_finding(department_id);
create index if not exists idx_forensic_finding_run on public.forensic_finding(run_id);
create index if not exists idx_forensic_finding_txn on public.forensic_finding(transaction_id);
create index if not exists idx_forensic_review_company on public.forensic_review(company_id);
create index if not exists idx_forensic_review_dept on public.forensic_review(department_id);
create index if not exists idx_forensic_review_txn on public.forensic_review(transaction_id);
create index if not exists idx_threshold_calibration_company on public.threshold_calibration_history(company_id);

create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_updated_at on public.users;
create trigger trg_user_updated_at before update on public.users
for each row execute procedure public.handle_updated_at();

drop trigger if exists trg_transaction_updated_at on public.transaction;
create trigger trg_transaction_updated_at before update on public.transaction
for each row execute procedure public.handle_updated_at();

drop trigger if exists trg_anomaly_updated_at on public.anomaly;
create trigger trg_anomaly_updated_at before update on public.anomaly
for each row execute procedure public.handle_updated_at();
