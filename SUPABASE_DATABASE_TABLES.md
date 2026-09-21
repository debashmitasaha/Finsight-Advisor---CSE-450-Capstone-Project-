# Supabase Database Tables

This document describes the PostgreSQL/Supabase tables used by FinSight Advisor, based on `backend/schema.sql` and the backend model usage. It lists each table, its columns, and what each column is used for in the system.

## Overview

The database is organized around companies, departments, users, uploaded ledger transactions, grouping, categorization, budgeting, notifications, and forensic analysis.

Main entity flow:

```text
company
  -> department
      -> upload_batch
          -> transaction
      -> group
          -> expense_category
      -> budget_forecast
      -> anomaly
      -> forensic_run
          -> forensic_finding
```

## Extension

The schema enables:

```sql
create extension if not exists "pgcrypto";
```

This provides `gen_random_uuid()`, which is used to generate UUID primary keys in Supabase/PostgreSQL.

## `company`

Stores companies/organizations that own departments and users.

| Column | Type | Used For |
|---|---:|---|
| `company_id` | `uuid` | Primary key. Unique company identifier generated with `gen_random_uuid()`. |
| `company_name` | `text` | Display name of the company. Used in admin company management. |
| `dept_id` | `uuid` | Legacy/default department reference. Points to `department.department_id`; nullable. |

Relationships:

- One company can have many departments through `department.company_id`.
- One company can have many users through `users.company_id`.
- One company can have company-scoped expense categories through `expense_category.company_id`.

## `department`

Stores departments. Most operational data is scoped by department.

| Column | Type | Used For |
|---|---:|---|
| `department_id` | `uuid` | Primary key. Unique department identifier. |
| `department_name` | `text` | Department display name. |
| `annual_budget` | `numeric(15,2)` | Department annual budget. Used by budget dashboard and utilization calculations. |
| `is_active` | `boolean` | Marks whether the department is active. Defaults to `true`. |
| `company_id` | `uuid` | Optional foreign key to `company.company_id`. Connects a department to a company. |
| `created_at` | `timestamptz` | Timestamp when the department row was created. |

Relationships:

- A department has many transactions.
- A department has many groups.
- A department has many upload batches.
- A department has many budget forecasts.
- A department has many anomalies and forensic findings.
- A department can have department-scoped expense categories.

## `users`

Stores application users.

| Column | Type | Used For |
|---|---:|---|
| `user_id` | `uuid` | Primary key. Unique user identifier. |
| `username` | `text` | User's display/login name. Must be unique. |
| `company_id` | `uuid` | Optional foreign key to `company.company_id`. Connects a user to a company. |
| `email` | `text` | User email address. Must be unique. Used for login. |
| `password_hash` | `text` | Hashed password. The raw password is not stored. |
| `is_admin` | `boolean` | Determines whether the user has admin privileges. |
| `is_active` | `boolean` | Determines whether the account can be used. |
| `last_login` | `timestamptz` | Last successful login timestamp. |
| `created_at` | `timestamptz` | Timestamp when the user was created. |
| `updated_at` | `timestamptz` | Timestamp updated by trigger when the user row changes. |

Relationships:

- Users can be assigned to departments through `user_role`.
- Users can upload files through `upload_batch.uploaded_by`.
- Users can create custom expense categories through `expense_category.created_by`.
- Users can have notification read states in `notification_seen`.

## `user_role`

Join table between departments and users. Stores department-level permissions.

| Column | Type | Used For |
|---|---:|---|
| `dept_id` | `uuid` | Part of composite primary key. References `department.department_id`. |
| `user_id` | `uuid` | Part of composite primary key. References `users.user_id`. |
| `permissions` | `text[]` | List of permissions the user has in the department. Defaults to an empty array. |

Primary key:

- `(dept_id, user_id)`

This prevents duplicate role rows for the same user and department.

## `expense_category`

Stores approved expense categories used for expenditure categorization.

| Column | Type | Used For |
|---|---:|---|
| `category_id` | `uuid` | Primary key. Unique category identifier. |
| `company_id` | `uuid` | Optional company scope. If set, the category belongs to that company. |
| `department_id` | `uuid` | Optional department scope. If set, the category belongs to that department. |
| `name` | `text` | Human-readable category name, such as `Fuel` or `Software`. |
| `category_key` | `text` | Normalized category name used for duplicate checks and matching. |
| `description` | `text` | Explanation of the category's meaning. Used in Gemini prompts and UI context. |
| `is_system` | `boolean` | Marks built-in default categories. |
| `is_active` | `boolean` | Determines whether the category is available for use. |
| `created_by` | `uuid` | Optional user who created the category. References `users.user_id`. |
| `created_at` | `timestamptz` | Timestamp when the category was created. |

