PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

-- Forensic and review data
DELETE FROM forensic_review;
DELETE FROM forensic_finding;
DELETE FROM threshold_calibration_history;
DELETE FROM forensic_run;
DELETE FROM company_forensic_config;

-- Transaction-derived workflow data
DELETE FROM anomaly;
DELETE FROM case_transaction;
DELETE FROM case_assignment;
DELETE FROM budget_forecast;
DELETE FROM notification_seen;
DELETE FROM notification;

-- Preserve access logs, but disconnect them from deleted transactions
UPDATE access_log
SET transaction_id = NULL
WHERE transaction_id IS NOT NULL;

-- Transaction, grouping, and upload data
DELETE FROM "transaction";
DELETE FROM "group";
DELETE FROM upload_batch;
DELETE FROM expense_category;

COMMIT;

PRAGMA foreign_key_check;