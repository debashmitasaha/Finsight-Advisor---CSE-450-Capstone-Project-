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
  Compass,
  FlaskConical,
  Gauge,
  HelpCircle,
  History,
  Info,
  Layers,
  Lock,
  Network,
  Play,
  RefreshCw,
  Scale,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
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
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import {
  BusyOverlay,
  Button,
  Card,
  Chip,
  Drawer,
  Empty,
  InfoDot,
  Meter,
  Reveal,
  SectionHead,
  Segmented,
  Stat,
  StepRule,
  Term,
  Tip,
} from '../components/ForensicKit';
import { LoopDiagram } from '../components/ForensicArt';
import HistoricalScanPanel from '../components/HistoricalScanPanel';
import artViews from '../assets/views-fusion.webp';
import artEvidence from '../assets/evidence-trail.webp';
import artLedger from '../assets/ledger-normalised.webp';
import boardCase from '../assets/case-anatomy.webp';
import boardCalibration from '../assets/calibration-journey.webp';
import boardReview from '../assets/review-flow.webp';
import boardProof from '../assets/benchmark-proof.webp';
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

const VIEW_META: Record<ForensicView, { label: string; icon: React.ElementType; short: string; blurb: string }> = {
  rule: {
    label: 'Rule & Control',
    icon: Scale,
    short: 'The audit tests, written down',
    blurb: 'ACFE audit tests — duplicate payments, split purchasing, payments steered just under an approval limit.',
  },
  behavioral: {
    label: 'Behavioural AI',
    icon: Activity,
    short: 'What is normal for this account head',
    blurb:
      'Learns what is normal for each account head, then flags what breaks that entity’s own pattern. A head too new to judge is compared with its approved expense category instead.',
  },
  temporal: {
    label: 'Temporal',
    icon: Timer,
    short: 'Patterns that only exist over time',
    blurb: 'Patterns that only exist across rows — payment bursts, dormant heads reactivating, velocity spikes.',
  },
  relational: {
    label: 'Relational',
    icon: Network,
    short: 'Which heads are posted together',
    blurb: 'Which account heads normally get posted together, and which payment breaks that habit.',
  },
};

// Status palette — reserved, never reused as a series colour, and always paired with an
// icon and a written label so the band never depends on hue alone.
const BAND_META: Record<RiskBand, { label: string; hex: string; icon: React.ElementType; chip: string }> = {
  critical: { label: 'Critical', hex: '#d03b3b', icon: AlertOctagon, chip: 'border-red-200/70 bg-red-50 text-red-700' },
  high: { label: 'High', hex: '#ec835a', icon: ShieldAlert, chip: 'border-orange-200/70 bg-orange-50 text-orange-700' },
  medium: { label: 'Medium', hex: '#fab219', icon: AlertTriangle, chip: 'border-amber-200/70 bg-amber-50 text-amber-700' },
  low: { label: 'Low', hex: '#0ca30c', icon: CheckCircle2, chip: 'border-green-200/70 bg-green-50 text-green-700' },
};

const LABEL_META: Record<ReviewLabel, { label: string; hex: string; chip: string; icon: React.ElementType; meaning: string }> = {
  confirmed: {
    label: 'Confirmed',
    hex: '#d03b3b',
    chip: 'border-red-200/70 bg-red-50 text-red-700',
    icon: AlertOctagon,
    meaning: 'A genuine issue. Counts as a positive when this company’s threshold is chosen.',
  },
  cleared: {
    label: 'Cleared',
    hex: '#0ca30c',
    chip: 'border-green-200/70 bg-green-50 text-green-700',
    icon: CheckCircle2,
    meaning: 'Legitimate spending. Counts as a negative, which is what makes precision measurable.',
  },
  uncertain: {
    label: 'Uncertain',
    hex: '#64748b',
    chip: 'border-zinc-200 bg-zinc-50 text-zinc-600',
    icon: HelpCircle,
    meaning: 'Cannot tell. Counts as reviewed but is excluded from every metric.',
  },
};

const MODE_META: Record<CalibrationMode, { label: string; chip: string; hex: string }> = {
  bootstrap: { label: 'Bootstrap', chip: 'border-zinc-200 bg-zinc-50 text-zinc-600', hex: '#52525b' },
  warmup: { label: 'Warm-up', chip: 'border-amber-200/70 bg-amber-50 text-amber-700', hex: '#b45309' },
  calibrated: { label: 'Calibrated', chip: 'border-green-200/70 bg-green-50 text-green-700', hex: '#15803d' },
};

const MODE_ORDER: CalibrationMode[] = ['bootstrap', 'warmup', 'calibrated'];

const STRATUM_STYLE: Record<ReviewStratum, { chip: string; hex: string }> = {
  priority: { chip: 'border-red-200/70 bg-red-50 text-red-700', hex: '#d03b3b' },
  alert: { chip: 'border-orange-200/70 bg-orange-50 text-orange-700', hex: '#ec835a' },
  near_miss: { chip: 'border-amber-200/70 bg-amber-50 text-amber-700', hex: '#b45309' },
  low: { chip: 'border-zinc-200 bg-zinc-50 text-zinc-600', hex: '#64748b' },
};

const STRATUM_ORDER: ReviewStratum[] = ['priority', 'alert', 'near_miss', 'low'];
const BAND_ORDER: RiskBand[] = ['critical', 'high', 'medium', 'low'];
const VIEW_ORDER: ForensicView[] = ['rule', 'behavioral', 'temporal', 'relational'];
const LABEL_ORDER: ReviewLabel[] = ['confirmed', 'cleared', 'uncertain'];

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
type Tab = 'overview' | 'alerts' | 'history' | 'review' | 'calibration' | 'proof';
type GuideStep = {
  title: string;
  body: string;
  hint: string;
  done: boolean;
  // `nav` actions just move to a tab, so the guide closes behind them. A long
  // action leaves the guide open, so its step ticks over in front of the reader.
  action?: { label: string; run: () => void; busy?: boolean; nav?: boolean };
};

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
  const [tab, setTab] = useState<Tab>('overview');
  const [guideOpen, setGuideOpen] = useState(false);

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
      // A department with no transactions comes back without diagnostics at all.
      // Holding on to that response would leave the page reading fields that are
      // not there, so it is reported as a message instead of a run.
      if (!result.diagnostics) {
        setAnalysis(null);
        setStoredFindings([]);
        setSelectedId(null);
        setStatus(result.message || 'This department has no transactions to analyse yet. Upload a ledger in Dept Control first.');
        return;
      }
      setAnalysis(result);
      setStoredFindings([]);
      setSelectedId(result.findings[0]?.transaction_id ?? null);
      if (!result.findings.length) {
        setStatus(`Analysis complete — nothing scored at or above the alert threshold of ${result.threshold?.value ?? result.min_report_score}.`);
      } else {
        setTab('alerts');
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
    setTab('proof');
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
    setTab('overview');
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
  const hasRun = !!analysis || storedFindings.length > 0;

  const openBand = useCallback((band: RiskBand | 'all') => {
    setBandFilter(band);
    setTab('alerts');
  }, []);

  // The guide reads the real state of this department, so it always shows what is
  // genuinely left to do rather than a fixed tour.
  const steps: GuideStep[] = [
    {
      title: 'Load a ledger',
      done: transactions.length > 0,
      body: 'The engine scores what is already in this department. Upload happens in Dept Control, one sheet at a time.',
      hint: transactions.length > 0 ? `${transactions.length.toLocaleString()} transactions ready` : 'nothing uploaded yet',
    },
    {
      title: 'Score every transaction',
      done: hasRun,
      body: 'Four views examine each payment and fuse their evidence into one number out of a hundred.',
      hint: hasRun ? 'a run is stored for this department' : 'takes a second or two',
      action: { label: running ? 'Analysing…' : 'Run analysis', run: runAnalysis, busy: running },
    },
    {
      title: 'Open a case file',
      done: hasRun && findings.length > 0,
      body: 'Pick any alert to see how each view scored it and every piece of evidence behind the number.',
      hint: findings.length ? `${findings.length} alerts waiting` : 'appears once the engine has run',
      action: findings.length ? { label: 'Go to alerts', run: () => setTab('alerts'), nav: true } : undefined,
    },
    {
      title: 'Give verdicts',
      done: (queue?.reviewed ?? 0) > 0,
      body: 'Confirmed or cleared. This is the only thing that ever moves the alert line, and it is what makes the engine yours.',
      hint: queue ? `${queue.reviewed} judged, ${queue.pending} waiting` : 'the queue is built from the latest run',
      action: queue?.run_id ? { label: 'Go to the queue', run: () => setTab('review'), nav: true } : undefined,
    },
    {
      title: 'Let the line calibrate',
      done: calibration?.mode === 'calibrated',
      body: 'Once enough verdicts exist the engine sweeps every threshold, picks the best, and keeps it only if it survives a held-out check.',
      hint:
        calibration?.mode === 'calibrated'
          ? `alerting at ${calibration.threshold.value}, chosen from your reviews`
          : calibration
            ? `${calibration.counts.reviewed} of ${calibration.requirements.min_reviewed_rows} reviews, ${calibration.counts.confirmed} of ${calibration.requirements.min_positive_labels} confirmed, ${calibration.counts.cleared} of ${calibration.requirements.min_negative_labels} cleared`
            : 'still on the bootstrap line',
      action: { label: 'Open calibration', run: () => setTab('calibration'), nav: true },
    },
    {
      title: 'Prove it works',
      done: benchmark !== null,
      body: 'Known fraud is planted into a throwaway copy of the ledger to show how much the engine recovers. Nothing is saved.',
      hint: benchmarking
        ? 'running now, this takes a few seconds'
        : benchmark
          ? `recovered ${benchmark.metrics.true_positives} of ${benchmark.metrics.planted_rows} planted rows`
          : 'takes a few seconds, good last slide for a demo',
      action: { label: benchmarking ? 'Running…' : 'Run benchmark', run: runBenchmark, busy: benchmarking },
    },
  ];
  const doneCount = steps.filter((step) => step.done).length;

  if (!department) {
    return (
      <Card className="overflow-hidden">
        <Empty icon={ShieldAlert} title="No department selected" body="Choose a department to run the forensic intelligence engine." />
      </Card>
    );
  }

  // Deliberately no tooltips on the tabs: a bubble opening over the section heading
  // below them hid the very thing the reader had just clicked towards.
  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'alerts', label: 'Alerts', count: findings.length || undefined },
    { value: 'history', label: '5-year scan' },
    { value: 'review', label: 'Review', count: queue?.pending || undefined },
    { value: 'calibration', label: 'Calibration' },
    { value: 'proof', label: 'Proof' },
  ];

  const busy = running
    ? {
        title: 'Running the analysis',
        body: `Scoring every transaction in ${department.department_name} and fusing the evidence into one number each.`,
        steps: [
          'Building a baseline for every account head, group and category',
          'Running the rule, behavioural, temporal and relational views',
          'Fusing the evidence and drawing the alert line',
        ],
      }
    : benchmarking
      ? {
          title: 'Planting known fraud',
          body: 'A throwaway copy of the ledger is seeded with schemes we already know, then re-scored. Nothing is written to the database.',
          steps: ['Copying the ledger in memory', 'Injecting seven fraud scenarios', 'Re-scoring and comparing against the clean run'],
        }
      : calibrating
        ? {
            title: 'Calibrating the alert line',
            body: 'Sweeping every candidate threshold against this company’s older verdicts, then checking the winner on the newer ones.',
            steps: ['Splitting the reviewed rows by time', 'Sweeping 20 to 85 for the best F1', 'Validating on rows it was not chosen from'],
          }
        : savingSettings
          ? {
              title: 'Saving the settings',
              body: 'Storing them against this company and re-checking whether the reviews on record now meet the new minimums.',
            }
          : null;

  return (
    <div className="space-y-5">
      <Hero
        department={department}
        analysis={analysis}
        storedCount={storedFindings.length}
        threshold={threshold}
        running={running}
        benchmarking={benchmarking}
        onRun={runAnalysis}
        onBenchmark={runBenchmark}
      />

      <div className="sticky top-[88px] z-30 flex flex-wrap items-center justify-between gap-3 rounded-full border border-zinc-200/70 bg-white/85 px-2 py-2 shadow-sm backdrop-blur-xl">
        <Segmented<Tab> options={tabs} value={tab} onChange={setTab} />
        <div className="flex items-center gap-2">
          {threshold && (
            <Tip
              side="below"
              text="Scores never change. This line only decides which scores are loud enough to become alerts, and it is set per company."
            >
              <span className="hidden items-center gap-2 text-[12px] text-zinc-500 sm:inline-flex">
                <Gauge className="h-3.5 w-3.5 text-zinc-400" />
                alerting at <b className="fs-num text-zinc-900">{threshold.value}</b>
                <Chip className={MODE_META[threshold.mode].chip}>{MODE_META[threshold.mode].label}</Chip>
              </span>
            </Tip>
          )}
          <button
            onClick={() => setGuideOpen(true)}
            className={`fs-focus inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-zinc-800 ${
              doneCount < steps.length ? 'fs-next' : ''
            }`}
          >
            <Compass className="h-3.5 w-3.5" />
            What can I do here?
            <span className="fs-num rounded-full bg-white/15 px-1.5 text-[11px]">
              {doneCount}/{steps.length}
            </span>
          </button>
        </div>
      </div>

      {status && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-[13px] text-zinc-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
          <span className="flex-1">{status}</span>
          <button onClick={() => setStatus(null)} className="fs-focus text-[12px] font-medium text-zinc-400 hover:text-zinc-900">
            Dismiss
          </button>
        </div>
      )}

      {/* Shown here, above the tabs, because a calibration usually fires while the
          reviewer is in the queue. Inside the calibration tab it went unseen. */}
      {event && (
        <EventBanner
          event={event}
          onDismiss={() => setEvent(null)}
          onOpen={tab === 'calibration' ? undefined : () => setTab('calibration')}
        />
      )}

      {tab === 'overview' && (
        <OverviewTab
          department={department}
          analysis={analysis}
          storedFindings={storedFindings}
          threshold={threshold}
          calibration={calibration}
          hasRun={hasRun}
          bandFilter={bandFilter}
          onOpenBand={openBand}
          onGoCalibration={() => setTab('calibration')}
        />
      )}

      {tab === 'alerts' && (
        <AlertsTab
          findings={findings}
          visibleFindings={visibleFindings}
          selected={selected}
          onSelect={setSelectedId}
          transactionById={transactionById}
          bandFilter={bandFilter}
          onBandFilter={setBandFilter}
          busyReview={busyReview}
          onReview={submitReview}
          onUndo={undoReview}
          hasRun={hasRun}
          running={running}
          onRun={runAnalysis}
          departmentName={department.department_name}
        />
      )}

      {tab === 'history' && <HistoricalScanPanel deptId={deptId} departmentName={department.department_name} />}

      {tab === 'review' && (
        <ReviewQueuePanel
          queue={queue}
          loading={loadingQueue}
          busyId={busyReview}
          onReview={submitReview}
          onUndo={undoReview}
          onReload={loadQueue}
        />
      )}

      {tab === 'calibration' &&
        (calibration ? (
          <CalibrationTab
            status={calibration}
            latestRun={latestRun}
            calibrating={calibrating}
            onRun={runCalibration}
            savingSettings={savingSettings}
            onSaveSettings={saveSettings}
          />
        ) : (
          <Card>
            <Empty icon={Gauge} title="Calibration status is loading" body="If this stays empty, the department has no company attached yet." />
          </Card>
        ))}

      {tab === 'proof' && <BenchmarkSection benchmark={benchmark} running={benchmarking} onRun={runBenchmark} />}

      <GuidePanel
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        steps={steps}
        doneCount={doneCount}
        threshold={threshold}
      />

      <BusyOverlay open={!!busy} title={busy?.title ?? ''} body={busy?.body ?? ''} steps={busy?.steps} />
    </div>
  );
};