Unique constraint:

- `(company_id, department_id, category_key)`

This avoids duplicate categories inside the same scope.

Scopes:

- Global/system category: `company_id` is `null`, `department_id` is `null`.
- Company category: `company_id` is set.
- Department category: `department_id` is set.

## `group`

Stores transaction groups. The table name is quoted as `"group"` because `group` is a SQL keyword.

| Column | Type | Used For |
|---|---:|---|
| `dept_id` | `uuid` | Part of primary key. References the department that owns the group. |
| `chart_acc_head_name` | `text` | Part of primary key. Group key, often a cleaned account-head name or generated semantic group key. |
| `group_no` | `numeric(10,2)` | Numeric group number assigned during grouping. Unique within a department. |
| `group_name` | `text` | Display name such as `group_1`. Stored on transactions too. |
| `representative_text` | `text` | Sample text used to represent the group semantically. Usually from transaction description/account head. |
| `embedding` | `jsonb` | Stored vector embedding for the group profile. Used by semantic grouping. |
| `expense_category_id` | `uuid` | Approved category assigned to this group. References `expense_category.category_id`. |
| `expense_category_status` | `text` | Review state: usually `unassigned`, `pending_review`, `approved`, or `rejected`. |
| `suggested_category_name` | `text` | Gemini-suggested category name waiting for review. |
| `suggested_category_confidence` | `numeric(5,4)` | Confidence score returned by the AI suggestion flow. |
| `suggested_category_is_new` | `boolean` | Whether the suggestion is a new category not already in the category catalog. |
| `suggested_category_reason` | `text` | Gemini's short explanation for the suggested category. |
| `suggested_category_source` | `text` | AI model/source used for the suggestion. |
| `suggested_category_payload` | `jsonb` | Raw structured suggestion payload from Gemini. |
| `created_at` | `timestamptz` | Timestamp when the group was created. |

Primary key:

- `(dept_id, chart_acc_head_name)`

Unique constraint:

- `(dept_id, group_no)`

Used by:

- semantic grouping;
- expense categorization;
- admin review of category suggestions.

## `upload_batch`

Stores one uploaded ledger file and its processing status.

| Column | Type | Used For |
|---|---:|---|
| `upload_batch_id` | `uuid` | Primary key. Unique upload batch identifier. |
| `department_id` | `uuid` | Department the upload belongs to. References `department.department_id`. |
| `source_file_name` | `text` | Original uploaded file name. |
| `source_file_hash` | `varchar(128)` | SHA-256 hash of the uploaded file bytes. Used to reject exact repeated uploads for a department. |
| `uploaded_by` | `uuid` | User who uploaded the file. References `users.user_id`. |
| `uploaded_at` | `timestamptz` | Timestamp when the file was uploaded. |
| `row_count` | `integer` | Number of rows in the uploaded dataframe/file. |
| `status` | `text` | Processing state, such as `processing`, `completed`, or `completed_with_errors`. |

Used by:

- transaction upload tracing;
- budget forecast source selection by upload batch;
- auditability of imported ledger files.

## `transaction`

Stores normalized transaction rows imported from CSV/XLS/XLSX files.

