import {
  AdminOverview,
  Anomaly,
  Company,
  Department,
  Forecast,
  ForecastContextResponse,
  ForecastRunResponse,
  ForecastSourceMode,
  ForensicRunResponse,
  Transaction,
  UploadBatchSummary,
  UserAccount,
} from '../types';
const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:8000';

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
    throw new Error(payload.detail || payload.message || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

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
  users: (companyId?: string) => request<UserAccount[]>(`/admin/users${companyId ? `?company_id=${companyId}` : ''}`),
  createUser: (payload: { username: string; email: string; password: string; company_id?: string | null; is_admin: boolean }) =>
    request<UserAccount>('/admin/users', { method: 'POST', body: JSON.stringify(payload) }),
  assignRole: (userId: string, deptId: string, permissions: string[]) =>
    request(`/admin/users/${userId}/assign-role?dept_id=${encodeURIComponent(deptId)}`, {
      method: 'POST',
      body: JSON.stringify({ permissions }),
    }),
  uploadTransactions: (deptId: string, file: File) => {
    const form = new FormData();
    form.append('dept_id', deptId);
    form.append('file', file);
    return request('/transactions/upload', { method: 'POST', body: form });
  },
  transactions: (deptId: string) => request<Transaction[]>(`/transactions/dept/${deptId}`),
  groupingStats: (deptId: string) => request(`/grouping/dept/${deptId}/statistics`),
  runGrouping: (deptId: string) => request('/grouping/assign-groups', { method: 'POST', body: JSON.stringify({ dept_id: deptId }) }),
  categorizationSummary: (deptId: string) => request(`/categorization/dept/${deptId}/summary`),
  runCategorization: (deptId: string) => request('/categorization/predict', { method: 'POST', body: JSON.stringify({ dept_id: deptId }) }),
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
  runForensic: (deptId: string, month: number, year: number) => request<ForensicRunResponse>('/forensic/analyze', {
    method: 'POST',
    body: JSON.stringify({ dept_id: deptId, month, year }),
  }),
  anomalies: (deptId: string) => request<Anomaly[]>(`/forensic/dept/${deptId}/anomalies`),
  resolveAnomaly: (anomalyId: string) => request<{ success: boolean; anomaly_id: string }>(`/forensic/anomaly/${anomalyId}/resolve`, { method: 'PATCH' }),
};