/* ================================================================= guide ==== */

const GuidePanel = ({
  open,
  onClose,
  steps,
  doneCount,
  threshold,
}: {
  open: boolean;
  onClose: () => void;
  steps: GuideStep[];
  doneCount: number;
  threshold: ThresholdInfo | null;
}) => {
  const nextIndex = steps.findIndex((step) => !step.done);
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="What can I do here?"
      subtitle={
        doneCount === steps.length
          ? 'Everything on this page has been exercised at least once for this department.'
          : `${doneCount} of ${steps.length} done. The highlighted step is the one to do next.`
      }
    >
      <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-4">
        <p className="fs-eyebrow text-zinc-400">The whole idea, in three moves</p>
        <LoopDiagram className="mt-2" />
      </div>

      <figure className="fs-art mt-4 overflow-hidden rounded-2xl border border-zinc-200/80">
        <img
          src={artLedger}
          alt="Raw narrations on the left, clustered in the middle, resolved into clean expense categories on the right"
          className="w-full"
        />
        <figcaption className="border-t border-zinc-100 px-4 py-3 text-[11.5px] leading-relaxed text-zinc-500">
          Before the engine sees a row, grouping and categorisation have already turned messy narrations into a clean
          cohort. That is what lets a new account head be judged against something.
        </figcaption>
      </figure>

      <ol className="mt-5 space-y-3">
        {steps.map((step, index) => {
          const isNext = index === nextIndex;
          return (
            <li
              key={step.title}
              className={`rounded-2xl border p-4 transition ${
                step.done ? 'border-zinc-200/70 bg-white' : isNext ? 'border-indigo-300 bg-indigo-50/40' : 'border-dashed border-zinc-200 bg-white'
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`fs-num mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                    step.done ? 'bg-green-600 text-white' : isNext ? 'bg-indigo-600 text-white' : 'bg-zinc-200 text-zinc-500'
                  } ${isNext ? 'fs-next' : ''}`}
                >
                  {step.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="fs-title text-[14px] text-zinc-900">{step.title}</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-500">{step.body}</p>
                  <p className="mt-1.5 text-[11.5px] text-zinc-400">{step.hint}</p>
                  {step.action && (
                    <div className="mt-3">
                      <Button
                        tone={isNext ? 'primary' : 'secondary'}
                        onClick={() => {
                          const action = step.action!;
                          action.run();
                          if (action.nav) onClose();
                        }}
                        busy={step.action.busy}
                        icon={ChevronRight}
                      >
                        {step.action.label}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-6 text-[12px] leading-relaxed text-zinc-400">
        Anything with a dotted underline or a small circled letter carries an explanation. Hover it, or tab to it, and the
        detail opens without leaving the page.
      </p>
    </Drawer>
  );
};

/* ---------------------------------------------------------- explainer board */

/**
 * A full-width illustrated board that explains one idea before the reader meets
 * the data for it. The note is not decoration: these drawings carry example
 * figures, and a page that mixes worked examples with live results without
 * saying which is which is a page that cannot be trusted.
 */
const Board = ({
  src,
  alt,
  icon,
  title,
  summary,
  body,
  note = 'Worked example. Your own figures are the ones on this page.',
}: {
  src: string;
  alt: string;
  icon?: React.ElementType;
  title: string;
  summary: string;
  body: string;
  note?: string;
}) => (
  <Reveal icon={icon} title={title} summary={summary}>
    <div className="px-6 py-6">
      <p className="max-w-3xl text-[13px] leading-relaxed text-zinc-500">{body}</p>
      <img src={src} alt={alt} loading="lazy" className="mx-auto mt-5 w-full max-w-[880px] rounded-xl" />
      <p className="mt-4 text-[11.5px] text-zinc-400">{note}</p>
    </div>
  </Reveal>
);

/* ================================================================== hero ==== */

const Hero = ({
  department,
  analysis,
  storedCount,
  threshold,
  running,
  benchmarking,
  onRun,
  onBenchmark,
}: {
  department: Department;
  analysis: EngineAnalyzeResponse | null;
  storedCount: number;
  threshold: ThresholdInfo | null;
  running: boolean;
  benchmarking: boolean;
  onRun: () => void;
  onBenchmark: () => void;
}) => (
  <section className="fs-mesh fs-grid fs-grain relative overflow-hidden rounded-[26px] text-white">
    <span className="fs-aurora -left-24 -top-24 h-72 w-72 bg-indigo-500/45" aria-hidden />
    <span className="fs-aurora -bottom-28 right-4 h-80 w-80 bg-sky-400/25" style={{ animationDelay: '-8s' }} aria-hidden />

    {/* The four views converging, dissolved into the mesh rather than framed in a box. */}
    <img
      src={artViews}
      alt=""
      aria-hidden
      className="fs-float fs-bleed-left pointer-events-none absolute -right-10 top-0 hidden h-full w-[62%] object-cover opacity-[0.55] lg:block"
    />

    <div className="relative flex flex-col gap-9 px-7 py-9 sm:px-10 sm:py-12">
      <div className="fs-in max-w-xl">
        <p className="fs-eyebrow inline-flex items-center gap-2 text-indigo-200/90">
          <Sparkles className="h-3.5 w-3.5" />
          Forensic Intelligence Engine
        </p>
        <h2 className="fs-display mt-4 text-[34px] text-white sm:text-[42px]">
          Every payment,
          <br />
          examined four ways.
        </h2>
        <p className="mt-4 max-w-lg text-[14px] leading-relaxed text-zinc-300">
          One risk score for every transaction in {department.department_name}, and the reasoning that produced it.{' '}
          <Term
            text="Four independent methods score each row: written audit rules, a behavioural model of each account head, timing patterns across rows, and the network of heads posted together. Their verdicts fuse by noisy-OR, so agreement raises the score and no single method can claim certainty on its own."
          >
            How?
          </Term>
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-2.5">
          <Button onClick={onRun} busy={running} icon={Play} tone="light">
            {running ? 'Analysing…' : 'Run analysis'}
          </Button>
          <Button onClick={onBenchmark} busy={benchmarking} icon={FlaskConical} tone="ghost" className="border border-white/20 text-white hover:bg-white/10">
            {benchmarking ? 'Testing…' : 'Prove it works'}
          </Button>
        </div>
        <p className="mt-3 text-[11.5px] text-zinc-400">
          Proving it plants known fraud in a throwaway copy of this ledger. Nothing is written to the database.
        </p>
      </div>

      <div className="fs-in fs-d2 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:max-w-[760px]">
        <HeroStat
          label="Alert line"
          value={threshold ? String(threshold.value) : '—'}
          note={threshold ? sourceShort(threshold.source) : 'not loaded'}
          tip="Scores at or above this become alerts. Bootstrap until this company has enough reviewed rows of its own, then chosen by F1 and validated on rows it was not chosen from."
        />
        <HeroStat
          label="Rows analysed"
          value={analysis?.diagnostics ? analysis.diagnostics.rows_analysed.toLocaleString() : '—'}
          note={
            analysis?.diagnostics
              ? `${analysis.diagnostics.date_range.from} → ${analysis.diagnostics.date_range.to}`
              : 'run to refresh'
          }
          tip="Debit rows only. Receipts belong in the ledger but scoring them would flag a large customer payment as a suspicious disbursement. This fills in on a fresh run."
        />
        <HeroStat
          label="Evidence signals"
          value={analysis?.diagnostics ? analysis.diagnostics.signals_total.toLocaleString() : '—'}
          note={analysis?.diagnostics ? 'raised across the four views' : 'run to refresh'}
          tip="One signal is one reason a row looked wrong. A row can collect several, and the case file lists every one of them with its strength. This fills in on a fresh run."
        />
        <HeroStat
          label="Alerts"
          value={analysis ? String(analysis.reported) : storedCount ? String(storedCount) : '—'}
          note={
            analysis
              ? `of ${(analysis.summary.total_scored ?? analysis.scored_total ?? 0).toLocaleString()} scored`
              : storedCount
                ? 'stored from the last run'
                : 'run the analysis'
          }
          tip="How many rows reached the alert line. After a page reload this shows what the last run stored, until you run the engine again."
        />
      </div>
    </div>
  </section>
);

const HeroStat = ({ label, value, note, tip }: { label: string; value: string; note: string; tip: string }) => (
  <Tip text={tip} side="right" className="!block">
    <div className="w-full cursor-help rounded-2xl border border-white/10 bg-white/[0.06] p-4 text-left backdrop-blur-sm transition hover:border-white/25 hover:bg-white/[0.1]">
      <p className="fs-eyebrow text-zinc-400">{label}</p>
      <p className="fs-num mt-1.5 text-[26px] font-semibold leading-none text-white">{value}</p>
      <p className="mt-1.5 truncate text-[11px] text-zinc-400">{note}</p>
    </div>
  </Tip>
);

/* ============================================================== overview ==== */

const OverviewTab = ({
  department,
  analysis,
  storedFindings,
  threshold,
  calibration,
  hasRun,
  bandFilter,
  onOpenBand,
  onGoCalibration,
}: {
  department: Department;
  analysis: EngineAnalyzeResponse | null;
  storedFindings: EngineFinding[];
  threshold: ThresholdInfo | null;
  calibration: CalibrationStatus | null;
  hasRun: boolean;
  bandFilter: RiskBand | 'all';
  onOpenBand: (band: RiskBand | 'all') => void;
  onGoCalibration: () => void;
}) => {
  const bands = analysis?.summary.bands ?? countBands(storedFindings);
  const totalScored = analysis?.summary.total_scored ?? analysis?.scored_total ?? storedFindings.length;
  const warnings = analysis?.diagnostics?.data_quality?.warnings ?? [];

  return (
    <div className="space-y-5">
      {!hasRun && (
        <Card className="fs-in overflow-hidden">
          <Empty
            icon={ShieldAlert}
            title="Nothing has been analysed yet"
            body={`Run the engine to score every transaction in ${department.department_name}. The alerts, the review queue and the calibration evidence all come from that run.`}
          />
        </Card>
      )}

      {hasRun && (
        <div className="fs-in grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {BAND_ORDER.map((band) => {
            const meta = BAND_META[band];
            const Icon = meta.icon;
            const count = bands?.[band] ?? 0;
            const active = bandFilter === band;
            return (
              <button
                key={band}
                onClick={() => onOpenBand(band)}
                className={`fs-focus fs-hover rounded-2xl border bg-white p-5 text-left ${
                  active ? 'border-zinc-900' : 'border-zinc-200/80'
                }`}
              >
                <span className="flex items-center justify-between">
                  <span className="fs-eyebrow flex items-center gap-1.5" style={{ color: meta.hex }}>
                    <Icon className="h-3.5 w-3.5" />
                    {meta.label}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-zinc-300" />
                </span>
                <p className="fs-num mt-3 text-[34px] font-semibold leading-none text-zinc-900">{count}</p>
                <p className="mt-1.5 text-[12px] text-zinc-500">
                  {!totalScored
                    ? 'no rows'
                    : analysis
                      ? `${((count / totalScored) * 100).toFixed(0)}% of scored rows`
                      : `${((count / totalScored) * 100).toFixed(0)}% of stored alerts`}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {warnings.length > 0 && (
        <Card className="fs-in fs-d1 border-amber-200/80 bg-amber-50/70 p-5">
          <p className="fs-title flex items-center gap-2 text-[14px] text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            Data quality limits what any view can find
            <InfoDot text="These are conditions upstream of the engine. A run that finds little because the data is thin looks identical to a clean ledger unless the difference is stated." />
          </p>
          <ul className="mt-3 space-y-1.5">
            {warnings.map((warning) => (
              <li key={warning} className="flex gap-2 text-[12.5px] leading-relaxed text-amber-900/90">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <section className="fs-in fs-d1 fs-mesh fs-grain fs-art relative overflow-hidden rounded-[22px]">
        <img
          src={artEvidence}
          alt="A scored transaction fanning out into the separate signals that produced its score"
          className="fs-bleed-left pointer-events-none absolute right-0 top-0 hidden h-full w-[56%] object-cover opacity-80 lg:block"
        />
        <div className="relative max-w-lg px-7 py-8 sm:px-9 sm:py-10">
          <p className="fs-eyebrow text-indigo-200/90">Never just a number</p>
          <h3 className="fs-display mt-3 text-[26px] text-white sm:text-[30px]">One row, many reasons.</h3>
          <p className="mt-3 text-[13.5px] leading-relaxed text-zinc-300">
            A score on its own is something to argue with. Every alert here arrives with the separate tests that fired, how
            hard each one fired, and the numbers behind them, so a reviewer can agree or disagree with the reasoning rather
            than the verdict.
          </p>
          <div className="mt-5 lg:hidden">
            <img src={artEvidence} alt="" aria-hidden className="w-full rounded-xl opacity-90" />
          </div>
        </div>
      </section>

      <div className="fs-in fs-d2">
        <SectionHead
          eyebrow="Method"
          title="How every transaction is scored"
          hint="Four independent views, each with its own idea of what looks wrong. Hover any card for what it actually tests."
        />
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {VIEW_ORDER.map((view, index) => {
            const meta = VIEW_META[view];
            const Icon = meta.icon;
            const info = analysis?.diagnostics?.views?.[view];
            const credibility = analysis?.diagnostics?.view_credibility?.[view];
            return (
              <Tip key={view} text={meta.blurb} className="!block">
                <Card hover className={`fs-in fs-d${index + 1} h-full w-full cursor-help p-5 text-left`}>
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${VIEW_COLOR[view]}16`, color: VIEW_COLOR[view] }}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <p className="fs-title mt-3.5 text-[14px] text-zinc-900">{meta.label}</p>
                  <p className="mt-1 text-[12.5px] leading-snug text-zinc-500">{meta.short}</p>
                  <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3">
                    <span className="text-[11px] text-zinc-400">
                      {credibility !== undefined ? `trusted ${credibility.toFixed(2)} alone` : 'credibility —'}
                    </span>
                    <span className="fs-num text-[11px] font-semibold text-zinc-700">
                      {info ? (info.status === 'ok' ? `${info.signals ?? 0} signals` : 'unavailable') : '—'}
                    </span>
                  </div>
                </Card>
              </Tip>
            );
          })}
        </div>
      </div>

      {calibration && (
        <Card className="fs-in fs-d4 overflow-hidden">
          <div className="fs-mesh-soft fs-grid-light relative px-6 py-6">
            <div className="relative flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="fs-eyebrow text-zinc-400">Current stage</p>
                <p className="fs-title mt-1.5 flex items-center gap-2 text-[17px] text-zinc-900">
                  {calibration.status_text}
                  <InfoDot text={calibration.explanation} />
                </p>
              </div>
              <div className="flex items-center gap-3">
                <MiniStepper mode={calibration.mode} />
                <Button tone="secondary" onClick={onGoCalibration} icon={ChevronRight}>
                  Open calibration
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {threshold && (
        <p className="px-1 text-[12px] text-zinc-400">
          Bands describe how a score reads. The{' '}
          <Term text={`Alerting at ${threshold.value}, ${sourceShort(threshold.source).toLowerCase()}. Change it in Calibration, never by editing a file.`}>
            threshold
          </Term>{' '}
          decides what alerts.
        </p>
      )}
    </div>
  );
};