| Column | Type | Used For |
|---|---:|---|
| `transaction_id` | `uuid` | Primary key. Unique transaction identifier. |
| `transaction_date` | `timestamptz` | Date/time of the ledger transaction. Used by filtering, forecasting, and forensic analysis. |
| `amount` | `numeric(15,2)` | Transaction amount. Debit/credit uploads are normalized into this single amount. |
| `transaction_type` | `text` | `debit` or `credit`. Used to distinguish spending from income. |
| `description` | `text` | Narration/details from the ledger. Used for grouping, display, and AI context. |
| `category` | `text` | Simple transaction label: `necessary`, `unnecessary`, or `uncategorized`. Defaults to `uncategorized`. |
| `department_id` | `uuid` | Department that owns the transaction. References `department.department_id`. |
| `payment_method` | `text` | Payment method or mapped voucher type from uploads. |
| `invoice_id` | `text` | Invoice/voucher identifier used for traceability and deduplication. |
| `voucher_number` | `text` | Voucher number from accounting exports. |
| `account_head_group` | `text` | Higher-level account group from uploaded ledger data. |
| `voucher_type` | `text` | Voucher type from uploaded ledger data. |
| `po_number` | `text` | Purchase order/reference number. Used for traceability and deduplication. |
| `has_receipt` | `boolean` | Whether a receipt is present. Defaults to `false`. |
| `approval_status` | `text` | Workflow status for the transaction. Defaults to `pending`. |
| `chart_acc_head` | `text` | Original chart/account head from uploaded file. |
| `cleaned_chart_acc_head` | `text` | Normalized chart account head used by grouping and categorization. |
| `group_no` | `numeric(10,2)` | Group number assigned by grouping. |
| `group_name` | `text` | Group display name assigned by grouping. |
| `expense_category_id` | `uuid` | Approved expense category assigned to the transaction. References `expense_category.category_id`. |
| `semantic_confidence` | `numeric(10,4)` | Confidence-like value from transaction categorization. |
| `risk_score` | `numeric(10,4)` | Risk score used by forensic workflows. Defaults to `0`. |
| `is_flagged` | `boolean` | Whether the transaction is currently flagged as suspicious/anomalous. |
| `flagged_reason` | `text` | Explanation for why the transaction is flagged. |
| `source_file_name` | `text` | Original file name that produced this transaction. |
| `upload_batch_id` | `uuid` | Upload batch that inserted this transaction. References `upload_batch.upload_batch_id`. |
| `dedupe_hash` | `text` | Legacy nullable row hash column. Current upload duplicate checks happen at the upload batch level. |
| `created_at` | `timestamptz` | Timestamp when the transaction row was created. |
| `updated_at` | `timestamptz` | Timestamp updated by trigger when the transaction row changes. |

Used by:

- transaction listing;
- grouping;
- categorization;
- budget forecasting;
- forensic anomaly detection;
- upload deduplication.

## `notification`

Stores system/user-facing notifications.

| Column | Type | Used For |
|---|---:|---|
| `notification_id` | `uuid` | Primary key. Unique notification identifier. |
| `department_id` | `uuid` | Optional department related to the notification. |
| `type` | `text` | Notification type/category. |
| `message` | `text` | Notification text shown to the user. |
| `created_at` | `timestamptz` | Timestamp when the notification was created. |

## `notification_seen`

Join table that tracks whether each user has read each notification.

| Column | Type | Used For |
|---|---:|---|
| `notification_id` | `uuid` | Part of primary key. References `notification.notification_id`. |
| `user_id` | `uuid` | Part of primary key. References `users.user_id`. |
| `is_read` | `boolean` | Whether this user has read the notification. |
| `read_at` | `timestamptz` | Timestamp when the notification was read. |

Primary key:

- `(notification_id, user_id)`

## `access_log`

Stores audit records for user actions.

| Column | Type | Used For |
|---|---:|---|
| `log_id` | `uuid` | Primary key. Unique access log identifier. |
| `user_id` | `uuid` | User who performed the action. References `users.user_id`. |
| `dept_id` | `uuid` | Department involved in the action. References `department.department_id`. |
| `transaction_id` | `uuid` | Optional transaction involved in the action. References `transaction.transaction_id`. |
| `action` | `text` | Description/code for the action that happened. |
| `access_timestamp` | `timestamptz` | Timestamp when the action occurred. |

Used for:

- audit trails;
- tracking transaction/department access.

## `case_transaction`

Stores transactions attached to review/investigation cases.

| Column | Type | Used For |
|---|---:|---|
| `ct_id` | `uuid` | Primary key. Unique case-transaction row identifier. |
| `transaction_id` | `uuid` | Transaction under review. References `transaction.transaction_id`. |
| `resolved` | `boolean` | Whether this case transaction has been resolved. |
| `resolved_at` | `timestamptz` | Timestamp when it was resolved. |

Used by forensic workflows to track transaction-level case resolution.

## `case_assignment`

Stores forensic/review case groupings assigned to departments.

| Column | Type | Used For |
|---|---:|---|
| `assignment_id` | `uuid` | Primary key. Unique case assignment identifier. |
| `dept_id` | `uuid` | Department the case belongs to. References `department.department_id`. |
| `case_name` | `text` | Human-readable case name, such as a Benford or Z-score review case. |
| `resolved` | `boolean` | Whether the case is resolved. |
| `resolved_at` | `timestamptz` | Timestamp when the case was resolved. |

