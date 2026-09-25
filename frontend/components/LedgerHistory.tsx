import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Search } from 'lucide-react';
import { api } from '../lib/api';
import { Transaction, TransactionCategory } from '../types';
import { InfoDot, Tip } from './ForensicKit';

/* ---------------------------------------------------------------------------
   The ledger, with the things a reviewer actually needs.

   This page used to show the first thirty rows with no search, no filter, no
   count and no way to correct anything. The necessity of a row is a judgement,
   and judgements get made wrong; PATCH /transactions/{id} has always existed to
   fix them and nothing in the interface ever called it.
   ------------------------------------------------------------------------- */

const shell = 'rounded-[32px] border border-slate-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]';

const CATEGORY_STYLE: Record<string, string> = {
  necessary: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  unnecessary: 'border-red-200 bg-red-50 text-red-700',
  uncategorized: 'border-slate-200 bg-slate-50 text-slate-600',
};

const CATEGORIES: { value: TransactionCategory; label: string; meaning: string }[] = [
  { value: 'necessary', label: 'Necessary', meaning: 'Spending the department had to make.' },
  { value: 'unnecessary', label: 'Unnecessary', meaning: 'Spending that could have been avoided.' },
  { value: 'uncategorized', label: 'Uncategorized', meaning: 'Not judged yet. The default for a fresh upload.' },
];

const PAGE = 40;

const LedgerHistory: React.FC<{
  transactions: Transaction[];
  loading: boolean;
  onUpdated: (transaction: Transaction) => void;
}> = ({ transactions, loading, onUpdated }) => {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<TransactionCategory | 'all'>('all');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return transactions.filter((transaction) => {
      if (category !== 'all' && (transaction.category || 'uncategorized') !== category) return false;
      if (flaggedOnly && !transaction.is_flagged) return false;
      if (!needle) return true;
      return [transaction.description, transaction.chart_acc_head, transaction.group_name, transaction.expense_category_name]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });
  }, [transactions, search, category, flaggedOnly]);

  const setRowCategory = async (transaction: Transaction, next: TransactionCategory) => {
    if ((transaction.category || 'uncategorized') === next) return;
    setSavingId(transaction.transaction_id);
    setError(null);
    try {
      onUpdated(await api.updateTransaction(transaction.transaction_id, { category: next }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update that row');
    } finally {
      setSavingId(null);
    }
  };

  const counts = useMemo(
    () => ({
      flagged: transactions.filter((transaction) => transaction.is_flagged).length,
      uncategorized: transactions.filter((transaction) => (transaction.category || 'uncategorized') === 'uncategorized').length,
    }),
    [transactions],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Operational history</p>
          <h1 className="mt-2 flex items-center gap-2 text-3xl font-black tracking-[-0.04em] text-slate-950">
            The ledger
            <InfoDot text="Everything imported for this department. Search it, narrow it, and correct a necessity judgement in place." />
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {filtered.length.toLocaleString()} of {transactions.length.toLocaleString()} rows
            {counts.flagged > 0 && ` · ${counts.flagged} flagged`}
            {counts.uncategorized > 0 && ` · ${counts.uncategorized} not judged`}
          </p>
        </div>
        <label className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setShown(PAGE);
            }}
            placeholder="Search description or account head"
            className="w-full rounded-2xl border border-slate-200 py-3 pl-11 pr-4 text-sm outline-none transition focus:border-slate-400"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip active={category === 'all'} onClick={() => setCategory('all')} label={`All ${transactions.length}`} />
        {CATEGORIES.map((option) => (
          <Tip key={option.value} text={option.meaning}>
            <FilterChip
              active={category === option.value}
              onClick={() => setCategory(category === option.value ? 'all' : option.value)}
              label={`${option.label} ${transactions.filter((t) => (t.category || 'uncategorized') === option.value).length}`}
            />
          </Tip>
        ))}
        <Tip text="Rows the rule-based scan or the intelligence engine marked as worth a second look.">
          <FilterChip
            active={flaggedOnly}
            onClick={() => setFlaggedOnly((value) => !value)}
            label={`Flagged ${counts.flagged}`}
          />
        </Tip>
      </div>

      {error && <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className={`${shell} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                <th className="px-7 py-4">Date</th>
                <th className="px-4 py-4">Description</th>
                <th className="px-4 py-4">Amount</th>
                <th className="px-4 py-4">Group</th>
                <th className="px-4 py-4">Expense type</th>
                <th className="px-7 py-4">
                  <span className="inline-flex items-center gap-1.5">
                    Necessity
                    <InfoDot text="Click a row's necessity to correct it. The change is saved immediately and shows up in the audit trail." side="right" />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-7 py-16 text-center text-sm text-slate-400">Loading the ledger…</td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-7 py-16 text-center text-sm text-slate-400">
                    Nothing matches. Clear the search or the filters.
                  </td>
                </tr>
              )}
              {!loading &&
                filtered.slice(0, shown).map((transaction) => {
                  const current = (transaction.category || 'uncategorized') as TransactionCategory;
                  const saving = savingId === transaction.transaction_id;
                  return (
                    <tr key={transaction.transaction_id} className="border-b border-slate-50 text-sm transition hover:bg-slate-50/70">
                      <td className="px-7 py-4 font-semibold text-slate-600">
                        {new Date(transaction.transaction_date).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-bold text-slate-900">{transaction.description || 'No description'}</p>
                        <p className="text-xs text-slate-400">{transaction.chart_acc_head || 'no account head'}</p>
                        {transaction.is_flagged && transaction.flagged_reason && (
                          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-red-600">
                            <AlertTriangle className="h-3 w-3" />
                            {transaction.flagged_reason}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-4 font-bold tabular-nums text-slate-900">
                        TK {transaction.amount.toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-slate-500">{transaction.group_name || 'Not grouped'}</td>
                      <td className="px-4 py-4">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">
                          {transaction.expense_category_name || 'Unassigned'}
                        </span>
                      </td>
                      <td className="px-7 py-4">
                        <div className="flex items-center gap-1.5">
                          {CATEGORIES.map((option) => (
                            <button
                              key={option.value}
                              onClick={() => setRowCategory(transaction, option.value)}
                              disabled={saving}
                              title={option.meaning}
                              className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition disabled:opacity-40 ${
                                current === option.value
                                  ? CATEGORY_STYLE[option.value]
                                  : 'border-transparent text-slate-300 hover:border-slate-200 hover:text-slate-600'
                              }`}
                            >
                              {current === option.value && !saving && <Check className="mr-1 inline h-3 w-3" />}
                              {saving && current === option.value && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
                              {option.label.slice(0, 3)}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {!loading && filtered.length > shown && (
          <div className="border-t border-slate-100 px-7 py-4 text-center">
            <button
              onClick={() => setShown((value) => value + PAGE)}
              className="rounded-2xl border border-slate-200 px-5 py-2.5 text-xs font-bold text-slate-600 transition hover:border-slate-400"
            >
              Show {Math.min(PAGE, filtered.length - shown)} more
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const FilterChip = ({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) => (
  <button
    onClick={onClick}
    className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${
      active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400'
    }`}
  >
    {label}
  </button>
);

export default LedgerHistory;
