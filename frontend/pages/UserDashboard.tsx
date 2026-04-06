import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Building2, ShieldAlert, Wallet } from 'lucide-react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { Anomaly, Department, Forecast, Transaction, UserAccount } from '../types';
import { COLORS } from '../constants';

interface UserDashboardProps {
  user: UserAccount;
  onLogout: () => void;
}

const cardStyle = 'bg-white p-6 rounded-3xl border border-slate-200 shadow-sm';

const getErrorMessage = (err: unknown, fallback: string) => err instanceof Error ? err.message : fallback;

const UserDashboard: React.FC<UserDashboardProps> = ({ user, onLogout }) => {
  const [activePath, setActivePath] = useState('/departments');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setStatus(null);
      try {
        const departmentData = await api.departments(user.company_id || undefined);
        const allowed = user.departments.length
          ? departmentData.filter((department) => user.departments.some((role) => role.department_id === department.department_id))
          : departmentData;
        setDepartments(allowed);
        if (allowed[0]) setSelectedDeptId(allowed[0].department_id);
      } catch (err) {
        setStatus(getErrorMessage(err, 'Unable to load departments'));
      } finally {
        setLoading(false);
      }
    })();
  }, [user.company_id, user.departments]);

  useEffect(() => {
    if (!selectedDeptId) return;
    (async () => {
      setStatus(null);
      const [transactionResult, forecastResult, anomalyResult] = await Promise.allSettled([
          api.transactions(selectedDeptId),
          api.forecasts(selectedDeptId),
          api.anomalies(selectedDeptId),
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

      if (failures.length) {
        setStatus(failures.join(' | '));
      }
    })();
  }, [selectedDeptId]);

  const selectedDepartment = useMemo(() => departments.find((department) => department.department_id === selectedDeptId) || null, [departments, selectedDeptId]);

  const departmentView = (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Department Overview</h1>
        <p className="text-slate-500 mt-2">Browse the departments you can access and inspect transaction intelligence outputs.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard icon={Building2} label="Departments" value={departments.length} />
        <StatCard icon={Wallet} label="Transactions" value={transactions.length} />
        <StatCard icon={AlertTriangle} label="Flags" value={transactions.filter((transaction) => transaction.is_flagged).length} />
      </div>
      <div className={cardStyle}>
        <select value={selectedDeptId} onChange={(e) => setSelectedDeptId(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 mb-4">
          {departments.map((department) => <option key={department.department_id} value={department.department_id}>{department.department_name}</option>)}
        </select>
        {selectedDepartment && (
          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-5">
            <p className="font-bold text-slate-900">{selectedDepartment.department_name}</p>
            <p className="text-sm text-slate-500">Annual budget: TK {Number(selectedDepartment.annual_budget || 0).toLocaleString()}</p>
          </div>
        )}
      </div>
    </div>
  );

  const analysisView = (
    <div className="grid grid-cols-1 xl:grid-cols-[1.1fr,0.9fr] gap-8">
      <div className={cardStyle}>
        <h2 className="text-xl font-bold text-slate-900 mb-4">Recent Transactions</h2>
        <div className="space-y-3 max-h-[520px] overflow-auto">
          {transactions.slice(0, 20).map((transaction) => (
            <div key={transaction.transaction_id} className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold text-slate-900">{transaction.description || 'No description'}</p>
                  <p className="text-sm text-slate-500 mt-1">{transaction.group_name || 'Not grouped'} • {new Date(transaction.transaction_date).toLocaleDateString()}</p>
                  {transaction.flagged_reason && <p className="text-xs text-red-500 mt-2">{transaction.flagged_reason}</p>}
                </div>
                <div className="text-right">
                  <p className="font-bold text-slate-900">TK {transaction.amount.toLocaleString()}</p>
                  <span className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-bold border ${COLORS[transaction.category || 'uncategorized'] || COLORS.uncategorized}`}>
                    {transaction.category || 'uncategorized'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-8">
        <div className={cardStyle}>
          <h2 className="text-xl font-bold text-slate-900 mb-4">Forecasts</h2>
          <div className="space-y-3">
            {forecasts.slice(0, 3).map((forecast) => (
              <div key={forecast.forecast_id} className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
                <p className="font-semibold text-slate-900">{forecast.forecast_period_start}</p>
                <p className="text-sm text-slate-500">Expected spend: TK {forecast.predicted_amount.toLocaleString()}</p>
              </div>
            ))}
            {!forecasts.length && <p className="text-sm text-slate-500">No forecasts yet for this department.</p>}
          </div>
        </div>
        <div className={cardStyle}>
          <h2 className="text-xl font-bold text-slate-900 mb-4">Forensic Alerts</h2>
          <div className="space-y-3">
            {anomalies.slice(0, 6).map((anomaly) => (
              <div key={anomaly.anomaly_id} className="rounded-2xl bg-red-50 border border-red-100 p-4">
                <p className="font-semibold text-slate-900">{anomaly.anomaly_type.toUpperCase()}</p>
                <p className="text-sm text-slate-500">Score {anomaly.score.toFixed(2)}</p>
              </div>
            ))}
            {!anomalies.length && <p className="text-sm text-slate-500">No open anomalies right now.</p>}
          </div>
        </div>
      </div>
    </div>
  );

  const historyView = (
    <div className={cardStyle}>
      <h2 className="text-xl font-bold text-slate-900 mb-4">Transaction History</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-slate-500">
              <th className="py-3">Date</th>
              <th className="py-3">Description</th>
              <th className="py-3">Amount</th>
              <th className="py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((transaction) => (
              <tr key={transaction.transaction_id} className="border-t border-slate-100 text-sm text-slate-700">
                <td className="py-3">{new Date(transaction.transaction_date).toLocaleDateString()}</td>
                <td className="py-3">{transaction.description || 'No description'}</td>
                <td className="py-3">TK {transaction.amount.toLocaleString()}</td>
                <td className="py-3">{transaction.approval_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const content = loading
    ? <p className="text-slate-500">Loading your workspace...</p>
    : activePath === '/departments' ? departmentView : activePath === '/analysis' ? analysisView : historyView;

  return (
    <Layout user={user} onLogout={onLogout} activePath={activePath} onNavigate={setActivePath}>
      {status && <p className="text-sm text-blue-600 mb-4">{status}</p>}
      {content}
    </Layout>
  );
};

const StatCard = ({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) => (
  <div className={cardStyle}>
    <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4"><Icon size={24} /></div>
    <p className="text-sm uppercase tracking-wider text-slate-500 font-bold">{label}</p>
    <p className="text-3xl font-extrabold text-slate-900 mt-1">{value}</p>
  </div>
);

export default UserDashboard;