Used by classic forensic anomaly workflows.

## `budget_forecast`

Stores forecasted budget/spend values generated by the budget module.

| Column | Type | Used For |
|---|---:|---|
| `forecast_id` | `uuid` | Primary key. Unique forecast row identifier. |
| `department_id` | `uuid` | Department the forecast belongs to. References `department.department_id`. |
| `forecast_period_start` | `date` | Start date of the forecast period. |
| `forecast_period_end` | `date` | End date of the forecast period. |
| `predicted_amount` | `numeric(15,2)` | Forecasted spend amount for the period. |
| `model_type` | `text` | Forecasting model used, such as SARIMA/baseline style identifiers. |
| `model_version` | `text` | Version/label of the forecasting implementation or artifact. |
| `lower_bound` | `numeric(15,2)` | Lower confidence estimate for the forecast. |
| `upper_bound` | `numeric(15,2)` | Upper confidence estimate for the forecast. |
| `created_at` | `timestamptz` | Timestamp when the forecast was generated. |

Used by:

- budget dashboard;
- forecast history;
- spend projection views.

## `anomaly`

Stores classic forensic anomalies from single-method detectors like Benford, Z-score, and RSF.

| Column | Type | Used For |
|---|---:|---|
| `anomaly_id` | `uuid` | Primary key. Unique anomaly identifier. |
| `transaction_id` | `uuid` | Transaction that triggered the anomaly. References `transaction.transaction_id`. |
| `department_id` | `uuid` | Department the anomaly belongs to. References `department.department_id`. |
| `anomaly_type` | `text` | Detector type, such as `benford`, `zscore`, or `rsf`. |
| `score` | `numeric(10,4)` | Observed anomaly score. Meaning depends on detector type. |
| `threshold` | `numeric(10,4)` | Threshold used to decide whether the row was anomalous. |
| `evidence_snapshot` | `jsonb` | Structured evidence captured at detection time. |
| `is_resolved` | `boolean` | Whether the anomaly has been resolved. |
| `created_at` | `timestamptz` | Timestamp when the anomaly was created. |
| `updated_at` | `timestamptz` | Timestamp updated by trigger when the anomaly changes. |

This table is separate from `forensic_finding`. `anomaly` stores individual detector hits, while `forensic_finding` stores fused multi-view risk assessments.

## `forensic_run`

Stores one execution of the newer multi-view forensic engine.

| Column | Type | Used For |
|---|---:|---|
| `run_id` | `uuid` | Primary key. Unique forensic engine run identifier. |
| `department_id` | `uuid` | Department analyzed by the run. References `department.department_id`. |
| `rows_analysed` | `integer` | Number of transaction rows analyzed. |
| `findings_stored` | `integer` | Number of reportable findings stored from this run. |
| `min_report_score` | `numeric(6,2)` | Minimum risk score required for a finding to be stored/reported. |
| `diagnostics` | `jsonb` | Structured engine diagnostics, such as data quality and view status. |
| `summary` | `jsonb` | Structured summary of the run, such as counts by risk band/view. |
| `created_at` | `timestamptz` | Timestamp when the run was created. |

Used to trace forensic findings back to the run settings and data quality context that produced them.

## `forensic_finding`

Stores fused multi-view forensic findings for transactions.

| Column | Type | Used For |
|---|---:|---|
| `finding_id` | `uuid` | Primary key. Unique finding identifier. |
| `run_id` | `uuid` | Forensic run that produced the finding. Links to `forensic_run.run_id` by application convention. |
| `transaction_id` | `uuid` | Transaction being assessed. References `transaction.transaction_id`. |
| `department_id` | `uuid` | Department the finding belongs to. References `department.department_id`. |
| `risk_score` | `numeric(6,2)` | Final fused risk score for the transaction. |
| `band` | `text` | Risk band, such as `critical`, `high`, `medium`, or `low`. |
| `corroboration` | `integer` | Number of independent forensic views supporting the finding. |
| `views_triggered` | `jsonb` | List of forensic views that triggered, such as rule, behavioral, temporal, or relational. |
| `view_scores` | `jsonb` | Per-view risk scores. |
| `evidence` | `jsonb` | Detailed structured evidence items used to explain the finding. |
| `is_resolved` | `boolean` | Whether the finding has been resolved. |
| `resolution_note` | `text` | Optional note entered when resolving the finding. |
| `created_at` | `timestamptz` | Timestamp when the finding was created. |

