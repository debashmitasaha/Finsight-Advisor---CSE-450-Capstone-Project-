import {
  CaseCalibration,
  CaseDetailedAnalysis,
  AdminOverview,
  BenchmarkResponse,
  CalibrationRunResponse,
  CalibrationSettingsPayload,
  CalibrationSettingsResponse,
  CalibrationStatus,
  EngineAnalyzeResponse,
  EngineCapabilities,
  EngineCaseReport,
  EngineFinding,
  ReviewLabel,
  ReviewQueue,
  ReviewResponse,
  ReviewSource,
  Anomaly,
  Company,
  Department,
  DepartmentTransactionSummary,
  ExpenseCategory,
  ExpenseCategorizationRunResponse,
  ExpenseGroupSummary,
  Forecast,
  ForecastContextResponse,
  ForecastAccuracyResponse,
  ForecastRunResponse,
  ForecastSourceMode,
  ForensicRunResponse,
  Transaction,
  TransactionPage,
  UploadBatchSummary,
  UploadTransactionsResponse,
  UserAccount,
  AuditLogResponse,
  GroupRosterRow,
  AnomalyCaseDetail,
  AnomalyCaseSummary,
  HistoricalScan,
} from '../types';
const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:8000';
const AUTH_EXPIRED_EVENT = 'finsight-auth-expired';

