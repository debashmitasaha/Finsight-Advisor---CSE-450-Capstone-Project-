import { AdminOverview, Anomaly, Company, Department, Forecast, Transaction, UserAccount } from '../types';

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
    return request('/transactions/upload', { method: 'POST', body: form });
  },
  transactions: (deptId: string) => request<Transaction[]>(`/transactions/dept/${deptId}`),
  groupingStats: (deptId: string) => request(`/grouping/dept/${deptId}/statistics`),
  runGrouping: (deptId: string) => request('/grouping/assign-groups', { method: 'POST', body: JSON.stringify({ dept_id: deptId }) }),
  categorizationSummary: (deptId: string) => request(`/categorization/dept/${deptId}/summary`),
  runCategorization: (deptId: string) => request('/categorization/predict', { method: 'POST', body: JSON.stringify({ dept_id: deptId }) }),
  runForecast: (deptId: string, monthsAhead = 1) => request<{ forecasts: Forecast[]; history: { month: string; amount: number }[] }>('/budget/forecast', {
    method: 'POST',
    body: JSON.stringify({ dept_id: deptId, months_ahead: monthsAhead }),
  }),
  forecasts: (deptId: string) => request<Forecast[]>(`/budget/dept/${deptId}/forecasts`),
  runForensic: (deptId: string, month: number, year: number) => request('/forensic/analyze', {
    method: 'POST',
    body: JSON.stringify({ dept_id: deptId, month, year }),
  }),
  anomalies: (deptId: string) => request<Anomaly[]>(`/forensic/dept/${deptId}/anomalies`),
};
