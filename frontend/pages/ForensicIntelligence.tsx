import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  BadgeCheck,
  Beaker,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FlaskConical,
  Gauge,
  HelpCircle,
  History,
  Info,
  Layers,
  Loader2,
  Lock,
  Network,
  Play,
  RefreshCw,
  Scale,
  ShieldAlert,
  SlidersHorizontal,
  Timer,
  Undo2,
  XCircle,
} from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import {
  BenchmarkResponse,
  CalibrationMode,
  CalibrationRecord,
  CalibrationSettingKey,
  CalibrationSettings,
  CalibrationSettingsPayload,
  CalibrationStatus,
  ConfusionMetrics,
  Department,
  EngineAnalyzeResponse,
  EngineFinding,
  ForensicView,
  ReviewLabel,
  ReviewQueue,
  ReviewQueueItem,
  ReviewRecord,
  ReviewSource,
  ReviewStratum,
  RiskBand,
  ThresholdInfo,
  ThresholdSource,
  Transaction,
} from '../types';

// Categorical slots 1-4, validated for adjacent pairs on a white surface (worst CVD
// deltaE 9.1, worst normal-vision 22.9). Aqua and yellow fall below 3:1 contrast, so every
// chart using them ships direct labels rather than relying on the swatch alone.
const VIEW_COLOR: Record<ForensicView, string> = {
  rule: '#2a78d6',
  behavioral: '#eb6834',
  temporal: '#1baf7a',
  relational: '#eda100',
};

const VIEW_META: Record<ForensicView, { label: string; icon: React.ElementType; blurb: string }> = {
  rule: {
    label: 'Rule & Control',
    icon: Scale,
    blurb: 'ACFE audit tests — duplicate payments, split purchasing, payments steered just under an approval limit.',
  },
  behavioral: {
    label: 'Behavioural AI',
    icon: Activity,
    blurb:
      'Learns what is normal for each account head, then flags what breaks that entity’s own pattern. A head too new to judge is compared with its approved expense category instead.',
  },
  temporal: {
    label: 'Temporal',
    icon: Timer,
    blurb: 'Patterns that only exist across rows — payment bursts, dormant heads reactivating, velocity spikes.',
  },
  relational: {
    label: 'Relational',
    icon: Network,
    blurb: 'Which account heads normally get posted together, and which payment breaks that habit.',
  },
};

// Status palette — reserved, never reused as a series colour, and always paired with an
// icon and a written label so the band never depends on hue alone.
const BAND_META: Record<RiskBand, { label: string; hex: string; icon: React.ElementType; chip: string; ring: string }> = {
  critical: { label: 'Critical', hex: '#d03b3b', icon: AlertOctagon, chip: 'bg-red-50 text-red-800 border-red-200', ring: 'ring-red-200' },
  high: { label: 'High', hex: '#ec835a', icon: ShieldAlert, chip: 'bg-orange-50 text-orange-800 border-orange-200', ring: 'ring-orange-200' },
  medium: { label: 'Medium', hex: '#fab219', icon: AlertTriangle, chip: 'bg-amber-50 text-amber-800 border-amber-200', ring: 'ring-amber-200' },
  low: { label: 'Low', hex: '#0ca30c', icon: CheckCircle2, chip: 'bg-green-50 text-green-800 border-green-200', ring: 'ring-green-200' },
};

const LABEL_META: Record<ReviewLabel, { label: string; hex: string; chip: string; icon: React.ElementType; meaning: string }> = {
  confirmed: {
    label: 'Confirmed',
    hex: '#d03b3b',
    chip: 'bg-red-50 text-red-800 border-red-200',
    icon: AlertOctagon,
    meaning: 'A genuine issue. Counts as a positive.',
  },
  cleared: {
    label: 'Cleared',
    hex: '#0ca30c',
    chip: 'bg-green-50 text-green-800 border-green-200',
    icon: CheckCircle2,
    meaning: 'Legitimate spending. Counts as a negative.',
  },
  uncertain: {
    label: 'Uncertain',
    hex: '#64748b',
    chip: 'bg-slate-100 text-slate-700 border-slate-200',
    icon: HelpCircle,
    meaning: 'Cannot tell. Excluded from every metric.',
  },
};

const MODE_META: Record<CalibrationMode, { label: string; chip: string; hex: string }> = {
  bootstrap: { label: 'Bootstrap', chip: 'bg-slate-100 text-slate-700 border-slate-200', hex: '#475569' },
  warmup: { label: 'Warm-up', chip: 'bg-amber-50 text-amber-800 border-amber-200', hex: '#b45309' },
  calibrated: { label: 'Calibrated', chip: 'bg-green-50 text-green-800 border-green-200', hex: '#15803d' },
};

const MODE_ORDER: CalibrationMode[] = ['bootstrap', 'warmup', 'calibrated'];

const STRATUM_STYLE: Record<ReviewStratum, { chip: string; hex: string }> = {
  priority: { chip: 'bg-red-50 text-red-800 border-red-200', hex: '#d03b3b' },
  alert: { chip: 'bg-orange-50 text-orange-800 border-orange-200', hex: '#ec835a' },
  near_miss: { chip: 'bg-amber-50 text-amber-800 border-amber-200', hex: '#b45309' },
  low: { chip: 'bg-slate-100 text-slate-700 border-slate-200', hex: '#64748b' },
};

const STRATUM_ORDER: ReviewStratum[] = ['priority', 'alert', 'near_miss', 'low'];
const BAND_ORDER: RiskBand[] = ['critical', 'high', 'medium', 'low'];
const VIEW_ORDER: ForensicView[] = ['rule', 'behavioral', 'temporal', 'relational'];
const LABEL_ORDER: ReviewLabel[] = ['confirmed', 'cleared', 'uncertain'];

const card = 'rounded-[32px] border border-slate-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]';

