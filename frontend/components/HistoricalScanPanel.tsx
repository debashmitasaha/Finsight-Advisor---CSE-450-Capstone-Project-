import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  Coins,
  Layers,
  Play,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  AnomalyCaseDetail,
  AnomalyCaseSummary,
  CaseBand,
  CaseDetailedAnalysis,
  CaseReason,
  CaseReviewStatus,
  HistoricalScan,
} from '../types';
import { BusyOverlay, Button, Card, Chip, Empty, InfoDot, Meter, Segmented, Tip } from './ForensicKit';

/* ---------------------------------------------------------------------------
   Five years of ledger, mined into a short list of audit cases.

   Written to be read at a glance. Every number carries its explanation on hover
   rather than in a paragraph beside it, because a reviewer scanning a queue wants
   to know which case to open, not to read an essay about scoring.
   ------------------------------------------------------------------------- */

const BAND_META: Record<CaseBand, { label: string; hex: string; chip: string; dot: string; icon: React.ElementType }> = {
  critical: { label: 'Critical', hex: '#d03b3b', chip: 'border-red-200/70 bg-red-50 text-red-700', dot: 'bg-red-500', icon: AlertOctagon },
  high: { label: 'High', hex: '#ec835a', chip: 'border-orange-200/70 bg-orange-50 text-orange-700', dot: 'bg-orange-500', icon: ShieldAlert },
  medium: { label: 'Medium', hex: '#fab219', chip: 'border-amber-200/70 bg-amber-50 text-amber-700', dot: 'bg-amber-400', icon: AlertTriangle },
  low: { label: 'Low', hex: '#0ca30c', chip: 'border-green-200/70 bg-green-50 text-green-700', dot: 'bg-green-500', icon: CheckCircle2 },
};

const REVIEW_META: Record<Exclude<CaseReviewStatus, 'pending'>, { label: string; chip: string; meaning: string }> = {
  confirmed: {
    label: 'Confirmed',
    chip: 'border-red-200/70 bg-red-50 text-red-700',
    meaning: 'A genuine issue. Recorded against the case, and used to learn where the priority line should sit.',
  },
  cleared: {
    label: 'Cleared',
    chip: 'border-green-200/70 bg-green-50 text-green-700',
    meaning: 'Explained and legitimate. This is what makes precision measurable at case level.',
  },
  uncertain: {
    label: 'Uncertain',
    chip: 'border-zinc-200 bg-zinc-50 text-zinc-600',
    meaning: 'Cannot tell without more context. Counts as reviewed, teaches the threshold nothing.',
  },
};

/** The four historical detectors, in the language a reviewer thinks in. */
const LAYER_META: Record<string, { label: string; tip: string; icon: React.ElementType }> = {
  aggregate: {
    label: 'Period behaviour',
    tip: 'Compares each month for this entity against its own history — its other months, the same month in other years, and the last twelve months.',
    icon: TrendingUp,
  },
  changepoint: {
    label: 'Change point',
    tip: 'Finds the date a level shifted and stayed shifted, which is what separates a new arrangement from a one-month spike.',
    icon: CalendarRange,
  },
  collective: {
    label: 'Group pattern',
    tip: 'Looks for payments that are only unusual together: bursts, the same amount repeated, and payments hugging an approval limit.',
    icon: Layers,
  },
  transaction: {
    label: 'Row-level views',
    tip: 'The four original detectives — rule, behavioural, temporal and relational — folded in as one more opinion when the ledger is small enough to run them.',
    icon: Search,
  },
};

const VIEW_META: Record<string, { label: string; tip: string }> = {
  rule: { label: 'Rule', tip: 'Control tests an auditor runs first: duplicate payments, repeated amounts, split purchases, payments under an approval limit.' },
  behavioral: { label: 'Behavioural', tip: 'How far this payment sits from what this account head normally does, by robust statistics and an outlier ensemble.' },
  temporal: { label: 'Temporal', tip: 'Timing: bursts, dormant heads waking up, weekend posting, and sudden changes in spending rate.' },
  relational: { label: 'Relational', tip: 'How this row sits against the rows around it — shared references, vendors and structures.' },
};

