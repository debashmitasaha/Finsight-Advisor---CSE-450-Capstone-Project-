import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { AuditLogResponse } from '../types';
import { InfoDot, Tip } from './ForensicKit';

/* ---------------------------------------------------------------------------
   The audit trail.

   This page used to render the transaction history twice under two different
   names, because nothing was writing to the access_log table. It is written to
   now, so this shows what it was always meant to: who did what, and when.
   ------------------------------------------------------------------------- */

const shell = 'rounded-[32px] border border-slate-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]';

const WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

const when = (iso: string | null) => {
  if (!iso) return '—';
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return date.toLocaleDateString();
};

const AuditLogPanel: React.FC<{ deptId?: string | null }> = ({ deptId }) => {
  const [data, setData] = useState<AuditLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [action, setAction] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.auditLogs({ days, limit: 300, deptId }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the audit trail');
    } finally {
      setLoading(false);
    }
  }, [days, deptId]);

  useEffect(() => {
    load();
  }, [load]);

  const actions = useMemo(() => Object.entries(data?.by_action ?? {}).slice(0, 7), [data]);
  const entries = useMemo(
    () => (data?.entries ?? []).filter((entry) => action === 'all' || entry.action === action),
    [data, action],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Accountability</p>
          <h1 className="mt-2 flex items-center gap-2 text-3xl font-black tracking-[-0.04em] text-slate-950">
            Audit trail
            <InfoDot text="Every action that changes something is recorded with the person who did it. Reading a page is not recorded: a log of every page view would bury the events anyone actually looks for." />
          </h1>
          <p className="mt-2 text-sm text-slate-500">Who did what, newest first.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-2xl bg-slate-100 p-1">
            {WINDOWS.map((option) => (
              <button
                key={option.days}
                onClick={() => setDays(option.days)}
                className={`rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                  days === option.days ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 transition hover:border-slate-400 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric
          icon={Activity}
          label="Events"
          value={data ? String(data.total) : '—'}
          note={`in the last ${days} days`}
          tip="One row per action that changed something. Uploads, runs, verdicts, settings and account changes all land here."
        />
        <Metric
          icon={UserRound}
          label="People"
          value={data ? String(data.distinct_actors) : '—'}
          note="signed in and did something"
          tip="Distinct accounts behind those events. A quiet week with one active account is worth noticing on its own."
        />
        <Metric
          icon={ShieldCheck}
          label="Most common"
          value={actions[0] ? String(actions[0][1]) : '—'}
          note={actions[0] ? actions[0][0].toLowerCase() : 'nothing yet'}
          tip="The action performed most often in this window."
        />
      </div>

      {actions.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setAction('all')}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${
              action === 'all' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400'
            }`}
          >
            All {data?.total ?? 0}
          </button>
          {actions.map(([name, count]) => (
            <button
              key={name}
              onClick={() => setAction(action === name ? 'all' : name)}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${
                action === name ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400'
              }`}
            >
              {name} {count}
            </button>
          ))}
        </div>
      )}

      <div className={`${shell} overflow-hidden`}>
        {loading && !data ? (
          <p className="px-7 py-16 text-center text-sm text-slate-400">Loading the trail…</p>
        ) : entries.length === 0 ? (
          <div className="px-7 py-16 text-center">
            <Activity className="mx-auto h-8 w-8 text-slate-300" strokeWidth={1.5} />
            <p className="mt-4 text-lg font-black text-slate-900">Nothing recorded yet</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
              The trail fills as people work: upload a ledger, run the engine, record a verdict, change a setting. It is
              written from now on, so it will not show anything that happened before today.
            </p>
          </div>
        ) : (
          <div className="max-h-[640px] overflow-y-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                  <th className="px-7 py-4">When</th>
                  <th className="px-4 py-4">Who</th>
                  <th className="px-4 py-4">Action</th>
                  <th className="px-7 py-4">Department</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.log_id} className="border-b border-slate-50 text-sm transition hover:bg-slate-50/70">
                    <td className="px-7 py-3.5 text-slate-500">
                      <Tip text={entry.at ? new Date(entry.at).toLocaleString() : 'no timestamp'}>
                        <span className="cursor-help">{when(entry.at)}</span>
                      </Tip>
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="font-bold text-slate-900">{entry.actor_name || 'Unknown'}</p>
                      <p className="text-xs text-slate-400">{entry.actor_email || 'account removed'}</p>
                    </td>
                    <td className="px-4 py-3.5 font-semibold text-slate-700">{entry.action}</td>
                    <td className="px-7 py-3.5 text-slate-500">{entry.department_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const Metric = ({
  icon: Icon,
  label,
  value,
  note,
  tip,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  note: string;
  tip: string;
}) => (
  <div className={`${shell} p-6`}>
    <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
      <Icon className="h-3.5 w-3.5" />
      {label}
      <InfoDot text={tip} />
    </p>
    <p className="mt-3 text-4xl font-black tabular-nums tracking-[-0.04em] text-slate-950">{value}</p>
    <p className="mt-1.5 text-xs text-slate-500">{note}</p>
  </div>
);

export default AuditLogPanel;
