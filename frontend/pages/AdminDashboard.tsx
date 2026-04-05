import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, CheckCircle2, FileUp, PlayCircle } from 'lucide-react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { Anomaly, Department, Forecast, Transaction, UserAccount } from '../types';
import { COLORS } from '../constants';

interface AdminDashboardProps {
  user: UserAccount;
  onLogout: () => void;
}

const cardStyle = 'bg-white p-6 rounded-3xl border border-slate-200 shadow-sm';

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

  const loadBase = async () => {
    const [departmentData, userData] = await Promise.all([api.departments(), api.users()]);
    setDepartments(departmentData);
    setEmployees(userData);
    if (!selectedDeptId && departmentData[0]) {
      setSelectedDeptId(departmentData[0].department_id);
    }
  };

  const loadDepartmentData = async (departmentId: string) => {
    if (!departmentId) return;
    const [transactionData, forecastData, anomalyData, groupingData, categorizationData] = await Promise.all([
      api.transactions(departmentId),
      api.forecasts(departmentId),
      api.anomalies(departmentId),
      api.groupingStats(departmentId),
      api.categorizationSummary(departmentId),
    ]);
    setTransactions(transactionData);
    setForecasts(forecastData);
    setAnomalies(anomalyData);
    setGroupingStats(groupingData);
    setCategorizationSummary(categorizationData);
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

  const overview = (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Department Operations</h1>
        <p className="text-slate-500 mt-2">Upload files, run the analytics pipeline, and review forecasts and anomalies in one place.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <MetricCard icon={FileUp} label="Transactions" value={transactions.length} />
        <MetricCard icon={BarChart3} label="Groups" value={groupingStats?.total_groups || 0} />
        <MetricCard icon={CheckCircle2} label="Necessary" value={categorizationSummary?.necessary || 0} />
        <MetricCard icon={AlertTriangle} label="Anomalies" value={anomalies.length} />
      </div>
      {selectedDepartment && (
        <div className={cardStyle}>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Selected Department</h2>
          <p className="text-slate-700 font-semibold">{selectedDepartment.department_name}</p>
          <p className="text-sm text-slate-500">Budget: TK {Number(selectedDepartment.annual_budget || 0).toLocaleString()}</p>
        </div>
      )}
    </div>
  );

  const deptControl = (
    <div className="grid grid-cols-1 xl:grid-cols-[0.9fr,1.1fr] gap-8">
      <form className={cardStyle} onSubmit={handleUpload}>
        <h2 className="text-xl font-bold text-slate-900 mb-4">Upload Transactions</h2>
        <select value={selectedDeptId} onChange={(e) => setSelectedDeptId(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 mb-3">
          {departments.map((department) => <option key={department.department_id} value={department.department_id}>{department.department_name}</option>)}
        </select>
        <input type="file" accept=".csv,.xls,.xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
        <button className="mt-4 w-full rounded-2xl bg-blue-600 text-white py-3 font-bold">Upload File</button>
      </form>
      <div className={cardStyle}>
        <h2 className="text-xl font-bold text-slate-900 mb-4">Pipeline Controls</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ActionButton label="Run Grouping" onClick={() => triggerAction('group')} />
          <ActionButton label="Run Categorization" onClick={() => triggerAction('categorize')} />
          <ActionButton label="Forecast Budget" onClick={() => triggerAction('forecast')} />
          <ActionButton label="Run Forensic" onClick={() => triggerAction('forensic')} />
        </div>
        {status && <p className="text-sm text-blue-600 mt-4">{status}</p>}
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
    <div className="space-y-8">
      <div className={cardStyle}>
        <h2 className="text-xl font-bold text-slate-900 mb-4">Categorization Summary</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SummaryPill label="Necessary" value={categorizationSummary?.necessary || 0} tone="necessary" />
          <SummaryPill label="Unnecessary" value={categorizationSummary?.unnecessary || 0} tone="unnecessary" />
          <SummaryPill label="Uncategorized" value={categorizationSummary?.uncategorized || 0} tone="uncategorized" />
        </div>
      </div>
      <div className={cardStyle}>
        <h2 className="text-xl font-bold text-slate-900 mb-4">Transactions</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-slate-500">
                <th className="py-3">Date</th>
                <th className="py-3">Description</th>
                <th className="py-3">Amount</th>
                <th className="py-3">Group</th>
                <th className="py-3">Category</th>
              </tr>
            </thead>
            <tbody>
              {transactions.slice(0, 25).map((transaction) => (
                <tr key={transaction.transaction_id} className="border-t border-slate-100 text-sm text-slate-700 align-top">
                  <td className="py-3">{new Date(transaction.transaction_date).toLocaleDateString()}</td>
                  <td className="py-3">
                    <p className="font-semibold text-slate-900">{transaction.description || 'No description'}</p>
                    {transaction.is_flagged && <p className="text-xs text-red-500 mt-1">{transaction.flagged_reason}</p>}
                  </td>
                  <td className="py-3">TK {transaction.amount.toLocaleString()}</td>
                  <td className="py-3">{transaction.group_name || 'Not grouped'}</td>
                  <td className="py-3">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold border ${COLORS[transaction.category || 'uncategorized'] || COLORS.uncategorized}`}>
                      {transaction.category || 'uncategorized'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const employeesView = (
    <div className={cardStyle}>
      <h2 className="text-xl font-bold text-slate-900 mb-4">Company Users</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {employees.map((employee) => (
          <div key={employee.user_id} className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
            <p className="font-semibold text-slate-900">{employee.name}</p>
            <p className="text-sm text-slate-500">{employee.email}</p>
            <p className="text-xs text-slate-400 mt-1">{employee.account_type}</p>
          </div>
        ))}
      </div>
    </div>
  );

  const content = loading
    ? <p className="text-slate-500">Loading admin workspace...</p>
    : activePath === '/dashboard' ? overview : activePath === '/dept-control' ? deptControl : activePath === '/dept-status' ? deptStatus : activePath === '/reports' || activePath === '/audit-logs' ? reports : employeesView;

  return <Layout user={user} onLogout={onLogout} activePath={activePath} onNavigate={setActivePath}>{content}</Layout>;
};

const MetricCard = ({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) => (
  <div className={cardStyle}>
    <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4"><Icon size={24} /></div>
    <p className="text-sm uppercase tracking-wider text-slate-500 font-bold">{label}</p>
    <p className="text-3xl font-extrabold text-slate-900 mt-1">{value}</p>
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

export default AdminDashboard;
