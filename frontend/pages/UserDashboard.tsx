import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  Clock3,
  LineChart,
  Shield,
  ShieldAlert,
  Table2,
  Wallet,
  Zap,
} from 'lucide-react';
import Layout from '../components/Layout';
import LoadingState from '../components/LoadingState';
import { api } from '../lib/api';
import { Anomaly, Department, Forecast, ForecastDiagnostics, Transaction, UserAccount } from '../types';
import { COLORS } from '../constants';

interface UserDashboardProps {
  user: UserAccount;
  onLogout: () => void;
}

const shellCard = 'rounded-[32px] border border-slate-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]';

const UserDashboard: React.FC<UserDashboardProps> = ({ user, onLogout }) => {
  const [activePath, setActivePath] = useState('/departments');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [forecastDiagnostics, setForecastDiagnostics] = useState<ForecastDiagnostics | null>(null);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const departmentData = await api.departments(user.company_id || undefined);
        const allowed = user.departments.length
          ? departmentData.filter((department) => user.departments.some((role) => role.department_id === department.department_id))
          : departmentData;
        setDepartments(allowed);
        if (allowed[0]) setSelectedDeptId(allowed[0].department_id);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : 'Unable to load departments');
      } finally {
        setLoading(false);
      }
    })();
  }, [user.company_id, user.departments]);

  useEffect(() => {
    if (!selectedDeptId) return;
    (async () => {
      try {
        const [transactionData, forecastContext, anomalyData] = await Promise.all([
          api.transactions(selectedDeptId),
          api.forecastContext(selectedDeptId, { monthsAhead: 6 }),
          api.anomalies(selectedDeptId),
        ]);
        setTransactions(transactionData);
        setForecasts(forecastContext.forecasts);
        setForecastDiagnostics(forecastContext.diagnostics);
        setAnomalies(anomalyData);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : 'Unable to load department data');
      }
    })();
  }, [selectedDeptId]);

  const selectedDepartment = useMemo(
    () => departments.find((department) => department.department_id === selectedDeptId) || null,
    [departments, selectedDeptId],
  );

  const annualBudget = Number(selectedDepartment?.annual_budget || 0);
  const orderedForecasts = useMemo(
    () => [...forecasts].sort((left, right) => left.forecast_period_start.localeCompare(right.forecast_period_start)),
    [forecasts],
  );
  const projectedSpend = orderedForecasts[0]?.predicted_amount || 0;
  const flaggedCount = transactions.filter((transaction) => transaction.is_flagged).length;
  const confidenceScore = forecastDiagnostics?.mape !== null && forecastDiagnostics?.mape !== undefined
    ? Math.max(0, Math.round(100 - forecastDiagnostics.mape))
    : (forecasts.length ? Math.max(82, 96 - anomalies.length * 2) : 94);
  const carryover = Math.max(0, Math.round(annualBudget / 12 - projectedSpend));
  const varianceRisk = forecastDiagnostics?.mape !== null && forecastDiagnostics?.mape !== undefined
    ? forecastDiagnostics.mape > 30 ? 'Elevated' : forecastDiagnostics.mape > 15 ? 'Moderate' : 'Negligible'
    : (anomalies.length > 2 ? 'Elevated' : anomalies.length > 0 ? 'Moderate' : 'Negligible');
  const auditCompliance = flaggedCount > 2 ? 'Review Needed' : flaggedCount > 0 ? 'Stable' : 'Excellent';
  const forecastCoverage = forecastDiagnostics?.train_months || 0;
  const predictionNarrative = employeeForecastNarrative(forecastDiagnostics?.notes, confidenceScore)
    || (confidenceScore >= 80
      ? 'Forecast confidence is strong and current spending patterns remain aligned with expected targets.'
      : confidenceScore >= 60
        ? 'Forecast confidence is moderate, so near-term spending should be watched for variance.'
        : 'Forecast confidence is limited, so this projection should be treated as directional guidance only.');

  const quickTabs = [
    { path: '/departments', label: 'Overview', icon: LineChart },
    { path: '/history', label: 'Full Ledger', icon: Table2 },
    { path: '/analysis', label: 'Audit Hub', icon: Shield },
    { path: '/projections', label: 'Projections', icon: Zap },
  ];

  const heroView = (
    <div className="space-y-8">
      <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-start gap-4">
          <button className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
            <ChevronLeft size={24} />
          </button>
          <div>
            <h1 className="text-4xl font-black tracking-[-0.05em] text-slate-950">
              {selectedDepartment ? `${selectedDepartment.department_name} Unit` : 'Department Unit'}
            </h1>
            <p className="mt-2 text-[11px] font-black uppercase tracking-[0.28em] text-slate-400">Fiscal Management Interface</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 xl:items-end">
          <select
            value={selectedDeptId}
            onChange={(event) => setSelectedDeptId(event.target.value)}
            disabled={!departments.length}
            className="min-h-[52px] w-full rounded-[22px] border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-[0_12px_28px_rgba(15,23,42,0.05)] outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 xl:w-72"
            aria-label="Select department"
          >
            {departments.map((department) => (
              <option key={department.department_id} value={department.department_id}>
                {department.department_name}
              </option>
            ))}
          </select>
          <div className="inline-flex rounded-[28px] bg-slate-100 p-2 shadow-inner">
            {quickTabs.map(({ path, label, icon: Icon }) => {
              const isActive = activePath === path || (path === '/projections' && activePath === '/departments');
              return (
                <button
                  key={path}
                  onClick={() => setActivePath(path === '/projections' ? '/departments' : path)}
                  className={`inline-flex items-center gap-3 rounded-[22px] px-5 py-3 text-sm font-bold transition ${
                    isActive
                      ? 'bg-white text-[#2f67ec] shadow-[0_10px_25px_rgba(15,23,42,0.08)]'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Icon size={18} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className={`${shellCard} p-8`}>
        <div className="rounded-[30px] bg-[linear-gradient(135deg,#16213c_0%,#192749_100%)] px-8 py-8 text-white shadow-[0_28px_60px_rgba(15,23,42,0.18)]">
          <div className="flex flex-col gap-6 md:flex-row md:items-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-[28px] bg-[#2f67ec] text-4xl font-black shadow-[0_20px_35px_rgba(47,103,236,0.35)]">
              {confidenceScore}%
            </div>
            <div className="max-w-3xl">
              <h2 className="text-4xl font-black tracking-[-0.04em]">Predictive Provisioning</h2>
              <p className="mt-3 text-2xl leading-relaxed text-blue-100/85">
                {predictionNarrative}
              </p>
              <div className="mt-5 flex flex-wrap gap-3 text-xs font-black uppercase tracking-[0.18em] text-blue-100/80">
                <span>Coverage {forecastCoverage} months</span>
                <span>MAPE {forecastDiagnostics?.mape !== null && forecastDiagnostics?.mape !== undefined ? `${forecastDiagnostics.mape}%` : 'N/A'}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-3">
          <MiniMetric label="Q2 Estimated Carryover" value={`TK ${carryover.toLocaleString()}`} />
          <MiniMetric label="Variance Risk" value={varianceRisk} />
          <MiniMetric label="Audit Compliance" value={auditCompliance} />
        </div>
      </div>
    </div>
  );

  const analysisView = (
    <div className="grid grid-cols-1 xl:grid-cols-[1.15fr,0.85fr] gap-8">
      <div className={`${shellCard} p-7`}>
        <SectionHeader title="Recent Transactions" description="Latest activity for the selected department." />
        <div className="mt-6 space-y-3 max-h-[560px] overflow-auto">
          {transactions.slice(0, 20).map((transaction) => (
            <div key={transaction.transaction_id} className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-bold text-slate-900">{transaction.description || 'No description'}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {transaction.group_name || 'Not grouped'} • {new Date(transaction.transaction_date).toLocaleDateString()}
                  </p>
                  {transaction.flagged_reason && <p className="mt-2 text-xs text-red-500">{transaction.flagged_reason}</p>}
                </div>
                <div className="text-right">
                  <p className="font-black text-slate-900">TK {transaction.amount.toLocaleString()}</p>
                  <span className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-bold border ${COLORS[transaction.category || 'uncategorized'] || COLORS.uncategorized}`}>
                    {transaction.category || 'uncategorized'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-8">
        <div className={`${shellCard} p-7`}>
          <SectionHeader title="Forecast Outlook" description="Upcoming projected department spend." />
          <div className="mt-5 space-y-3">
            {orderedForecasts.slice(0, 3).map((forecast) => (
              <div key={forecast.forecast_id} className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-bold text-slate-900">{formatMonthLabel(forecast.forecast_period_start)}</p>
                    <p className="mt-1 text-sm text-slate-500">Projected department spend</p>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-slate-900">TK {forecast.predicted_amount.toLocaleString()}</p>
                    <p className="text-xs text-slate-500">Range TK {forecast.lower_bound.toLocaleString()} - {forecast.upper_bound.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            ))}
            {!forecasts.length && <p className="text-sm text-slate-500">No forecasts yet for this department.</p>}
          </div>
        </div>

        <div className={`${shellCard} p-7`}>
          <SectionHeader title="Audit Hub" description="Current alerts that may need review." />
          <div className="mt-5 space-y-3">
            {anomalies.slice(0, 6).map((anomaly) => (
              <div key={anomaly.anomaly_id} className="rounded-[24px] border border-red-100 bg-red-50 p-4">
                <p className="font-bold text-slate-900">{anomaly.anomaly_type.toUpperCase()}</p>
                <p className="mt-1 text-sm text-slate-500">Score {anomaly.score.toFixed(2)}</p>
              </div>
            ))}
            {!anomalies.length && (
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                    <ShieldAlert size={20} />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">No open alerts</p>
                    <p className="text-sm text-slate-500">Everything looks stable for this department.</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const historyView = (
    <div className={`${shellCard} p-7`}>
      <SectionHeader title="Full Ledger" description="Transaction history for the selected department." />
      <div className="mt-6 mb-5">
        <select
          value={selectedDeptId}
          onChange={(e) => setSelectedDeptId(e.target.value)}
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-semibold text-slate-700"
        >
          {departments.map((department) => <option key={department.department_id} value={department.department_id}>{department.department_name}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">
              <th className="pb-4">Date</th>
              <th className="pb-4">Description</th>
              <th className="pb-4">Amount</th>
              <th className="pb-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((transaction) => (
              <tr key={transaction.transaction_id} className="border-t border-slate-100 text-sm text-slate-700">
                <td className="py-4 font-semibold">{new Date(transaction.transaction_date).toLocaleDateString()}</td>
                <td className="py-4">{transaction.description || 'No description'}</td>
                <td className="py-4 font-black">TK {transaction.amount.toLocaleString()}</td>
                <td className="py-4">{transaction.approval_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const content = loading
    ? <LoadingState label="Loading your workspace" />
    : activePath === '/analysis'
      ? analysisView
      : activePath === '/history'
        ? historyView
        : heroView;

  return (
    <Layout user={user} onLogout={onLogout} activePath={activePath} onNavigate={setActivePath}>
      {status && <p className="mb-4 text-sm font-semibold text-blue-700">{status}</p>}
      {content}
    </Layout>
  );
};

const SectionHeader = ({ title, description }: { title: string; description: string }) => (
  <div>
    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">{title}</p>
    <p className="mt-2 text-2xl font-black tracking-[-0.03em] text-slate-950">{description}</p>
  </div>
);

const MiniMetric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-[28px] border border-slate-200 bg-white px-8 py-8 shadow-[0_16px_35px_rgba(15,23,42,0.04)]">
    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">{label}</p>
    <p className="mt-4 text-4xl font-black tracking-[-0.04em] text-slate-950">{value}</p>
  </div>
);

const formatMonthLabel = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

const employeeForecastNarrative = (notes: string | null | undefined, confidenceScore: number) => {
  if (!notes) return null;
  if (notes.includes('rolling averages validated better')) {
    return confidenceScore >= 80
      ? 'Recent spending patterns are stable, and the current projection is tracking well against expected department activity.'
      : 'Recent spending patterns are being used to project near-term budget usage, with moderate confidence in the outlook.';
  }
  if (notes.includes('last-year-same-month spending')) {
    return 'This projection is based on seasonal patterns from prior months and gives a practical estimate of near-term department spending.';
  }
  if (notes.includes('Fallback trend forecast')) {
    return 'This projection is based on a simpler spending trend because there is not yet enough history for a stronger forecast.';
  }
  return notes;
};

export default UserDashboard;
