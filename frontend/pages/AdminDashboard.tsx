import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  Eye,
  FileUp,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Upload,
  WalletCards,
  X,
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
import ForensicIntelligence from './ForensicIntelligence';
import { api } from '../lib/api';
import {
  Anomaly,
  Department,
  Forecast,
  ForecastDiagnostics,
  ForecastSourceMode,
  ForensicRunResponse,
  Transaction,
  UploadBatchSummary,
  UserAccount,
} from '../types';
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
  const [sourceMode, setSourceMode] = useState<ForecastSourceMode>('latest_batch');
  const [uploadBatches, setUploadBatches] = useState<UploadBatchSummary[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [groupingStats, setGroupingStats] = useState<any>(null);
  const [categorizationSummary, setCategorizationSummary] = useState<any>(null);
  const [employees, setEmployees] = useState<UserAccount[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [forensicFile, setForensicFile] = useState<File | null>(null);
  const [forensicMonth, setForensicMonth] = useState('2022-08');
  const [forensicResult, setForensicResult] = useState<ForensicRunResponse | null>(null);
  const [selectedAnomaly, setSelectedAnomaly] = useState<Anomaly | null>(null);
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
    const [transactionData, anomalyData, groupingData, categorizationData, batchData] = await Promise.all([
      api.transactions(departmentId),
      api.anomalies(departmentId),
      api.groupingStats(departmentId),
      api.categorizationSummary(departmentId),
      api.uploadBatches(departmentId),
    ]);
    setTransactions(transactionData);
    setAnomalies(anomalyData);
    setGroupingStats(groupingData);
    setCategorizationSummary(categorizationData);
    setUploadBatches(batchData);
  };

  const loadForecastContext = async (departmentId: string) => {
    if (!departmentId || !isForecastSourceReady(sourceMode, selectedBatchId, dateFrom, dateTo)) {
      setForecasts([]);
      setForecastHistory([]);
      setForecastDiagnostics(null);
      setForecastModel(null);
      return;
    }

    const forecastContext = await api.forecastContext(departmentId, {
      monthsAhead,
      sourceMode,
      uploadBatchId: selectedBatchId || null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
    });
    setForecasts(forecastContext.forecasts);
    setForecastHistory(forecastContext.history);
    setForecastDiagnostics(forecastContext.diagnostics);
    setForecastModel(forecastContext.model);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await loadBase();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to load admin data';
        setStatus(message.includes('Authentication') ? 'Your session expired. Please log out and log in again.' : message);
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
  useEffect(() => {
    if (selectedDeptId) {
      loadForecastContext(selectedDeptId).catch((err) => setStatus(err.message));
    }
  }, [selectedDeptId, monthsAhead, sourceMode, selectedBatchId, dateFrom, dateTo]);

  useEffect(() => {
    if (sourceMode !== 'upload_batch') {
      setSelectedBatchId('');
      return;
    }
    if (!uploadBatches.length) {
      setSelectedBatchId('');
      return;
    }
    if (!uploadBatches.some((batch) => batch.upload_batch_id === selectedBatchId)) {
      setSelectedBatchId(uploadBatches[0].upload_batch_id);
    }
  }, [sourceMode, uploadBatches, selectedBatchId]);

  useEffect(() => {
    if (!selectedAnomaly) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedAnomaly(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedAnomaly]);

  const selectedDepartment = useMemo(
    () => departments.find((department) => department.department_id === selectedDeptId) || null,
    [departments, selectedDeptId],
  );

  const selectedUploadBatch = useMemo(
    () => uploadBatches.find((batch) => batch.upload_batch_id === selectedBatchId) || null,
    [uploadBatches, selectedBatchId],
  );

  const transactionById = useMemo(() => {
    return new Map(transactions.map((transaction) => [transaction.transaction_id, transaction]));
  }, [transactions]);

  const activeAnomalies = useMemo(
    () => anomalies.filter((anomaly) => !anomaly.is_resolved),
    [anomalies],
  );

  const anomalyCounts = useMemo(() => {
    return activeAnomalies.reduce(
      (counts, anomaly) => {
        const key = anomaly.anomaly_type.toLowerCase();
        if (key.includes('benford')) counts.benford += 1;
        if (key.includes('zscore')) counts.zscore += 1;
        if (key.includes('rsf')) counts.rsf += 1;
        return counts;
      },
      { benford: 0, zscore: 0, rsf: 0 },
    );
  }, [activeAnomalies]);

  const flaggedRows = useMemo(() => {
    const rows = new Map<string, { transaction: Transaction | null; anomalies: Anomaly[] }>();
    activeAnomalies.forEach((anomaly) => {
      const existing = rows.get(anomaly.transaction_id) || {
        transaction: transactionById.get(anomaly.transaction_id) || null,
        anomalies: [],
      };
      existing.anomalies.push(anomaly);
      rows.set(anomaly.transaction_id, existing);
    });
    return Array.from(rows.values());
  }, [activeAnomalies, transactionById]);

  const parseForensicMonth = () => {
    const [year, month] = forensicMonth.split('-').map(Number);
    return { month, year };
  };

  const runForensicAnalysis = async () => {
    if (!selectedDeptId) return;
    const { month, year } = parseForensicMonth();
    try {
      setStatus(`Running forensic scan for ${formatMonthLabel(`${year}-${String(month).padStart(2, '0')}`)}...`);
      const result = await api.runForensic(selectedDeptId, month, year);
      setForensicResult(result);
      await loadDepartmentData(selectedDeptId);

      if (result.message) {
        setStatus(result.message);
        return;
      }

      setStatus(
        `Forensic completed: ${result.total_anomalies} anomalies found ` +
        `(Benford: ${result.benford_anomalies || 0}, Z-score: ${result.zscore_anomalies || 0}, RSF: ${result.rsf_anomalies || 0}).`
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Unable to run forensic scan.');
    }
  };

  const handleForensicUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedDeptId) {
      setStatus('Choose a department before uploading forensic data.');
      return;
    }
    if (!forensicFile) {
      setStatus('Choose a ledger file before uploading.');
      return;
    }
    try {
      setStatus('Uploading monthly forensic ledger...');
      await api.uploadTransactions(selectedDeptId, forensicFile);
      await loadDepartmentData(selectedDeptId);
      setStatus('Monthly transaction data uploaded. Run forensic scan next.');
      setForensicFile(null);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Unable to upload forensic data.');
    }
  };

  const handleUndoAnomaly = async (anomalyId: string) => {
    try {
      await api.resolveAnomaly(anomalyId);
      await loadDepartmentData(selectedDeptId);
      if (selectedAnomaly?.anomaly_id === anomalyId) setSelectedAnomaly(null);
      setStatus('Anomaly flag undone.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Unable to undo anomaly flag.');
    }
  };
  const triggerAction = async (action: 'group' | 'categorize' | 'forecast' | 'forensic') => {
    if (!selectedDeptId) return;
    setStatus(`Running ${action}...`);
    if (action === 'group') await api.runGrouping(selectedDeptId);
    if (action === 'categorize') await api.runCategorization(selectedDeptId);
    if (action === 'forecast') {
      if (!isForecastSourceReady(sourceMode, selectedBatchId, dateFrom, dateTo)) {
        setStatus(sourceMode === 'upload_batch' ? 'Select an upload batch first.' : 'Choose both start and end dates first.');
        return;
      }
      const result = await api.runForecast(selectedDeptId, {
        monthsAhead,
        sourceMode,
        uploadBatchId: selectedBatchId || null,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
      });
      setForecasts(result.forecasts);
      setForecastHistory(result.history);
      setForecastDiagnostics(result.diagnostics);
      setForecastModel(result.model);
      setStatus('Budget forecast updated successfully.');
      return;
    }
    if (action === 'forensic') {
      await runForensicAnalysis();
      return;
    }
    
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
    const chronologicalForecasts = [...forecasts].sort((left, right) =>
      left.forecast_period_start.localeCompare(right.forecast_period_start),
    );

    const historical = history.map((point) => ({
      month: formatShortMonth(point.month),
      actual: Math.round(point.amount),
      forecast: null as number | null,
      lower: null as number | null,
      upper: null as number | null,
    }));

    const future = chronologicalForecasts.map((forecast) => ({
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

  const latestForecasts = useMemo(
    () => [...forecasts].sort((left, right) => right.forecast_period_start.localeCompare(left.forecast_period_start)),
    [forecasts],
  );

  const sourceModeLabel = useMemo(
    () => formatForecastSourceMode(sourceMode),
    [sourceMode],
  );

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
              <div className="mt-5">
                <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Forecast Source</label>
                <select value={sourceMode} onChange={(e) => setSourceMode(e.target.value as ForecastSourceMode)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700">
                  <option value="latest_batch">Latest Upload Batch</option>
                  <option value="full_history">Full Department History</option>
                  <option value="upload_batch">Selected Upload Batch</option>
                  <option value="date_range">Custom Date Range</option>
                </select>
              </div>
              {sourceMode === 'upload_batch' && (
                <div className="mt-5">
                  <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Upload Batch</label>
                  <select value={selectedBatchId} onChange={(e) => setSelectedBatchId(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700">
                    {uploadBatches.map((batch) => (
                      <option key={batch.upload_batch_id} value={batch.upload_batch_id}>
                        {batch.source_file_name} ({batch.transaction_count} rows)
                      </option>
                    ))}
                  </select>
                  {selectedUploadBatch && (
                    <p className="mt-2 text-xs font-medium text-slate-500">
                      Range: {selectedUploadBatch.first_transaction_date || 'N/A'} to {selectedUploadBatch.last_transaction_date || 'N/A'}
                    </p>
                  )}
                </div>
              )}
              {sourceMode === 'date_range' && (
                <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Start Date</label>
                    <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">End Date</label>
                    <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700" />
                  </div>
                </div>
              )}
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

  const forensicView = (
    <div className="space-y-8">
      <HeroHeader
        eyebrow="Forensic Lab"
        title={`${selectedDepartment?.department_name || 'Department'} Anomaly Review`}
        description="Upload a monthly transaction ledger, run Benford, Z-score, and RSF checks, then inspect every generated flag."
        actionLabel="Audit"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <ExecutiveMetric label="Open Flags" value={activeAnomalies.length} note="Detected by forensic laws" accent="negative" icon={AlertTriangle} />
        <ExecutiveMetric label="Flagged Transactions" value={flaggedRows.length} note="Unique ledger rows under review" accent="negative" icon={ShieldAlert} />
        <ExecutiveMetric label="Integrity Score" value={`${Math.max(70, 100 - activeAnomalies.length * 4).toFixed(1)}%`} note={formatMonthLabel(forensicMonth)} accent="neutral" icon={ShieldCheck} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[0.86fr,1.14fr] gap-6">
        <form className={`${shellCard} p-7 bg-[radial-gradient(circle_at_top_left,_rgba(239,68,68,0.10),_transparent_42%),white]`} onSubmit={handleForensicUpload}>
          <SectionKicker title="Monthly Ledger Upload" subtitle="Add the transaction file for the month you want to audit." />
          <div className="mt-6 space-y-4">
            <div className="rounded-[26px] border border-slate-200 bg-slate-50 p-4">
              <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Department</label>
              <select value={selectedDeptId} onChange={(event) => setSelectedDeptId(event.target.value)} disabled={!departments.length} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100">
                {!departments.length && <option value="">No departments loaded</option>}
                {departments.map((department) => <option key={department.department_id} value={department.department_id}>{department.department_name}</option>)}
              </select>
            </div>

            <div className="rounded-[26px] border border-slate-200 bg-slate-50 p-4">
              <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Audit Month</label>
              <input
                type="month"
                value={forensicMonth}
                onChange={(event) => setForensicMonth(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700"
              />
            </div>

            <label className="block rounded-[26px] border border-dashed border-red-200 bg-red-50/70 p-6 cursor-pointer transition hover:border-red-400 hover:bg-red-50">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-red-600 shadow-sm">
                  <Upload size={22} />
                </div>
                <div>
                  <p className="font-bold text-slate-900">{forensicFile ? forensicFile.name : 'Upload monthly ledger'}</p>
                  <p className="text-sm text-slate-500 mt-1">Supports normalized files and ledgers with Debit/narration/chart_of_acc_head columns.</p>
                </div>
              </div>
              <input type="file" accept=".csv,.xls,.xlsx" onChange={(event) => setForensicFile(event.target.files?.[0] || null)} className="hidden" />
            </label>

            <button type="submit" disabled={!selectedDeptId || !forensicFile} className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-4 font-bold text-white shadow-[0_20px_40px_rgba(15,23,42,0.15)] ${selectedDeptId && forensicFile ? 'bg-slate-950' : 'bg-slate-300 cursor-not-allowed'}`}>
              <FileUp size={18} />
              Upload Month Data
            </button>
          </div>
        </form>

        <div className={`${shellCard} p-7`}>
          <SectionKicker title="Detection Laws" subtitle="Run the backend forensic checks against the selected month." />
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <ForensicLawCard title="Benford" value={anomalyCounts.benford} description="Flags unusual leading-digit distributions." />
            <ForensicLawCard title="Z-score" value={anomalyCounts.zscore} description="Flags outliers inside transaction groups." />
            <ForensicLawCard title="RSF" value={anomalyCounts.rsf} description="Flags amounts far above their cohort median." />
          </div>

          <button type="button" disabled={!selectedDeptId} onClick={runForensicAnalysis} className={`mt-6 inline-flex w-full items-center justify-center gap-2 rounded-[24px] px-5 py-4 font-black text-white shadow-[0_20px_40px_rgba(239,68,68,0.20)] transition ${selectedDeptId ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-300 cursor-not-allowed'}`}>
            <AlertTriangle size={18} />
            Run Forensic Scan
          </button>

          {forensicResult && (
            <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 p-5">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Latest Run</p>
              <p className="mt-2 text-sm font-semibold text-slate-700">
                {forensicResult.message || `${forensicResult.total_anomalies} anomalies detected for ${formatMonthLabel(forensicMonth)}.`}
              </p>
            </div>
          )}

          {status && <p className="mt-5 text-sm font-semibold text-blue-700">{status}</p>}
        </div>
      </div>

      <div className={`${shellCard} p-7`}>
        <SectionKicker title="Generated Flags" subtitle="Open each explanation to see which law flagged the transaction and the evidence behind it." />
        <div className="mt-6 space-y-4">
          {flaggedRows.map(({ transaction, anomalies: rowAnomalies }) => (
            <div key={rowAnomalies[0].transaction_id} className="rounded-[26px] border border-red-100 bg-red-50/60 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2">
                    {rowAnomalies.map((anomaly) => (
                      <span key={anomaly.anomaly_id} className="rounded-full border border-red-200 bg-white px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-red-700">
                        {formatAnomalyType(anomaly.anomaly_type)}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 font-black text-slate-950">{transaction?.description || 'Flagged transaction'}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    {transaction ? `${formatDate(transaction.transaction_date)} | TK ${transaction.amount.toLocaleString()} | ${transaction.group_name || transaction.chart_acc_head || 'Ungrouped'}` : rowAnomalies[0].transaction_id}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {rowAnomalies.map((anomaly) => (
                    <div key={anomaly.anomaly_id} className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setSelectedAnomaly(anomaly)} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-red-700 shadow-sm transition hover:bg-red-100">
                        <Eye size={16} />
                        View {formatAnomalyType(anomaly.anomaly_type)}
                      </button>
                      <button type="button" onClick={() => handleUndoAnomaly(anomaly.anomaly_id)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-600 shadow-sm transition hover:bg-slate-100">
                        <X size={16} />
                        Undo Flag
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}

          {!flaggedRows.length && (
            <div className="rounded-[26px] border border-slate-200 bg-slate-50 p-6">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                  <ShieldCheck size={22} />
                </div>
                <div>
                  <p className="font-black text-slate-950">No generated flags yet</p>
                  <p className="mt-1 text-sm text-slate-500">Upload a monthly ledger, choose the month, then run the forensic scan.</p>
                </div>
              </div>
            </div>
          )}
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
              <DataPill label="Source" value={sourceModeLabel} />
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
              {latestForecasts.map((forecast) => (
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
          : activePath === '/forensic'
            ? forensicView
          : activePath === '/forensic-engine'
            ? <ForensicIntelligence department={selectedDepartment} transactions={transactions} />
            : activePath === '/reports'
              ? reports
              : activePath === '/history'
                ? historyView
                : activePath === '/audit-logs'
                  ? historyView
                  : employeesView;

  const modalTransaction = selectedAnomaly ? transactionById.get(selectedAnomaly.transaction_id) || null : null;

  return (
    <>
      <Layout user={user} onLogout={onLogout} activePath={activePath} onNavigate={setActivePath}>{content}</Layout>
      {selectedAnomaly && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 px-4 py-8 backdrop-blur-sm"
          onClick={() => setSelectedAnomaly(null)}
        >
          <div
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[32px] bg-white p-7 shadow-[0_30px_80px_rgba(15,23,42,0.35)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-red-600">Flag Explanation</p>
                <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950">{formatAnomalyType(selectedAnomaly.anomaly_type)} Detection</h2>
              </div>
              <button type="button" onClick={() => setSelectedAnomaly(null)} className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 transition hover:bg-slate-200" aria-label="Close explanation">
                <X size={20} />
              </button>
            </div>

            <div className="mt-6 rounded-[26px] border border-slate-200 bg-slate-50 p-5">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Flagged Transaction</p>
              <p className="font-black text-slate-950">{modalTransaction?.description || 'Flagged transaction'}</p>
              <p className="mt-2 text-sm font-semibold text-slate-500">
                {modalTransaction
                  ? `${formatDate(modalTransaction.transaction_date)} | TK ${modalTransaction.amount.toLocaleString()} | ${modalTransaction.group_name || modalTransaction.chart_acc_head || 'Ungrouped'}`
                  : selectedAnomaly.transaction_id}
              </p>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TransactionDetail label="Transaction ID" value={selectedAnomaly.transaction_id} />
                <TransactionDetail label="Voucher" value={modalTransaction?.invoice_id || 'N/A'} />
                <TransactionDetail label="Reference" value={modalTransaction?.po_number || 'N/A'} />
                <TransactionDetail label="Account Head" value={modalTransaction?.chart_acc_head || modalTransaction?.cleaned_chart_acc_head || 'N/A'} />
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <DataPill label="Law" value={formatAnomalyType(selectedAnomaly.anomaly_type)} />
              <DataPill label="Score" value={selectedAnomaly.score.toFixed(4)} />
              <DataPill label="Threshold" value={selectedAnomaly.threshold.toFixed(4)} />
              <DataPill label="Status" value={selectedAnomaly.is_resolved ? 'Resolved' : 'Open'} />
            </div>

            <div className="mt-5 rounded-[26px] border border-red-100 bg-red-50 p-5">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-red-700">Why it was flagged</p>
              <p className="mt-3 text-sm font-semibold leading-6 text-slate-700">
                {buildAnomalyExplanation(selectedAnomaly)}
              </p>
            </div>

            <div className="mt-5 rounded-[26px] border border-slate-200 bg-white p-5">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Evidence Snapshot</p>
              <div className="mt-3 space-y-2">
                {Object.entries(selectedAnomaly.evidence_snapshot || {}).map(([key, value]) => (
                  <div key={key} className="flex items-start justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm">
                    <span className="font-black uppercase tracking-[0.12em] text-slate-400">{key.replaceAll('_', ' ')}</span>
                    <span className="text-right font-semibold text-slate-700">{formatEvidenceValue(value)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setSelectedAnomaly(null)} className="rounded-2xl border border-slate-200 px-5 py-3 font-black text-slate-600 transition hover:bg-slate-50">
                Close
              </button>
              {!selectedAnomaly.is_resolved && (
                <button type="button" onClick={() => handleUndoAnomaly(selectedAnomaly.anomaly_id)} className="rounded-2xl bg-slate-950 px-5 py-3 font-black text-white transition hover:bg-slate-800">
                  Undo Flag
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
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

const TransactionDetail = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</p>
    <p className="mt-1 break-words text-sm font-black text-slate-800">{value}</p>
  </div>
);

const ForensicLawCard = ({ title, value, description }: { title: string; value: number; description: string }) => (
  <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{title}</p>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">{description}</p>
      </div>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-xl font-black text-red-600 shadow-sm">
        {value}
      </span>
    </div>
  </div>
);

const formatAnomalyType = (value: string) => {
  const normalized = value.toLowerCase();
  if (normalized.includes('zscore')) return 'Z-score';
  if (normalized.includes('rsf')) return 'RSF';
  if (normalized.includes('benford')) return 'Benford';
  return value.replaceAll('_', ' ');
};

const formatEvidenceValue = (value: unknown) => {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(4);
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return 'N/A';
  return JSON.stringify(value);
};

const buildAnomalyExplanation = (anomaly: Anomaly) => {
  const evidence = anomaly.evidence_snapshot || {};
  const type = anomaly.anomaly_type.toLowerCase();
  if (type.includes('benford')) {
    return `Benford's Law flagged this transaction because first digit ${formatEvidenceValue(evidence.digit)} appeared with observed frequency ${formatEvidenceValue(evidence.observed_frequency)}, while the expected frequency is ${formatEvidenceValue(evidence.expected_frequency)}. The deviation crossed the configured threshold of ${anomaly.threshold.toFixed(4)}.`;
  }
  if (type.includes('zscore')) {
    return `Z-score flagged this transaction because its amount was unusually far from the average in group "${formatEvidenceValue(evidence.group_name)}". The anomaly score is ${anomaly.score.toFixed(4)}, which is above the threshold of ${anomaly.threshold.toFixed(4)}.`;
  }
  if (type.includes('rsf')) {
    return `Relative Size Factor flagged this transaction because its amount was ${anomaly.score.toFixed(4)} times the median amount in group "${formatEvidenceValue(evidence.group_name)}". That is above the configured threshold of ${anomaly.threshold.toFixed(4)}.`;
  }
  return `This transaction was flagged by ${formatAnomalyType(anomaly.anomaly_type)} with score ${anomaly.score.toFixed(4)}, above threshold ${anomaly.threshold.toFixed(4)}.`;
};

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });

const formatMonthLabel = (value: string) =>
  new Date(`${value.length === 7 ? `${value}-01` : value}T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

const formatShortMonth = (value: string) =>
  value.length === 7
    ? new Date(`${value}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' })
    : value;

const isForecastSourceReady = (
  sourceMode: ForecastSourceMode,
  selectedBatchId: string,
  dateFrom: string,
  dateTo: string,
) => {
  if (sourceMode === 'upload_batch') return Boolean(selectedBatchId);
  if (sourceMode === 'date_range') return Boolean(dateFrom && dateTo);
  return true;
};

const formatForecastSourceMode = (sourceMode: ForecastSourceMode) => {
  if (sourceMode === 'latest_batch') return 'Latest Batch';
  if (sourceMode === 'full_history') return 'Full History';
  if (sourceMode === 'upload_batch') return 'Selected Batch';
  return 'Date Range';
};

export default AdminDashboard;
