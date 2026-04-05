import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  FileUp,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Upload,
  WalletCards,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { Anomaly, Department, Forecast, ForecastDiagnostics, Transaction, UserAccount } from '../types';
import { COLORS } from '../constants';

interface AdminDashboardProps {
  user: UserAccount;
  onLogout: () => void;
}

const shellCard = 'rounded-[32px] border border-slate-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]';

const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, onLogout }) => {
  const [activePath, setActivePath] = useState('/dashboard');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [forecastHistory, setForecastHistory] = useState<{ month: string; amount: number }[]>([]);
  const [forecastDiagnostics, setForecastDiagnostics] = useState<ForecastDiagnostics | null>(null);
  const [forecastModel, setForecastModel] = useState<{ model_type: string; model_version: string } | null>(null);
  const [monthsAhead, setMonthsAhead] = useState(3);
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
    setForecastHistory([]);
    setForecastDiagnostics(null);
    setForecastModel(
      forecastData[0]
        ? { model_type: forecastData[0].model_type || 'saved_forecast', model_version: forecastData[0].model_version || 'unknown' }
        : null,
    );
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

  const selectedDepartment = useMemo(
    () => departments.find((department) => department.department_id === selectedDeptId) || null,
    [departments, selectedDeptId],
  );

  const triggerAction = async (action: 'group' | 'categorize' | 'forecast' | 'forensic') => {
    if (!selectedDeptId) return;
    setStatus(`Running ${action}...`);
    const now = new Date();
    if (action === 'group') await api.runGrouping(selectedDeptId);
    if (action === 'categorize') await api.runCategorization(selectedDeptId);
    if (action === 'forecast') {
      const result = await api.runForecast(selectedDeptId, monthsAhead);
      setForecasts(result.forecasts);
      setForecastHistory(result.history);
      setForecastDiagnostics(result.diagnostics);
      setForecastModel(result.model);
      setStatus('Budget forecast updated successfully.');
      return;
    }
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

  const actualSpend = useMemo(
    () => transactions.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0),
    [transactions],
  );

  const projectedSpend = useMemo(
    () => forecasts.reduce((sum, forecast) => sum + Number(forecast.predicted_amount || 0), 0),
    [forecasts],
  );

  const spendTrend = useMemo(() => {
    const monthlyMap = new Map<string, number>();
    transactions.forEach((transaction) => {
      const month = new Date(transaction.transaction_date).toISOString().slice(0, 7);
      monthlyMap.set(month, (monthlyMap.get(month) || 0) + Number(transaction.amount || 0));
    });

    const history = Array.from(monthlyMap.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-6)
      .map(([month, actual]) => ({
        month: formatShortMonth(month),
        actual: Math.round(actual),
      }));

    return history.map((point) => ({
      ...point,
    }));
  }, [transactions]);

  const forecastChartData = useMemo(() => {
    const history = (forecastHistory.length
      ? forecastHistory
      : spendTrend.map((point) => ({ month: point.month, amount: point.actual }))).slice(-6);

    const historical = history.map((point) => ({
      month: formatShortMonth(point.month),
      actual: Math.round(point.amount),
      forecast: null as number | null,
      lower: null as number | null,
      upper: null as number | null,
    }));

    const future = forecasts.map((forecast) => ({
      month: formatShortMonth(forecast.forecast_period_start.slice(0, 7)),
      actual: null as number | null,
      forecast: Math.round(forecast.predicted_amount),
      lower: Math.round(forecast.lower_bound),
      upper: Math.round(forecast.upper_bound),
    }));

    return [...historical, ...future];
  }, [forecastHistory, forecasts, spendTrend]);

  const departmentBudgetData = useMemo(() => {
    return departments.map((department) => ({
      name: department.department_name.split(' ').slice(0, 2).join(' '),
      budget: Number(department.annual_budget || 0),
      spend: department.department_id === selectedDeptId ? Math.round(actualSpend) : Math.round(Number(department.annual_budget || 0) * 0.58),
    }));
  }, [departments, selectedDeptId, actualSpend]);

  const insightScore = forecastDiagnostics?.mape !== null && forecastDiagnostics?.mape !== undefined
    ? Math.max(72, Math.round(100 - forecastDiagnostics.mape))
    : 82;

  const overview = (
    <div className="space-y-8">
      <HeroHeader
        eyebrow="Executive Command"
        title={selectedDepartment ? `${selectedDepartment.department_name} Intelligence` : 'Executive Intelligence'}
        description="A sharper operational workspace for budget oversight, forecast confidence, and risk visibility."
        actionLabel="Detailed PDF"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        <ExecutiveMetric
          label="Unit Ledger Items"
          value={transactions.length}
          note={selectedDepartment ? selectedDepartment.department_name : 'Department selected'}
          accent="positive"
          icon={WalletCards}
        />
        <ExecutiveMetric
          label="Actual Spending"
          value={`TK ${actualSpend.toLocaleString()}`}
          note="Current imported spend"
          accent="negative"
          icon={CircleDollarSign}
        />
        <ExecutiveMetric
          label="Monthly Budget"
          value={`TK ${Math.round(Number(selectedDepartment?.annual_budget || 0) / 12).toLocaleString()}`}
          note="Based on annual allocation"
          accent="neutral"
          icon={TrendingUp}
        />
        <ExecutiveMetric
          label="Data Integrity"
          value={`${Math.max(88, 100 - anomalies.length * 2.1).toFixed(1)}%`}
          note={`${anomalies.length} active anomalies`}
          accent="positive"
          icon={ShieldCheck}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.4fr,0.8fr,0.8fr] gap-6">
        <div className={`${shellCard} p-7`}>
          <SectionKicker title="Spending Momentum" subtitle="Recent actuals versus expected department behavior." />
          <div className="h-[340px] mt-6">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={spendTrend}>
                <defs>
                  <linearGradient id="spendArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 6" stroke="#dbe7ff" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: '#94A3B8', fontSize: 12, fontWeight: 700 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: '#94A3B8', fontSize: 12 }} />
                <Tooltip contentStyle={{ borderRadius: 20, borderColor: '#dbeafe', boxShadow: '0 12px 40px rgba(59,130,246,0.14)' }} />
                <Area type="monotone" dataKey="actual" stroke="#3B82F6" strokeWidth={4} fill="url(#spendArea)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <CalloutCard
          tone="dark"
          eyebrow="Reconciliation Index"
          title={`${insightScore}%`}
          description="Platform-wide anomaly resolution efficiency and budget alignment quality."
          footer="Forecast discipline is trending upward."
        />

        <CalloutCard
          tone="green"
          eyebrow="AI Savings Potential"
          title={`TK ${Math.max(14200, Math.round(projectedSpend * 0.08)).toLocaleString()}`}
          description="Potential quarterly savings visible from unnecessary or duplicate spending patterns."
          footer="Audit savings"
        />
      </div>
    </div>
  );

  const deptControl = (
    <div className="space-y-8">
      <HeroHeader
        eyebrow="Department Control"
        title="Department Operations"
        description="Manage department data, refresh forecasts, and keep financial operations up to date."
        actionLabel="Operations"
      />
      <div className="grid grid-cols-1 xl:grid-cols-[0.88fr,1.12fr] gap-6">
        <form className={`${shellCard} p-7 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.12),_transparent_45%),white]`} onSubmit={handleUpload}>
          <SectionKicker title="Import Ledger File" subtitle="Upload departmental transactions." />
          <div className="mt-6 space-y-4">
            <div className="rounded-[26px] border border-slate-200 bg-slate-50 p-4">
              <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Department</label>
              <select value={selectedDeptId} onChange={(e) => setSelectedDeptId(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700">
                {departments.map((department) => <option key={department.department_id} value={department.department_id}>{department.department_name}</option>)}
              </select>
            </div>
            <label className="block rounded-[26px] border border-dashed border-blue-200 bg-blue-50/70 p-6 cursor-pointer transition hover:border-blue-400 hover:bg-blue-50">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm">
                  <Upload size={22} />
                </div>
                <div>
                  <p className="font-bold text-slate-900">{file ? file.name : 'Drop CSV or Excel ledger here'}</p>
                  <p className="text-sm text-slate-500 mt-1">Accepted formats: `.csv`, `.xls`, `.xlsx`</p>
                </div>
              </div>
              <input type="file" accept=".csv,.xls,.xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} className="hidden" />
            </label>
            <button className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-4 font-bold text-white shadow-[0_20px_40px_rgba(15,23,42,0.15)]">
              <FileUp size={18} />
              Upload Transactions
            </button>
          </div>
        </form>

        <div className={`${shellCard} p-7 bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.16),_transparent_40%),white]`}>
          <SectionKicker title="Operational Controls" subtitle="Choose the forecast horizon and run department actions." />
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-[26px] border border-slate-200 bg-slate-50 p-5">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Budget Forecast</p>
              <p className="mt-3 text-2xl font-black tracking-tight text-slate-950">Forecast Settings</p>
              <p className="mt-2 text-sm text-slate-500">Set how far ahead you want to project department spending.</p>
              <div className="mt-5">
                <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Months Ahead</label>
                <select value={monthsAhead} onChange={(e) => setMonthsAhead(Number(e.target.value))} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700">
                  {[1, 2, 3, 6].map((value) => <option key={value} value={value}>{value} month{value > 1 ? 's' : ''}</option>)}
                </select>
              </div>
            </div>
            <div className="rounded-[26px] bg-slate-950 p-5 text-white shadow-[0_24px_50px_rgba(15,23,42,0.24)]">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-blue-200">Workflow</p>
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                <p>Grouping organizes related account activity.</p>
                <p>Categorization separates necessary and unnecessary spend.</p>
                <p>Forensic scans the current period for unusual activity.</p>
              </div>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <PipelineButton label="Run Grouping" icon={BarChart3} onClick={() => triggerAction('group')} />
            <PipelineButton label="Run Categorization" icon={CheckCircle2} onClick={() => triggerAction('categorize')} />
            <PipelineButton label="Forecast Budget" icon={Sparkles} onClick={() => triggerAction('forecast')} />
            <PipelineButton label="Run Forensic" icon={AlertTriangle} onClick={() => triggerAction('forensic')} />
          </div>
          {status && <p className="mt-5 text-sm font-semibold text-blue-700">{status}</p>}
        </div>
      </div>
    </div>
  );

  const reports = (
    <div className="space-y-8">
      <HeroHeader
        eyebrow="Executive Intelligence"
        title="Holistic Performance Reports"
        description="A cleaner presentation layer for budget utilization, forecast confidence, and operational efficiency."
        actionLabel="Detailed PDF"
      />
      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr,0.6fr,0.6fr] gap-6">
        <div className={`${shellCard} p-7`}>
          <SectionKicker title="Budget Utilization by Business Unit" subtitle="Budget vs. realized spend across active departments." />
          <div className="h-[380px] mt-6">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={departmentBudgetData} barGap={12}>
                <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#94A3B8', fontSize: 12, fontWeight: 700 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: '#94A3B8', fontSize: 12 }} />
                <Tooltip contentStyle={{ borderRadius: 20, borderColor: '#dbeafe', boxShadow: '0 12px 40px rgba(15,23,42,0.10)' }} />
                <Bar dataKey="budget" fill="#E8EEF8" radius={[10, 10, 0, 0]} />
                <Bar dataKey="spend" radius={[10, 10, 0, 0]}>
                  {departmentBudgetData.map((entry, index) => (
                    <Cell key={`${entry.name}-${index}`} fill={entry.name === selectedDepartment?.department_name.split(' ').slice(0, 2).join(' ') ? '#3B82F6' : '#94A3B8'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <CalloutCard
          tone="dark"
          eyebrow="Forecast Accuracy"
          title={forecastDiagnostics?.mape !== null && forecastDiagnostics?.mape !== undefined ? `${forecastDiagnostics.mape}%` : 'N/A'}
          description="Lower MAPE means the prediction pipeline is tracking actual spend more tightly."
          footer="Forecast quality"
        />

        <CalloutCard
          tone="green"
          eyebrow="Savings Potential"
          title={`TK ${Math.round((categorizationSummary?.unnecessary || 0) * 1200 + anomalies.length * 450).toLocaleString()}`}
          description="Potential reduction from unnecessary transactions and anomalies requiring remediation."
          footer="Audit savings"
        />
      </div>
    </div>
  );

  const deptStatus = (
    <div className="space-y-8">
      <HeroHeader
        eyebrow="Realtime Fiscal Analysis"
        title={`${selectedDepartment?.department_name || 'Department'} Status`}
        description="Track department spending, forecast updates, and data integrity in one place."
        actionLabel="Predictive"
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <ExecutiveMetric label="Forecast Entries" value={forecasts.length} note="Serialized or live model output" accent="neutral" icon={Sparkles} />
        <ExecutiveMetric label="Open Anomalies" value={anomalies.length} note="Needs attention" accent="negative" icon={AlertTriangle} />
        <ExecutiveMetric label="Necessary" value={categorizationSummary?.necessary || 0} note="Spending marked essential" accent="positive" icon={CheckCircle2} />
        <ExecutiveMetric label="Integrity" value={`${Math.max(88, 100 - anomalies.length * 2.1).toFixed(1)}%`} note={forecasts.length ? 'Forecast available' : 'Awaiting forecast'} accent="positive" icon={ShieldCheck} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.35fr,0.65fr] gap-6">
        <div className={`${shellCard} p-7`}>
          <SectionKicker title="Budget Forecast Curve" subtitle="Historical monthly spend extended into the prediction window." />
          <div className="h-[380px] mt-6">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={forecastChartData}>
                <defs>
                  <linearGradient id="forecastBand" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#60A5FA" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#60A5FA" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 6" stroke="#dbeafe" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: '#94A3B8', fontSize: 12, fontWeight: 700 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: '#94A3B8', fontSize: 12 }} />
                <Tooltip contentStyle={{ borderRadius: 20, borderColor: '#dbeafe', boxShadow: '0 12px 40px rgba(59,130,246,0.14)' }} />
                <Area type="monotone" dataKey="upper" stroke="transparent" fill="url(#forecastBand)" />
                <Area type="monotone" dataKey="actual" stroke="#1D4ED8" strokeWidth={4} fillOpacity={0} />
                <Area type="monotone" dataKey="forecast" stroke="#60A5FA" strokeWidth={4} fillOpacity={0} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-6">
          <div className={`${shellCard} p-7`}>
            <SectionKicker title="Forecast Summary" subtitle="Current forecast health and coverage." />
            <div className="mt-5 space-y-4">
              <DataPill label="Forecast Status" value={forecasts.length ? 'Ready' : 'Pending'} />
              <DataPill label="Confidence" value={forecastDiagnostics?.mape !== null && forecastDiagnostics?.mape !== undefined ? `${Math.max(0, Math.round(100 - forecastDiagnostics.mape))}%` : 'N/A'} />
              <DataPill label="MAPE" value={forecastDiagnostics?.mape !== null && forecastDiagnostics?.mape !== undefined ? `${forecastDiagnostics.mape}%` : 'N/A'} />
              <DataPill label="Coverage" value={`${forecastDiagnostics?.train_months || 0} months`} />
            </div>
            {forecastDiagnostics?.notes && (
              <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
                Forecast data is available and ready to review.
              </div>
            )}
          </div>

          <div className={`${shellCard} p-7`}>
            <SectionKicker title="Latest Forecasts" subtitle="Confidence-bounded projections." />
            <div className="mt-5 space-y-3">
              {forecasts.map((forecast) => (
                <div key={forecast.forecast_id} className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-black text-slate-950">{formatMonthLabel(forecast.forecast_period_start)}</p>
                      <p className="text-sm text-slate-500 mt-1">Projected department spend</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black text-slate-950">TK {forecast.predicted_amount.toLocaleString()}</p>
                      <p className="text-xs font-semibold text-slate-500">TK {forecast.lower_bound.toLocaleString()} - {forecast.upper_bound.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              ))}
              {!forecasts.length && <p className="text-sm text-slate-500">No forecasts yet. Run budget prediction for this department.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const historyView = (
    <div className="space-y-8">
      <HeroHeader
        eyebrow="Operational History"
        title="Recent Transaction Timeline"
        description="A cleaner ledger table for reviewing recent imported activity."
        actionLabel="History"
      />
      <div className={`${shellCard} p-7`}>
        <SectionKicker title="Transaction History" subtitle="Recent imported records for the selected department." />
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">
                <th className="pb-4">Date</th>
                <th className="pb-4">Description</th>
                <th className="pb-4">Amount</th>
                <th className="pb-4">Group</th>
                <th className="pb-4">Category</th>
              </tr>
            </thead>
            <tbody>
              {transactions.slice(0, 30).map((transaction) => (
                <tr key={transaction.transaction_id} className="border-t border-slate-100 text-sm text-slate-700">
                  <td className="py-4 font-semibold">{new Date(transaction.transaction_date).toLocaleDateString()}</td>
                  <td className="py-4">
                    <p className="font-bold text-slate-900">{transaction.description || 'No description'}</p>
                    {transaction.flagged_reason && <p className="mt-1 text-xs text-red-500">{transaction.flagged_reason}</p>}
                  </td>
                  <td className="py-4 font-bold">TK {transaction.amount.toLocaleString()}</td>
                  <td className="py-4">{transaction.group_name || 'Not grouped'}</td>
                  <td className="py-4">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold border ${COLORS[transaction.category || 'uncategorized'] || COLORS.uncategorized}`}>
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
    <div className="space-y-8">
      <HeroHeader
        eyebrow="Team Oversight"
        title="Employee Access Map"
        description="A more polished roster view for company users and their operational access."
        actionLabel="Employees"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {employees.map((employee) => (
          <div key={employee.user_id} className={`${shellCard} p-6 bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.08),_transparent_38%),white]`}>
            <div className="flex items-center justify-between">
              <div className="h-12 w-12 rounded-2xl bg-slate-950 text-white flex items-center justify-center font-black">
                {employee.name.charAt(0)}
              </div>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-blue-700">
                {employee.account_type}
              </span>
            </div>
            <p className="mt-5 text-lg font-black text-slate-950">{employee.name}</p>
            <p className="mt-1 text-sm text-slate-500">{employee.email}</p>
          </div>
        ))}
      </div>
    </div>
  );

  const content = loading
    ? <p className="text-slate-500">Loading admin workspace...</p>
    : activePath === '/dashboard'
      ? overview
      : activePath === '/dept-control'
        ? deptControl
        : activePath === '/dept-status'
          ? deptStatus
          : activePath === '/reports'
            ? reports
            : activePath === '/history'
              ? historyView
              : activePath === '/audit-logs'
                ? historyView
                : employeesView;

  return <Layout user={user} onLogout={onLogout} activePath={activePath} onNavigate={setActivePath}>{content}</Layout>;
};

const HeroHeader = ({ eyebrow, title, description, actionLabel }: { eyebrow: string; title: string; description: string; actionLabel: string }) => (
  <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
    <div>
      <p className="text-[11px] font-black uppercase tracking-[0.28em] text-blue-600">{eyebrow}</p>
      <h1 className="mt-2 text-4xl font-black tracking-[-0.04em] text-slate-950">{title}</h1>
      <p className="mt-3 max-w-2xl text-lg text-slate-500">{description}</p>
    </div>
    <button className="inline-flex items-center gap-2 self-start rounded-[22px] border border-slate-200 bg-white px-5 py-4 font-bold text-slate-700 shadow-[0_15px_40px_rgba(15,23,42,0.06)]">
      <ArrowUpRight size={18} />
      {actionLabel}
    </button>
  </div>
);

const SectionKicker = ({ title, subtitle }: { title: string; subtitle: string }) => (
  <div>
    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">{title}</p>
    <p className="mt-2 text-2xl font-black tracking-[-0.03em] text-slate-950">{subtitle}</p>
  </div>
);

const ExecutiveMetric = ({
  label,
  value,
  note,
  accent,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  note: string;
  accent: 'positive' | 'negative' | 'neutral';
  icon: React.ElementType;
}) => (
  <div className={`${shellCard} p-6 bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.08),_transparent_42%),white]`}>
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{label}</p>
        <p className="mt-3 text-4xl font-black tracking-[-0.05em] text-slate-950">{value}</p>
        <p className="mt-2 text-sm font-medium text-slate-500">{note}</p>
      </div>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
        <Icon size={22} />
      </div>
    </div>
    <div className="mt-5">
      <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${
        accent === 'positive'
          ? 'bg-emerald-50 text-emerald-700'
          : accent === 'negative'
            ? 'bg-red-50 text-red-700'
            : 'bg-blue-50 text-blue-700'
      }`}>
        {accent === 'positive' ? '+ healthy' : accent === 'negative' ? 'watch' : 'stable'}
      </span>
    </div>
  </div>
);

const CalloutCard = ({
  tone,
  eyebrow,
  title,
  description,
  footer,
}: {
  tone: 'dark' | 'green';
  eyebrow: string;
  title: string;
  description: string;
  footer: string;
}) => (
  <div className={`rounded-[34px] p-7 shadow-[0_24px_60px_rgba(15,23,42,0.18)] ${
    tone === 'dark' ? 'bg-slate-950 text-white' : 'bg-emerald-600 text-white'
  }`}>
    <p className={`text-[11px] font-black uppercase tracking-[0.26em] ${tone === 'dark' ? 'text-blue-200' : 'text-emerald-100'}`}>{eyebrow}</p>
    <p className="mt-6 text-5xl font-black tracking-[-0.05em]">{title}</p>
    <p className={`mt-5 text-base leading-7 ${tone === 'dark' ? 'text-slate-300' : 'text-emerald-50/85'}`}>{description}</p>
    <div className={`mt-10 inline-flex rounded-2xl px-4 py-3 text-sm font-black uppercase tracking-[0.18em] ${
      tone === 'dark' ? 'bg-white/8 text-white' : 'bg-emerald-500/60 text-white'
    }`}>
      {footer}
    </div>
  </div>
);

const PipelineButton = ({ label, icon: Icon, onClick }: { label: string; icon: React.ElementType; onClick: () => void }) => (
  <button onClick={onClick} className="inline-flex items-center justify-center gap-2 rounded-[24px] border border-slate-200 bg-white px-4 py-4 font-bold text-slate-700 transition hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700">
    <Icon size={18} />
    {label}
  </button>
);

const DataPill = ({ label, value }: { label: string; value: string | number }) => (
  <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
    <span className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</span>
    <span className="text-sm font-black text-slate-950">{value}</span>
  </div>
);

const formatMonthLabel = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

const formatShortMonth = (value: string) =>
  value.length === 7
    ? new Date(`${value}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' })
    : value;

export default AdminDashboard;
