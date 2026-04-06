import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowRight, BarChart3, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, FileUp, PieChart, PlayCircle, Plus, Settings, Shield, ShieldAlert, Table, TrendingUp, Upload, X, Zap } from 'lucide-react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { Anomaly, Department, Forecast, Transaction, UserAccount } from '../types';
import { COLORS } from '../constants';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface AdminDashboardProps {
  user: UserAccount;
  onLogout: () => void;
}

const cardStyle = 'bg-white p-6 rounded-3xl border border-slate-200 shadow-sm';
const MAX_ANNUAL_BUDGET = 9999999999999.99;
const EMPLOYEE_SCOPE_OPTIONS = [
  { id: 'transactions:view', label: 'View Ledger' },
  { id: 'transactions:edit', label: 'Modify Class' },
  { id: 'cases:view', label: 'Forensic Access' },
  { id: 'budgets:view', label: 'View Analytics' },
] as const;

const getErrorMessage = (err: unknown, fallback: string) => err instanceof Error ? err.message : fallback;

const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, onLogout }) => {
  const [activePath, setActivePath] = useState('/dashboard');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [groupingStats, setGroupingStats] = useState<any>(null);
  const [categorizationSummary, setCategorizationSummary] = useState<any>(null);
  const [employees, setEmployees] = useState<UserAccount[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [modalMode, setModalMode] = useState<'upload' | 'create'>('upload');
  const [selectedDeptStatusId, setSelectedDeptStatusId] = useState<string | null>(null);
  const [activeDeptTab, setActiveDeptTab] = useState<'overview' | 'transactions' | 'forensic' | 'budget'>('overview');
  const [budgetDraft, setBudgetDraft] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);
  const [isBudgetEditing, setIsBudgetEditing] = useState(false);

  const loadBase = async () => {
    setStatus(null);
    const [departmentResult, userResult] = await Promise.allSettled([api.departments(), api.users()]);
    const failures: string[] = [];

    if (departmentResult.status === 'fulfilled') {
      setDepartments(departmentResult.value);
      if (!selectedDeptId && departmentResult.value[0]) {
        setSelectedDeptId(departmentResult.value[0].department_id);
      }
    } else {
      setDepartments([]);
      failures.push(`departments: ${getErrorMessage(departmentResult.reason, 'Unable to load departments')}`);
    }

    if (userResult.status === 'fulfilled') {
      setEmployees(userResult.value);
    } else {
      setEmployees([]);
      failures.push(`users: ${getErrorMessage(userResult.reason, 'Unable to load users')}`);
    }

    if (failures.length) {
      setStatus(failures.join(' | '));
    }
  };

  const loadDepartmentData = async (departmentId: string) => {
    if (!departmentId) return;
    setStatus(null);
    const [transactionResult, forecastResult, anomalyResult, groupingResult, categorizationResult] = await Promise.allSettled([
      api.transactions(departmentId),
      api.forecasts(departmentId),
      api.anomalies(departmentId),
      api.groupingStats(departmentId),
      api.categorizationSummary(departmentId),
    ]);

    const failures: string[] = [];

    if (transactionResult.status === 'fulfilled') {
      setTransactions(transactionResult.value);
    } else {
      setTransactions([]);
      failures.push(`transactions: ${getErrorMessage(transactionResult.reason, 'Unable to load transactions')}`);
    }

    if (forecastResult.status === 'fulfilled') {
      setForecasts(forecastResult.value);
    } else {
      setForecasts([]);
      failures.push(`forecasts: ${getErrorMessage(forecastResult.reason, 'Unable to load forecasts')}`);
    }

    if (anomalyResult.status === 'fulfilled') {
      setAnomalies(anomalyResult.value);
    } else {
      setAnomalies([]);
      failures.push(`anomalies: ${getErrorMessage(anomalyResult.reason, 'Unable to load anomalies')}`);
    }

    if (groupingResult.status === 'fulfilled') {
      setGroupingStats(groupingResult.value);
    } else {
      setGroupingStats(null);
      failures.push(`grouping: ${getErrorMessage(groupingResult.reason, 'Unable to load grouping stats')}`);
    }

    if (categorizationResult.status === 'fulfilled') {
      setCategorizationSummary(categorizationResult.value);
    } else {
      setCategorizationSummary(null);
      failures.push(`categorization: ${getErrorMessage(categorizationResult.reason, 'Unable to load categorization summary')}`);
    }

    if (failures.length) {
      setStatus(failures.join(' | '));
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await loadBase();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (selectedDeptId) {
      loadDepartmentData(selectedDeptId).catch((err) => setStatus(err.message));
    }
  }, [selectedDeptId]);

  const selectedDepartment = useMemo(() => departments.find((department) => department.department_id === selectedDeptId) || null, [departments, selectedDeptId]);

  useEffect(() => {
    setBudgetDraft(selectedDepartment ? String(Number(selectedDepartment.annual_budget || 0)) : '');
    setIsBudgetEditing(false);
  }, [selectedDepartment]);

  const totalUsedBudget = useMemo(
    () => departments.reduce((sum, department) => sum + Number(department.used_budget_current_year || 0), 0),
    [departments],
  );
  const flaggedTransactions = useMemo(
    () => transactions.filter((transaction) => transaction.is_flagged).length,
    [transactions],
  );

  const triggerAction = async (action: 'group' | 'categorize' | 'forecast' | 'forensic') => {
    if (!selectedDeptId) return;
    setStatus(`Running ${action}...`);
    const now = new Date();
    if (action === 'group') await api.runGrouping(selectedDeptId);
    if (action === 'categorize') await api.runCategorization(selectedDeptId);
    if (action === 'forecast') await api.runForecast(selectedDeptId, 1);
    if (action === 'forensic') await api.runForensic(selectedDeptId, now.getMonth() + 1, now.getFullYear());
    await loadDepartmentData(selectedDeptId);
    setStatus(`${action} completed successfully.`);
  };

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedDeptId || !file) return;
    setStatus('Uploading transactions...');
    await api.uploadTransactions(selectedDeptId, file);
    await loadDepartmentData(selectedDeptId);
    setStatus('Upload complete.');
    setFile(null);
  };

  const openUploadModal = (departmentId: string) => {
    setSelectedDeptId(departmentId);
    setModalMode('upload');
    setShowDeptModal(true);
    setFile(null);
  };

  const openCreateModal = () => {
    setModalMode('create');
    setShowDeptModal(true);
    setFile(null);
  };

  const openDepartmentStatus = (departmentId: string) => {
    setSelectedDeptId(departmentId);
    setSelectedDeptStatusId(departmentId);
    setActiveDeptTab('overview');
    setActivePath('/dept-status');
  };

  const selectedDeptStatus = useMemo(
    () => departments.find((department) => department.department_id === selectedDeptStatusId) || null,
    [departments, selectedDeptStatusId],
  );

  const handleBudgetUpdate = async () => {
    if (!selectedDepartment) return;
    const nextBudget = Number(budgetDraft);
    if (Number.isNaN(nextBudget) || nextBudget < 0) {
      setStatus('Please enter a valid annual budget.');
      return;
    }
    if (nextBudget > MAX_ANNUAL_BUDGET) {
      setStatus('Annual budget is too large. Please enter a value below 10,000,000,000,000.');
      return;
    }

    setSavingBudget(true);
    setStatus('Updating annual budget...');
    try {
      const updatedDepartment = await api.updateDepartmentBudget(selectedDepartment.department_id, nextBudget);
      setDepartments((current) =>
        current.map((department) =>
          department.department_id === updatedDepartment.department_id ? updatedDepartment : department,
        ),
      );
      setBudgetDraft(String(Number(updatedDepartment.annual_budget || 0)));
      setIsBudgetEditing(false);
      if (selectedDeptStatusId === updatedDepartment.department_id) {
        setSelectedDeptStatusId(updatedDepartment.department_id);
      }
      setStatus('Annual budget updated.');
    } catch (error) {
      setStatus(getErrorMessage(error, 'Unable to update annual budget'));
    } finally {
      setSavingBudget(false);
    }
  };

  const handleUpdateEmployeeScopes = async (userId: string, permissionsByDepartment: Record<string, string[]>) => {
    const employee = employees.find((item) => item.user_id === userId);
    const existingDepartmentIds = employee?.departments.map((role) => role.department_id) || [];
    const targetDepartmentIds = Object.keys(permissionsByDepartment);
    const departmentIds = Array.from(new Set([...existingDepartmentIds, ...targetDepartmentIds]));

    setStatus('Deploying scope updates...');
    try {
      await Promise.all(
        departmentIds.map((departmentId) =>
          api.assignRole(userId, departmentId, permissionsByDepartment[departmentId] || []),
        ),
      );
      const refreshedUsers = await api.users();
      setEmployees(refreshedUsers);
      setStatus('Employee scopes updated.');
    } catch (error) {
      setStatus(getErrorMessage(error, 'Unable to update employee scopes'));
      throw error;
    }
  };

  const overview = (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end gap-6 flex-wrap">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Organization Control</h1>
          <p className="text-slate-500 font-medium mt-1">Annual budget health and operational signals for your departments.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setActivePath('/dept-status')}
            className="bg-white border border-slate-200 p-3 rounded-2xl hover:bg-slate-50 transition-all shadow-sm"
          >
            <TrendingUp size={20} className="text-blue-500" />
          </button>
          <button
            onClick={() => setActivePath('/reports')}
            className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 shadow-lg shadow-blue-500/20 active:scale-95 transition-all"
          >
            <ShieldAlert size={18} /> Review Reports
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard icon={FileUp} label="Transactions" value={transactions.length} />
        <MetricCard icon={BarChart3} label="Business Units" value={departments.length} />
        <MetricCard icon={AlertTriangle} label="Audit Flags" value={flaggedTransactions} />
        <MetricCard icon={CheckCircle2} label="Used Budget" valueLabel={`TK ${Math.round(totalUsedBudget).toLocaleString()}`} value={totalUsedBudget} />
      </div>

      <div className="space-y-8">
        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
          <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
            <PieChart size={24} className="text-indigo-500" />
            Departmental Budget Health
          </h3>
          <div className="space-y-6">
            {departments.slice(0, 5).map((department) => {
              const utilization = Math.min(100, Math.round(Number(department.annual_budget_utilization_pct || 0)));
              return (
                <div key={department.department_id} className="space-y-2">
                  <div className="flex justify-between items-end gap-4">
                    <div>
                      <span className="font-bold text-slate-700">{department.department_name}</span>
                      <p className="text-xs text-slate-500 mt-1">
                        Used this year: TK {Number(department.used_budget_current_year || 0).toLocaleString()} of TK {Number(department.annual_budget || 0).toLocaleString()}
                      </p>
                    </div>
                    <span className="text-xs font-black text-slate-400 uppercase">{utilization}% Utilized</span>
                  </div>
                  <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full transition-all duration-700" style={{ width: `${utilization}%` }} />
                  </div>
                </div>
              );
            })}
            {!departments.length && <p className="text-sm text-slate-500">No departments available for budget analysis yet.</p>}
          </div>
        </div>

        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
          <div className="mb-6">
            <h3 className="text-lg font-bold text-slate-900">Current Department Snapshot</h3>
            <p className="text-sm text-slate-500 mt-1">Choose a department to inspect its live summary.</p>
            <select
              value={selectedDeptId}
              onChange={(event) => setSelectedDeptId(event.target.value)}
              className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none transition-all focus:border-blue-300 focus:bg-white"
            >
              {departments.map((department) => (
                <option key={department.department_id} value={department.department_id}>
                  {department.department_name}
                </option>
              ))}
            </select>
          </div>
          {selectedDepartment ? (
            <div className="space-y-6">
              <div>
                <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Department</p>
                <p className="text-2xl font-extrabold text-slate-900 mt-1">{selectedDepartment.department_name}</p>
              </div>
              <div className="grid grid-cols-1 gap-4">
                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
                  <p className="text-xs uppercase tracking-wider font-bold text-slate-500">Annual Budget</p>
                  <div className="mt-1">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={budgetDraft}
                      readOnly={!isBudgetEditing}
                      onDoubleClick={() => setIsBudgetEditing(true)}
                      onChange={(event) => setBudgetDraft(event.target.value.replace(/[^\d.]/g, ''))}
                      placeholder="Annual budget"
                      className={`w-full rounded-xl bg-transparent text-lg font-extrabold text-slate-900 outline-none ${isBudgetEditing ? 'border border-blue-200 px-3 py-2 bg-white' : 'cursor-text border border-transparent p-0'}`}
                    />
                  </div>
                  {isBudgetEditing ? (
                    <div className="mt-3 flex justify-end gap-3">
                      <button
                        onClick={() => {
                          setBudgetDraft(String(Number(selectedDepartment.annual_budget || 0)));
                          setIsBudgetEditing(false);
                        }}
                        disabled={savingBudget}
                        className="rounded-2xl bg-slate-200 px-5 py-3 text-sm font-bold text-slate-700 transition-all hover:bg-slate-300 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleBudgetUpdate}
                        disabled={savingBudget || !selectedDepartment}
                        className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition-all hover:bg-blue-700 disabled:opacity-50"
                      >
                        {savingBudget ? 'Updating...' : 'Update Budget'}
                      </button>
                    </div>
                  ) : null}
                </div>
                <SnapshotRow label="Used This Year" value={`TK ${Number(selectedDepartment.used_budget_current_year || 0).toLocaleString()}`} />
                <SnapshotRow
                  label="Budget Utilization"
                  value={`${Number(selectedDepartment.annual_budget_utilization_pct || 0).toFixed(2)}%`}
                  progress={Number(selectedDepartment.annual_budget_utilization_pct || 0)}
                />
                <SnapshotRow label="Transactions" value={String(selectedDepartment.transaction_count || 0)} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Select a department from the control section to inspect it here.</p>
          )}
        </div>
      </div>
    </div>
  );

  const deptControl = (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Department Control Center</h1>
        <p className="text-slate-500 font-medium mt-1">Initialize organizational units and ingest financial CSV records.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {departments.map((department) => {
          const referenceMonthly = Math.round(Number(department.annual_budget || 0) / 12);
          return (
            <div key={department.department_id} className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm hover:shadow-xl transition-all group hover:border-blue-300">
              <div className="flex justify-between items-start mb-6">
                <div className="w-16 h-16 bg-slate-50 text-slate-400 rounded-3xl flex items-center justify-center font-bold text-2xl group-hover:bg-blue-600 group-hover:text-white transition-all duration-300 shadow-inner">
                  <Settings size={32} />
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400">Reference Monthly</span>
                  <p className="text-2xl font-black text-slate-900 leading-none mt-1">TK {referenceMonthly.toLocaleString()}</p>
                </div>
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-2">{department.department_name}</h3>
              <div className="flex items-center gap-6 mt-8">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Master Records</span>
                  <span className="text-sm font-bold text-slate-800">{department.transaction_count || 0} Ledger Entries</span>
                </div>
              </div>
              <div className="mt-8 flex gap-3">
                <button
                  onClick={() => openUploadModal(department.department_id)}
                  className="flex-1 py-4 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm"
                >
                  <Upload size={18} />
                  Ingest CSV
                </button>
                <button
                  onClick={() => setSelectedDeptId(department.department_id)}
                  className="p-4 bg-slate-50 text-slate-400 hover:bg-slate-100 rounded-2xl transition-all shadow-sm"
                >
                  <Settings size={20} />
                </button>
              </div>
            </div>
          );
        })}
        <button
          onClick={openCreateModal}
          className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-[2.5rem] p-10 flex flex-col items-center justify-center gap-4 text-slate-400 hover:border-blue-400 hover:bg-white hover:text-blue-500 transition-all group active:scale-[0.98]"
        >
          <div className="w-16 h-16 bg-white border border-slate-100 rounded-3xl flex items-center justify-center shadow-sm group-hover:shadow-lg group-hover:scale-110 transition-all">
            <Plus size={32} />
          </div>
          <span className="text-xl font-bold block mb-1">New Business Unit</span>
        </button>
      </div>
    </div>
  );

  const reports = (
    <div className="grid grid-cols-1 xl:grid-cols-[1.1fr,0.9fr] gap-8">
      <div className={cardStyle}>
        <h2 className="text-xl font-bold text-slate-900 mb-4">Forecasts</h2>
        <div className="space-y-3">
          {forecasts.map((forecast) => (
            <div key={forecast.forecast_id} className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
              <p className="font-semibold text-slate-900">{forecast.forecast_period_start} to {forecast.forecast_period_end}</p>
              <p className="text-sm text-slate-500">Predicted: TK {forecast.predicted_amount.toLocaleString()} ({forecast.model_type})</p>
            </div>
          ))}
          {!forecasts.length && <p className="text-sm text-slate-500">No forecasts yet. Run budget prediction for this department.</p>}
        </div>
      </div>
      <div className={cardStyle}>
        <h2 className="text-xl font-bold text-slate-900 mb-4">Open Anomalies</h2>
        <div className="space-y-3 max-h-[420px] overflow-auto">
          {anomalies.map((anomaly) => (
            <div key={anomaly.anomaly_id} className="rounded-2xl bg-red-50 border border-red-100 p-4">
              <p className="font-semibold text-slate-900">{anomaly.anomaly_type.toUpperCase()}</p>
              <p className="text-sm text-slate-500">Score {anomaly.score.toFixed(2)} vs threshold {anomaly.threshold.toFixed(2)}</p>
            </div>
          ))}
          {!anomalies.length && <p className="text-sm text-slate-500">No anomalies found for this department.</p>}
        </div>
      </div>
    </div>
  );

  const deptStatus = (
    selectedDeptStatus ? (
      <DepartmentStatusDetail
        department={selectedDeptStatus}
        transactions={transactions}
        activeTab={activeDeptTab}
        onTabChange={setActiveDeptTab}
        onBack={() => setSelectedDeptStatusId(null)}
      />
    ) : (
      <div className="space-y-10 animate-in fade-in duration-500">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Fiscal Health Center</h1>
          <p className="text-slate-500 font-medium mt-1">Analytical status of each business unit.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {departments.map((department) => {
            const utilization = Math.min(100, Math.round(Number(department.annual_budget_utilization_pct || 0)));
            return (
              <div
                key={department.department_id}
                className="bg-white p-8 rounded-[2.5rem] border border-slate-200 hover:border-blue-500 transition-all group cursor-pointer shadow-sm"
                onClick={() => openDepartmentStatus(department.department_id)}
              >
                <div className="flex justify-between items-start mb-6">
                  <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-all duration-300">
                    <PieChart size={28} />
                  </div>
                </div>
                <h3 className="text-2xl font-bold text-slate-900 mb-2">{department.department_name}</h3>
                <div className="space-y-4 mt-8">
                  <div className="w-full h-2 bg-slate-100 rounded-full">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${utilization}%` }} />
                  </div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{utilization}% Budget Utilized</p>
                </div>
                <button className="w-full mt-10 py-4 bg-slate-50 text-slate-900 font-bold rounded-2xl flex items-center justify-center gap-2 group-hover:bg-blue-600 group-hover:text-white transition-all">
                  Enter Unit Analysis <ArrowRight size={18} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    )
  );

  const employeesView = (
    <EmployeeSection
      accounts={employees.filter((employee) => employee.account_type === 'EMPLOYEE')}
      departments={departments}
      onUpdatePermissions={handleUpdateEmployeeScopes}
    />
  );

  const content = loading
    ? <p className="text-slate-500">Loading admin workspace...</p>
    : activePath === '/dashboard' ? overview : activePath === '/dept-control' ? deptControl : activePath === '/dept-status' ? deptStatus : activePath === '/reports' || activePath === '/audit-logs' ? reports : employeesView;

  return (
    <Layout user={user} onLogout={onLogout} activePath={activePath} onNavigate={setActivePath}>
      {status && <p className="text-sm text-blue-600 mb-4">{status}</p>}
      {content}
      {showDeptModal && (
        <DepartmentControlModal
          mode={modalMode}
          department={departments.find((department) => department.department_id === selectedDeptId) || null}
          onClose={() => {
            setShowDeptModal(false);
            setFile(null);
          }}
          onCreateDepartment={async (payload) => {
            await api.createDepartment(payload);
            await loadBase();
            setShowDeptModal(false);
          }}
          onUploadCsv={async (departmentId, uploadFile) => {
            await api.uploadTransactions(departmentId, uploadFile);
            await loadBase();
            await loadDepartmentData(departmentId);
            setShowDeptModal(false);
            setFile(null);
            setStatus('Upload complete.');
          }}
        />
      )}
    </Layout>
  );
};

const MetricCard = ({ icon: Icon, label, value, valueLabel }: { icon: React.ElementType; label: string; value: number; valueLabel?: string }) => (
  <div className={cardStyle}>
    <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4"><Icon size={24} /></div>
    <p className="text-sm uppercase tracking-wider text-slate-500 font-bold">{label}</p>
    <p className="text-3xl font-extrabold text-slate-900 mt-1">{valueLabel ?? value}</p>
  </div>
);

const SnapshotRow = ({ label, value, progress }: { label: string; value: string; progress?: number }) => (
  <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
    <p className="text-xs uppercase tracking-wider font-bold text-slate-500">{label}</p>
    <p className="text-lg font-extrabold text-slate-900 mt-1">{value}</p>
    {typeof progress === 'number' ? (
      <div className="mt-3">
        <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-500"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      </div>
    ) : null}
  </div>
);

const ActionButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button onClick={onClick} className="rounded-2xl border border-slate-200 bg-slate-50 hover:bg-blue-600 hover:text-white px-4 py-4 font-bold flex items-center justify-center gap-2 transition-all">
    <PlayCircle size={18} /> {label}
  </button>
);

const SummaryPill = ({ label, value, tone }: { label: string; value: number; tone: string }) => (
  <div className={`rounded-2xl p-4 border ${COLORS[tone] || COLORS.uncategorized}`}>
    <p className="text-xs uppercase tracking-wider font-bold">{label}</p>
    <p className="text-2xl font-extrabold mt-1">{value}</p>
  </div>
);

const EmployeeSection = ({
  accounts,
  departments,
  onUpdatePermissions,
}: {
  accounts: UserAccount[];
  departments: Department[];
  onUpdatePermissions: (userId: string, permissionsByDepartment: Record<string, string[]>) => Promise<void>;
}) => {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const selectedEmployee = accounts.find((account) => account.user_id === selectedEmployeeId) || null;

  if (selectedEmployee) {
    return (
      <EmployeeProfile
        employee={selectedEmployee}
        departments={departments}
        onBack={() => setSelectedEmployeeId(null)}
        onUpdatePermissions={(permissions) => onUpdatePermissions(selectedEmployee.user_id, permissions)}
      />
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Personnel Directory</h1>
          <p className="text-slate-500 font-medium mt-1">Manage departmental roles and system visibility.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {accounts.map((employee) => (
          <div
            key={employee.user_id}
            className="bg-white p-6 rounded-3xl border border-slate-200 hover:border-blue-400 transition-all group cursor-pointer shadow-sm hover:shadow-lg"
            onClick={() => setSelectedEmployeeId(employee.user_id)}
          >
            <div className="flex justify-between items-start mb-4">
              <div className="w-14 h-14 bg-slate-50 text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-500 rounded-2xl flex items-center justify-center font-bold text-xl transition-all shadow-inner">
                {employee.name.charAt(0)}
              </div>
              <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-tight ${employee.is_active ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>
                {employee.is_active ? 'Active' : 'Locked'}
              </span>
            </div>
            <h3 className="text-xl font-bold text-slate-900 leading-tight mb-1">{employee.name}</h3>
            <p className="text-sm font-semibold text-slate-400 mb-4">{employee.email}</p>
            <div className="pt-6 border-t border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-500">
                <Clock size={16} />
                <span className="text-[10px] font-bold uppercase tracking-tighter">System Access</span>
              </div>
              <button className="text-blue-600 font-bold text-sm flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                Configure Scopes <ChevronRight size={16} />
              </button>
            </div>
          </div>
        ))}
        {!accounts.length && (
          <div className="col-span-full rounded-[2rem] border border-dashed border-slate-200 bg-slate-50 p-12 text-center text-slate-400 font-medium">
            No employee accounts found for this company yet.
          </div>
        )}
      </div>
    </div>
  );
};

const EmployeeProfile = ({
  employee,
  departments,
  onBack,
  onUpdatePermissions,
}: {
  employee: UserAccount;
  departments: Department[];
  onBack: () => void;
  onUpdatePermissions: (permissionsByDepartment: Record<string, string[]>) => Promise<void>;
}) => {
  const initialPermissions = useMemo(
    () =>
      employee.departments.reduce<Record<string, string[]>>((accumulator, role) => {
        accumulator[role.department_id] = role.permissions || [];
        return accumulator;
      }, {}),
    [employee],
  );
  const [permissions, setPermissions] = useState<Record<string, string[]>>(initialPermissions);
  const [showAddAccess, setShowAddAccess] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploySuccess, setDeploySuccess] = useState(false);

  useEffect(() => {
    setPermissions(initialPermissions);
    setShowAddAccess(false);
    setDeploySuccess(false);
  }, [initialPermissions]);

  const togglePermission = (departmentId: string, permissionId: string) => {
    const current = permissions[departmentId] || [];
    const next = current.includes(permissionId)
      ? current.filter((permission) => permission !== permissionId)
      : [...current, permissionId];
    setPermissions((previous) => ({ ...previous, [departmentId]: next }));
  };

  const handleAddUnitAccess = (departmentId: string) => {
    setPermissions((previous) => ({ ...previous, [departmentId]: ['transactions:view'] }));
    setShowAddAccess(false);
  };

  const deployChanges = async () => {
    setIsDeploying(true);
    try {
      await onUpdatePermissions(permissions);
      setDeploySuccess(true);
      window.setTimeout(() => setDeploySuccess(false), 1500);
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      <div className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-8 border-b border-slate-100 bg-slate-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="flex items-center gap-6">
            <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-3xl flex items-center justify-center font-bold text-3xl shadow-inner border border-blue-200">
              {employee.name.charAt(0)}
            </div>
            <div>
              <h2 className="text-3xl font-extrabold text-slate-900 leading-tight">{employee.name}</h2>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className="text-sm font-bold text-slate-400">{employee.email}</span>
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                <span className="text-xs font-bold text-emerald-600 uppercase">Authorized Corporate User</span>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={onBack} className="px-6 py-3 rounded-2xl font-bold text-slate-600 border border-slate-200 hover:bg-slate-100 transition-all active:scale-95">
              Discard Changes
            </button>
            <button
              onClick={deployChanges}
              disabled={isDeploying}
              className={`px-8 py-3 rounded-2xl font-bold text-white shadow-lg transition-all active:scale-95 flex items-center gap-2 ${deploySuccess ? 'bg-emerald-500 shadow-emerald-500/20' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/20'}`}
            >
              {isDeploying ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Deploying...
                </>
              ) : deploySuccess ? (
                <>
                  <Check size={18} />
                  Scopes Deployed
                </>
              ) : (
                'Deploy Scope Updates'
              )}
            </button>
          </div>
        </div>

        <div className="p-8 space-y-10">
          <div>
            <div className="flex items-center gap-2 mb-6 border-b border-slate-50 pb-4">
              <Shield className="text-blue-500" size={24} />
              <h3 className="text-xl font-bold text-slate-800 tracking-tight">Active Scopes & Authorization</h3>
            </div>
            <div className="space-y-8">
              {Object.keys(permissions).map((departmentId) => {
                const department = departments.find((item) => item.department_id === departmentId);
                if (!department) return null;
                return (
                  <div key={departmentId} className="bg-slate-50/50 border border-slate-200 rounded-3xl p-6 lg:p-8 animate-in slide-in-from-top-2 duration-300 shadow-sm">
                    <div className="flex justify-between items-center mb-6 gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white border border-slate-200 rounded-xl flex items-center justify-center text-blue-500 shadow-sm">
                          <Table size={18} />
                        </div>
                        <h4 className="text-lg font-bold text-slate-800">{department.department_name}</h4>
                      </div>
                      <button
                        onClick={() => {
                          const updated = { ...permissions };
                          delete updated[departmentId];
                          setPermissions(updated);
                        }}
                        className="text-red-500 hover:text-red-600 text-[10px] font-black uppercase tracking-widest px-4 py-2 bg-white border border-red-100 rounded-xl transition-all shadow-sm active:scale-95"
                      >
                        Revoke Access
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      {EMPLOYEE_SCOPE_OPTIONS.map((permission) => {
                        const isActive = permissions[departmentId]?.includes(permission.id);
                        return (
                          <div
                            key={permission.id}
                            className={`flex items-center justify-between p-4 rounded-2xl border transition-all cursor-pointer ${isActive ? 'bg-white border-blue-400 shadow-md ring-1 ring-blue-400' : 'bg-white/40 border-slate-200 opacity-60 hover:opacity-100 hover:bg-white'}`}
                            onClick={() => togglePermission(departmentId, permission.id)}
                          >
                            <span className={`text-[11px] font-bold uppercase tracking-tight ${isActive ? 'text-slate-900' : 'text-slate-400'}`}>{permission.label}</span>
                            <div className={`w-8 h-4 rounded-full p-0.5 transition-colors ${isActive ? 'bg-blue-500' : 'bg-slate-300'}`}>
                              <div className={`w-3 h-3 bg-white rounded-full transition-transform ${isActive ? 'translate-x-4' : 'translate-x-0'}`}></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              <div className="pt-6 flex justify-center relative">
                <button
                  onClick={() => setShowAddAccess(!showAddAccess)}
                  className="flex items-center gap-3 text-blue-600 font-bold hover:bg-blue-50 px-8 py-4 rounded-2xl transition-all border border-blue-100 shadow-sm bg-white"
                >
                  <Plus size={20} />
                  Grant New Unit Access
                </button>

                {showAddAccess && (
                  <div className="absolute bottom-full mb-4 w-72 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 p-3 overflow-hidden animate-in fade-in zoom-in-95 origin-bottom">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest p-2 border-b border-slate-50 mb-2">Available Organizations</p>
                    <div className="max-h-56 overflow-y-auto space-y-1">
                      {departments.filter((department) => !permissions[department.department_id]).map((department) => (
                        <button
                          key={department.department_id}
                          onClick={() => handleAddUnitAccess(department.department_id)}
                          className="w-full text-left p-3 hover:bg-blue-600 hover:text-white text-sm font-bold text-slate-700 transition-all rounded-xl flex justify-between items-center group"
                        >
                          <span>{department.department_name}</span>
                          <ArrowRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      ))}
                      {departments.filter((department) => !permissions[department.department_id]).length === 0 && (
                        <p className="p-8 text-xs italic text-slate-400 text-center font-medium">No further business units left to authorize.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const DepartmentStatusDetail = ({
  department,
  transactions,
  activeTab,
  onTabChange,
  onBack,
}: {
  department: Department;
  transactions: Transaction[];
  activeTab: 'overview' | 'transactions' | 'forensic' | 'budget';
  onTabChange: (tab: 'overview' | 'transactions' | 'forensic' | 'budget') => void;
  onBack: () => void;
}) => {
  const tabs = [
    { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
    { id: 'transactions' as const, label: 'Unit Ledger', icon: Table },
    { id: 'forensic' as const, label: 'Audit Hub', icon: ShieldAlert },
    { id: 'budget' as const, label: 'Predictive', icon: Zap },
  ];

  return (
    <div className="space-y-8 animate-in slide-in-from-right-4 duration-500">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-4 bg-white border border-slate-200 rounded-2xl text-slate-500 hover:text-blue-600 hover:border-blue-200 transition-all shadow-sm active:scale-95">
            <ChevronLeft size={24} />
          </button>
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">{department.department_name} Status</h1>
            <p className="text-slate-400 font-bold uppercase tracking-[0.15em] text-[10px] mt-1">Real-time Fiscal Analysis Interface</p>
          </div>
        </div>
        <nav className="flex p-2 bg-slate-200/50 backdrop-blur rounded-2xl w-full lg:w-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex-1 lg:flex-none flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-white text-blue-600 shadow-md' : 'text-slate-500 hover:text-slate-800'}`}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-slate-200 p-8 shadow-sm min-h-[500px]">
        {activeTab === 'overview' && <DepartmentOverviewTab department={department} transactions={transactions} />}
        {activeTab === 'transactions' && <DepartmentLedgerTab transactions={transactions} />}
        {activeTab === 'forensic' && <DepartmentForensicTab department={department} />}
        {activeTab === 'budget' && <DepartmentPredictiveTab department={department} />}
      </div>
    </div>
  );
};

const DepartmentOverviewTab = ({ department, transactions }: { department: Department; transactions: Transaction[] }) => {
  const ledgerItems = transactions.length;
  const debitTransactions = transactions.filter((transaction) => transaction.transaction_type === 'debit');
  const creditTransactions = transactions.filter((transaction) => transaction.transaction_type === 'credit');
  const spendingTransactions = debitTransactions.length ? debitTransactions : creditTransactions;
  const now = new Date();
  const currentMonthTransactions = spendingTransactions.filter((transaction) => {
    const transactionDate = new Date(transaction.transaction_date);
    return transactionDate.getFullYear() === now.getFullYear() && transactionDate.getMonth() === now.getMonth();
  });
  const actualSpending = currentMonthTransactions.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);

  const monthlySeriesMap = new Map<string, number>();
  spendingTransactions.forEach((transaction) => {
    const date = new Date(transaction.transaction_date);
    const monthKey = date.toLocaleString('en-US', { month: 'short' });
    monthlySeriesMap.set(monthKey, (monthlySeriesMap.get(monthKey) || 0) + Number(transaction.amount || 0));
  });

  const chartData = Array.from(monthlySeriesMap.entries()).map(([name, spend]) => ({ name, spend }));
  const averageMonthlySpend = chartData.length > 0
    ? actualSpending / chartData.length
    : Number(department.annual_budget || 0) / 12;

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <SummaryCard label="Unit Ledger Items" value={String(ledgerItems)} delta="" />
        <SummaryCard label="Actual Spending" value={`TK ${Math.round(actualSpending).toLocaleString()}`} delta="" />
        <SummaryCard label="Monthly Budget" value={`TK ${Math.round(averageMonthlySpend).toLocaleString()}`} delta="" />
        <SummaryCard label="Data Integrity" value="99.2%" delta="+0.1%" />
      </div>
      <div className="h-[300px] bg-slate-50/50 p-8 rounded-[2rem] border border-slate-100 shadow-inner">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData.length ? chartData : [{ name: 'No Data', spend: 0 }]}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 700 }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
            <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
            <Line type="monotone" dataKey="spend" stroke="#3b82f6" strokeWidth={4} dot={{ r: 6, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff' }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const SummaryCard = ({ label, value, delta }: { label: string; value: string; delta?: string }) => (
  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
    <p className="text-[10px] font-black text-slate-400 uppercase mb-2 tracking-widest">{label}</p>
    <div className="flex items-end justify-between">
      <p className="text-2xl font-black text-slate-900 leading-none">{value}</p>
      {delta ? <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-600">{delta}</span> : null}
    </div>
  </div>
);

const DepartmentLedgerTab = ({ transactions }: { transactions: Transaction[] }) => {
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'necessary' | 'uncategorized' | 'unnecessary'>('all');
  const filteredTransactions = categoryFilter === 'all'
    ? transactions
    : transactions.filter((transaction) => (transaction.category || 'uncategorized') === categoryFilter);
  const filterOptions: Array<'all' | 'necessary' | 'uncategorized' | 'unnecessary'> = ['all', 'necessary', 'uncategorized', 'unnecessary'];

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-6 bg-slate-50 border-b border-slate-100 flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-center">
          <div className="flex items-center justify-between gap-4">
            <h3 className="font-bold text-slate-800 flex items-center gap-2"><Table size={18} className="text-blue-500" /> Unit Ledger</h3>
            <span className="text-[10px] font-black bg-blue-100 text-blue-700 px-3 py-1 rounded-full uppercase border border-blue-200">{filteredTransactions.length} Entries</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {filterOptions.map((option) => (
              <button
                key={option}
                onClick={() => setCategoryFilter(option)}
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider border transition-all ${
                  categoryFilter === option
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-blue-200 hover:text-blue-600'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-white">
              <tr>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Description</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Category</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Type</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredTransactions.map((transaction) => (
                <tr key={transaction.transaction_id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-5 text-sm font-medium text-slate-500">{new Date(transaction.transaction_date).toLocaleDateString()}</td>
                  <td className="px-6 py-5">
                    <p className="text-sm font-bold text-slate-900">{transaction.description || 'No description'}</p>
                    <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tight">{transaction.group_name || 'Ungrouped'}</p>
                  </td>
                  <td className="px-6 py-5">
                    <span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase border tracking-tight ${COLORS[transaction.category || 'uncategorized']}`}>
                      {transaction.category || 'uncategorized'}
                    </span>
                  </td>
                  <td className="px-6 py-5 text-sm font-bold text-slate-600 uppercase">{transaction.transaction_type}</td>
                  <td className="px-6 py-5 text-sm font-black text-slate-900 text-right">TK {Math.round(transaction.amount).toLocaleString()}</td>
                </tr>
              ))}
              {!filteredTransactions.length && (
                <tr>
                  <td colSpan={5} className="px-6 py-20 text-center text-slate-400 italic font-medium">No ledger records match the selected category.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const DepartmentForensicTab = ({ department }: { department: Department }) => (
  <div className="space-y-8 animate-in fade-in duration-700">
    <div className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-sm">
      <div className="p-6 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
        <h3 className="font-bold text-slate-800 flex items-center gap-2"><ShieldAlert size={18} className="text-amber-500" /> Audit Hub</h3>
        <span className="text-[10px] font-black bg-amber-100 text-amber-700 px-3 py-1 rounded-full uppercase border border-amber-200">Demo Layout</span>
      </div>
      <div className="p-8 space-y-4">
        <p className="text-xl font-bold text-slate-900">Forensic monitoring for {department.department_name}</p>
        <p className="text-slate-500">This section is kept as a placeholder for now, but follows the demo analysis layout.</p>
      </div>
    </div>
  </div>
);

const DepartmentPredictiveTab = ({ department }: { department: Department }) => (
  <div className="space-y-8 animate-in fade-in duration-700">
    <div className="flex items-center gap-6 p-10 bg-slate-900 text-white rounded-[2.5rem] shadow-2xl overflow-hidden relative">
      <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/10 rounded-full blur-[60px] -mr-32 -mt-32" />
      <div className="w-24 h-24 bg-blue-600 text-white rounded-3xl flex items-center justify-center font-black text-3xl shadow-xl border border-white/10 relative z-10">94%</div>
      <div className="relative z-10">
        <h3 className="text-3xl font-black tracking-tight">Predictive Provisioning Suite</h3>
        <p className="text-slate-400 font-medium leading-relaxed max-w-xl mt-2">Predictive analysis for {department.department_name} will appear here. The layout is now aligned with the demo.</p>
      </div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="p-8 bg-slate-50 border border-slate-100 rounded-[2rem] space-y-4">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Est. Year-End Carryover</p>
        <p className="text-3xl font-black text-slate-900">TK 24,500</p>
      </div>
      <div className="p-8 bg-slate-50 border border-slate-100 rounded-[2rem] space-y-4">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Anomalous Risk Factor</p>
        <p className="text-3xl font-black text-emerald-600">0.02</p>
      </div>
      <div className="p-8 bg-slate-50 border border-slate-100 rounded-[2rem] space-y-4">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Optimization Score</p>
        <p className="text-3xl font-black text-blue-600">9.4/10</p>
      </div>
    </div>
  </div>
);

const DepartmentControlModal = ({
  mode,
  department,
  onClose,
  onCreateDepartment,
  onUploadCsv,
}: {
  mode: 'upload' | 'create';
  department: Department | null;
  onClose: () => void;
  onCreateDepartment: (payload: { department_name: string; annual_budget: number; company_id?: string | null }) => Promise<void>;
  onUploadCsv: (departmentId: string, file: File) => Promise<void>;
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [deptName, setDeptName] = useState(department?.department_name || '');
  const [budget, setBudget] = useState(Number(department?.annual_budget || 500000));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setDeptName(department?.department_name || '');
    setBudget(Number(department?.annual_budget || 500000));
    setFile(null);
  }, [department, mode]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      if (mode === 'create') {
        await onCreateDepartment({
          department_name: deptName,
          annual_budget: Number(budget),
          company_id: null,
        });
      } else if (department && file) {
        await onUploadCsv(department.department_id, file);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="relative bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">{mode === 'create' ? 'Init Business Unit' : 'Append Records'}</h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl transition-all"><X size={20} /></button>
        </div>
        <div className="p-8 space-y-8">
          {mode === 'create' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Unit Identifier</label>
                <input type="text" value={deptName} onChange={(event) => setDeptName(event.target.value)} className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="e.g. Dhaka Ops" />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Annual Provision (TK)</label>
                <input type="number" value={budget} onChange={(event) => setBudget(Number(event.target.value))} className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="500000" />
              </div>
            </div>
          )}
          {mode === 'upload' && department && (
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-sm font-bold text-slate-900">{department.department_name}</p>
              <p className="text-xs text-slate-500 mt-1">Expected CSV columns: `transaction_date`, `vouchar_number/invoice_number`, `narration`, `chart_of_acc_head`, `account_head_group`, `debit`, `credit`, `vouchar_type`</p>
            </div>
          )}
          <input type="file" id="csv-upload-live" className="hidden" accept=".csv,.xls,.xlsx" onChange={(event) => event.target.files?.[0] && setFile(event.target.files[0])} />
          <label htmlFor="csv-upload-live" className={`border-4 border-dashed rounded-[2rem] p-16 bg-slate-50 flex flex-col items-center justify-center cursor-pointer group transition-all ${file ? 'border-blue-500 bg-blue-50/20' : 'border-slate-100 hover:border-blue-400 hover:bg-white'}`}>
            <div className={`p-6 rounded-3xl mb-4 transition-all ${file ? 'bg-blue-600 text-white' : 'bg-white text-blue-500 shadow-sm'}`}>
              <Upload size={32} />
            </div>
            <span className="text-xl font-bold text-slate-800">{file ? file.name : 'Drop CSV here or Browse'}</span>
            <p className="text-xs text-slate-400 mt-2 font-medium">Supports CSV, XLS, and XLSX ingestion.</p>
          </label>
          <div className="flex gap-4">
            <button onClick={onClose} className="flex-1 py-4 font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-2xl transition-all active:scale-95" disabled={submitting}>Discard</button>
            <button
              disabled={(mode === 'create' && !deptName) || (mode === 'upload' && !file) || submitting}
              onClick={handleSubmit}
              className="flex-2 px-10 py-4 font-bold text-white bg-blue-600 disabled:opacity-50 hover:bg-blue-700 rounded-2xl transition-all shadow-xl shadow-blue-500/20 active:scale-95"
            >
              {mode === 'create' ? 'Create Department' : 'Deploy Financial Data'}
            </button>
          </div>
        </div>
        {submitting && mode === 'upload' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
            <div className="mx-6 w-full max-w-md rounded-[2rem] bg-white p-8 text-center shadow-2xl">
              <div className="mx-auto mb-5 h-14 w-14 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
              <h3 className="text-2xl font-black text-slate-900">Uploading Transactions</h3>
              <p className="mt-2 text-sm font-medium text-slate-500">
                Your file is being ingested now. This screen will close automatically when the upload completes.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