const MiniStepper = ({ mode }: { mode: CalibrationMode }) => {
  const current = MODE_ORDER.indexOf(mode);
  return (
    <div className="hidden items-center gap-1.5 sm:flex">
      {MODE_ORDER.map((step, index) => (
        <Tip key={step} text={MODE_META[step].label}>
          <span
            className="block h-1.5 rounded-full transition-all"
            style={{
              width: index === current ? 28 : 14,
              backgroundColor: index <= current ? MODE_META[mode].hex : '#e4e4e7',
            }}
          />
        </Tip>
      ))}
    </div>
  );
};

/* ================================================================ alerts ==== */

const AlertsTab = ({
  findings,
  visibleFindings,
  selected,
  onSelect,
  transactionById,
  bandFilter,
  onBandFilter,
  busyReview,
  onReview,
  onUndo,
  hasRun,
  running,
  onRun,
  departmentName,
}: {
  findings: EngineFinding[];
  visibleFindings: EngineFinding[];
  selected: EngineFinding | null;
  onSelect: (id: string) => void;
  transactionById: Map<string, Transaction>;
  bandFilter: RiskBand | 'all';
  onBandFilter: (band: RiskBand | 'all') => void;
  busyReview: string | null;
  onReview: (target: ReviewTarget, label: ReviewLabel, note: string | null) => void;
  onUndo: (transactionId: string, reviewId: string) => void;
  hasRun: boolean;
  running: boolean;
  onRun: () => void;
  departmentName: string;
}) => {
  if (!hasRun) {
    return (
      <Card className="fs-in overflow-hidden">
        <Empty
          icon={ShieldAlert}
          title="No alerts yet"
          body={`Run the engine on ${departmentName} and the ranked alerts will appear here, each with its evidence.`}
        />
        <div className="pb-10 text-center">
          <Button onClick={onRun} busy={running} icon={Play}>
            Run analysis
          </Button>
        </div>
      </Card>
    );
  }

  const bandOptions: { value: RiskBand | 'all'; label: string; count?: number }[] = [
    { value: 'all', label: 'All', count: findings.length },
    ...BAND_ORDER.map((band) => ({
      value: band as RiskBand | 'all',
      label: BAND_META[band].label,
      count: findings.filter((f) => f.band === band).length,
    })),
  ];

  return (
    <div className="fs-in space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHead
          eyebrow="Ranked by risk"
          title={`${visibleFindings.length} alert${visibleFindings.length === 1 ? '' : 's'}`}
          hint="Pick a row on the left to open its case file on the right: how each view scored it, and every piece of evidence behind the number."
        />
        <Segmented options={bandOptions} value={bandFilter} onChange={onBandFilter} size="sm" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <FindingsList
          findings={visibleFindings}
          selectedId={selected?.transaction_id ?? null}
          onSelect={onSelect}
          transactionById={transactionById}
        />
        <CasePanel
          finding={selected}
          transaction={selected ? transactionById.get(selected.transaction_id) ?? null : null}
          busy={busyReview === selected?.transaction_id}
          onReview={onReview}
          onUndo={onUndo}
        />
      </div>

      <Board
        src={boardCase}
        alt="An alert opened up into its parts: a duplicate payment, a payment just below the approval threshold, suspicious timing, related entities, and a risk breakdown across the four views"
        icon={Layers}
        title="How to read a case file"
        summary="What sits behind the number when you open an alert"
        body="The score is only a summary. Open any alert and it comes apart into the separate tests that fired, the figures each one is based on, and how much each of the four views contributed to the total."
      />
    </div>
  );
};