const money = (value: number) => `৳${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const pct0 = (value: number) => `${Math.round(value * 100)}%`;
const dateOnly = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString() : '—');
const dateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');
const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);
const sourceShort = (source: ThresholdSource) =>
  source === 'company_f1' ? 'Company-specific' : source === 'manual' ? 'Manual override' : 'Bootstrap';

const countBands = (findings: EngineFinding[]): Record<RiskBand, number> => {
  const counts: Record<RiskBand, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  findings.forEach((finding) => {
    counts[finding.band] += 1;
  });
  return counts;
};

type ReviewTarget = { transaction_id: string; finding_id: string | null; source: ReviewSource };
type PanelEvent = { tone: 'good' | 'warn' | 'info'; title: string; body: string };

interface Props {
  department: Department | null;
  transactions: Transaction[];
}

const ForensicIntelligence: React.FC<Props> = ({ department, transactions }) => {
  const [analysis, setAnalysis] = useState<EngineAnalyzeResponse | null>(null);
  const [storedFindings, setStoredFindings] = useState<EngineFinding[]>([]);
  const [benchmark, setBenchmark] = useState<BenchmarkResponse | null>(null);
  const [calibration, setCalibration] = useState<CalibrationStatus | null>(null);
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [latestRun, setLatestRun] = useState<CalibrationRecord | null>(null);
  const [event, setEvent] = useState<PanelEvent | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [benchmarking, setBenchmarking] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [busyReview, setBusyReview] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [bandFilter, setBandFilter] = useState<RiskBand | 'all'>('all');

  const deptId = department?.department_id ?? '';

  const transactionById = useMemo(() => {
    const map = new Map<string, Transaction>();
    transactions.forEach((txn) => map.set(txn.transaction_id, txn));
    return map;
  }, [transactions]);

  const loadCalibration = useCallback(async () => {
    if (!deptId) return;
    try {
      setCalibration(await api.engineCalibration(deptId));
    } catch (err) {
      setStatus(errorText(err, 'Could not load the calibration status'));
    }
  }, [deptId]);

  const loadQueue = useCallback(async () => {
    if (!deptId) return;
    setLoadingQueue(true);
    try {
      setQueue(await api.engineReviewQueue(deptId));
    } catch (err) {
      setStatus(errorText(err, 'Could not load the review queue'));
    } finally {
      setLoadingQueue(false);
    }
  }, [deptId]);

  const runAnalysis = useCallback(async () => {
    if (!deptId) return;
    setRunning(true);
    setStatus(null);
    try {
      const result = await api.engineAnalyze(deptId);
      setAnalysis(result);
      setStoredFindings([]);
      setSelectedId(result.findings[0]?.transaction_id ?? null);
      if (!result.findings.length) {
        setStatus(`Analysis complete — nothing scored at or above the alert threshold of ${result.threshold?.value ?? result.min_report_score}.`);
      }
      await loadQueue();
      await loadCalibration();
    } catch (err) {
      setStatus(errorText(err, 'Analysis failed'));
    } finally {
      setRunning(false);
    }
  }, [deptId, loadCalibration, loadQueue]);

  const runBenchmark = useCallback(async () => {
    if (!deptId) return;
    setBenchmarking(true);
    setStatus(null);
    try {
      setBenchmark(await api.engineBenchmark(deptId, 60));
    } catch (err) {
      setStatus(errorText(err, 'Benchmark failed'));
    } finally {
      setBenchmarking(false);
    }
  }, [deptId]);

  const runCalibration = useCallback(async () => {
    if (!deptId) return;
    setCalibrating(true);
    try {
      const result = await api.engineCalibrate(deptId);
      setCalibration(result.status);
      if (result.record) setLatestRun(result.record);
      setEvent({
        tone: result.activated ? 'good' : result.ready ? 'warn' : 'info',
        title: result.activated
          ? 'Company-specific threshold activated'
          : result.ready
            ? 'Candidate threshold rejected — current threshold kept'
            : 'Not ready to calibrate',
        body: result.reason,
      });
      if (result.activated) await loadQueue();
    } catch (err) {
      setStatus(errorText(err, 'Calibration failed'));
    } finally {
      setCalibrating(false);
    }
  }, [deptId, loadQueue]);

  const saveSettings = useCallback(
    async (payload: CalibrationSettingsPayload) => {
      if (!deptId) return;
      setSavingSettings(true);
      try {
        const result = await api.engineUpdateCalibrationSettings(deptId, payload);
        setCalibration(result.status);
        if (result.calibration_triggered && result.calibration) {
          setLatestRun(result.calibration);
          setEvent({
            tone: result.calibration.outcome === 'activated' ? 'good' : 'warn',
            title:
              result.calibration.outcome === 'activated'
                ? 'Settings saved — the reviews on record already met the new minimums, so a calibration ran and a company-specific threshold is now active'
                : 'Settings saved — a calibration ran on the reviews on record, but the candidate was rejected, so the current threshold stays',
            body: result.calibration.reason,
          });
        } else {
          setEvent({
            tone: 'info',
            title: 'Calibration settings saved for this company',
            body: 'They are live now: no restart and no configuration file. The stepper, the progress bars and the recalibration counter already use them.',
          });
        }
        await loadQueue();
      } catch (err) {
        setStatus(errorText(err, 'Could not save the settings'));
      } finally {
        setSavingSettings(false);
      }
    },
    [deptId, loadQueue],
  );

  // Reload whatever the last run stored for this department, so navigating away and back
  // does not present an analysed department as if it had never been examined.
  useEffect(() => {
    setAnalysis(null);
    setBenchmark(null);
    setCalibration(null);
    setQueue(null);
    setLatestRun(null);
    setEvent(null);
    setSelectedId(null);
    setStatus(null);
    setBandFilter('all');
    if (!deptId) return;

    let cancelled = false;
    (async () => {
      try {
        const stored = await api.engineFindings(deptId);
        if (cancelled || !stored.length) return;
        setStoredFindings(stored);
        setSelectedId(stored[0].transaction_id);
      } catch {
        // A department with no stored run is the normal case, not an error worth showing.
      }
    })();
    loadCalibration();
    loadQueue();
    return () => {
      cancelled = true;
    };
  }, [deptId, loadCalibration, loadQueue]);

  const applyReview = useCallback((transactionId: string, review: ReviewRecord | null) => {
    setQueue((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) => (item.transaction_id === transactionId ? { ...item, review } : item)),
            reviewed: current.items.filter((item) => (item.transaction_id === transactionId ? review : item.review)).length,
            pending: current.items.filter((item) => (item.transaction_id === transactionId ? !review : !item.review)).length,
          }
        : current,
    );
    const patch = (list: EngineFinding[]) => list.map((item) => (item.transaction_id === transactionId ? { ...item, review } : item));
    setStoredFindings((current) => patch(current));
    setAnalysis((current) => (current ? { ...current, findings: patch(current.findings) } : current));
  }, []);

  const submitReview = useCallback(
    async (target: ReviewTarget, label: ReviewLabel, note: string | null) => {
      if (!deptId) return;
      setBusyReview(target.transaction_id);
      try {
        const result = await api.engineSubmitReview({
          dept_id: deptId,
          transaction_id: target.transaction_id,
          label,
          note,
          finding_id: target.finding_id,
          source: target.source,
        });
        applyReview(target.transaction_id, result.review);
        setCalibration(result.status);
        if (result.calibration_triggered && result.calibration) {
          setLatestRun(result.calibration);
          setEvent({
            tone: result.calibration.outcome === 'activated' ? 'good' : 'warn',
            title:
              result.calibration.outcome === 'activated'
                ? 'Your review triggered a calibration — a company-specific threshold is now active'
                : 'Your review triggered a calibration — the candidate was rejected, so the current threshold stays',
            body: result.calibration.reason,
          });
        }
      } catch (err) {
        setStatus(errorText(err, 'Could not save the review'));
      } finally {
        setBusyReview(null);
      }
    },
    [applyReview, deptId],
  );

  const undoReview = useCallback(
    async (transactionId: string, reviewId: string) => {
      setBusyReview(transactionId);
      try {
        const result = await api.engineDeleteReview(reviewId);
        applyReview(transactionId, null);
        if (result.status) setCalibration(result.status);
      } catch (err) {
        setStatus(errorText(err, 'Could not withdraw the review'));
      } finally {
        setBusyReview(null);
      }
    },
    [applyReview],
  );

  const findings = analysis?.findings ?? storedFindings;
  const visibleFindings = bandFilter === 'all' ? findings : findings.filter((f) => f.band === bandFilter);
  const selected = findings.find((f) => f.transaction_id === selectedId) ?? visibleFindings[0] ?? null;
  const threshold: ThresholdInfo | null = calibration?.threshold ?? analysis?.threshold ?? null;

  if (!department) {
    return <EmptyState message="Select a department to run the forensic intelligence engine." />;
  }

  return (
    <div className="space-y-6">
      <Header
        department={department}
        analysis={analysis}
        threshold={threshold}
        running={running}
        benchmarking={benchmarking}
        onRun={runAnalysis}
        onBenchmark={runBenchmark}
      />

      {status && (
        <div className="flex items-start gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          <span>{status}</span>
        </div>
      )}

      {calibration && (
        <>
          <MaturityStepper status={calibration} />
          <CalibrationPanel
            status={calibration}
            latestRun={latestRun}
            calibrating={calibrating}
            event={event}
            onDismissEvent={() => setEvent(null)}
            onRun={runCalibration}
            savingSettings={savingSettings}
            onSaveSettings={saveSettings}
          />
        </>
      )}

      <ReviewQueuePanel
        queue={queue}
        loading={loadingQueue}
        busyId={busyReview}
        onReview={submitReview}
        onUndo={undoReview}
        onReload={loadQueue}
      />

      {(analysis || storedFindings.length > 0) && (
        <>
          <BandTiles
            bands={analysis?.summary.bands ?? countBands(storedFindings)}
            totalScored={analysis?.summary.total_scored ?? analysis?.scored_total ?? storedFindings.length}
            reported={analysis?.reported ?? storedFindings.length}
            threshold={threshold}
            active={bandFilter}
            onSelect={setBandFilter}
          />

          {(analysis?.diagnostics.data_quality.warnings.length ?? 0) > 0 && (
            <DataQualityPanel warnings={analysis!.diagnostics.data_quality.warnings} />
          )}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <FindingsList
              findings={visibleFindings}
              selectedId={selected?.transaction_id ?? null}
              onSelect={setSelectedId}
              transactionById={transactionById}
              bandFilter={bandFilter}
            />
            <CasePanel
              finding={selected}
              transaction={selected ? transactionById.get(selected.transaction_id) ?? null : null}
              busy={busyReview === selected?.transaction_id}
              onReview={submitReview}
              onUndo={undoReview}
            />
          </div>
        </>
      )}

      {!analysis && !running && storedFindings.length === 0 && (
        <div className={`${card} p-10 text-center`}>
          <ShieldAlert className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-4 text-lg font-black text-slate-900">No analysis yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Run the engine to score every transaction in {department.department_name} across four independent forensic
            perspectives and fuse the evidence into a single risk score. Alerts are then drawn at this company&rsquo;s
            threshold, and the review queue fills up.
          </p>
        </div>
      )}

      <MethodStrip diagnostics={analysis?.diagnostics ?? null} />

      <BenchmarkSection benchmark={benchmark} running={benchmarking} onRun={runBenchmark} />
    </div>
  );
};

const EmptyState = ({ message }: { message: string }) => (
  <div className={`${card} p-10 text-center text-slate-500`}>{message}</div>
);

// ------------------------------------------------------------------------------ header

const Header = ({
  department,
  analysis,
  threshold,
  running,
  benchmarking,
  onRun,
  onBenchmark,
}: {
  department: Department;
  analysis: EngineAnalyzeResponse | null;
  threshold: ThresholdInfo | null;
  running: boolean;
  benchmarking: boolean;
  onRun: () => void;
  onBenchmark: () => void;
}) => (
  <div className={`${card} overflow-hidden`}>
    <div className="flex flex-col gap-6 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-8 text-white lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.28em] text-blue-300">Forensic Intelligence Engine</p>
        <h2 className="mt-3 text-3xl font-black leading-tight">Explainable multi-view spend forensics</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300">
          Every transaction in <span className="font-bold text-white">{department.department_name}</span> is examined from
          four independent angles. Their evidence is fused into one 0&ndash;100 risk score, and every score comes with the
          chain of reasoning behind it. Which scores count as <em>alerts</em> is decided per company, below.
        </p>
        {threshold && (
          <div className="mt-5 inline-flex flex-wrap items-center gap-2 rounded-2xl bg-white/10 px-4 py-2 text-xs font-semibold text-slate-200">
            <Gauge className="h-4 w-4 text-blue-300" />
            <span>
              Alerting at <span className="text-base font-black text-white">{threshold.value}</span> · {sourceShort(threshold.source)}
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${MODE_META[threshold.mode].chip}`}>
              {MODE_META[threshold.mode].label}
            </span>
          </div>
        )}
        {analysis && (
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs font-semibold text-slate-300">
            <span>{analysis.diagnostics.rows_analysed.toLocaleString()} rows analysed</span>
            <span>
              {analysis.diagnostics.date_range.from} &rarr; {analysis.diagnostics.date_range.to}
            </span>
            <span>{analysis.diagnostics.signals_total.toLocaleString()} evidence signals raised</span>
            <span>
              baselines: {analysis.diagnostics.entity_kinds_active.map((kind) => kind.replace(/_/g, ' ')).join(', ')}
              {typeof analysis.diagnostics.data_quality.expense_category_coverage === 'number' &&
                ` · ${Math.round(analysis.diagnostics.data_quality.expense_category_coverage * 100)}% of rows carry an approved expense category`}
            </span>
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
        <button
          onClick={onRun}
          disabled={running}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-3.5 text-sm font-black text-slate-900 transition hover:bg-blue-50 disabled:opacity-60"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? 'Analysing…' : 'Run analysis'}
        </button>
        <button
          onClick={onBenchmark}
          disabled={benchmarking}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/25 px-6 py-3.5 text-sm font-black text-white transition hover:bg-white/10 disabled:opacity-60"
        >
          {benchmarking ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
          {benchmarking ? 'Testing…' : 'Prove it works'}
        </button>
      </div>
    </div>
  </div>
);

// ---------------------------------------------------------------- maturity stepper

const MaturityStepper = ({ status }: { status: CalibrationStatus }) => {
  const current = MODE_ORDER.indexOf(status.mode);
  const req = status.requirements;
  const stages: { mode: CalibrationMode; title: string; meaning: string }[] = [
    {
      mode: 'bootstrap',
      title: 'Bootstrap',
      meaning: `No company ground truth yet. Alerts use the predefined threshold of ${status.bootstrap_threshold}. F1 plays no part.`,
    },
    {
      mode: 'warmup',
      title: 'Warm-up',
      meaning: `Reviewers label alerts and sampled non-alerts. The bootstrap threshold stays until ${req.min_reviewed_rows} reviews, ${req.min_positive_labels} confirmed and ${req.min_negative_labels} cleared exist.`,
    },
    {
      mode: 'calibrated',
      title: 'Calibrated',
      meaning: `A threshold chosen by F1 on the company's older labels, checked on its newer ones, and only then activated. Re-checked every ${req.recalibration_batch} new reviews.`,
    },
  ];

  return (
    <div className={`${card} p-6`}>
      <p className="text-sm font-black text-slate-900">How this company&rsquo;s alert line is decided</p>
      <p className="mt-1 text-xs text-slate-500">
        Three stages. A company only moves forward when its own reviewers have produced enough evidence — never on the
        strength of the synthetic benchmark.
      </p>
      <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-stretch">
        {stages.map((stage, index) => {
          const state = index < current ? 'done' : index === current ? 'current' : 'upcoming';
          const meta = MODE_META[stage.mode];
          return (
            <React.Fragment key={stage.mode}>
              <div
                className={`rounded-3xl border p-5 ${
                  state === 'current'
                    ? 'border-transparent bg-slate-50 ring-2 ring-slate-900'
                    : state === 'done'
                      ? 'border-slate-200 bg-white'
                      : 'border-dashed border-slate-200 bg-white opacity-70'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-black text-white"
                      style={{ backgroundColor: state === 'upcoming' ? '#cbd5e1' : meta.hex }}
                    >
                      {state === 'done' ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                    </span>
                    <p className="text-sm font-black text-slate-900">{stage.title}</p>
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                      state === 'current'
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : state === 'done'
                          ? 'border-green-200 bg-green-50 text-green-800'
                          : 'border-slate-200 text-slate-400'
                    }`}
                  >
                    {state === 'current' ? 'You are here' : state === 'done' ? 'Done' : 'Not yet'}
                  </span>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-slate-600">{stage.meaning}</p>
              </div>
              {index < stages.length - 1 && (
                <div className="hidden items-center justify-center lg:flex">
                  <ChevronRight className="h-5 w-5 text-slate-300" />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

// -------------------------------------------------------------- calibration panel

const CalibrationPanel = ({
  status,
  latestRun,
  calibrating,
  event,
  onDismissEvent,
  onRun,
  savingSettings,
  onSaveSettings,
}: {
  status: CalibrationStatus;
  latestRun: CalibrationRecord | null;
  calibrating: boolean;
  event: PanelEvent | null;
  onDismissEvent: () => void;
  onRun: () => void;
  savingSettings: boolean;
  onSaveSettings: (payload: CalibrationSettingsPayload) => void;
}) => {
  const latest = latestRun ?? status.last_calibration;
  const companyName = status.company?.company_name ?? status.department.department_name;

  return (
    <div className={`${card} overflow-hidden`}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-7 py-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
            <Gauge className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-black text-slate-900">Company alert threshold · {companyName}</p>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">
              Where {companyName} draws the line between &ldquo;alert&rdquo; and &ldquo;do not alert&rdquo;, and why. The
              engine&rsquo;s scores do not change with this — only which scores count as alerts. Reviews from every
              department of the company pool into the same ground truth.
            </p>
          </div>
        </div>
        <span className="text-[11px] font-semibold text-slate-400">engine {status.engine_version}</span>
      </div>

      {event && <EventBanner event={event} onDismiss={onDismissEvent} />}

      <div className="grid gap-6 px-7 py-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <ThresholdCard status={status} />
        <ProgressCard status={status} calibrating={calibrating} onRun={onRun} />
      </div>

      {status.settings && <SettingsCard settings={status.settings} saving={savingSettings} onSave={onSaveSettings} />}

      {latest && <LatestCalibrationCard record={latest} status={status} />}
      {status.history.length > 1 && <HistoryList history={status.history} />}
    </div>
  );
};

// ---------------------------------------------------------------- settings card

const SETTING_ORDER: CalibrationSettingKey[] = [
  'min_reviewed_rows',
  'min_positive_labels',
  'min_negative_labels',
  'recalibration_batch',
  'bootstrap_threshold',
];

const SETTING_META: Record<CalibrationSettingKey, { label: string; hint: string }> = {
  min_reviewed_rows: { label: 'Minimum reviews', hint: 'reviewed rows before the first calibration can run' },
  min_positive_labels: { label: 'Minimum confirmed', hint: 'confirmed verdicts before the first calibration' },
  min_negative_labels: { label: 'Minimum cleared', hint: 'cleared verdicts before the first calibration' },
  recalibration_batch: { label: 'Recalibrate every', hint: 'new reviews between automatic recalibrations' },
  bootstrap_threshold: { label: 'Bootstrap threshold', hint: 'alert line until this company has calibrated' },
};

const toDraft = (values: Record<CalibrationSettingKey, number>) =>
  Object.fromEntries(SETTING_ORDER.map((key) => [key, String(values[key])])) as Record<CalibrationSettingKey, string>;

// The five knobs live in the database per company and are read on every request, so a
// save here is in force immediately: no environment file, no server restart.
const SettingsCard = ({
  settings,
  saving,
  onSave,
}: {
  settings: CalibrationSettings;
  saving: boolean;
  onSave: (payload: CalibrationSettingsPayload) => void;
}) => {
  const valuesKey = SETTING_ORDER.map((key) => settings.values[key]).join('|');
  const [draft, setDraft] = useState<Record<CalibrationSettingKey, string>>(() => toDraft(settings.values));

  useEffect(() => {
    // Reset the form whenever the server-side values change (a save, a preset, another admin).
    setDraft(toDraft(settings.values));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesKey]);

  const problems = SETTING_ORDER.filter((key) => {
    const value = Number(draft[key]);
    const [low, high] = settings.bounds[key];
    return draft[key].trim() === '' || !Number.isFinite(value) || value < low || value > high;
  });
  const dirty = SETTING_ORDER.some((key) => Number(draft[key]) !== settings.values[key]);
  const demo = settings.presets.demo;
  const demoLabel = demo
    ? `Demo preset (${SETTING_ORDER.filter((key) => demo[key] !== undefined).map((key) => demo[key]).join(' · ')})`
    : 'Demo preset';
  const locked = !settings.editable || saving;

  const save = () =>
    onSave(Object.fromEntries(SETTING_ORDER.map((key) => [key, Number(draft[key])])) as CalibrationSettingsPayload);

  return (
    <div className="border-t border-slate-100 px-7 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            <SlidersHorizontal className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-black text-slate-900">Calibration settings · this company</p>
            <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-slate-500">{settings.note}</p>
          </div>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-wider ${
            settings.overridden.length ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-600'
          }`}
        >
          {settings.overridden.length ? `${settings.overridden.length} changed from defaults` : 'Deployment defaults'}
        </span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {SETTING_ORDER.map((key) => {
          const meta = SETTING_META[key];
          const [low, high] = settings.bounds[key];
          const invalid = problems.includes(key);
          const changed = settings.overridden.includes(key);
          return (
            <label
              key={key}
              className={`block rounded-2xl border p-3 ${
                invalid ? 'border-red-300 bg-red-50/40' : changed ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200'
              }`}
            >
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">{meta.label}</span>
              <input
                type="number"
                value={draft[key]}
                min={low}
                max={high}
                step={key === 'bootstrap_threshold' ? 5 : 1}
                disabled={locked}
                onChange={(e) => setDraft((current) => ({ ...current, [key]: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-lg font-black tabular-nums text-slate-900 focus:border-slate-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500"
              />
              <span className="mt-1 block text-[11px] leading-snug text-slate-500">{meta.hint}</span>
              <span className="mt-1 block text-[10px] text-slate-400">
                default {settings.defaults[key]} · allowed {low}–{high >= 10000 ? '∞' : high}
              </span>
            </label>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={locked || !dirty || problems.length > 0}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Save settings
        </button>
        <button
          onClick={() => onSave({ preset: 'demo' })}
          disabled={locked}
          className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-slate-400 disabled:opacity-40"
        >
          {demoLabel}
        </button>
        <button
          onClick={() => onSave({ preset: 'default' })}
          disabled={locked || !settings.stored}
          className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-slate-400 disabled:opacity-40"
        >
          Reset to defaults
        </button>
        {!settings.editable && (
          <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Lock className="h-3.5 w-3.5" /> Only a company admin can change these.
          </p>
        )}
        {problems.length > 0 && settings.editable && (
          <p className="text-[11px] font-bold text-red-700">
            Out of range: {problems.map((key) => SETTING_META[key].label).join(', ')}
          </p>
        )}
      </div>
    </div>
  );
};

const EventBanner = ({ event, onDismiss }: { event: PanelEvent; onDismiss: () => void }) => {
  const tone =
    event.tone === 'good'
      ? { wrap: 'border-green-200 bg-green-50 text-green-900', icon: BadgeCheck, iconColor: 'text-green-700' }
      : event.tone === 'warn'
        ? { wrap: 'border-amber-200 bg-amber-50 text-amber-900', icon: AlertTriangle, iconColor: 'text-amber-700' }
        : { wrap: 'border-slate-200 bg-slate-50 text-slate-800', icon: Info, iconColor: 'text-slate-500' };
  const Icon = tone.icon;
  return (
    <div className={`mx-7 mt-6 flex items-start gap-3 rounded-2xl border p-4 ${tone.wrap}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone.iconColor}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-black">{event.title}</p>
        <p className="mt-1 text-xs leading-relaxed">{event.body}</p>
      </div>
      <button onClick={onDismiss} className="text-[11px] font-bold opacity-70 hover:opacity-100">
        Dismiss
      </button>
    </div>
  );
};

const ThresholdCard = ({ status }: { status: CalibrationStatus }) => {
  const mode = MODE_META[status.mode];
  return (
    <div className="rounded-3xl border border-slate-200 p-6">
      <div className="flex items-center gap-2">
        <span className={`rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-wider ${mode.chip}`}>
          {mode.label}
        </span>
        <span className="text-[11px] font-semibold text-slate-400">current stage</span>
      </div>
      <p className="mt-5 text-7xl font-black leading-none tabular-nums" style={{ color: mode.hex }}>
        {status.threshold.value}
      </p>
      <p className="mt-2 text-[11px] font-black uppercase tracking-wider text-slate-400">alert threshold · risk score out of 100</p>
      <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3">
        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Where it comes from</p>
        <p className="mt-1 text-xs font-bold text-slate-800">{status.threshold.label}</p>
      </div>
      <p className="mt-5 text-sm font-black text-slate-900">{status.status_text}</p>
      <p className="mt-2 text-xs leading-relaxed text-slate-600">{status.explanation}</p>

      <div className="mt-5 rounded-2xl border border-slate-200 p-4">
        <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">What is not happening</p>
        <ul className="mt-3 space-y-2">
          {status.not_happening.map((line) => (
            <li key={line} className="flex gap-2 text-xs leading-relaxed text-slate-600">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

const ProgressBar = ({ label, actual, required, hint }: { label: string; actual: number; required: number; hint?: string }) => {
  const done = actual >= required;
  const width = required > 0 ? Math.min(100, (actual / required) * 100) : 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
          {done ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <Lock className="h-3.5 w-3.5 text-slate-400" />}
          {label}
        </p>
        <p className="text-xs font-black tabular-nums text-slate-900">
          {actual} <span className="font-semibold text-slate-400">/ {required}</span>
        </p>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full transition-all" style={{ width: `${width}%`, backgroundColor: done ? '#0ca30c' : '#2a78d6' }} />
      </div>
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
};

const ProgressCard = ({ status, calibrating, onRun }: { status: CalibrationStatus; calibrating: boolean; onRun: () => void }) => {
  const { readiness, counts, recalibration, active_metrics: active } = status;
  return (
    <div className="space-y-6 rounded-3xl border border-slate-200 p-6">
      <div>
        <p className="text-sm font-black text-slate-900">Before F1 can be used</p>
        <p className="mt-1 text-xs text-slate-500">
          All three minimums must be met. Uncertain verdicts count as reviewed but never enter the metrics.
        </p>
        <div className="mt-4 space-y-4">
          {readiness.checks.map((check) => (
            <React.Fragment key={check.code}>
              <ProgressBar label={check.label} actual={check.actual} required={check.required} />
            </React.Fragment>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-slate-400">
          {counts.uncertain} uncertain · excluded from every metric
        </p>
      </div>

      <div className="border-t border-slate-100 pt-5">
        <p className="text-sm font-black text-slate-900">Company F1</p>
        {active ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Precision', value: pct0(active.precision) },
                { label: 'Recall', value: pct0(active.recall) },
                { label: 'F1', value: active.f1.toFixed(2) },
                { label: 'False positive rate', value: pct(active.false_positive_rate) },
              ].map((tile) => (
                <div key={tile.label} className="rounded-2xl bg-slate-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{tile.label}</p>
                  <p className="mt-1 text-xl font-black tabular-nums text-slate-900">{tile.value}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Measured on held-out reviewed rows the threshold was not chosen from · last calibrated {dateOnly(status.calibrated_at)}
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 text-lg font-black text-slate-400">Not available yet</p>
            <p className="text-xs leading-relaxed text-slate-500">
              {readiness.ready
                ? 'The minimums are met, but no candidate threshold has passed held-out validation yet.'
                : 'F1 needs company ground truth to be computed from. Keep reviewing.'}
            </p>
          </>
        )}
      </div>

      <div className="border-t border-slate-100 pt-5">
        <p className="text-sm font-black text-slate-900">Recalibration</p>
        {recalibration.ever_calibrated ? (
          <div className="mt-3">
            <ProgressBar
              label="New reviews since the last calibration"
              actual={recalibration.reviews_since_last}
              required={recalibration.batch}
              hint={`Runs again automatically at ${recalibration.batch}. The current threshold is never overwritten unless the new candidate passes validation.`}
            />
          </div>
        ) : (
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            The first calibration runs automatically the moment all three minimums are met — inside the review that
            gets the company there.
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={onRun}
            disabled={!readiness.ready || calibrating}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {calibrating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />}
            {calibrating ? 'Calibrating…' : 'Run calibration now'}
          </button>
          {!readiness.ready && (
            <p className="text-[11px] text-slate-400">Disabled until the minimums are met. Readiness is never bypassed.</p>
          )}
        </div>
      </div>
    </div>
  );
};

const MetricTiles = ({ title, metrics, accent }: { title: string; metrics: ConfusionMetrics | null; accent: string }) => (
  <div className="rounded-2xl border border-slate-200 p-4">
    <p className="text-[11px] font-black uppercase tracking-wider" style={{ color: accent }}>
      {title}
    </p>
    {metrics ? (
      <>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          {[
            ['Precision', pct0(metrics.precision)],
            ['Recall', pct0(metrics.recall)],
            ['F1', metrics.f1.toFixed(2)],
            ['False positive rate', pct(metrics.false_positive_rate)],
            ['Alerts', String(metrics.alerts)],
            ['Rows', String(metrics.rows)],
          ].map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-2">
              <dt className="text-slate-500">{label}</dt>
              <dd className="font-black tabular-nums text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[10px] text-slate-400">
          TP {metrics.true_positives} · FP {metrics.false_positives} · TN {metrics.true_negatives} · FN {metrics.false_negatives}
        </p>
      </>
    ) : (
      <p className="mt-2 text-xs text-slate-400">—</p>
    )}
  </div>
);

const LatestCalibrationCard = ({ record, status }: { record: CalibrationRecord; status: CalibrationStatus }) => {
  const activated = record.outcome === 'activated';
  const req = status.requirements;
  return (
    <div className="border-t border-slate-100 px-7 py-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            <History className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-black text-slate-900">Latest calibration</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {dateTime(record.created_at)} · {record.triggered_by === 'auto' ? 'ran automatically after a review' : 'run manually'} ·{' '}
              {record.review_count} reviews ({record.positive_count} confirmed, {record.negative_count} cleared)
            </p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-wider ${
            activated ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          {activated ? <BadgeCheck className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
          {activated ? `Activated ${record.activated_threshold}` : `Rejected · ${record.old_threshold} kept`}
        </span>
      </div>

      <p className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-700">{record.reason}</p>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-slate-400">
            Step 1 · Choose on the oldest {record.calibration_rows} reviewed rows ({pct0(req.calibration_share)})
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Every candidate threshold is scored against these labels. The candidate is the one with the highest F1:{' '}
            <span className="font-black text-slate-900">{record.candidate_threshold}</span>.
          </p>
          <SweepChart sweep={record.sweep} candidate={record.candidate_threshold} current={record.old_threshold} />
          <SweepTable sweep={record.sweep} candidate={record.candidate_threshold} />
        </div>

        <div>
          <p className="text-xs font-black uppercase tracking-wider text-slate-400">
            Step 2 · Validate on the newest {record.validation_rows} rows it was not chosen from
          </p>
          <p className="mt-1 text-xs text-slate-500">
            The candidate and the threshold currently in force are both scored on the same held-out rows.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <MetricTiles title={`Candidate ${record.candidate_threshold}`} metrics={record.validation} accent="#2a78d6" />
            <MetricTiles title={`Current ${record.old_threshold}`} metrics={record.current_validation} accent="#64748b" />
          </div>

          <p className="mt-6 text-xs font-black uppercase tracking-wider text-slate-400">Step 3 · Three checks, all must pass</p>
          <ul className="mt-3 space-y-2">
            {record.checks.map((check) => (
              <li key={check.code} className="flex gap-2 rounded-2xl border border-slate-100 p-3">
                {check.passed ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                )}
                <div>
                  <p className="text-xs font-bold text-slate-800">{check.label}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">{check.detail}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className={`mt-4 text-sm font-black ${activated ? 'text-green-800' : 'text-amber-800'}`}>
            {activated
              ? `Decision: ${record.activated_threshold} is now the company's alert threshold.`
              : `Decision: ${record.old_threshold} stays in force. The candidate was recorded, not activated.`}
          </p>
        </div>
      </div>
    </div>
  );
};

const SweepChart = ({ sweep, candidate, current }: { sweep: ConfusionMetrics[]; candidate: number; current: number }) => {
  const data = sweep.map((point) => ({
    threshold: point.threshold,
    F1: +(point.f1 * 100).toFixed(1),
    Precision: +(point.precision * 100).toFixed(1),
    Recall: +(point.recall * 100).toFixed(1),
  }));
  return (
    <div className="mt-3 h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 24, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#eef2f7" vertical={false} />
          <XAxis
            dataKey="threshold"
            tick={{ fill: '#64748b', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: '#e2e8f0' }}
            label={{ value: 'Candidate threshold', position: 'insideBottom', offset: -4, fill: '#94a3b8', fontSize: 11 }}
          />
          <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
          <Tooltip
            contentStyle={{ borderRadius: 16, border: '1px solid #e2e8f0', fontSize: 12 }}
            formatter={(value: number, name: string) => [`${value}%`, name]}
            labelFormatter={(label) => `Threshold ${label}`}
          />
          <Legend verticalAlign="top" align="right" height={32} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine x={candidate} stroke="#2a78d6" strokeDasharray="4 4" label={{ value: 'candidate', fill: '#2a78d6', fontSize: 10, position: 'top' }} />
          {current !== candidate && (
            <ReferenceLine x={current} stroke="#94a3b8" strokeDasharray="2 4" label={{ value: 'current', fill: '#94a3b8', fontSize: 10, position: 'top' }} />
          )}
          <Line type="monotone" dataKey="F1" stroke="#1baf7a" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          <Line type="monotone" dataKey="Precision" stroke="#eb6834" strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="Recall" stroke="#2a78d6" strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

const SweepTable = ({ sweep, candidate }: { sweep: ConfusionMetrics[]; candidate: number }) => (
  <div className="mt-3 max-h-56 overflow-auto">
    <table className="w-full min-w-[420px] text-left text-xs">
      <thead className="sticky top-0 bg-white">
        <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-wider text-slate-400">
          <th className="py-2 pr-4">Threshold</th>
          <th className="py-2 pr-4">Precision</th>
          <th className="py-2 pr-4">Recall</th>
          <th className="py-2 pr-4">F1</th>
          <th className="py-2 pr-4">FPR</th>
          <th className="py-2">Alerts</th>
        </tr>
      </thead>
      <tbody className="tabular-nums text-slate-700">
        {sweep.map((point) => {
          const isCandidate = point.threshold === candidate;
          return (
            <tr key={point.threshold} className={`border-b border-slate-50 ${isCandidate ? 'bg-blue-50/60 font-black text-slate-900' : ''}`}>
              <td className="py-1.5 pr-4">
                {point.threshold}
                {isCandidate && <span className="ml-2 text-[10px] uppercase tracking-wider text-blue-700">best F1</span>}
              </td>
              <td className="py-1.5 pr-4">{pct0(point.precision)}</td>
              <td className="py-1.5 pr-4">{pct0(point.recall)}</td>
              <td className="py-1.5 pr-4">{point.f1.toFixed(2)}</td>
              <td className="py-1.5 pr-4">{pct(point.false_positive_rate)}</td>
              <td className="py-1.5">{point.alerts}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

const HistoryList = ({ history }: { history: CalibrationRecord[] }) => (
  <div className="border-t border-slate-100 px-7 py-6">
    <p className="text-sm font-black text-slate-900">Calibration history</p>
    <p className="mt-1 text-xs text-slate-500">
      Every attempt is kept, activated or not, so &ldquo;why does this company alert at {history.find((h) => h.outcome === 'activated')?.activated_threshold ?? '…'}?&rdquo;
      always has an answer.
    </p>
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead>
          <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-wider text-slate-400">
            <th className="py-2 pr-4">When</th>
            <th className="py-2 pr-4">Trigger</th>
            <th className="py-2 pr-4">From → candidate</th>
            <th className="py-2 pr-4">Outcome</th>
            <th className="py-2 pr-4">Held-out F1</th>
            <th className="py-2">Reviews</th>
          </tr>
        </thead>
        <tbody className="tabular-nums text-slate-700">
          {history.map((entry) => (
            <tr key={entry.calibration_id} className="border-b border-slate-50">
              <td className="py-2 pr-4">{dateTime(entry.created_at)}</td>
              <td className="py-2 pr-4">{entry.triggered_by === 'auto' ? 'automatic' : 'manual'}</td>
              <td className="py-2 pr-4 font-bold text-slate-900">
                {entry.old_threshold} → {entry.candidate_threshold}
              </td>
              <td className="py-2 pr-4">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                    entry.outcome === 'activated' ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800'
                  }`}
                >
                  {entry.outcome}
                </span>
              </td>
              <td className="py-2 pr-4">{entry.validation ? entry.validation.f1.toFixed(2) : '—'}</td>
              <td className="py-2">{entry.review_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

// --------------------------------------------------------------------- review queue

const ReviewButtons = ({
  review,
  busy,
  onLabel,
  onUndo,
}: {
  review: ReviewRecord | null;
  busy: boolean;
  onLabel: (label: ReviewLabel, note: string | null) => void;
  onUndo?: () => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState(review?.note ?? '');

  useEffect(() => {
    setEditing(false);
    setShowNote(false);
    setNote(review?.note ?? '');
  }, [review?.review_id, review?.label, review?.note]);

  if (review && !editing) {
    const meta = LABEL_META[review.label];
    const Icon = meta.icon;
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-wider ${meta.chip}`}>
          <Icon className="h-3 w-3" />
          {meta.label}
        </span>
        <span className="text-[11px] text-slate-400">
          {review.reviewer ? `${review.reviewer} · ` : ''}
          {dateOnly(review.reviewed_at)}
          {review.source === 'sample' ? ' · below-threshold sample' : ''}
        </span>
        {review.note && <span className="text-[11px] italic text-slate-500">&ldquo;{review.note}&rdquo;</span>}
        <button onClick={() => setEditing(true)} disabled={busy} className="text-[11px] font-bold text-slate-500 hover:text-slate-900">
          Change
        </button>
        {onUndo && (
          <button onClick={onUndo} disabled={busy} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-900">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
            Undo
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {LABEL_ORDER.map((label) => {
          const meta = LABEL_META[label];
          const Icon = meta.icon;
          return (
            <button
              key={label}
              onClick={() => onLabel(label, note.trim() || null)}
              disabled={busy}
              title={meta.meaning}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] font-black uppercase tracking-wider transition hover:brightness-95 disabled:opacity-50 ${meta.chip}`}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
              {meta.label}
            </button>
          );
        })}
        <button onClick={() => setShowNote((value) => !value)} className="text-[11px] font-bold text-slate-500 hover:text-slate-900">
          {showNote ? 'Hide note' : 'Add note'}
        </button>
        {review && (
          <button onClick={() => setEditing(false)} className="text-[11px] font-bold text-slate-500 hover:text-slate-900">
            Cancel
          </button>
        )}
      </div>
      {showNote && (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note for the audit trail"
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-slate-400 focus:outline-none"
        />
      )}
    </div>
  );
};

type QueueFilter = 'pending' | 'reviewed' | 'all';

const ReviewQueuePanel = ({
  queue,
  loading,
  busyId,
  onReview,
  onUndo,
  onReload,
}: {
  queue: ReviewQueue | null;
  loading: boolean;
  busyId: string | null;
  onReview: (target: ReviewTarget, label: ReviewLabel, note: string | null) => void;
  onUndo: (transactionId: string, reviewId: string) => void;
  onReload: () => void;
}) => {
  const [filter, setFilter] = useState<QueueFilter>('pending');
  const [stratum, setStratum] = useState<ReviewStratum | 'all'>('all');

  const items = queue?.items ?? [];
  const visible = items.filter(
    (item) =>
      (filter === 'all' || (filter === 'pending' ? !item.review : !!item.review)) && (stratum === 'all' || item.stratum === stratum),
  );
  const stale = !!queue && queue.run_threshold !== null && queue.run_threshold !== queue.threshold.value;

  return (
    <div className={`${card} overflow-hidden`}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-7 py-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
            <ClipboardCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-black text-slate-900">Review queue — your verdicts are this company&rsquo;s ground truth</p>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">
              Every alert, plus a random sample of rows <em>below</em> the threshold. Reviewing only alerts would reveal false
              alarms but never what the engine missed, so recall could not be measured and no threshold could be trusted.
            </p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {LABEL_ORDER.map((label) => {
                const meta = LABEL_META[label];
                const Icon = meta.icon;
                return (
                  <span key={label} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                    <Icon className="h-3 w-3" style={{ color: meta.hex }} />
                    <b className="text-slate-700">{meta.label}</b> = {meta.meaning}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {queue && queue.run_id && (
            <p className="text-xs font-bold text-slate-600">
              <span className="text-xl font-black tabular-nums text-slate-900">{queue.reviewed}</span> / {items.length} reviewed
            </p>
          )}
          <button
            onClick={onReload}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-bold text-slate-600 transition hover:border-slate-400 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {!queue || !queue.run_id ? (
        <p className="px-7 py-10 text-center text-sm text-slate-400">
          {loading ? 'Loading the review queue…' : queue?.message ?? 'Run the analysis first. The review queue is built from the latest run.'}
        </p>
      ) : (
        <>
          {stale && (
            <div className="mx-7 mt-5 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                These scores come from the run on {dateTime(queue.run_at)}, which alerted at {queue.run_threshold}. The company
                threshold is now {queue.threshold.value}, so the lanes below already use the new line — re-run the analysis to
                refresh the stored alerts too.
              </span>
            </div>
          )}

          <div className="grid gap-3 px-7 pt-5 sm:grid-cols-2 xl:grid-cols-4">
            {STRATUM_ORDER.map((key) => {
              const summary = queue.strata[key];
              if (!summary) return null;
              const style = STRATUM_STYLE[key];
              const active = stratum === key;
              return (
                <button
                  key={key}
                  onClick={() => setStratum(active ? 'all' : key)}
                  title={summary.why}
                  className={`rounded-2xl border p-4 text-left transition ${active ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${style.chip}`}>
                    {summary.label}
                  </span>
                  <p className="mt-2 text-2xl font-black tabular-nums text-slate-900">
                    {summary.sampled}
                    <span className="text-sm font-bold text-slate-400"> of {summary.population}</span>
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-slate-500">
                    {summary.rate === null ? 'every row is reviewed' : `${pct0(summary.rate)} random sample`}
                  </p>
                  <p className="mt-2 text-[11px] leading-snug text-slate-500">{summary.why}</p>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 px-7 pt-5">
            {(['pending', 'reviewed', 'all'] as QueueFilter[]).map((key) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`rounded-full border px-4 py-1.5 text-xs font-bold capitalize transition ${
                  filter === key ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400'
                }`}
              >
                {key}
                {key === 'pending' ? ` (${queue.pending})` : key === 'reviewed' ? ` (${queue.reviewed})` : ` (${items.length})`}
              </button>
            ))}
            {stratum !== 'all' && (
              <button onClick={() => setStratum('all')} className="text-xs font-bold text-slate-500 hover:text-slate-900">
                Clear lane filter
              </button>
            )}
          </div>

          <div className="mt-4 max-h-[720px] overflow-y-auto border-t border-slate-100">
            {visible.length === 0 && (
              <p className="px-7 py-10 text-center text-sm text-slate-400">
                {filter === 'pending' ? 'Nothing left to review in this lane. Re-run the analysis when new transactions arrive.' : 'No rows match this filter.'}
              </p>
            )}
            {visible.map((item) => (
              <React.Fragment key={item.transaction_id}>
                <QueueRow
                  item={item}
                  busy={busyId === item.transaction_id}
                  onLabel={(label, note) =>
                    onReview(
                      {
                        transaction_id: item.transaction_id,
                        finding_id: item.finding_id,
                        source: item.stratum === 'near_miss' || item.stratum === 'low' ? 'sample' : 'alert',
                      },
                      label,
                      note,
                    )
                  }
                  onUndo={item.review ? () => onUndo(item.transaction_id, item.review!.review_id) : undefined}
                />
              </React.Fragment>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const QueueRow = ({
  item,
  busy,
  onLabel,
  onUndo,
}: {
  item: ReviewQueueItem;
  busy: boolean;
  onLabel: (label: ReviewLabel, note: string | null) => void;
  onUndo?: () => void;
}) => {
  const band = BAND_META[item.band];
  const style = STRATUM_STYLE[item.stratum];
  const txn = item.transaction;
  return (
    <div className="flex flex-col gap-3 border-b border-slate-50 px-7 py-4 lg:flex-row lg:items-center lg:gap-6">
      <div className="w-14 shrink-0">
        <p className="text-2xl font-black tabular-nums leading-none" style={{ color: band.hex }}>
          {item.risk_score.toFixed(0)}
        </p>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full" style={{ width: `${item.risk_score}%`, backgroundColor: band.hex }} />
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${style.chip}`}>
            {item.stratum_label}
          </span>
          <span className="text-[11px] font-semibold text-slate-400">
            {band.label} band
            {item.corroboration > 0 ? ` · ${item.corroboration} view${item.corroboration === 1 ? '' : 's'} agree` : ''}
          </span>
          <span className="flex gap-1">
            {VIEW_ORDER.map((view) => (
              <span
                key={view}
                title={VIEW_META[view].label}
                className="h-1.5 w-4 rounded-full"
                style={{ backgroundColor: item.views_triggered.includes(view) ? VIEW_COLOR[view] : '#e2e8f0' }}
              />
            ))}
          </span>
        </div>
        <p className="mt-1 truncate text-sm font-bold text-slate-900">{txn.chart_acc_head || txn.description || 'Transaction'}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {new Date(txn.transaction_date).toLocaleDateString()} · {money(txn.amount)}
          {txn.invoice_id ? ` · voucher ${txn.invoice_id}` : ''}
          {txn.description && txn.chart_acc_head ? ` · ${txn.description}` : ''}
        </p>
        {item.top_evidence ? (
          <p className="mt-1 text-xs leading-relaxed text-slate-600">{item.top_evidence}</p>
        ) : (
          <p className="mt-1 text-xs italic text-slate-400">No forensic signal was raised for this row. It is here as a control sample.</p>
        )}
      </div>

      <div className="lg:w-[380px] lg:shrink-0">
        <ReviewButtons review={item.review} busy={busy} onLabel={onLabel} onUndo={onUndo} />
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ scoring views

const MethodStrip = ({ diagnostics }: { diagnostics: EngineAnalyzeResponse['diagnostics'] | null }) => (
  <div>
    <p className="px-1 text-xs font-black uppercase tracking-wider text-slate-400">How every transaction is scored</p>
    <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {VIEW_ORDER.map((view) => {
        const meta = VIEW_META[view];
        const Icon = meta.icon;
        const info = diagnostics?.views?.[view];
        const credibility = diagnostics?.view_credibility?.[view];
        return (
          <div key={view} className={`${card} p-6`}>
            <div className="flex items-center gap-3">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-2xl"
                style={{ backgroundColor: `${VIEW_COLOR[view]}1a`, color: VIEW_COLOR[view] }}
              >
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-black text-slate-900">{meta.label}</p>
                {credibility !== undefined && (
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">credibility {credibility.toFixed(2)}</p>
                )}
              </div>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-slate-500">{meta.blurb}</p>
            {info && (
              <p className="mt-4 text-xs font-bold text-slate-700">
                {info.status === 'ok' ? `${info.signals ?? 0} signals raised` : `unavailable — ${info.error ?? 'error'}`}
              </p>
            )}
          </div>
        );
      })}
    </div>
  </div>
);

const BandTiles = ({
  bands,
  totalScored,
  reported,
  threshold,
  active,
  onSelect,
}: {
  bands: Record<RiskBand, number>;
  totalScored: number;
  reported: number;
  threshold: ThresholdInfo | null;
  active: RiskBand | 'all';
  onSelect: (band: RiskBand | 'all') => void;
}) => (
  <div className={`${card} p-6`}>
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <div>
        <p className="text-sm font-black text-slate-900">Alerts and risk distribution</p>
        <p className="mt-1 text-xs text-slate-500">
          {totalScored.toLocaleString()} transactions scored · {reported} alert{reported === 1 ? '' : 's'} at this company&rsquo;s threshold
          {threshold ? ` of ${threshold.value} (${sourceShort(threshold.source).toLowerCase()})` : ''}. Bands describe how a score reads;
          the threshold decides what alerts.
        </p>
      </div>
      <button
        onClick={() => onSelect('all')}
        className={`rounded-full border px-4 py-1.5 text-xs font-bold transition ${
          active === 'all' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400'
        }`}
      >
        Show all
      </button>
    </div>

    <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {BAND_ORDER.map((band) => {
        const meta = BAND_META[band];
        const Icon = meta.icon;
        const count = bands?.[band] ?? 0;
        const isActive = active === band;
        return (
          <button
            key={band}
            onClick={() => onSelect(isActive ? 'all' : band)}
            className={`rounded-3xl border p-5 text-left transition ${
              isActive ? `border-transparent ring-2 ${meta.ring} bg-slate-50` : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4" style={{ color: meta.hex }} />
              <span className="text-xs font-black uppercase tracking-wider" style={{ color: meta.hex }}>
                {meta.label}
              </span>
            </div>
            <p className="mt-3 text-4xl font-black tabular-nums text-slate-950">{count}</p>
            <p className="mt-1 text-xs text-slate-500">{totalScored ? `${((count / totalScored) * 100).toFixed(0)}% of scored rows` : 'no rows'}</p>
          </button>
        );
      })}
    </div>
  </div>
);

const DataQualityPanel = ({ warnings }: { warnings: string[] }) => (
  <div className="rounded-[32px] border border-amber-200 bg-amber-50 p-6">
    <div className="flex items-center gap-2">
      <AlertTriangle className="h-4 w-4 text-amber-700" />
      <p className="text-sm font-black text-amber-900">Data quality limits what any view can find</p>
    </div>
    <ul className="mt-4 space-y-2">
      {warnings.map((warning) => (
        <li key={warning} className="flex gap-2 text-xs leading-relaxed text-amber-900">
          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-600" />
          <span>{warning}</span>
        </li>
      ))}
    </ul>
  </div>
);

const FindingsList = ({
  findings,
  selectedId,
  onSelect,
  transactionById,
  bandFilter,
}: {
  findings: EngineFinding[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  transactionById: Map<string, Transaction>;
  bandFilter: RiskBand | 'all';
}) => (
  <div className={`${card} flex flex-col overflow-hidden`}>
    <div className="border-b border-slate-100 px-6 py-5">
      <p className="text-sm font-black text-slate-900">Ranked alerts</p>
      <p className="mt-1 text-xs text-slate-500">
        {findings.length} {bandFilter === 'all' ? 'alerted' : `${BAND_META[bandFilter].label.toLowerCase()}-band`} findings, highest risk first
      </p>
    </div>

    <div className="max-h-[560px] overflow-y-auto">
      {findings.length === 0 && <p className="px-6 py-10 text-center text-sm text-slate-400">No findings in this band.</p>}
      {findings.map((finding) => {
        const meta = BAND_META[finding.band];
        const Icon = meta.icon;
        const txn = transactionById.get(finding.transaction_id);
        const isActive = finding.transaction_id === selectedId;
        const review = finding.review ?? null;
        return (
          <button
            key={finding.transaction_id}
            onClick={() => onSelect(finding.transaction_id)}
            className={`flex w-full items-center gap-4 border-b border-slate-50 px-6 py-4 text-left transition ${
              isActive ? 'bg-slate-50' : 'hover:bg-slate-50/60'
            }`}
          >
            <div className="w-14 shrink-0">
              <p className="text-2xl font-black tabular-nums leading-none" style={{ color: meta.hex }}>
                {finding.risk_score.toFixed(0)}
              </p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full" style={{ width: `${finding.risk_score}%`, backgroundColor: meta.hex }} />
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: meta.hex }} />
                <span className="text-[11px] font-black uppercase tracking-wider" style={{ color: meta.hex }}>
                  {meta.label}
                </span>
                <span className="text-[11px] font-semibold text-slate-400">
                  · {finding.corroboration} view{finding.corroboration === 1 ? '' : 's'} agree
                </span>
                {review && (
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${LABEL_META[review.label].chip}`}>
                    {LABEL_META[review.label].label}
                  </span>
                )}
              </div>
              <p className="mt-1 truncate text-sm font-bold text-slate-900">
                {txn?.chart_acc_head || finding.evidence[0]?.code.replace(/_/g, ' ') || 'Transaction'}
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-500">{finding.evidence[0]?.message ?? ''}</p>
            </div>

            <div className="shrink-0 text-right">
              {txn && <p className="text-sm font-black tabular-nums text-slate-900">{money(txn.amount)}</p>}
              <div className="mt-1.5 flex justify-end gap-1">
                {VIEW_ORDER.map((view) => (
                  <span
                    key={view}
                    title={VIEW_META[view].label}
                    className="h-1.5 w-4 rounded-full"
                    style={{ backgroundColor: finding.views_triggered.includes(view) ? VIEW_COLOR[view] : '#e2e8f0' }}
                  />
                ))}
              </div>
            </div>
            <ChevronRight className={`h-4 w-4 shrink-0 ${isActive ? 'text-slate-700' : 'text-slate-300'}`} />
          </button>
        );
      })}
    </div>
  </div>
);

const CasePanel = ({
  finding,
  transaction,
  busy,
  onReview,
  onUndo,
}: {
  finding: EngineFinding | null;
  transaction: Transaction | null;
  busy: boolean;
  onReview: (target: ReviewTarget, label: ReviewLabel, note: string | null) => void;
  onUndo: (transactionId: string, reviewId: string) => void;
}) => {
  if (!finding) {
    return <div className={`${card} flex items-center justify-center p-10 text-sm text-slate-400`}>Select a finding to open its case file.</div>;
  }

  const meta = BAND_META[finding.band];
  const Icon = meta.icon;
  const review = finding.review ?? null;

  return (
    <div className={`${card} overflow-hidden`}>
      <div className="border-b border-slate-100 px-7 py-6">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-wider ${meta.chip}`}>
              <Icon className="h-3 w-3" />
              {meta.label} risk
            </div>
            <p className="mt-3 truncate text-xl font-black text-slate-950">{transaction?.chart_acc_head || 'Transaction'}</p>
            {transaction && (
              <p className="mt-1 text-xs text-slate-500">
                {new Date(transaction.transaction_date).toLocaleDateString()} · {money(transaction.amount)}
                {transaction.invoice_id ? ` · voucher ${transaction.invoice_id}` : ''}
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-5xl font-black tabular-nums leading-none" style={{ color: meta.hex }}>
              {finding.risk_score.toFixed(0)}
            </p>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">of 100</p>
          </div>
        </div>

        <div className="mt-5 rounded-2xl bg-slate-50 p-4">
          <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Your verdict</p>
          <p className="mb-3 mt-1 text-[11px] text-slate-500">
            Recorded as company ground truth and used, once there is enough of it, to choose this company&rsquo;s alert threshold.
          </p>
          <ReviewButtons
            review={review}
            busy={busy}
            onLabel={(label, note) => onReview({ transaction_id: finding.transaction_id, finding_id: finding.finding_id ?? null, source: 'alert' }, label, note)}
            onUndo={review ? () => onUndo(finding.transaction_id, review.review_id) : undefined}
          />
        </div>
      </div>

      <div className="border-b border-slate-100 px-7 py-6">
        <p className="text-xs font-black uppercase tracking-wider text-slate-400">How each view scored it</p>
        <div className="mt-4 space-y-3">
          {VIEW_ORDER.map((view) => {
            const score = finding.view_scores[view] ?? 0;
            const triggered = finding.views_triggered.includes(view);
            return (
              <div key={view} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-xs font-bold text-slate-600">{VIEW_META[view].label}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.max(score, 0)}%`, backgroundColor: triggered ? VIEW_COLOR[view] : '#cbd5e1' }}
                  />
                </div>
                <span className={`w-10 shrink-0 text-right text-xs font-black tabular-nums ${triggered ? 'text-slate-900' : 'text-slate-300'}`}>
                  {score.toFixed(0)}
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
          Scores fuse by noisy-OR after each view is discounted by how much it can be trusted alone, so agreement between
          views raises the total without any single view reaching certainty.
        </p>
      </div>

      <div className="px-7 py-6">
        <p className="text-xs font-black uppercase tracking-wider text-slate-400">Why it was flagged</p>
        <ol className="mt-4 space-y-3">
          {finding.evidence.map((item, index) => (
            <li key={`${item.code}-${index}`} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: VIEW_COLOR[item.view] }} />
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                  {VIEW_META[item.view].label} · {item.code.replace(/_/g, ' ')}
                </span>
                <span className="ml-auto text-[11px] font-bold tabular-nums text-slate-400">strength {item.strength.toFixed(2)}</span>
              </div>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-800">{item.message}</p>
              <EvidenceDetail detail={item.detail} />
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
};

const EvidenceDetail = ({ detail }: { detail: Record<string, unknown> }) => {
  const entries = Object.entries(detail || {}).filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object');
  if (!entries.length) return null;
  return (
    <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
      {entries.slice(0, 6).map(([key, value]) => (
        <div key={key} className="flex items-baseline gap-1.5">
          <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{key.replace(/_/g, ' ')}</dt>
          <dd className="text-xs font-bold tabular-nums text-slate-700">
            {typeof value === 'number' ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
};

// ------------------------------------------------------------- synthetic benchmark

const BenchmarkSection = ({ benchmark, running, onRun }: { benchmark: BenchmarkResponse | null; running: boolean; onRun: () => void }) => (
  <div className={`${card} overflow-hidden`}>
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-7 py-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-700">
          <Beaker className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-black text-slate-900">Does the engine actually work? — synthetic benchmark</p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
            Real spend data carries no fraud labels, so the engine is measured by planting known schemes into a copy of the
            ledger and checking how many come back. Nothing is written to the database.
          </p>
        </div>
      </div>
      {!benchmark && (
        <button
          onClick={onRun}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-60"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
          {running ? 'Running…' : 'Run benchmark'}
        </button>
      )}
    </div>

    <div className="mx-7 mt-6 flex items-start gap-2 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-xs leading-relaxed text-violet-900">
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <b>Kept separate from calibration.</b> This is developer evidence that the engine can find fraud it is known to
        contain. Nothing here is company ground truth and nothing here sets the company&rsquo;s alert threshold above; that
        comes only from human reviews of real rows.
      </span>
    </div>

    {!benchmark ? (
      <p className="px-7 py-10 text-center text-sm text-slate-400">
        {running ? 'Planting fraud scenarios and re-scoring the ledger…' : 'Benchmark has not been run for this department yet.'}
      </p>
    ) : (
      <div className="space-y-8 px-7 py-7">
        <BenchmarkHeadline benchmark={benchmark} />
        <ThresholdCurve points={benchmark.threshold_curve} activeThreshold={benchmark.metrics.threshold} />
        <ScenarioTable benchmark={benchmark} />
      </div>
    )}
  </div>
);

const BenchmarkHeadline = ({ benchmark }: { benchmark: BenchmarkResponse }) => {
  const { metrics, injection } = benchmark;
  const hit = Object.values(metrics.per_scenario).filter((s) => s.detected > 0).length;
  const total = Object.keys(metrics.per_scenario).length;

  const tiles = [
    { label: 'Schemes recovered', value: `${hit}/${total}`, hint: 'distinct fraud scenarios detected', accent: '#2a78d6' },
    { label: 'Recall', value: pct(metrics.recall), hint: `${metrics.true_positives} of ${metrics.planted_rows} planted rows`, accent: '#1baf7a' },
    { label: 'Precision', value: pct(metrics.precision), hint: `${metrics.flagged_rows} rows alerted at score ≥ ${metrics.threshold}`, accent: '#eb6834' },
    { label: 'False positive rate', value: pct(metrics.false_positive_rate), hint: 'of the untouched clean rows', accent: '#eda100' },
  ];

  return (
    <div>
      <p className="text-xs font-black uppercase tracking-wider text-slate-400">
        {injection.rows_planted} rows planted across {injection.scenarios_planted} scenarios · synthetic
      </p>
      {metrics.pre_existing_flagged > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          <b>{metrics.pre_existing_flagged}</b> row{metrics.pre_existing_flagged === 1 ? ' was' : 's were'} already being reported
          before anything was planted, so {metrics.pre_existing_flagged === 1 ? 'it is' : 'they are'} set aside rather than
          counted as mistakes &mdash; the engine was flagging them on the untouched ledger, which is not an error the
          injection caused.
        </p>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-3xl border border-slate-200 p-5">
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">{tile.label}</p>
            <p className="mt-2 text-3xl font-black tabular-nums" style={{ color: tile.accent }}>
              {tile.value}
            </p>
            <p className="mt-1.5 text-[11px] leading-snug text-slate-500">{tile.hint}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

const ThresholdCurve = ({ points, activeThreshold }: { points: BenchmarkResponse['threshold_curve']; activeThreshold: number }) => {
  const data = points.map((point) => ({
    threshold: point.threshold,
    Recall: +(point.recall * 100).toFixed(1),
    Precision: +(point.precision * 100).toFixed(1),
    F1: +(point.f1 * 100).toFixed(1),
  }));
  const best = points.reduce((acc, point) => (point.f1 > acc.f1 ? point : acc), points[0]);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-sm font-black text-slate-900">How the engine trades precision for recall on planted fraud</p>
          <p className="mt-1 text-xs text-slate-500">
            Best F1 at a threshold of {best.threshold} on this synthetic test &mdash; {pct(best.recall)} recall, {pct(best.precision)} precision.
            Scored at {activeThreshold}. This curve describes the engine, not the company: it never sets the company threshold.
          </p>
        </div>
      </div>
      <div className="mt-4 h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 24, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#eef2f7" vertical={false} />
            <XAxis
              dataKey="threshold"
              tick={{ fill: '#64748b', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#e2e8f0' }}
              label={{ value: 'Risk-score threshold', position: 'insideBottom', offset: -4, fill: '#94a3b8', fontSize: 11 }}
            />
            <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
            <Tooltip
              contentStyle={{ borderRadius: 16, border: '1px solid #e2e8f0', fontSize: 12 }}
              formatter={(value: number, name: string) => [`${value}%`, name]}
              labelFormatter={(label) => `Threshold ${label}`}
            />
            <Legend verticalAlign="top" align="right" height={32} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="Recall" stroke="#2a78d6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="Precision" stroke="#eb6834" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="F1" stroke="#1baf7a" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ThresholdTable points={points} />
    </div>
  );
};

// The chart's aqua and orange series sit below 3:1 against white, so the numbers are also
// available as text rather than readable only off the line colour.
const ThresholdTable = ({ points }: { points: BenchmarkResponse['threshold_curve'] }) => (
  <div className="mt-4 overflow-x-auto">
    <table className="w-full min-w-[520px] text-left text-xs">
      <thead>
        <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-wider text-slate-400">
          <th className="py-2 pr-4">Threshold</th>
          <th className="py-2 pr-4">Recall</th>
          <th className="py-2 pr-4">Precision</th>
          <th className="py-2 pr-4">F1</th>
          <th className="py-2 pr-4">False positive rate</th>
          <th className="py-2">Rows alerted</th>
        </tr>
      </thead>
      <tbody className="tabular-nums text-slate-700">
        {points.map((point) => (
          <tr key={point.threshold} className="border-b border-slate-50">
            <td className="py-2 pr-4 font-bold text-slate-900">{point.threshold}</td>
            <td className="py-2 pr-4">{pct(point.recall)}</td>
            <td className="py-2 pr-4">{pct(point.precision)}</td>
            <td className="py-2 pr-4">{pct(point.f1)}</td>
            <td className="py-2 pr-4">{pct(point.false_positive_rate)}</td>
            <td className="py-2">{point.flagged}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const ScenarioTable = ({ benchmark }: { benchmark: BenchmarkResponse }) => {
  const entries = Object.entries(benchmark.metrics.per_scenario);
  return (
    <div>
      <p className="text-sm font-black text-slate-900">Scheme by scheme</p>
      <p className="mt-1 text-xs text-slate-500">Each planted scheme, whether it was recovered, and which views caught it.</p>

      <div className="mt-4 space-y-2.5">
        {entries.map(([scenario, result]) => {
          const caught = result.detected > 0;
          return (
            <div
              key={scenario}
              className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border p-4 ${
                caught ? 'border-green-200 bg-green-50/50' : 'border-slate-200 bg-slate-50/60'
              }`}
            >
              <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider">
                {caught ? <BadgeCheck className="h-4 w-4" style={{ color: BAND_META.low.hex }} /> : <XCircle className="h-4 w-4 text-slate-400" />}
                <span style={{ color: caught ? BAND_META.low.hex : '#94a3b8' }}>{caught ? 'Detected' : 'Missed'}</span>
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-slate-900">{scenario.replace(/_/g, ' ')}</p>
                <p className="mt-0.5 text-xs text-slate-500">{result.description}</p>
              </div>

              <div className="flex items-center gap-5 text-xs">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Rows</p>
                  <p className="font-black tabular-nums text-slate-800">
                    {result.detected}/{result.planted}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Top score</p>
                  <p className="font-black tabular-nums text-slate-800">{result.best_score.toFixed(0)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Rank</p>
                  <p className="font-black tabular-nums text-slate-800">#{result.best_rank ?? '—'}</p>
                </div>
                <div className="flex gap-1">
                  {VIEW_ORDER.map((view) => (
                    <span
                      key={view}
                      title={VIEW_META[view].label}
                      className="h-1.5 w-4 rounded-full"
                      style={{ backgroundColor: result.triggered_views.includes(view) ? VIEW_COLOR[view] : '#e2e8f0' }}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {Object.keys(benchmark.scenarios_unsupported).length > 0 && (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-slate-500" />
            <p className="text-xs font-black text-slate-700">Not testable on this ledger</p>
          </div>
          <ul className="mt-2 space-y-1">
            {Object.entries(benchmark.scenarios_unsupported).map(([scenario, reason]) => (
              <li key={scenario} className="text-xs text-slate-500">
                <span className="font-bold text-slate-600">{scenario.replace(/_/g, ' ')}</span> — {reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default ForensicIntelligence;