async function request<T>(path: string, options: RequestInit = {}, authenticated = true): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (authenticated) {
    const token = localStorage.getItem('finsight_token');
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (authenticated && response.status === 401) {
      localStorage.removeItem('finsight_user');
      localStorage.removeItem('finsight_token');
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: payload.detail || 'Session expired' }));
    }
    throw new Error(payload.detail || payload.message || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const AUTH_EXPIRED = AUTH_EXPIRED_EVENT;

export const api = {
  login: (email: string, password: string) =>
    request<{ access_token: string; refresh_token: string; expires_in: number; user: UserAccount }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }, false),
  me: () => request<{ user: UserAccount }>('/auth/me'),
  adminOverview: () => request<AdminOverview>('/admin/overview'),
  companies: () => request<Company[]>('/admin/companies'),
  createCompany: (company_name: string) => request<Company>('/admin/companies', { method: 'POST', body: JSON.stringify({ company_name }) }),
  departments: (companyId?: string) => request<Department[]>(`/admin/departments${companyId ? `?company_id=${companyId}` : ''}`),
  createDepartment: (payload: { department_name: string; annual_budget: number; company_id?: string | null }) =>
    request<Department>('/admin/departments', { method: 'POST', body: JSON.stringify(payload) }),
  updateDepartmentBudget: (departmentId: string, annual_budget: number) =>
    request<Department>(`/admin/departments/${departmentId}`, { method: 'PATCH', body: JSON.stringify({ annual_budget }) }),
  users: (companyId?: string) => request<UserAccount[]>(`/admin/users${companyId ? `?company_id=${companyId}` : ''}`),
  createUser: (payload: { username: string; email: string; password: string; company_id?: string | null; is_admin: boolean }) =>
    request<UserAccount>('/admin/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUserStatus: (userId: string, is_active: boolean) =>
    request<UserAccount>(`/admin/users/${userId}/status`, { method: 'PATCH', body: JSON.stringify({ is_active }) }),
  deleteUser: (userId: string) =>
    request<{ success: boolean; user_id: string }>(`/admin/users/${userId}`, { method: 'DELETE' }),
  assignRole: (userId: string, deptId: string, permissions: string[]) =>
    request(`/admin/users/${userId}/assign-role?dept_id=${encodeURIComponent(deptId)}`, {
      method: 'POST',
      body: JSON.stringify({ permissions }),
    }),
  uploadTransactions: (deptId: string, file: File) => {
    const form = new FormData();
    form.append('dept_id', deptId);
    form.append('file', file);
    return request<UploadTransactionsResponse>('/transactions/upload', { method: 'POST', body: form });
  },
  transactions: (
    deptId: string,
    options: {
      limit?: number;
      offset?: number;
      uploadBatchId?: string | null;
      groupNo?: number | null;
      chartAccHeadName?: string | null;
      // The endpoint has always accepted these; nothing was sending them.
      category?: string | null;
      flagged?: boolean | null;
      month?: number | null;
      year?: number | null;
    } = {},
  ) => {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    if (options.uploadBatchId) params.set('upload_batch_id', options.uploadBatchId);
    if (options.groupNo !== null && options.groupNo !== undefined) params.set('group_no', String(options.groupNo));
    else if (options.chartAccHeadName) params.set('chart_acc_head_name', options.chartAccHeadName);
    if (options.category) params.set('category', options.category);
    if (options.flagged !== null && options.flagged !== undefined) params.set('flagged', String(options.flagged));
    if (options.month) params.set('month', String(options.month));
    if (options.year) params.set('year', String(options.year));
    const query = params.toString();
    return request<Transaction[]>(`/transactions/dept/${deptId}${query ? `?${query}` : ''}`);
  },

  /** Correct one row: its necessity, its approval state, or whether it stays flagged. */
  updateTransaction: (
    transactionId: string,
    patch: { category?: string; approval_status?: string; is_flagged?: boolean; flagged_reason?: string | null },
  ) => request<Transaction>(`/transactions/${transactionId}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  /** The semantic groups themselves, with the narration that defines each one. */
  groupRoster: (deptId: string) => request<GroupRosterRow[]>(`/grouping/dept/${deptId}/groups`),

  /* ------------------------------ historical full-population scanning ---- */

  /** Mine a company's whole history and return ranked audit cases. */
  engineHistoricalScan: (payload: { dept_id?: string; company_id?: string; start_date?: string; end_date?: string; max_cases?: number }) =>
    request<HistoricalScan>('/forensic-engine/historical-scans', { method: 'POST', body: JSON.stringify(payload) }),

  engineHistoricalScans: (companyId?: string, limit = 10) => {
    const params = new URLSearchParams();
    if (companyId) params.set('company_id', companyId);
    params.set('limit', String(limit));
    return request<HistoricalScan[]>(`/forensic-engine/historical-scans?${params.toString()}`);
  },

  engineHistoricalCases: (scanId: string, options: { band?: string; reviewStatus?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.band) params.set('band', options.band);
    if (options.reviewStatus) params.set('review_status', options.reviewStatus);
    if (options.limit) params.set('limit', String(options.limit));
    const query = params.toString();
    return request<AnomalyCaseSummary[]>(`/forensic-engine/historical-scans/${scanId}/cases${query ? `?${query}` : ''}`);
  },

  engineCase: (caseId: string) => request<AnomalyCaseDetail>(`/forensic-engine/cases/${caseId}`),

  engineCaseDetailedAnalysis: (caseId: string) =>
    request<CaseDetailedAnalysis>(`/forensic-engine/cases/${caseId}/detailed-analysis`, { method: 'POST' }),
  engineCaseCalibration: () => request<CaseCalibration>('/forensic-engine/case-calibration'),
  engineReviewCase: (caseId: string, payload: { status: string; note?: string | null }) =>
    request<{ success: boolean; case: AnomalyCaseSummary }>(`/forensic-engine/cases/${caseId}/review`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Who did what, newest first. Administrators only. */
  auditLogs: (options: { limit?: number; days?: number; deptId?: string | null } = {}) => {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.days) params.set('days', String(options.days));
    if (options.deptId) params.set('dept_id', options.deptId);
    const query = params.toString();
    return request<AuditLogResponse>(`/admin/audit-logs${query ? `?${query}` : ''}`);
  },
  transactionsPage: (deptId: string, options: { limit?: number; offset?: number; uploadBatchId?: string | null; groupNo?: number | null; chartAccHeadName?: string | null } = {}) => {
    const params = new URLSearchParams();
    params.set('limit', String(options.limit ?? 100));
    params.set('offset', String(options.offset ?? 0));
    if (options.uploadBatchId) params.set('upload_batch_id', options.uploadBatchId);
    if (options.groupNo !== null && options.groupNo !== undefined) params.set('group_no', String(options.groupNo));
    else if (options.chartAccHeadName) params.set('chart_acc_head_name', options.chartAccHeadName);
    return request<TransactionPage>(`/transactions/dept/${deptId}/page?${params.toString()}`);
  },
  transactionSummary: (deptId: string) => request<DepartmentTransactionSummary>(`/transactions/dept/${deptId}/summary`),
  groupingStats: (deptId: string) => request(`/grouping/dept/${deptId}/statistics`),
  runGrouping: (deptId: string) => request('/grouping/assign-groups', { method: 'POST', body: JSON.stringify({ dept_id: deptId }) }),
  categorizationSummary: (deptId: string) => request(`/categorization/dept/${deptId}/summary`),
  runCategorization: (deptId: string) => request('/categorization/predict', { method: 'POST', body: JSON.stringify({ dept_id: deptId }) }),
  expenseCategories: (deptId: string) => request<ExpenseCategory[]>(`/categorization/expense-categories?dept_id=${encodeURIComponent(deptId)}`),
  expenseGroups: (deptId: string) => request<ExpenseGroupSummary[]>(`/categorization/dept/${deptId}/expense-groups`),
  runExpenseCategorization: (deptId: string) =>
    request<ExpenseCategorizationRunResponse>('/categorization/expense/predict', {
      method: 'POST',
      body: JSON.stringify({ dept_id: deptId }),
    }),
  approveExpenseGroup: (payload: { dept_id: string; group_no?: number | null; chart_acc_head_name?: string | null; category_name?: string | null }) =>
    request<{ success: boolean; category: ExpenseCategory; group: ExpenseGroupSummary }>('/categorization/expense-groups/approve', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  rejectExpenseGroup: (payload: { dept_id: string; group_no?: number | null; chart_acc_head_name?: string | null }) =>
    request<{ success: boolean; group: ExpenseGroupSummary }>('/categorization/expense-groups/reject', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  runForecast: (
    deptId: string,
    options: {
      monthsAhead?: number;
      sourceMode?: ForecastSourceMode;
      uploadBatchId?: string | null;
      dateFrom?: string | null;
      dateTo?: string | null;
    } = {},
  ) => request<ForecastRunResponse>('/budget/forecast', {
    method: 'POST',
    body: JSON.stringify({
      dept_id: deptId,
      months_ahead: options.monthsAhead ?? 1,
      source_mode: options.sourceMode ?? 'latest_batch',
      upload_batch_id: options.uploadBatchId ?? null,
      date_from: options.dateFrom ?? null,
      date_to: options.dateTo ?? null,
    }),
  }),
  forecasts: (deptId: string) => request<Forecast[]>(`/budget/dept/${deptId}/forecasts`),

  uploadBatches: (deptId: string) => request<UploadBatchSummary[]>(`/budget/dept/${deptId}/upload-batches`),
  forecastContext: (
    deptId: string,
    options: {
      monthsAhead?: number;
      sourceMode?: ForecastSourceMode;
      uploadBatchId?: string | null;
      dateFrom?: string | null;
      dateTo?: string | null;
    } = {},
  ) => {
    const params = new URLSearchParams();
    params.set('months_ahead', String(options.monthsAhead ?? 3));
    params.set('source_mode', options.sourceMode ?? 'latest_batch');
    if (options.uploadBatchId) params.set('upload_batch_id', options.uploadBatchId);
    if (options.dateFrom) params.set('date_from', options.dateFrom);
    if (options.dateTo) params.set('date_to', options.dateTo);
    return request<ForecastContextResponse>(`/budget/dept/${deptId}/forecast-context?${params.toString()}`);
  },
  forecastAccuracy: (deptId: string) => request<ForecastAccuracyResponse>(`/budget/dept/${deptId}/forecast-accuracy`),
  runForensic: (deptId: string, month: number, year: number, uploadBatchId?: string | null) => request<ForensicRunResponse>('/forensic/analyze', {
    method: 'POST',
    body: JSON.stringify({ dept_id: deptId, month, year, upload_batch_id: uploadBatchId ?? null }),
  }),
  anomalies: (deptId: string, uploadBatchId?: string | null) => {
    const params = new URLSearchParams();
    if (uploadBatchId) params.set('upload_batch_id', uploadBatchId);
    const query = params.toString();
    return request<Anomaly[]>(`/forensic/dept/${deptId}/anomalies${query ? `?${query}` : ''}`);
  },
  resolveAnomaly: (anomalyId: string) => request<{ success: boolean; anomaly_id: string }>(`/forensic/anomaly/${anomalyId}/resolve`, { method: 'PATCH' }),

  // --- Forensic Intelligence Engine ---
  engineCapabilities: (deptId?: string) =>
    request<EngineCapabilities>(`/forensic-engine/capabilities${deptId ? `?dept_id=${encodeURIComponent(deptId)}` : ''}`),
  // Leave `minReportScore` undefined (the normal case) and the run alerts at the company's
  // active threshold: bootstrap until it has calibrated, its own validated threshold after.
  engineAnalyze: (deptId: string, minReportScore?: number) =>
    request<EngineAnalyzeResponse>('/forensic-engine/analyze', {
      method: 'POST',
      body: JSON.stringify({ dept_id: deptId, min_report_score: minReportScore ?? null }),
    }),
  engineFindings: (deptId: string, options: { band?: string; minScore?: number; alertsOnly?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (options.band) params.set('band', options.band);
    if (options.minScore) params.set('min_score', String(options.minScore));
    if (options.alertsOnly === false) params.set('alerts_only', 'false');
    const query = params.toString();
    return request<EngineFinding[]>(`/forensic-engine/dept/${deptId}/findings${query ? `?${query}` : ''}`);
  },
  engineCaseReport: (findingId: string) => request<EngineCaseReport>(`/forensic-engine/finding/${findingId}/case-report`),
  engineResolve: (findingId: string, note?: string) =>
    request<{ success: boolean; finding_id: string }>(`/forensic-engine/finding/${findingId}/resolve`, {
      method: 'PATCH',
      body: JSON.stringify({ note: note ?? null }),
    }),
  engineBenchmark: (deptId: string, threshold = 60) =>
    request<BenchmarkResponse>('/forensic-engine/benchmark', {
      method: 'POST',
      body: JSON.stringify({ dept_id: deptId, threshold }),
    }),

  // --- Company-specific alert threshold calibration ---
  engineCalibration: (deptId: string) => request<CalibrationStatus>(`/forensic-engine/dept/${deptId}/calibration`),
  engineCalibrate: (deptId: string) =>
    request<CalibrationRunResponse>('/forensic-engine/calibrate', {
      method: 'POST',
      body: JSON.stringify({ dept_id: deptId }),
    }),
  // Per-company calibration settings, changed from the page and live at once (no restart).
  engineUpdateCalibrationSettings: (deptId: string, payload: CalibrationSettingsPayload) =>
    request<CalibrationSettingsResponse>('/forensic-engine/calibration-settings', {
      method: 'PUT',
      body: JSON.stringify({ dept_id: deptId, ...payload }),
    }),
  engineReviewQueue: (deptId: string) => request<ReviewQueue>(`/forensic-engine/dept/${deptId}/review-queue`),
  engineSubmitReview: (payload: {
    dept_id: string;
    transaction_id: string;
    label: ReviewLabel;
    note?: string | null;
    finding_id?: string | null;
    source?: ReviewSource;
  }) =>
    request<ReviewResponse>('/forensic-engine/review', {
      method: 'POST',
      body: JSON.stringify({
        dept_id: payload.dept_id,
        transaction_id: payload.transaction_id,
        label: payload.label,
        note: payload.note ?? null,
        finding_id: payload.finding_id ?? null,
        source: payload.source ?? 'alert',
      }),
    }),
  engineDeleteReview: (reviewId: string) =>
    request<{ success: boolean; review_id: string; status: CalibrationStatus | null }>(`/forensic-engine/review/${reviewId}`, {
      method: 'DELETE',
    }),
};