const CODE_LABELS: Record<string, string> = {
  spend_surge: 'spend surge',
  volume_surge: 'more payments than usual',
  large_payment_shift: 'larger payments than usual',
  weekend_shift: 'more weekend posting',
  round_number_shift: 'more round amounts',
  near_threshold_shift: 'more payments near the limit',
  concentration_shift: 'concentrated in single payments',
  regime_change: 'a dated change in level',
  payment_burst: 'clustered payments',
  repeated_amount: 'repeated identical amounts',
  near_threshold_cluster: 'payments just under a limit',
  transaction_alert: 'individually flagged rows',
};

const REASON_ICON: Record<CaseReason['kind'], React.ElementType> = {
  anomaly: TrendingUp,
  corroboration: Layers,
  materiality: Coins,
  persistence: CalendarRange,
  novelty: Sparkles,
  rows: Search,
};

const money = (value: number) => `৳${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString() : '—');
const short = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

const reasonsOf = (row: AnomalyCaseSummary): CaseReason[] => {
  const raw = (row.scores as Record<string, unknown> | undefined)?.reasons;
  return Array.isArray(raw) ? (raw as CaseReason[]) : [];
};

/** A number with its meaning one hover away, never a paragraph. */
const ReasonChip: React.FC<{ reason: CaseReason; muted?: boolean }> = ({ reason, muted }) => {
  const Icon = REASON_ICON[reason.kind] ?? Search;
  return (
    <Tip text={reason.detail} side="center">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
          muted ? 'border-zinc-200 bg-white text-zinc-600' : 'border-indigo-200/70 bg-indigo-50 text-indigo-700'
        }`}
      >
        <Icon size={11} />
        {reason.label}
      </span>
    </Tip>
  );
};

