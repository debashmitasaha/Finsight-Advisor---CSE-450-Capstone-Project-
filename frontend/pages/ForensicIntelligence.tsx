import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  BadgeCheck,
  Beaker,
  CheckCircle2,
  ChevronRight,
  FlaskConical,
  Info,
  Layers,
  Loader2,
  Network,
  Play,
  Scale,
  ShieldAlert,
  Timer,
  XCircle,
} from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import {
  BenchmarkResponse,
  Department,
  EngineAnalyzeResponse,
  EngineFinding,
  ForensicView,
  RiskBand,
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
    blurb: 'Learns what is normal for each account head, then flags what breaks that entity’s own pattern.',
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

const BAND_ORDER: RiskBand[] = ['critical', 'high', 'medium', 'low'];
const VIEW_ORDER: ForensicView[] = ['rule', 'behavioral', 'temporal', 'relational'];

const card = 'rounded-[32px] border border-slate-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]';

const money = (value: number) => `৳${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

const countBands = (findings: EngineFinding[]): Record<RiskBand, number> => {
  const counts: Record<RiskBand, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  findings.forEach((finding) => {
    counts[finding.band] += 1;
  });
  return counts;
};

interface Props {
  department: Department | null;
  transactions: Transaction[];
}

const ForensicIntelligence: React.FC<Props> = ({ department, transactions }) => {
  const [analysis, setAnalysis] = useState<EngineAnalyzeResponse | null>(null);
  const [storedFindings, setStoredFindings] = useState<EngineFinding[]>([]);
  const [benchmark, setBenchmark] = useState<BenchmarkResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [benchmarking, setBenchmarking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [bandFilter, setBandFilter] = useState<RiskBand | 'all'>('all');

  const deptId = department?.department_id ?? '';

  const transactionById = useMemo(() => {
    const map = new Map<string, Transaction>();
    transactions.forEach((txn) => map.set(txn.transaction_id, txn));
    return map;
  }, [transactions]);

  const runAnalysis = useCallback(async () => {
    if (!deptId) return;
    setRunning(true);
    setStatus(null);
    try {
      const result = await api.engineAnalyze(deptId, 60);
      setAnalysis(result);
      setStoredFindings([]);
      setSelectedId(result.findings[0]?.transaction_id ?? null);
      if (!result.findings.length) setStatus('Analysis complete — nothing scored above the reporting threshold.');
    } catch (err) {
      setStatus(errorText(err, 'Analysis failed'));
    } finally {
      setRunning(false);
    }
  }, [deptId]);

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

  // Reload whatever the last run stored for this department, so navigating away and back
  // does not present an analysed department as if it had never been examined.
  useEffect(() => {
    setAnalysis(null);
    setBenchmark(null);
    setSelectedId(null);
    setStatus(null);
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
    return () => {
      cancelled = true;
    };
  }, [deptId]);

  const resolveFinding = useCallback(
    async (findingId: string) => {
      try {
        await api.engineResolve(findingId);
        setStoredFindings((current) => current.filter((item) => item.finding_id !== findingId));
        setAnalysis((current) =>
          current
            ? { ...current, findings: current.findings.filter((item) => item.finding_id !== findingId) }
            : current,
        );
        setStatus('Finding marked as reviewed.');
      } catch (err) {
        setStatus(errorText(err, 'Could not resolve finding'));
      }
    },
    [],
  );

  const findings = analysis?.findings ?? storedFindings;
  const visibleFindings = bandFilter === 'all' ? findings : findings.filter((f) => f.band === bandFilter);
  const selected = findings.find((f) => f.transaction_id === selectedId) ?? visibleFindings[0] ?? null;

  if (!department) {
    return <EmptyState message="Select a department to run the forensic intelligence engine." />;
  }

  return (
    <div className="space-y-6">
      <Header
        department={department}
        analysis={analysis}
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

      <MethodStrip diagnostics={analysis?.diagnostics ?? null} />

      {(analysis || storedFindings.length > 0) && (
        <>
          <BandTiles
            bands={analysis?.summary.bands ?? countBands(storedFindings)}
            totalScored={analysis?.summary.total_scored ?? storedFindings.length}
            reported={analysis?.reported ?? storedFindings.length}
            threshold={analysis?.min_report_score ?? 60}
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
              onResolve={resolveFinding}
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
            perspectives and fuse the evidence into a single risk score.
          </p>
        </div>
      )}

      <BenchmarkSection benchmark={benchmark} running={benchmarking} onRun={runBenchmark} />
    </div>
  );
};

const EmptyState = ({ message }: { message: string }) => (
  <div className={`${card} p-10 text-center text-slate-500`}>{message}</div>
);

const Header = ({
  department,
  analysis,
  running,
  benchmarking,
  onRun,
  onBenchmark,
}: {
  department: Department;
  analysis: EngineAnalyzeResponse | null;
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
          chain of reasoning behind it.
        </p>
        {analysis && (
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs font-semibold text-slate-300">
            <span>{analysis.diagnostics.rows_analysed.toLocaleString()} rows analysed</span>
            <span>
              {analysis.diagnostics.date_range.from} &rarr; {analysis.diagnostics.date_range.to}
            </span>
            <span>{analysis.diagnostics.signals_total.toLocaleString()} evidence signals raised</span>
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

const MethodStrip = ({ diagnostics }: { diagnostics: EngineAnalyzeResponse['diagnostics'] | null }) => (
  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  credibility {credibility.toFixed(2)}
                </p>
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
  threshold: number;
  active: RiskBand | 'all';
  onSelect: (band: RiskBand | 'all') => void;
}) => (
  <div className={`${card} p-6`}>
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <div>
        <p className="text-sm font-black text-slate-900">Risk distribution</p>
        <p className="mt-1 text-xs text-slate-500">
          {totalScored.toLocaleString()} transactions scored · {reported} above the reporting threshold of {threshold}
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
            <p className="mt-1 text-xs text-slate-500">
              {totalScored ? `${((count / totalScored) * 100).toFixed(0)}% of scored rows` : 'no rows'}
            </p>
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
      <p className="text-sm font-black text-slate-900">Ranked findings</p>
      <p className="mt-1 text-xs text-slate-500">
        {findings.length} {bandFilter === 'all' ? 'reported' : `${BAND_META[bandFilter].label.toLowerCase()}-band`} findings,
        highest risk first
      </p>
    </div>

    <div className="max-h-[560px] overflow-y-auto">
      {findings.length === 0 && <p className="px-6 py-10 text-center text-sm text-slate-400">No findings in this band.</p>}
      {findings.map((finding) => {
        const meta = BAND_META[finding.band];
        const Icon = meta.icon;
        const txn = transactionById.get(finding.transaction_id);
        const isActive = finding.transaction_id === selectedId;
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
                <div
                  className="h-full rounded-full"
                  style={{ width: `${finding.risk_score}%`, backgroundColor: meta.hex }}
                />
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: meta.hex }} />
                <span className="text-[11px] font-black uppercase tracking-wider" style={{ color: meta.hex }}>
                  {meta.label}
                </span>
                <span className="text-[11px] font-semibold text-slate-400">
                  · {finding.corroboration} view{finding.corroboration === 1 ? '' : 's'} agree
                </span>
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
                    style={{
                      backgroundColor: finding.views_triggered.includes(view) ? VIEW_COLOR[view] : '#e2e8f0',
                    }}
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
  onResolve,
}: {
  finding: EngineFinding | null;
  transaction: Transaction | null;
  onResolve: (findingId: string) => void;
}) => {
  if (!finding) {
    return <div className={`${card} flex items-center justify-center p-10 text-sm text-slate-400`}>Select a finding to open its case file.</div>;
  }

  const meta = BAND_META[finding.band];
  const Icon = meta.icon;

  return (
    <div className={`${card} overflow-hidden`}>
      <div className="border-b border-slate-100 px-7 py-6">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-wider ${meta.chip}`}>
              <Icon className="h-3 w-3" />
              {meta.label} risk
            </div>
            <p className="mt-3 truncate text-xl font-black text-slate-950">
              {transaction?.chart_acc_head || 'Transaction'}
            </p>
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
            {finding.finding_id && (
              <button
                onClick={() => onResolve(finding.finding_id!)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
              >
                <CheckCircle2 className="h-3 w-3" />
                Mark reviewed
              </button>
            )}
          </div>
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
                <span className="ml-auto text-[11px] font-bold tabular-nums text-slate-400">
                  strength {item.strength.toFixed(2)}
                </span>
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
  const entries = Object.entries(detail || {}).filter(
    ([, value]) => value !== null && value !== undefined && typeof value !== 'object',
  );
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

const BenchmarkSection = ({
  benchmark,
  running,
  onRun,
}: {
  benchmark: BenchmarkResponse | null;
  running: boolean;
  onRun: () => void;
}) => (
  <div className={`${card} overflow-hidden`}>
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-7 py-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-700">
          <Beaker className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-black text-slate-900">Does it actually work?</p>
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
        {injection.rows_planted} rows planted across {injection.scenarios_planted} scenarios
      </p>
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
          <p className="text-sm font-black text-slate-900">Where to set the alert threshold</p>
          <p className="mt-1 text-xs text-slate-500">
            Best F1 at a threshold of {best.threshold} — {pct(best.recall)} recall, {pct(best.precision)} precision. Currently
            alerting at {activeThreshold}.
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
            <YAxis
              tick={{ fill: '#64748b', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              domain={[0, 100]}
              tickFormatter={(value) => `${value}%`}
            />
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
                {caught ? (
                  <BadgeCheck className="h-4 w-4" style={{ color: BAND_META.low.hex }} />
                ) : (
                  <XCircle className="h-4 w-4 text-slate-400" />
                )}
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