const FindingsList = ({
  findings,
  selectedId,
  onSelect,
  transactionById,
}: {
  findings: EngineFinding[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  transactionById: Map<string, Transaction>;
}) => (
  <Card className="flex flex-col overflow-hidden">
    <div className="fs-scroll max-h-[640px] overflow-y-auto">
      {findings.length === 0 && <Empty title="Nothing in this band" body="Try another band, or run the analysis again." />}
      {findings.map((finding) => {
        const meta = BAND_META[finding.band];
        const txn = transactionById.get(finding.transaction_id);
        const isActive = finding.transaction_id === selectedId;
        const review = finding.review ?? null;
        return (
          <button
            key={finding.transaction_id}
            onClick={() => onSelect(finding.transaction_id)}
            className={`fs-focus relative flex w-full items-center gap-4 border-b border-zinc-100 px-5 py-4 text-left transition ${
              isActive ? 'bg-zinc-50' : 'hover:bg-zinc-50/70'
            }`}
          >
            {isActive && <span className="absolute inset-y-0 left-0 w-[3px] rounded-r bg-zinc-900" />}
            <div className="w-12 shrink-0">
              <p className="fs-num text-[22px] font-semibold leading-none" style={{ color: meta.hex }}>
                {finding.risk_score.toFixed(0)}
              </p>
              <Meter value={finding.risk_score} color={meta.hex} className="mt-2" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="fs-eyebrow" style={{ color: meta.hex }}>
                  {meta.label}
                </span>
                <span className="text-[11px] text-zinc-400">
                  {finding.corroboration} view{finding.corroboration === 1 ? '' : 's'} agree
                </span>
                {review && <Chip className={LABEL_META[review.label].chip}>{LABEL_META[review.label].label}</Chip>}
              </div>
              <p className="mt-1 truncate text-[13.5px] font-medium text-zinc-900">
                {txn?.chart_acc_head || finding.evidence[0]?.code.replace(/_/g, ' ') || 'Transaction'}
              </p>
              <p className="mt-0.5 truncate text-[12px] text-zinc-500">{finding.evidence[0]?.message ?? ''}</p>
            </div>

            <div className="shrink-0 text-right">
              {txn && <p className="fs-num text-[13px] font-semibold text-zinc-900">{money(txn.amount)}</p>}
              <ViewDots triggered={finding.views_triggered} className="mt-2 justify-end" />
            </div>
          </button>
        );
      })}
    </div>
  </Card>
);

const ViewDots = ({ triggered, className = '' }: { triggered: ForensicView[]; className?: string }) => (
  <span className={`flex gap-1 ${className}`}>
    {VIEW_ORDER.map((view) => (
      <Tip key={view} text={`${VIEW_META[view].label} — ${triggered.includes(view) ? 'raised a signal here' : 'found nothing here'}`}>
        <span
          className="block h-1.5 w-4 rounded-full transition"
          style={{ backgroundColor: triggered.includes(view) ? VIEW_COLOR[view] : '#e4e4e7' }}
        />
      </Tip>
    ))}
  </span>
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
    return (
      <Card className="flex items-center justify-center">
        <Empty title="No case open" body="Select an alert on the left to see why it was flagged." />
      </Card>
    );
  }

  const meta = BAND_META[finding.band];
  const Icon = meta.icon;
  const review = finding.review ?? null;

  return (
    <Card className="overflow-hidden">
      <div className="fs-mesh-soft fs-grid-light relative border-b border-zinc-100 px-6 py-6">
        <div className="relative flex items-start justify-between gap-6">
          <div className="min-w-0">
            <Chip className={meta.chip}>
              <Icon className="h-3 w-3" />
              {meta.label} risk
            </Chip>
            <p className="fs-title mt-3 truncate text-[20px] text-zinc-900">{transaction?.chart_acc_head || 'Transaction'}</p>
            {transaction && (
              <p className="mt-1 text-[12.5px] text-zinc-500">
                {new Date(transaction.transaction_date).toLocaleDateString()} · {money(transaction.amount)}
                {transaction.invoice_id ? ` · voucher ${transaction.invoice_id}` : ''}
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="fs-num text-[46px] font-semibold leading-none" style={{ color: meta.hex }}>
              {finding.risk_score.toFixed(0)}
            </p>
            <p className="fs-eyebrow mt-1 text-zinc-400">of 100</p>
          </div>
        </div>
      </div>

      <div className="border-b border-zinc-100 px-6 py-5">
        <p className="fs-eyebrow flex items-center gap-1.5 text-zinc-400">
          Your verdict
          <InfoDot text="Recorded as company ground truth. Once there are enough verdicts, they are what chooses this company’s alert threshold." />
        </p>
        <div className="mt-3">
          <ReviewButtons
            review={review}
            busy={busy}
            onLabel={(label, note) => onReview({ transaction_id: finding.transaction_id, finding_id: finding.finding_id ?? null, source: 'alert' }, label, note)}
            onUndo={review ? () => onUndo(finding.transaction_id, review.review_id) : undefined}
          />
        </div>
        {!review && <VerdictLegend />}
      </div>

      <div className="border-b border-zinc-100 px-6 py-5">
        <p className="fs-eyebrow flex items-center gap-1.5 text-zinc-400">
          How each view scored it
          <InfoDot text="Each view’s verdict is discounted by how far it can be trusted alone, then the discounted verdicts fuse by noisy-OR. Agreement raises the total; no single view can reach certainty." />
        </p>
        <div className="mt-3.5 space-y-2.5">
          {VIEW_ORDER.map((view) => {
            const score = finding.view_scores[view] ?? 0;
            const triggered = finding.views_triggered.includes(view);
            return (
              <div key={view} className="flex items-center gap-3">
                <Tip text={VIEW_META[view].blurb}>
                  <span className="w-24 shrink-0 cursor-help text-left text-[12px] font-medium text-zinc-600">{VIEW_META[view].label}</span>
                </Tip>
                <Meter value={score} color={triggered ? VIEW_COLOR[view] : '#d4d4d8'} className="flex-1" />
                <span className={`fs-num w-8 shrink-0 text-right text-[12px] font-semibold ${triggered ? 'text-zinc-900' : 'text-zinc-300'}`}>
                  {score.toFixed(0)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="fs-scroll max-h-[420px] overflow-y-auto px-6 py-5">
        <p className="fs-eyebrow text-zinc-400">Why it was flagged</p>
        <ol className="mt-3.5 space-y-2.5">
          {finding.evidence.map((item, index) => (
            <li key={`${item.code}-${index}`} className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-4">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: VIEW_COLOR[item.view] }} />
                <span className="fs-eyebrow text-zinc-500">
                  {VIEW_META[item.view].label} · {item.code.replace(/_/g, ' ')}
                </span>
                <Tip text="How strongly this single test fired, from 0 to 1. Strengths do not add up; they fuse." side="right" className="ml-auto">
                  <span className="fs-num cursor-help text-[11px] text-zinc-400">{item.strength.toFixed(2)}</span>
                </Tip>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-zinc-800">{item.message}</p>
              <EvidenceDetail detail={item.detail} />
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
};

/** The three verdicts and what each one costs, written out rather than hidden in a hover. */
const VerdictLegend = () => (
  <dl className="mt-3 space-y-1">
    {LABEL_ORDER.map((label) => {
      const meta = LABEL_META[label];
      const Icon = meta.icon;
      return (
        <div key={label} className="flex gap-2 text-[11.5px] leading-snug">
          <Icon className="mt-[2px] h-3 w-3 shrink-0" style={{ color: meta.hex }} />
          <dt className="shrink-0 font-medium text-zinc-700">{meta.label}</dt>
          <dd className="text-zinc-500">{meta.meaning}</dd>
        </div>
      );
    })}
  </dl>
);

const EvidenceDetail = ({ detail }: { detail: Record<string, unknown> }) => {
  const entries = Object.entries(detail || {}).filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object');
  if (!entries.length) return null;
  return (
    <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {entries.slice(0, 6).map(([key, value]) => (
        <div key={key} className="flex items-baseline gap-1.5">
          <dt className="text-[10px] uppercase tracking-[0.08em] text-zinc-400">{key.replace(/_/g, ' ')}</dt>
          <dd className="fs-num text-[12px] font-medium text-zinc-700">
            {typeof value === 'number' ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
};

/* ========================================================== review queue ==== */

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
        <Chip className={meta.chip}>
          <Icon className="h-3 w-3" />
          {meta.label}
        </Chip>
        <span className="text-[11px] text-zinc-400">
          {review.reviewer ? `${review.reviewer} · ` : ''}
          {dateOnly(review.reviewed_at)}
          {review.source === 'sample' ? ' · below-threshold sample' : ''}
        </span>
        {review.note && <span className="text-[11px] italic text-zinc-500">“{review.note}”</span>}
        <button onClick={() => setEditing(true)} disabled={busy} className="fs-focus text-[11.5px] font-medium text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline">
          Change
        </button>
        {onUndo && (
          <button onClick={onUndo} disabled={busy} className="fs-focus inline-flex items-center gap-1 text-[11.5px] font-medium text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline">
            <Undo2 className="h-3 w-3" />
            Withdraw
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
              className={`fs-focus inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] transition hover:brightness-[0.97] disabled:opacity-50 ${meta.chip}`}
            >
              <Icon className="h-3 w-3" />
              {meta.label}
            </button>
          );
        })}
        <button onClick={() => setShowNote((value) => !value)} className="fs-focus text-[11.5px] font-medium text-zinc-500 hover:text-zinc-900">
          {showNote ? 'Hide note' : 'Add note'}
        </button>
        {review && (
          <button onClick={() => setEditing(false)} className="fs-focus text-[11.5px] font-medium text-zinc-500 hover:text-zinc-900">
            Cancel
          </button>
        )}
      </div>
      {showNote && (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note for the audit trail"
          className="fs-focus w-full rounded-xl border border-zinc-200 px-3 py-2 text-[12.5px] outline-none transition focus:border-zinc-400"
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
    <div className="fs-in space-y-4">
      <Board
        src={boardReview}
        alt="Three steps: the engine flags suspicious payments, a person reviews each one with its evidence, and the case is routed to confirmed, cleared or uncertain"
        icon={ClipboardCheck}
        title="What happens on this page"
        summary="The engine flags, you decide, and your verdicts move the alert line"
        body="Every alert arrives with its evidence so the judgement is yours, not the model’s. Confirmed, cleared and uncertain each mean something different downstream, and together they are the only thing that moves this company’s alert line. Rows scoring below the line are sampled in on purpose, because judging only the loud ones would never show what the engine missed."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHead
          eyebrow="Ground truth"
          title="Review queue"
          hint="Every alert, plus a random sample of rows below the threshold. Reviewing only alerts would reveal false alarms but never what the engine missed, so recall could not be measured and no threshold could be trusted."
          action={undefined}
        />
        <div className="flex items-center gap-3">
          {queue && queue.run_id && (
            <span className="text-[12px] text-zinc-500">
              <b className="fs-num text-[17px] text-zinc-900">{queue.reviewed}</b> / {items.length} reviewed
            </span>
          )}
          <Button tone="secondary" onClick={onReload} busy={loading} icon={RefreshCw}>
            Refresh
          </Button>
        </div>
      </div>

      {!queue || !queue.run_id ? (
        <Card>
          <Empty
            icon={ClipboardCheck}
            title={loading ? 'Loading the review queue…' : 'The queue is built from the latest run'}
            body={queue?.message ?? 'Run the analysis first, then come back here to give verdicts.'}
          />
        </Card>
      ) : (
        <>
          {stale && (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[12.5px] leading-relaxed text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                These scores come from the run on {dateTime(queue.run_at)}, which alerted at {queue.run_threshold}. The company
                threshold is now {queue.threshold.value}, so the lanes below already use the new line. Re-run the analysis to
                refresh the stored alerts too.
              </span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {STRATUM_ORDER.map((key) => {
              const summary = queue.strata[key];
              if (!summary) return null;
              const style = STRATUM_STYLE[key];
              const active = stratum === key;
              return (
                <button
                  key={key}
                  onClick={() => setStratum(active ? 'all' : key)}
                  className={`fs-focus fs-hover w-full rounded-2xl border bg-white p-4 text-left ${
                    active ? 'border-zinc-900' : 'border-zinc-200/80'
                  }`}
                >
                  <Chip className={style.chip}>{summary.label}</Chip>
                  <p className="fs-num mt-2.5 text-[26px] font-semibold leading-none text-zinc-900">
                    {summary.sampled}
                    <span className="text-[13px] font-medium text-zinc-400"> of {summary.population}</span>
                  </p>
                  <p className="mt-1.5 text-[11.5px] leading-snug text-zinc-500">
                    {summary.rate === null ? 'all queued, nothing sampled out' : `${pct0(summary.rate)} random sample`}
                  </p>
                  {/* Kept on the card rather than in a tooltip: it explains why the lane
                      exists, and a bubble over the next card helped nobody. */}
                  <p className="mt-2 border-t border-zinc-100 pt-2 text-[11px] leading-snug text-zinc-400">{summary.why}</p>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Segmented<QueueFilter>
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'pending', label: 'Pending', count: queue.pending },
                { value: 'reviewed', label: 'Reviewed', count: queue.reviewed },
                { value: 'all', label: 'All', count: items.length },
              ]}
            />
            {stratum !== 'all' && (
              <button onClick={() => setStratum('all')} className="fs-focus text-[12px] font-medium text-zinc-500 hover:text-zinc-900">
                Clear lane filter
              </button>
            )}
            <span className="ml-auto hidden items-center gap-3 text-[11.5px] text-zinc-400 lg:flex">
              {LABEL_ORDER.map((label) => {
                const meta = LABEL_META[label];
                const Icon = meta.icon;
                return (
                  <span key={label} className="inline-flex items-center gap-1.5" title={meta.meaning}>
                    <Icon className="h-3 w-3" style={{ color: meta.hex }} />
                    {meta.label}
                  </span>
                );
              })}
            </span>
          </div>

          <Card className="overflow-hidden">
            <div className="fs-scroll max-h-[720px] overflow-y-auto">
              {visible.length === 0 && (
                <Empty
                  title={filter === 'pending' ? 'Nothing left in this lane' : 'No rows match this filter'}
                  body={filter === 'pending' ? 'Re-run the analysis when new transactions arrive.' : undefined}
                />
              )}
              {visible.map((item) => (
                <QueueRow
                  key={item.transaction_id}
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
              ))}
            </div>
          </Card>
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
    <div className="flex flex-col gap-3 border-b border-zinc-100 px-5 py-4 transition hover:bg-zinc-50/60 lg:flex-row lg:items-center lg:gap-6">
      <div className="w-12 shrink-0">
        <p className="fs-num text-[22px] font-semibold leading-none" style={{ color: band.hex }}>
          {item.risk_score.toFixed(0)}
        </p>
        <Meter value={item.risk_score} color={band.hex} className="mt-2" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Chip className={style.chip}>{item.stratum_label}</Chip>
          <span className="text-[11px] text-zinc-400">
            {band.label} band
            {item.corroboration > 0 ? ` · ${item.corroboration} view${item.corroboration === 1 ? '' : 's'} agree` : ''}
          </span>
          <ViewDots triggered={item.views_triggered} />
        </div>
        <p className="mt-1 truncate text-[13.5px] font-medium text-zinc-900">{txn.chart_acc_head || txn.description || 'Transaction'}</p>
        <p className="mt-0.5 text-[12px] text-zinc-500">
          {new Date(txn.transaction_date).toLocaleDateString()} · {money(txn.amount)}
          {txn.invoice_id ? ` · voucher ${txn.invoice_id}` : ''}
          {txn.description && txn.chart_acc_head ? ` · ${txn.description}` : ''}
        </p>
        {item.top_evidence ? (
          <p className="mt-1 text-[12px] leading-relaxed text-zinc-600">{item.top_evidence}</p>
        ) : (
          <p className="mt-1 text-[12px] italic text-zinc-400">No forensic signal was raised for this row. It is here as a control sample.</p>
        )}
      </div>

      <div className="lg:w-[360px] lg:shrink-0">
        <ReviewButtons review={item.review} busy={busy} onLabel={onLabel} onUndo={onUndo} />
      </div>
    </div>
  );
};

/* =========================================================== calibration ==== */

const CalibrationTab = ({
  status,
  latestRun,
  calibrating,
  onRun,
  savingSettings,
  onSaveSettings,
}: {
  status: CalibrationStatus;
  latestRun: CalibrationRecord | null;
  calibrating: boolean;
  onRun: () => void;
  savingSettings: boolean;
  onSaveSettings: (payload: CalibrationSettingsPayload) => void;
}) => {
  const latest = latestRun ?? status.last_calibration;
  const companyName = status.company?.company_name ?? status.department.department_name;

  return (
    <div className="fs-in space-y-5">
      <SectionHead
        eyebrow={`${companyName} · engine ${status.engine_version}`}
        title="Where this company draws the line"
        hint="The engine’s scores do not change here. Only which scores count as alerts. Reviews from every department of the company pool into the same ground truth."
      />

      <Board
        src={boardCalibration}
        alt="Three stages from a generic bootstrap threshold, through warm-up, to a company-specific calibrated threshold, with the older 70 percent of reviews used to choose it and the newest 30 percent used to validate it"
        icon={Gauge}
        title="How the alert line is chosen"
        summary="From a generic starting value to a threshold learned from your own verdicts"
        body="Every company starts on the same conservative line. As reviewers judge real rows, the shape of what is genuinely wrong emerges, and the line moves to where this company’s own evidence puts it. The older reviews choose the line; the newest ones are held back to check it holds."
        note={`Worked example. This company is at ${MODE_META[status.mode].label.toLowerCase()}, alerting at ${status.threshold.value}, with the real figures below.`}
      />

      <MaturityStepper status={status} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <ThresholdCard status={status} />
        <ProgressCard status={status} calibrating={calibrating} onRun={onRun} />
      </div>

      {status.settings && <SettingsCard settings={status.settings} saving={savingSettings} onSave={onSaveSettings} />}
      {latest && <LatestCalibrationCard record={latest} status={status} />}
      {status.history.length > 1 && <HistoryList history={status.history} />}
    </div>
  );
};

const MaturityStepper = ({ status }: { status: CalibrationStatus }) => {
  const current = MODE_ORDER.indexOf(status.mode);
  const req = status.requirements;
  const stages: { mode: CalibrationMode; title: string; caption: string; meaning: string }[] = [
    {
      mode: 'bootstrap',
      title: 'Bootstrap',
      caption: 'A safe starting line',
      meaning: `No company ground truth yet. Alerts use the predefined threshold of ${status.bootstrap_threshold}. F1 plays no part.`,
    },
    {
      mode: 'warmup',
      title: 'Warm-up',
      caption: 'Collecting verdicts',
      meaning: `Reviewers label alerts and sampled non-alerts. The bootstrap threshold stays until ${req.min_reviewed_rows} reviews, ${req.min_positive_labels} confirmed and ${req.min_negative_labels} cleared exist.`,
    },
    {
      mode: 'calibrated',
      title: 'Calibrated',
      caption: 'The company’s own line',
      meaning: `A threshold chosen by F1 on the company's older labels, checked on its newer ones, and only then activated. Re-checked every ${req.recalibration_batch} new reviews.`,
    },
  ];

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {stages.map((stage, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'upcoming';
        const meta = MODE_META[stage.mode];
        return (
          <Tip key={stage.mode} text={stage.meaning} className="!block">
            <div
              className={`h-full w-full cursor-help rounded-2xl border p-5 text-left transition ${
                state === 'current'
                  ? 'border-zinc-900 bg-white shadow-sm'
                  : state === 'done'
                    ? 'border-zinc-200/80 bg-white'
                    : 'border-dashed border-zinc-200 bg-zinc-50/50'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className="fs-num flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                    style={{ backgroundColor: state === 'upcoming' ? '#d4d4d8' : meta.hex }}
                  >
                    {state === 'done' ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
                  </span>
                  <p className="fs-title text-[14px] text-zinc-900">{stage.title}</p>
                </div>
                {state === 'current' && <Chip className="border-zinc-900 bg-zinc-900 text-white">You are here</Chip>}
                {state === 'done' && <Chip className="border-green-200/70 bg-green-50 text-green-700">Done</Chip>}
              </div>
              <p className="mt-2.5 text-[12.5px] text-zinc-500">{stage.caption}</p>
            </div>
          </Tip>
        );
      })}
    </div>
  );
};

const EventBanner = ({ event, onDismiss, onOpen }: { event: PanelEvent; onDismiss: () => void; onOpen?: () => void }) => {
  const tone =
    event.tone === 'good'
      ? { wrap: 'border-green-200 bg-green-50 text-green-900', icon: BadgeCheck, iconColor: 'text-green-600' }
      : event.tone === 'warn'
        ? { wrap: 'border-amber-200 bg-amber-50 text-amber-900', icon: AlertTriangle, iconColor: 'text-amber-600' }
        : { wrap: 'border-zinc-200 bg-zinc-50 text-zinc-800', icon: Info, iconColor: 'text-zinc-400' };
  const Icon = tone.icon;
  return (
    <div className={`fs-in flex items-start gap-3 rounded-2xl border p-4 ${tone.wrap}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone.iconColor}`} />
      <div className="min-w-0 flex-1">
        <p className="fs-title text-[13.5px]">{event.title}</p>
        <p className="mt-1 text-[12.5px] leading-relaxed opacity-90">{event.body}</p>
        {onOpen && (
          <button
            onClick={onOpen}
            className="fs-focus mt-2.5 inline-flex items-center gap-1 rounded-full border border-current px-3 py-1 text-[11.5px] font-semibold opacity-80 transition hover:opacity-100"
          >
            See the working
            <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>
      <button onClick={onDismiss} className="fs-focus text-[11.5px] font-medium opacity-60 hover:opacity-100">
        Dismiss
      </button>
    </div>
  );
};

const ThresholdCard = ({ status }: { status: CalibrationStatus }) => {
  const mode = MODE_META[status.mode];
  return (
    <Card className="overflow-hidden">
      <div className="fs-mesh-soft fs-grid-light relative px-6 py-7">
        <div className="relative">
          <Chip className={mode.chip}>{mode.label}</Chip>
          <p className="fs-num mt-5 text-[76px] font-semibold leading-none" style={{ color: mode.hex }}>
            {status.threshold.value}
          </p>
          <p className="fs-eyebrow mt-2 flex items-center gap-1.5 text-zinc-400">
            alert threshold, out of 100
            <InfoDot text={status.threshold.label} />
          </p>
        </div>
      </div>

      <div className="space-y-4 px-6 py-5">
        <p className="fs-title text-[14px] text-zinc-900">{status.status_text}</p>
        <p className="text-[12.5px] leading-relaxed text-zinc-500">{status.explanation}</p>

        <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-4">
          <p className="fs-eyebrow flex items-center gap-1.5 text-zinc-400">
            What is not happening
            <InfoDot text="Stated explicitly, because the most common wrong assumption about a system like this is that it quietly trains on itself." />
          </p>
          <ul className="mt-2.5 space-y-1.5">
            {status.not_happening.map((line) => (
              <li key={line} className="flex gap-2 text-[12px] leading-relaxed text-zinc-600">
                <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-zinc-300" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
};

const ProgressBar = ({ label, actual, required, hint, tip }: { label: string; actual: number; required: number; hint?: string; tip?: string }) => {
  const done = actual >= required;
  const width = required > 0 ? Math.min(100, (actual / required) * 100) : 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-zinc-700">
          {done ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <Lock className="h-3.5 w-3.5 text-zinc-300" />}
          {tip ? <Term text={tip}>{label}</Term> : label}
        </p>
        <p className="fs-num text-[12.5px] font-semibold text-zinc-900">
          {actual} <span className="font-normal text-zinc-400">/ {required}</span>
        </p>
      </div>
      <Meter value={width} color={done ? '#0ca30c' : '#5b5bd6'} className="mt-2" />
      {hint && <p className="mt-1.5 text-[11px] text-zinc-400">{hint}</p>}
    </div>
  );
};

const ProgressCard = ({ status, calibrating, onRun }: { status: CalibrationStatus; calibrating: boolean; onRun: () => void }) => {
  const { readiness, counts, recalibration, active_metrics: active } = status;
  return (
    <Card className="space-y-6 p-6">
      <div>
        <StepRule step={1} title="Before F1 can be used" tip="All three minimums must be met. Uncertain verdicts count as reviewed but never enter the metrics." />
        <div className="mt-4 space-y-4">
          {readiness.checks.map((check) => (
            <ProgressBar key={check.code} label={check.label} actual={check.actual} required={check.required} />
          ))}
        </div>
        <p className="mt-3 text-[11px] text-zinc-400">{counts.uncertain} uncertain · excluded from every metric</p>
      </div>

      <div className="border-t border-zinc-100 pt-5">
        <StepRule step={2} title="Company F1" tip="Measured on held-out reviewed rows the threshold was not chosen from, which is the only honest way to report it." />
        {active ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Precision', value: pct0(active.precision), tip: 'Of the rows we alerted on, how many turned out to be genuine issues.' },
                { label: 'Recall', value: pct0(active.recall), tip: 'Of the genuine issues in the reviewed set, how many we alerted on.' },
                { label: 'F1', value: active.f1.toFixed(2), tip: 'The balance of precision and recall in one number. This is what the threshold search maximises.' },
                { label: 'False positives', value: pct(active.false_positive_rate), tip: 'How often a clean row was alerted on. The cost of a lower threshold.' },
              ].map((tile) => (
                <div key={tile.label} className="rounded-xl bg-zinc-50 p-3">
                  <p className="fs-eyebrow flex items-center gap-1 text-zinc-400">
                    {tile.label}
                    <InfoDot text={tile.tip} />
                  </p>
                  <p className="fs-num mt-1.5 text-[19px] font-semibold text-zinc-900">{tile.value}</p>
                </div>
              ))}
            </div>
            <p className="mt-2.5 text-[11px] text-zinc-400">last calibrated {dateOnly(status.calibrated_at)}</p>
          </>
        ) : (
          <p className="mt-3 text-[12.5px] leading-relaxed text-zinc-500">
            {readiness.ready
              ? 'The minimums are met, but no candidate threshold has passed held-out validation yet.'
              : 'F1 needs company ground truth to be computed from. Keep reviewing.'}
          </p>
        )}
      </div>

      <div className="border-t border-zinc-100 pt-5">
        <StepRule step={3} title="Recalibration" tip="The current threshold is never overwritten unless a new candidate passes the same validation." />
        {recalibration.ever_calibrated ? (
          <div className="mt-4">
            <ProgressBar
              label="New reviews since the last calibration"
              actual={recalibration.reviews_since_last}
              required={recalibration.batch}
              hint={`Runs again automatically at ${recalibration.batch}.`}
            />
          </div>
        ) : (
          <p className="mt-3 text-[12.5px] leading-relaxed text-zinc-500">
            The first calibration runs automatically the moment all three minimums are met, inside the review that gets the
            company there.
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button onClick={onRun} disabled={!readiness.ready} busy={calibrating} icon={Gauge}>
            {calibrating ? 'Calibrating…' : 'Run calibration now'}
          </Button>
          {!readiness.ready && <p className="text-[11px] text-zinc-400">Disabled until the minimums are met. Readiness is never bypassed.</p>}
        </div>
      </div>
    </Card>
  );
};

/* ------------------------------------------------------------ settings card */

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
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600">
            <SlidersHorizontal className="h-4 w-4" />
          </span>
          <div>
            <p className="fs-title flex items-center gap-2 text-[15px] text-zinc-900">
              Calibration settings
              <InfoDot text={settings.note} />
            </p>
            <p className="mt-0.5 text-[12.5px] text-zinc-500">Live for this company. No restart, no configuration file.</p>
          </div>
        </div>
        <Chip
          className={settings.overridden.length ? 'border-amber-200/70 bg-amber-50 text-amber-700' : 'border-zinc-200 bg-zinc-50 text-zinc-500'}
        >
          {settings.overridden.length ? `${settings.overridden.length} changed` : 'Defaults'}
        </Chip>
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
              className={`block w-full rounded-xl border p-3 text-left transition ${
                invalid ? 'border-red-300 bg-red-50/40' : changed ? 'border-amber-200 bg-amber-50/40' : 'border-zinc-200/80 hover:border-zinc-300'
              }`}
            >
              <span className="fs-eyebrow block text-zinc-400">{meta.label}</span>
              <input
                type="number"
                value={draft[key]}
                min={low}
                max={high}
                step={key === 'bootstrap_threshold' ? 5 : 1}
                disabled={locked}
                onChange={(e) => setDraft((current) => ({ ...current, [key]: e.target.value }))}
                className="fs-num fs-focus mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[17px] font-semibold text-zinc-900 outline-none transition focus:border-zinc-400 disabled:bg-zinc-50 disabled:text-zinc-400"
              />
              {/* Written under the field, not in a hover: nobody hovers a form they
                  are trying to type into. */}
              <span className="mt-1.5 block text-[11px] leading-snug text-zinc-500">{meta.hint}</span>
              <span className="mt-1 block text-[10.5px] text-zinc-400">
                default {settings.defaults[key]} · allowed {low}–{high >= 10000 ? '∞' : high}
              </span>
            </label>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Button onClick={save} disabled={locked || !dirty || problems.length > 0} busy={saving} icon={CheckCircle2}>
          Save settings
        </Button>
        <Button tone="secondary" onClick={() => onSave({ preset: 'demo' })} disabled={locked}>
          {demoLabel}
        </Button>
        <Button tone="secondary" onClick={() => onSave({ preset: 'default' })} disabled={locked || !settings.stored}>
          Reset to defaults
        </Button>
        <p className="w-full text-[11.5px] text-zinc-400">
          The demo preset lowers the minimums so a calibration can be shown in a few minutes instead of a few hundred
          reviews. It changes when the line is chosen, never how a score is computed.
        </p>
        {!settings.editable && (
          <p className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <Lock className="h-3 w-3" /> Only a company admin can change these.
          </p>
        )}
        {problems.length > 0 && settings.editable && (
          <p className="text-[11.5px] font-medium text-red-600">Out of range: {problems.map((key) => SETTING_META[key].label).join(', ')}</p>
        )}
      </div>
    </Card>
  );
};

/* ------------------------------------------------------- latest calibration */

const MetricTiles = ({ title, metrics, accent }: { title: string; metrics: ConfusionMetrics | null; accent: string }) => (
  <div className="rounded-xl border border-zinc-200/80 p-4">
    <p className="fs-eyebrow" style={{ color: accent }}>
      {title}
    </p>
    {metrics ? (
      <>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
          {[
            ['Precision', pct0(metrics.precision)],
            ['Recall', pct0(metrics.recall)],
            ['F1', metrics.f1.toFixed(2)],
            ['FPR', pct(metrics.false_positive_rate)],
            ['Alerts', String(metrics.alerts)],
            ['Rows', String(metrics.rows)],
          ].map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-2">
              <dt className="text-zinc-500">{label}</dt>
              <dd className="fs-num font-semibold text-zinc-900">{value}</dd>
            </div>
          ))}
        </dl>
        <Tip text="True positives, false positives, true negatives, false negatives on the held-out rows." side="right">
          <p className="fs-num mt-2 cursor-help text-[10.5px] text-zinc-400">
            TP {metrics.true_positives} · FP {metrics.false_positives} · TN {metrics.true_negatives} · FN {metrics.false_negatives}
          </p>
        </Tip>
      </>
    ) : (
      <p className="mt-2 text-[12px] text-zinc-400">—</p>
    )}
  </div>
);

const LatestCalibrationCard = ({ record, status }: { record: CalibrationRecord; status: CalibrationStatus }) => {
  const activated = record.outcome === 'activated';
  const req = status.requirements;
  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600">
            <History className="h-4 w-4" />
          </span>
          <div>
            <p className="fs-title text-[15px] text-zinc-900">Latest calibration</p>
            <p className="mt-0.5 text-[12px] text-zinc-500">
              {dateTime(record.created_at)} · {record.triggered_by === 'auto' ? 'ran automatically after a review' : 'run manually'} ·{' '}
              {record.review_count} reviews ({record.positive_count} confirmed, {record.negative_count} cleared)
            </p>
          </div>
        </div>
        <Chip className={activated ? 'border-green-200/70 bg-green-50 text-green-700' : 'border-amber-200/70 bg-amber-50 text-amber-700'}>
          {activated ? <BadgeCheck className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          {activated ? `Activated ${record.activated_threshold}` : `Rejected · ${record.old_threshold} kept`}
        </Chip>
      </div>

      <p className="mt-4 rounded-xl bg-zinc-50 px-4 py-3 text-[12.5px] leading-relaxed text-zinc-700">{record.reason}</p>

      <div className="mt-6 grid gap-7 xl:grid-cols-2">
        <div>
          <StepRule
            step={1}
            title={`Choose on the oldest ${record.calibration_rows} rows`}
            tip={`The oldest ${pct0(req.calibration_share)} of reviewed rows. Every candidate threshold is scored against these labels, and the one with the highest F1 becomes the candidate.`}
          />
          <p className="mt-3 text-[12.5px] text-zinc-500">
            Candidate: <b className="fs-num text-zinc-900">{record.candidate_threshold}</b>
          </p>
          <SweepChart sweep={record.sweep} candidate={record.candidate_threshold} current={record.old_threshold} />
          <SweepTable sweep={record.sweep} candidate={record.candidate_threshold} />
        </div>

        <div>
          <StepRule
            step={2}
            title={`Validate on the newest ${record.validation_rows} rows`}
            tip="Rows the candidate was never chosen from. The candidate and the threshold currently in force are scored on exactly the same rows."
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <MetricTiles title={`Candidate ${record.candidate_threshold}`} metrics={record.validation} accent="#5b5bd6" />
            <MetricTiles title={`Current ${record.old_threshold}`} metrics={record.current_validation} accent="#71717a" />
          </div>

          <div className="mt-6">
            <StepRule step={3} title="Three checks, all must pass" tip="Enough held-out evidence, no regression against the threshold in force, and no large drop in F1. Any failure means the candidate is recorded but not activated." />
          </div>
          <ul className="mt-3.5 space-y-2">
            {record.checks.map((check) => (
              <li key={check.code} className="flex gap-2.5 rounded-xl border border-zinc-100 p-3">
                {check.passed ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                )}
                <div>
                  <p className="text-[12.5px] font-medium text-zinc-800">{check.label}</p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-zinc-500">{check.detail}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className={`fs-title mt-4 text-[13.5px] ${activated ? 'text-green-700' : 'text-amber-700'}`}>
            {activated
              ? `Decision: ${record.activated_threshold} is now the company's alert threshold.`
              : `Decision: ${record.old_threshold} stays in force. The candidate was recorded, not activated.`}
          </p>
        </div>
      </div>
    </Card>
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
    <div className="mt-3 h-60 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 20, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#f4f4f5" vertical={false} />
          <XAxis
            dataKey="threshold"
            tick={{ fill: '#a1a1aa', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: '#e4e4e7' }}
            label={{ value: 'Candidate threshold', position: 'insideBottom', offset: -4, fill: '#a1a1aa', fontSize: 11 }}
          />
          <YAxis tick={{ fill: '#a1a1aa', fontSize: 11 }} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
          <ChartTooltip
            contentStyle={{ borderRadius: 12, border: '1px solid #e4e4e7', fontSize: 12, boxShadow: '0 12px 32px -14px rgba(16,24,40,.28)' }}
            formatter={(value: number, name: string) => [`${value}%`, name]}
            labelFormatter={(label) => `Threshold ${label}`}
          />
          <Legend verticalAlign="top" align="right" height={30} iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine x={candidate} stroke="#5b5bd6" strokeDasharray="4 4" label={{ value: 'candidate', fill: '#5b5bd6', fontSize: 10, position: 'top' }} />
          {current !== candidate && (
            <ReferenceLine x={current} stroke="#a1a1aa" strokeDasharray="2 4" label={{ value: 'current', fill: '#a1a1aa', fontSize: 10, position: 'top' }} />
          )}
          <Line type="monotone" dataKey="F1" stroke="#1baf7a" strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
          <Line type="monotone" dataKey="Precision" stroke="#eb6834" strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="Recall" stroke="#2a78d6" strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

const SweepTable = ({ sweep, candidate }: { sweep: ConfusionMetrics[]; candidate: number }) => (
  <div className="fs-scroll mt-3 max-h-52 overflow-auto rounded-xl border border-zinc-100">
    <table className="w-full min-w-[420px] text-left text-[12px]">
      <thead className="sticky top-0 bg-white">
        <tr className="border-b border-zinc-100 text-[10px] uppercase tracking-[0.08em] text-zinc-400">
          <th className="px-3 py-2">Threshold</th>
          <th className="px-3 py-2">Precision</th>
          <th className="px-3 py-2">Recall</th>
          <th className="px-3 py-2">F1</th>
          <th className="px-3 py-2">FPR</th>
          <th className="px-3 py-2">Alerts</th>
        </tr>
      </thead>
      <tbody className="fs-num text-zinc-600">
        {sweep.map((point) => {
          const isCandidate = point.threshold === candidate;
          return (
            <tr key={point.threshold} className={`border-b border-zinc-50 ${isCandidate ? 'bg-indigo-50/60 font-semibold text-zinc-900' : ''}`}>
              <td className="px-3 py-1.5">
                {point.threshold}
                {isCandidate && <span className="ml-2 text-[9.5px] uppercase tracking-[0.08em] text-indigo-600">best F1</span>}
              </td>
              <td className="px-3 py-1.5">{pct0(point.precision)}</td>
              <td className="px-3 py-1.5">{pct0(point.recall)}</td>
              <td className="px-3 py-1.5">{point.f1.toFixed(2)}</td>
              <td className="px-3 py-1.5">{pct(point.false_positive_rate)}</td>
              <td className="px-3 py-1.5">{point.alerts}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

const HistoryList = ({ history }: { history: CalibrationRecord[] }) => (
  <Card className="p-6">
    <SectionHead
      eyebrow="Audit trail"
      title="Calibration history"
      hint={`Every attempt is kept, activated or not, so "why does this company alert where it does?" always has an answer.`}
    />
    <div className="fs-scroll mt-4 overflow-x-auto rounded-xl border border-zinc-100">
      <table className="w-full min-w-[640px] text-left text-[12px]">
        <thead>
          <tr className="border-b border-zinc-100 text-[10px] uppercase tracking-[0.08em] text-zinc-400">
            <th className="px-3 py-2">When</th>
            <th className="px-3 py-2">Trigger</th>
            <th className="px-3 py-2">From → candidate</th>
            <th className="px-3 py-2">Outcome</th>
            <th className="px-3 py-2">Held-out F1</th>
            <th className="px-3 py-2">Reviews</th>
          </tr>
        </thead>
        <tbody className="fs-num text-zinc-600">
          {history.map((entry) => (
            <tr key={entry.calibration_id} className="border-b border-zinc-50">
              <td className="px-3 py-2">{dateTime(entry.created_at)}</td>
              <td className="px-3 py-2">{entry.triggered_by === 'auto' ? 'automatic' : 'manual'}</td>
              <td className="px-3 py-2 font-semibold text-zinc-900">
                {entry.old_threshold} → {entry.candidate_threshold}
              </td>
              <td className="px-3 py-2">
                <Chip
                  className={entry.outcome === 'activated' ? 'border-green-200/70 bg-green-50 text-green-700' : 'border-amber-200/70 bg-amber-50 text-amber-700'}
                >
                  {entry.outcome}
                </Chip>
              </td>
              <td className="px-3 py-2">{entry.validation ? entry.validation.f1.toFixed(2) : '—'}</td>
              <td className="px-3 py-2">{entry.review_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Card>
);

/* ============================================================= benchmark ==== */

const BenchmarkSection = ({ benchmark, running, onRun }: { benchmark: BenchmarkResponse | null; running: boolean; onRun: () => void }) => (
  <div className="fs-in space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <SectionHead
        eyebrow="Developer evidence"
        title="Does the engine actually work?"
        hint="Real spend data carries no fraud labels, so the engine is measured by planting known schemes into a copy of the ledger and checking how many come back. Nothing is written to the database."
      />
      {!benchmark && (
        <Button onClick={onRun} busy={running} icon={FlaskConical}>
          {running ? 'Running…' : 'Run benchmark'}
        </Button>
      )}
    </div>

    <div className="flex items-start gap-2.5 rounded-2xl border border-indigo-200/70 bg-indigo-50/70 p-4 text-[12.5px] leading-relaxed text-indigo-900">
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <b>Kept separate from calibration.</b> Nothing here is company ground truth and nothing here sets the company&rsquo;s
        alert threshold. That comes only from human reviews of real rows.
      </span>
    </div>

    <Board
      src={boardProof}
      alt="Seven fraud scenarios are injected into a copy of the ledger, analysed by the engine, and each one is reported as recovered or missed with its score and rank"
      icon={Beaker}
      title="How the proof works"
      summary="Known fraud is planted, the engine re-scores blind, and every scheme is reported"
      body="Real ledgers carry no fraud labels, so there is nothing to measure against. Seven known schemes are planted into a throwaway copy, the engine re-scores it blind, and every scheme is reported as recovered or missed with the rank an auditor would have reached it at."
      note="Worked example from a run of this engine. Run the benchmark below for this department’s own figures."
    />

    {!benchmark ? (
      <Card>
        <Empty
          icon={Beaker}
          title={running ? 'Planting fraud scenarios…' : 'Not run for this department yet'}
          body={running ? 'The ledger is being re-scored with known fraud inside it.' : 'Run the benchmark to see how much planted fraud the engine recovers.'}
        />
      </Card>
    ) : (
      <div className="space-y-6">
        <BenchmarkHeadline benchmark={benchmark} />
        <Card className="p-6">
          <ThresholdCurve points={benchmark.threshold_curve} activeThreshold={benchmark.metrics.threshold} />
        </Card>
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
    {
      label: 'Schemes recovered',
      value: `${hit}/${total}`,
      sub: 'distinct fraud scenarios detected',
      accent: '#5b5bd6',
      tip: 'A scheme counts as recovered if at least one of its planted rows was alerted on.',
    },
    {
      label: 'Recall',
      value: pct(metrics.recall),
      sub: `${metrics.true_positives} of ${metrics.planted_rows} planted rows`,
      accent: '#1baf7a',
      tip: 'Of everything we planted, how much the engine found.',
    },
    {
      label: 'Precision',
      value: pct(metrics.precision),
      sub: `${metrics.flagged_rows} rows alerted at ≥ ${metrics.threshold}`,
      accent: '#eb6834',
      tip: 'Of everything the engine alerted on, how much was actually planted.',
    },
    {
      label: 'False positive rate',
      value: pct(metrics.false_positive_rate),
      sub: 'of the untouched clean rows',
      accent: '#eda100',
      tip: 'How often an untouched row was alerted on. This is the number an auditor feels the most.',
    },
  ];

  return (
    <div>
      <p className="fs-eyebrow flex items-center gap-1.5 text-zinc-400">
        {injection.rows_planted} rows planted across {injection.scenarios_planted} scenarios
        {metrics.pre_existing_flagged > 0 && (
          <InfoDot
            text={`${metrics.pre_existing_flagged} row${metrics.pre_existing_flagged === 1 ? ' was' : 's were'} already being reported before anything was planted, so they are set aside rather than counted as mistakes. The engine was flagging them on the untouched ledger, which is not an error the injection caused.`}
          />
        )}
      </p>
      <div className="mt-3.5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile, index) => (
          <div key={tile.label} className={`fs-in fs-d${index + 1}`}>
            <Stat label={tile.label} value={tile.value} sub={tile.sub} tip={tile.tip} accent={tile.accent} />
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
      <SectionHead
        title="Precision traded against recall"
        hint="This curve describes the engine, not the company. It never sets the company threshold."
      />
      <p className="mt-2 text-[12.5px] text-zinc-500">
        Best F1 at {best.threshold} on this synthetic test, {pct(best.recall)} recall and {pct(best.precision)} precision. Scored at{' '}
        {activeThreshold}.
      </p>
      <div className="mt-4 h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 20, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#f4f4f5" vertical={false} />
            <XAxis
              dataKey="threshold"
              tick={{ fill: '#a1a1aa', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#e4e4e7' }}
              label={{ value: 'Risk-score threshold', position: 'insideBottom', offset: -4, fill: '#a1a1aa', fontSize: 11 }}
            />
            <YAxis tick={{ fill: '#a1a1aa', fontSize: 11 }} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
            <ChartTooltip
              contentStyle={{ borderRadius: 12, border: '1px solid #e4e4e7', fontSize: 12, boxShadow: '0 12px 32px -14px rgba(16,24,40,.28)' }}
              formatter={(value: number, name: string) => [`${value}%`, name]}
              labelFormatter={(label) => `Threshold ${label}`}
            />
            <Legend verticalAlign="top" align="right" height={30} iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="Recall" stroke="#2a78d6" strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="Precision" stroke="#eb6834" strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="F1" stroke="#1baf7a" strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
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
  <div className="fs-scroll mt-4 overflow-x-auto rounded-xl border border-zinc-100">
    <table className="w-full min-w-[520px] text-left text-[12px]">
      <thead>
        <tr className="border-b border-zinc-100 text-[10px] uppercase tracking-[0.08em] text-zinc-400">
          <th className="px-3 py-2">Threshold</th>
          <th className="px-3 py-2">Recall</th>
          <th className="px-3 py-2">Precision</th>
          <th className="px-3 py-2">F1</th>
          <th className="px-3 py-2">False positive rate</th>
          <th className="px-3 py-2">Rows alerted</th>
        </tr>
      </thead>
      <tbody className="fs-num text-zinc-600">
        {points.map((point) => (
          <tr key={point.threshold} className="border-b border-zinc-50">
            <td className="px-3 py-2 font-semibold text-zinc-900">{point.threshold}</td>
            <td className="px-3 py-2">{pct(point.recall)}</td>
            <td className="px-3 py-2">{pct(point.precision)}</td>
            <td className="px-3 py-2">{pct(point.f1)}</td>
            <td className="px-3 py-2">{pct(point.false_positive_rate)}</td>
            <td className="px-3 py-2">{point.flagged}</td>
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
      <SectionHead eyebrow="Scheme by scheme" title="What was planted, and what came back" hint="Each planted scheme, whether it was recovered, and which views caught it." />

      <div className="mt-4 space-y-2.5">
        {entries.map(([scenario, result]) => {
          const caught = result.detected > 0;
          return (
            <div
              key={scenario}
              className={`fs-hover flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border p-4 ${
                caught ? 'border-green-200/70 bg-green-50/40' : 'border-zinc-200/80 bg-white'
              }`}
            >
              <span className="fs-eyebrow flex items-center gap-1.5">
                {caught ? <BadgeCheck className="h-4 w-4" style={{ color: BAND_META.low.hex }} /> : <XCircle className="h-4 w-4 text-zinc-300" />}
                <span style={{ color: caught ? BAND_META.low.hex : '#a1a1aa' }}>{caught ? 'Detected' : 'Missed'}</span>
              </span>

              <div className="min-w-0 flex-1">
                <p className="fs-title text-[13.5px] text-zinc-900">{scenario.replace(/_/g, ' ')}</p>
                <p className="mt-0.5 text-[12px] text-zinc-500">{result.description}</p>
              </div>

              <div className="flex items-center gap-5 text-[12px]">
                <Tip text="Planted rows this scheme contributed, and how many of them were alerted on.">
                  <div className="cursor-help text-left">
                    <p className="fs-eyebrow text-zinc-400">Rows</p>
                    <p className="fs-num font-semibold text-zinc-800">
                      {result.detected}/{result.planted}
                    </p>
                  </div>
                </Tip>
                <Tip text="The highest risk score any row of this scheme reached.">
                  <div className="cursor-help text-left">
                    <p className="fs-eyebrow text-zinc-400">Top score</p>
                    <p className="fs-num font-semibold text-zinc-800">{result.best_score.toFixed(0)}</p>
                  </div>
                </Tip>
                <Tip text="Where its best row landed in the ranked list. A low rank means an auditor would reach it early.">
                  <div className="cursor-help text-left">
                    <p className="fs-eyebrow text-zinc-400">Rank</p>
                    <p className="fs-num font-semibold text-zinc-800">#{result.best_rank ?? '—'}</p>
                  </div>
                </Tip>
                <ViewDots triggered={result.triggered_views} />
              </div>
            </div>
          );
        })}
      </div>

      {Object.keys(benchmark.scenarios_unsupported).length > 0 && (
        <Card className="mt-5 bg-zinc-50/60 p-4">
          <p className="fs-title flex items-center gap-2 text-[13px] text-zinc-700">
            <Layers className="h-3.5 w-3.5 text-zinc-400" />
            Not testable on this ledger
            <InfoDot text="These schemes need columns this ledger does not carry, so planting them would prove nothing." />
          </p>
          <ul className="mt-2 space-y-1">
            {Object.entries(benchmark.scenarios_unsupported).map(([scenario, reason]) => (
              <li key={scenario} className="text-[12px] text-zinc-500">
                <span className="font-medium text-zinc-600">{scenario.replace(/_/g, ' ')}</span> — {reason}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
};

export default ForensicIntelligence;