const HistoricalScanPanel: React.FC<{ deptId: string; departmentName: string }> = ({ deptId, departmentName }) => {
  const [scan, setScan] = useState<HistoricalScan | null>(null);
  const [cases, setCases] = useState<AnomalyCaseSummary[]>([]);
  const [selected, setSelected] = useState<AnomalyCaseDetail | null>(null);
  const [running, setRunning] = useState(false);
  const [loadingCase, setLoadingCase] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [band, setBand] = useState<CaseBand | 'all'>('all');
  const [drill, setDrill] = useState<CaseDetailedAnalysis | null>(null);
  const [drilling, setDrilling] = useState(false);

  // The most recent scan for this company, so the tab is not blank on arrival.
  const loadLatest = useCallback(async () => {
    try {
      const scans = await api.engineHistoricalScans(undefined, 1);
      if (!scans.length) return;
      setScan(scans[0]);
      setCases(await api.engineHistoricalCases(scans[0].scan_id, { limit: 200 }));
    } catch {
      // No scan yet is the normal first state, not an error worth showing.
    }
  }, []);

  useEffect(() => {
    setScan(null);
    setCases([]);
    setSelected(null);
    setDrill(null);
    setError(null);
    loadLatest();
  }, [deptId, loadLatest]);

  const runScan = async () => {
    setRunning(true);
    setError(null);
    setSelected(null);
    setDrill(null);
    try {
      const result = await api.engineHistoricalScan({ dept_id: deptId });
      setScan(result);
      setCases(result.cases ?? (await api.engineHistoricalCases(result.scan_id, { limit: 200 })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The historical scan failed');
    } finally {
      setRunning(false);
    }
  };

  const openCase = useCallback(async (caseId: string) => {
    setLoadingCase(true);
    setDrill(null);
    try {
      setSelected(await api.engineCase(caseId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that case');
    } finally {
      setLoadingCase(false);
    }
  }, []);

  // A finished scan that shows an empty panel reads as a scan that found nothing.
  // The highest-priority case is the one to read first, so it opens itself.
  useEffect(() => {
    if (!selected && cases.length) void openCase(cases[0].case_id);
  }, [cases, selected, openCase]);

  const review = async (status: CaseReviewStatus) => {
    if (!selected) return;
    setReviewing(true);
    try {
      const result = await api.engineReviewCase(selected.case_id, { status });
      setSelected({ ...selected, review_status: result.case.review_status, reviewed_at: result.case.reviewed_at });
      setCases((current) => current.map((row) => (row.case_id === result.case.case_id ? { ...row, ...result.case } : row)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that verdict');
    } finally {
      setReviewing(false);
    }
  };

  const runDrillDown = async () => {
    if (!selected) return;
    setDrilling(true);
    setError(null);
    try {
      setDrill(await api.engineCaseDetailedAnalysis(selected.case_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not analyse this case in detail');
    } finally {
      setDrilling(false);
    }
  };

  const visible = useMemo(() => (band === 'all' ? cases : cases.filter((row) => row.band === band)), [cases, band]);

  const bandOptions = useMemo(() => {
    const count = (name: CaseBand) => cases.filter((row) => row.band === name).length;
    return [
      { value: 'all' as const, label: 'All', badge: cases.length },
      ...(['critical', 'high', 'medium', 'low'] as CaseBand[])
        .filter((name) => count(name) > 0)
        .map((name) => ({ value: name, label: BAND_META[name].label, badge: count(name) })),
    ];
  }, [cases]);

  const diagnostics = (scan?.diagnostics ?? {}) as Record<string, any>;
  const quality = (diagnostics.data_quality ?? {}) as Record<string, any>;
  const categories = (diagnostics.categories ?? {}) as Record<string, any>;
  const warnings: string[] = Array.isArray(quality.warnings) ? quality.warnings : [];
  const rowViews = (diagnostics.row_level_views ?? {}) as Record<string, any>;

  return (
    <div className="space-y-5">
      {running && (
        <BusyOverlay
          open
          body="Reading every payment in the company's history, then merging what the detectors agree on into ranked cases."
          title="Mining five years of ledger"
          steps={[
            'Reading every row and setting credits aside',
            'Giving each row a category to compare against',
            'Building each account head its own history',
            'Testing every month, finding change points, grouping patterns',
            'Merging what agrees into ranked cases',
          ]}
        />
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="fs-eyebrow text-zinc-400">Full population</p>
          <h3 className="mt-1 flex items-center gap-2 text-[22px] font-semibold tracking-[-0.01em] text-zinc-900">
            Mine the whole history
            <InfoDot text={`Reads every transaction ${departmentName ? `in ${departmentName}'s company` : 'in the company'} at once and reports episodes, not rows. Built for the question "here are five years, find anything wrong".`} />
          </h3>
        </div>
        <Button onClick={runScan} disabled={running} icon={Play}>
          {running ? 'Mining…' : scan ? 'Run again' : 'Run the scan'}
        </Button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200/70 bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</div>
      )}

      {!scan && !running && (
        <Card className="p-8">
          <Empty
            icon={Layers}
            title="No five-year scan yet"
            body="Run the scan to read the whole ledger at once. It looks for episodes made of ordinary payments — the kind no single row would ever flag."
          />
        </Card>
      )}

      {scan && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Rows mined"
              value={Number(quality.rows_scanned || scan.row_count || 0).toLocaleString()}
              foot={`${quality.months_covered ?? 0} months · ${quality.distinct_account_heads ?? 0} account heads`}
              tip="Every payment row in the window. Receipts and zero-value rows are counted separately and set aside, because scoring them would report a customer payment as suspicious spending."
            />
            <Stat
              label="Cases"
              value={String(scan.case_count ?? cases.length)}
              foot={`from ${diagnostics.evidence_total ?? 0} pieces of evidence`}
              tip="An episode: one entity, one stretch of time, and every detector that agreed about it. A case is a prioritised audit lead, never a finding of fraud."
            />
            <Stat
              label="Window"
              value={quality.date_from ? `${new Date(quality.date_from).getFullYear()}–${new Date(quality.date_to).getFullYear()}` : '—'}
              foot={`${day(quality.date_from)} to ${day(quality.date_to)}`}
              tip="The span actually present in the ledger, not the span you asked for. Seasonal comparison needs at least two years before a December can be judged against other Decembers."
            />
            <Stat
              label="Took"
              value={`${diagnostics.total_seconds ?? 0}s`}
              foot={rowViews.status === 'skipped' ? 'row-level views skipped' : 'all layers ran'}
              tip={
                rowViews.status === 'skipped'
                  ? String(rowViews.reason || 'The row-level views were skipped on this ledger.')
                  : 'Every layer ran, including the four row-level views.'
              }
            />
          </div>

          {(categories.inferred > 0 || categories.approved > 0) && (
            <Card className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <p className="fs-eyebrow flex items-center gap-1.5 text-zinc-400">
                  Categories used
                  <InfoDot
                    text={String(
                      categories.note ||
                        'Categories used only while this scan ran. Nothing was written to the database.',
                    )}
                  />
                </p>
                {categories.approved > 0 && (
                  <Tip text="Assigned by the categorization pipeline and approved by a reviewer. These always win over an inferred one.">
                    <Chip className="border-green-200/70 bg-green-50 text-green-700">
                      {Number(categories.approved).toLocaleString()} approved
                    </Chip>
                  </Tip>
                )}
                {categories.inferred > 0 && (
                  <Tip text="Read from the account head's own wording during this scan so category-level history exists before the approval queue has been worked through. Not written to the database, and not the same thing as an approved category.">
                    <Chip className="border-indigo-200/70 bg-indigo-50 text-indigo-700">
                      {Number(categories.inferred).toLocaleString()} inferred
                    </Chip>
                  </Tip>
                )}
                {categories.fallback > 0 && (
                  <Tip text="No category vocabulary matched, so these rows were grouped by their own account head instead. Still comparable — just not rolled up.">
                    <Chip>{Number(categories.fallback).toLocaleString()} by account head</Chip>
                  </Tip>
                )}
                <span className="text-[12px] text-zinc-500">{categories.distinct_categories ?? 0} distinct</span>
              </div>
            </Card>
          )}

          {warnings.length > 0 && (
            <Card className="border-amber-200/70 bg-amber-50/40 px-5 py-4">
              <p className="fs-eyebrow flex items-center gap-1.5 text-amber-700">
                <AlertTriangle size={12} /> What limits this scan
                <InfoDot text="A scan that is quiet because the data is thin looks exactly like a scan of a clean company. These are the reasons it might be the former." />
              </p>
              <ul className="mt-2 space-y-1">
                {warnings.map((line) => (
                  <li key={line} className="text-[12.5px] leading-relaxed text-amber-900">• {line}</li>
                ))}
              </ul>
            </Card>
          )}

          {cases.length === 0 ? (
            <Card className="p-8">
              <Empty
                icon={CheckCircle2}
                title="Nothing rose above the noise"
                body="No entity departed from its own history enough to raise a case. On a thin ledger that can also mean there was not enough history to judge against — check the limits above."
              />
            </Card>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[13px] text-zinc-500">
                  {visible.length} case{visible.length === 1 ? '' : 's'}, highest priority first
                </p>
                <Segmented<CaseBand | 'all'> options={bandOptions} value={band} onChange={setBand} size="sm" />
              </div>

              {/* The queue stays put while the case reads: one thing scrolls at a
                  time, rather than a pane inside a pane inside the page. */}
              <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                {/* 164px clears the page header (81px) and the tab bar pinned
                    beneath it (88px + 64px), so the queue is never hidden by them. */}
                <Card className="flex flex-col overflow-hidden xl:sticky xl:top-[164px] xl:self-start">
                  <div className="fs-scroll max-h-[calc(100vh-190px)] overflow-y-auto">
                    {visible.map((row) => {
                      const meta = BAND_META[row.band];
                      const active = selected?.case_id === row.case_id;
                      const chips = reasonsOf(row).filter((item) => item.kind !== 'rows').slice(0, 3);
                      return (
                        <button
                          key={row.case_id}
                          onClick={() => openCase(row.case_id)}
                          className={`group flex w-full items-start gap-3 border-b border-zinc-100 px-4 py-3.5 text-left transition last:border-b-0 ${
                            active ? 'bg-indigo-50/60' : 'hover:bg-zinc-50'
                          }`}
                        >
                          <span className="mt-0.5 flex w-11 shrink-0 flex-col items-center gap-1">
                            <span className="text-[19px] font-semibold leading-none" style={{ color: meta.hex }}>
                              {Math.round(row.priority_score)}
                            </span>
                            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13.5px] font-semibold text-zinc-900">{row.title}</span>
                            <span className="mt-0.5 block text-[11.5px] text-zinc-500">
                              {short(row.start_date)} → {short(row.end_date)} · {money(row.total_amount)}
                            </span>
                            {chips.length > 0 && (
                              <span className="mt-2 flex flex-wrap gap-1.5">
                                {chips.map((item) => (
                                  <span
                                    key={item.kind + item.label}
                                    className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10.5px] font-semibold text-zinc-600"
                                  >
                                    {item.label}
                                  </span>
                                ))}
                              </span>
                            )}
                            {row.review_status !== 'pending' && (
                              <span className="mt-2 inline-flex">
                                <Chip className={REVIEW_META[row.review_status as Exclude<CaseReviewStatus, 'pending'>].chip}>
                                  {REVIEW_META[row.review_status as Exclude<CaseReviewStatus, 'pending'>].label}
                                </Chip>
                              </span>
                            )}
                          </span>
                          <ChevronRight size={15} className="mt-1 shrink-0 text-zinc-300 group-hover:text-zinc-500" />
                        </button>
                      );
                    })}
                  </div>
                </Card>

                <CaseDetail
                  detail={selected}
                  loading={loadingCase}
                  reviewing={reviewing}
                  onReview={review}
                  drill={drill}
                  drilling={drilling}
                  onDrill={runDrillDown}
                  rowViewsSkipped={rowViews.status === 'skipped'}
                  rowViewsReason={String(rowViews.reason || '')}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

/** A stat card whose label carries its own explanation. */
const Stat: React.FC<{ label: string; value: string; foot: string; tip: React.ReactNode }> = ({ label, value, foot, tip }) => (
  <Card className="px-5 py-4">
    <p className="fs-eyebrow flex items-center gap-1.5 text-zinc-400">
      {label}
      <InfoDot text={tip} />
    </p>
    <p className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em] text-zinc-900">{value}</p>
    <p className="mt-0.5 text-[11.5px] text-zinc-500">{foot}</p>
  </Card>
);

const CaseDetail: React.FC<{
  detail: AnomalyCaseDetail | null;
  loading: boolean;
  reviewing: boolean;
  onReview: (status: CaseReviewStatus) => void;
  drill: CaseDetailedAnalysis | null;
  drilling: boolean;
  onDrill: () => void;
  rowViewsSkipped: boolean;
  rowViewsReason: string;
}> = ({ detail, loading, reviewing, onReview, drill, drilling, onDrill, rowViewsSkipped, rowViewsReason }) => {
  if (loading && !detail) {
    return (
      <Card className="flex min-h-[320px] items-center justify-center p-8">
        <p className="text-[13px] text-zinc-500">Opening the case…</p>
      </Card>
    );
  }
  if (!detail) {
    return (
      <Card className="p-8">
        <Empty icon={Layers} title="Pick a case" body="Choose one from the queue to see what changed, which detectors agreed, and the payments behind it." />
      </Card>
    );
  }

  const meta = BAND_META[detail.band];
  const packet = detail.explanation ?? ({} as AnomalyCaseDetail['explanation']);
  const reasons = reasonsOf(detail);

  // Evidence grouped by the layer that produced it: four detectors, four verdicts.
  const byLayer = new Map<string, typeof detail.evidence>();
  for (const item of detail.evidence ?? []) {
    const list = byLayer.get(item.layer) ?? [];
    list.push(item);
    byLayer.set(item.layer, list);
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-zinc-100 px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Chip className={meta.chip}>{meta.label} priority</Chip>
            <h4 className="mt-2 text-[17px] font-semibold leading-snug tracking-[-0.01em] text-zinc-900">{detail.title}</h4>
            <p className="mt-1 text-[12.5px] text-zinc-500">
              {day(detail.start_date)} → {day(detail.end_date)} · {detail.member_count.toLocaleString()} transactions · {money(detail.total_amount)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[30px] font-semibold leading-none" style={{ color: meta.hex }}>
              {Math.round(detail.priority_score)}
            </p>
            <p className="fs-eyebrow mt-1 flex items-center justify-end gap-1 text-zinc-400">
              Priority
              <InfoDot text="A prioritisation score out of 100, never a probability of fraud. It says where to look first; only a reviewer decides what it means." side="right" />
            </p>
          </div>
        </div>

        {/* The grounds for the score, as chips rather than a paragraph. */}
        {reasons.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {reasons.map((item) => (
              <ReasonChip key={item.kind + item.label} reason={item} muted={item.kind === 'rows'} />
            ))}
          </div>
        )}
      </div>

      <div>
        <section className="border-b border-zinc-100 px-6 py-5">
          <p className="fs-eyebrow flex items-center gap-1.5 text-zinc-400">
            What changed
            <InfoDot text="The single loudest thing a detector measured, quoted as it was measured." />
          </p>
          <p className="mt-2 text-[13.5px] leading-relaxed text-zinc-800">{packet.what_changed}</p>
          {packet.compared_with && <p className="mt-1.5 text-[12px] text-zinc-500">{packet.compared_with}</p>}
        </section>

        {/* Which detectors agreed — the part that used to be a wall of text. */}
        <section className="border-b border-zinc-100 px-6 py-5">
          <p className="fs-eyebrow flex items-center gap-1.5 text-zinc-400">
            Which detectors agree
            <InfoDot text="Each works a different way and reached this case by a different route. Agreement between methods is much harder to produce by chance than one loud detector." />
          </p>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {Object.keys(LAYER_META).map((layer) => {
              const found = byLayer.get(layer);
              const info = LAYER_META[layer];
              const Icon = info.icon;
              const fired = Boolean(found?.length);
              const best = fired ? Math.max(...found!.map((item) => item.strength)) : 0;
              // A detector that was never run has not cleared this case, and saying
              // "silent" would imply it had. Skipped and silent are different facts.
              const skipped = !fired && layer === 'transaction' && rowViewsSkipped;
              const status = fired ? `${found!.length} signal${found!.length === 1 ? '' : 's'}` : skipped ? 'not run' : 'silent';
              return (
                <Tip key={layer} text={skipped ? `${info.tip}

Skipped on this scan: ${rowViewsReason}` : info.tip}>
                  <div
                    className={`rounded-xl border px-3.5 py-3 ${
                      fired ? 'border-indigo-200/70 bg-indigo-50/50' : 'border-zinc-150 bg-zinc-50/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold ${fired ? 'text-indigo-800' : 'text-zinc-400'}`}>
                        <Icon size={13} />
                        {info.label}
                      </span>
                      <span className={`text-[11px] font-semibold ${fired ? 'text-indigo-700' : skipped ? 'text-amber-600' : 'text-zinc-400'}`}>
                        {status}
                      </span>
                    </div>
                    <div className="mt-2">
                      <Meter value={best * 100} color={fired ? '#4f46e5' : '#d4d4d8'} />
                    </div>
                  </div>
                </Tip>
              );
            })}
          </div>
        </section>

        <section className="border-b border-zinc-100 px-6 py-5">
          <p className="fs-eyebrow flex items-center gap-1.5 text-zinc-400">
            Your verdict
            <InfoDot text="Recorded against the case, which is the level the work actually happens at. Confirmed and cleared verdicts are what teach the priority line where to sit for this company." />
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(['confirmed', 'cleared', 'uncertain'] as const).map((status) => {
              const info = REVIEW_META[status];
              const active = detail.review_status === status;
              return (
                <Tip key={status} text={info.meaning}>
                  <button
                    onClick={() => onReview(status)}
                    disabled={reviewing}
                    className={`rounded-full border px-3.5 py-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] transition disabled:opacity-50 ${
                      active ? info.chip : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'
                    }`}
                  >
                    {info.label}
                  </button>
                </Tip>
              );
            })}
          </div>
        </section>

        {/* Zoom in: the four row-level views, on this case's rows only. */}
        <section className="border-b border-zinc-100 px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="fs-eyebrow flex items-center gap-1.5 text-zinc-400">
              Zoom in on these rows
              <InfoDot text="The five-year scan finds where the problem is. This runs the four row-level detectives on this case's transactions alone to say which exact payments look wrong and why — the step that is too slow to run across five years, and cheap on a few hundred rows." />
            </p>
            <Button onClick={onDrill} disabled={drilling} icon={Search} tone="secondary">
              {drilling ? 'Examining…' : drill ? 'Run again' : 'Run detailed analysis'}
            </Button>
          </div>

          {drill && drill.status === 'ok' && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Chip className="border-zinc-200 bg-white text-zinc-600">
                  {drill.rows_examined?.toLocaleString()} rows examined in {drill.seconds}s
                </Chip>
                <Tip text={`Rows scoring at or above ${drill.alert_line} out of 100, this company's alert line.`}>
                  <Chip className="border-orange-200/70 bg-orange-50 text-orange-700">
                    {drill.rows_above_alert_line} above the alert line
                  </Chip>
                </Tip>
                {Object.entries(drill.views_that_fired ?? {}).map(([view, count]) => (
                  <Tip key={view} text={VIEW_META[view]?.tip ?? view}>
                    <Chip>{`${VIEW_META[view]?.label ?? view} · ${count}`}</Chip>
                  </Tip>
                ))}
              </div>

              <div className="fs-scroll max-h-80 overflow-auto rounded-xl border border-zinc-100">
                <table className="w-full min-w-[440px] text-left text-[12px]">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-zinc-100 text-[10px] uppercase tracking-[0.08em] text-zinc-400">
                      <th className="px-3 py-2">Score</th>
                      <th className="px-3 py-2">Views that fired</th>
                      <th className="px-3 py-2">Strongest reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drill.findings.slice(0, 60).map((row) => (
                      <tr key={row.transaction_id} className="border-b border-zinc-50 last:border-b-0">
                        <td className="px-3 py-2">
                          <span
                            className="font-semibold"
                            style={{ color: row.risk_score >= 60 ? '#ec835a' : row.risk_score >= 40 ? '#fab219' : '#71717a' }}
                          >
                            {Math.round(row.risk_score)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex flex-wrap gap-1">
                            {row.views_triggered.map((view) => (
                              <Tip key={view} text={VIEW_META[view]?.tip ?? view}>
                                <span className="rounded-full border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600">
                                  {VIEW_META[view]?.label ?? view}
                                </span>
                              </Tip>
                            ))}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-zinc-600">{row.signals[0]?.message ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {drill.caveat && <p className="text-[11.5px] leading-relaxed text-zinc-500">{drill.caveat}</p>}
            </div>
          )}

          {drill && drill.status === 'empty' && (
            <p className="mt-3 text-[12.5px] text-zinc-500">{drill.reason}</p>
          )}
        </section>

        <section className="border-b border-zinc-100 px-6 py-5">
          <p className="fs-eyebrow flex items-center gap-1.5 text-zinc-400">
            The evidence
            <InfoDot text="Every signal that built this case, strongest first, each with the period it covers and how many rows it touched." />
          </p>
          <div className="mt-3 space-y-2">
            {(detail.evidence ?? []).slice(0, 12).map((item, index) => (
              <div key={`${item.code}-${index}`} className="rounded-xl border border-zinc-100 bg-zinc-50/50 px-3.5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="fs-eyebrow text-zinc-500">{CODE_LABELS[item.code] ?? item.code}</span>
                  <Tip text="How strongly this single test fired, from 0 to 1." side="right">
                    <span className="text-[11px] font-semibold text-zinc-500">{item.strength.toFixed(2)}</span>
                  </Tip>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-700">{item.message}</p>
                <p className="mt-1 text-[11px] text-zinc-400">
                  {day(item.period_start)} → {day(item.period_end)} · {(item.member_count ?? 0).toLocaleString()} rows
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="px-6 py-5">
          <p className="fs-eyebrow flex items-center gap-1.5 text-zinc-400">
            Member transactions
            {detail.members_truncated && (
              <InfoDot text={`This case names ${detail.member_count} rows; the first few hundred are linked and shown here.`} />
            )}
          </p>
          <div className="fs-scroll mt-3 max-h-[26rem] overflow-auto rounded-xl border border-zinc-100">
            <table className="w-full min-w-[420px] text-left text-[12px]">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-zinc-100 text-[10px] uppercase tracking-[0.08em] text-zinc-400">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {detail.members.map((row) => (
                  <tr key={row.transaction_id} className="border-b border-zinc-50 last:border-b-0">
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-600">{day(row.transaction_date)}</td>
                    <td className="px-3 py-2 text-zinc-700">{row.description || row.chart_acc_head || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-zinc-800">{money(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {packet.caveat && (
            <p className="mt-3 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-zinc-500">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {packet.caveat}
            </p>
          )}
        </section>
      </div>
    </Card>
  );
};

export default HistoricalScanPanel;