Used by the Forensic Intelligence Engine UI and reporting endpoints.

## Indexes

The schema creates indexes to speed up common filters and joins:

| Index | Table / Column(s) | Purpose |
|---|---|---|
| `idx_user_company_id` | `users(company_id)` | Faster user lookup by company. |
| `idx_user_role_user_id` | `user_role(user_id)` | Faster role lookup by user. |
| `idx_expense_category_company` | `expense_category(company_id)` | Faster company-scoped category lookup. |
| `idx_expense_category_department` | `expense_category(department_id)` | Faster department-scoped category lookup. |
| `idx_group_expense_category` | `"group"(expense_category_id)` | Faster lookup of groups by approved category. |
| `idx_notification_department_id` | `notification(department_id)` | Faster notification lookup by department. |
| `idx_notification_seen_user_id` | `notification_seen(user_id)` | Faster notification read-state lookup by user. |
| `idx_access_log_user_id` | `access_log(user_id)` | Faster audit log lookup by user. |
| `idx_access_log_dept_id` | `access_log(dept_id)` | Faster audit log lookup by department. |
| `idx_access_log_transaction_id` | `access_log(transaction_id)` | Faster audit log lookup by transaction. |
| `idx_transaction_department_id` | `transaction(department_id)` | Faster transaction listing/filtering by department. |
| `idx_transaction_expense_category` | `transaction(expense_category_id)` | Faster spend/category analysis. |
| `idx_transaction_batch_id` | `transaction(upload_batch_id)` | Faster lookup of transactions from an upload batch. |
| `idx_transaction_dedupe_hash` | `transaction(dedupe_hash)` | Legacy index for the nullable row hash column. |
| `idx_upload_batch_file_hash` | `upload_batch(department_id, source_file_hash)` | Faster exact repeated-file detection by department. |
| `idx_case_transaction_transaction_id` | `case_transaction(transaction_id)` | Faster case lookup by transaction. |
| `idx_case_assignment_dept_id` | `case_assignment(dept_id)` | Faster case lookup by department. |
| `idx_budget_forecast_department_id` | `budget_forecast(department_id)` | Faster forecast lookup by department. |
| `idx_anomaly_department_id` | `anomaly(department_id)` | Faster anomaly lookup by department. |
| `idx_forensic_run_dept` | `forensic_run(department_id)` | Faster forensic run lookup by department. |
| `idx_forensic_finding_dept` | `forensic_finding(department_id)` | Faster finding lookup by department. |
| `idx_forensic_finding_run` | `forensic_finding(run_id)` | Faster finding lookup by run. |
| `idx_forensic_finding_txn` | `forensic_finding(transaction_id)` | Faster finding lookup by transaction. |

## Triggers

The schema defines one reusable trigger function:

```sql
public.handle_updated_at()
```

It sets:

```sql
new.updated_at = now()
```

before an update.

Tables using this trigger:

| Trigger | Table | Purpose |
|---|---|---|
| `trg_user_updated_at` | `users` | Keeps `users.updated_at` current. |
| `trg_transaction_updated_at` | `transaction` | Keeps `transaction.updated_at` current. |
| `trg_anomaly_updated_at` | `anomaly` | Keeps `anomaly.updated_at` current. |

## Important Foreign Key Behavior

The schema uses different delete behaviors depending on the relationship:

| Behavior | Meaning | Example |
|---|---|---|
| `on delete cascade` | Delete child rows when the parent is deleted. | Deleting a department deletes its groups. |
| `on delete set null` | Keep the child row but clear the foreign key. | Deleting a user sets `upload_batch.uploaded_by` to `null`. |

This is useful because some records, such as transactions and upload batches, may need to remain for audit history even if related users or departments are removed.

## Notes About Supabase Usage

- Supabase is PostgreSQL, so these tables are created with normal PostgreSQL SQL.
- UUIDs are generated using `gen_random_uuid()` from `pgcrypto`.
- JSON-heavy fields such as `diagnostics`, `summary`, `evidence`, and `suggested_category_payload` use `jsonb`.
- The application connects to Supabase through `DATABASE_URL` in `backend/.env`.
- The current schema file is the source of truth for creating these tables in a fresh Supabase database.
