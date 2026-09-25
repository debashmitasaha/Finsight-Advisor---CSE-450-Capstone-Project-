import React, { useEffect, useState } from 'react';
import { ChevronDown, Info, Loader2, X } from 'lucide-react';

/* ---------------------------------------------------------------------------
   The shared vocabulary for the Forensic Intelligence workspace.

   The page used to explain itself in paragraphs. Everything long now lives in a
   tooltip instead, so the surface stays short and the depth is one hover away.
   Every tooltip is reachable by keyboard too: the trigger is focusable and the
   bubble opens on focus-within.
   ------------------------------------------------------------------------- */

export type TipSide = 'center' | 'right' | 'below';

const SIDE_CLASS: Record<TipSide, string> = {
  center: '',
  right: 'fs-tip-right',
  below: 'fs-tip-below',
};

/**
 * `focusable` is off by default on purpose. When the trigger is already a button
 * or an input, the bubble opens from its own focus through `:focus-within`, and
 * adding a second tab stop would double the length of every keyboard pass.
 */
export const Tip = ({
  text,
  children,
  side = 'center',
  className = '',
  focusable = false,
}: {
  text: React.ReactNode;
  children: React.ReactNode;
  side?: TipSide;
  className?: string;
  focusable?: boolean;
}) => (
  <span className={`fs-tip ${SIDE_CLASS[side]} ${className}`} tabIndex={focusable ? 0 : undefined}>
    {children}
    <span role="tooltip" className="fs-tip-body">
      {text}
    </span>
  </span>
);

/** A small circled "i". Use beside a heading whose meaning is not obvious. */
export const InfoDot = ({ text, side = 'center' }: { text: React.ReactNode; side?: TipSide }) => (
  <Tip text={text} side={side} className="align-middle" focusable>
    <Info className="h-3.5 w-3.5 cursor-help text-zinc-400 transition hover:text-zinc-700" />
  </Tip>
);

/** A word or phrase that carries an explanation. Dotted underline signals it. */
export const Term = ({ text, children, side = 'center' }: { text: React.ReactNode; children: React.ReactNode; side?: TipSide }) => (
  <Tip text={text} side={side} focusable>
    <span className="fs-underline">{children}</span>
  </Tip>
);

/* ------------------------------------------------------------------ surfaces */

export const Card = ({
  children,
  className = '',
  hover = false,
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  as?: 'div' | 'section';
}) => <Tag className={`fs-card ${hover ? 'fs-hover' : ''} ${className}`}>{children}</Tag>;

export const SectionHead = ({
  eyebrow,
  title,
  hint,
  action,
}: {
  eyebrow?: string;
  title: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
}) => (
  <div className="flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0">
      {eyebrow && <p className="fs-eyebrow text-zinc-400">{eyebrow}</p>}
      <h3 className="fs-title mt-1.5 flex items-center gap-2 text-[19px] text-zinc-900">
        {title}
        {hint && <InfoDot text={hint} />}
      </h3>
    </div>
    {action}
  </div>
);

/* -------------------------------------------------------------------- inputs */

export const Segmented = <T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  tipSide = 'center',
}: {
  options: { value: T; label: string; count?: number; tip?: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  tipSide?: TipSide;
}) => (
  <div
    role="tablist"
    className={`inline-flex flex-wrap items-center gap-1 rounded-full border border-zinc-200/80 bg-zinc-50/80 p-1 backdrop-blur ${
      size === 'sm' ? 'text-[12px]' : 'text-[13px]'
    }`}
  >
    {options.map((option) => {
      const active = option.value === value;
      const button = (
        <button
          key={option.value}
          role="tab"
          aria-selected={active}
          onClick={() => onChange(option.value)}
          className={`fs-focus rounded-full px-3.5 font-medium transition ${size === 'sm' ? 'py-1.5' : 'py-2'} ${
            active ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-900'
          }`}
        >
          {option.label}
          {option.count !== undefined && (
            <span className={`ml-1.5 fs-num text-[11px] ${active ? 'text-zinc-400' : 'text-zinc-400'}`}>{option.count}</span>
          )}
        </button>
      );
      return option.tip ? (
        <Tip key={option.value} text={option.tip} side={tipSide}>
          {button}
        </Tip>
      ) : (
        button
      );
    })}
  </div>
);

type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'light';

export const Button = ({
  children,
  onClick,
  disabled,
  busy,
  icon: Icon,
  tone = 'primary',
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  icon?: React.ElementType;
  tone?: ButtonTone;
  className?: string;
}) => {
  const tones: Record<ButtonTone, string> = {
    primary: 'bg-zinc-900 text-white hover:bg-zinc-800 shadow-sm',
    secondary: 'border border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50',
    ghost: 'text-zinc-500 hover:text-zinc-900',
    light: 'bg-white text-zinc-900 hover:bg-zinc-100 shadow-sm',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={`fs-focus inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${tones[tone]} ${className}`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : Icon ? <Icon className="h-3.5 w-3.5" /> : null}
      {children}
    </button>
  );
};

/* -------------------------------------------------------------------- pieces */

export const Chip = ({
  children,
  className = '',
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) => (
  <span
    style={style}
    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] ${className}`}
  >
    {children}
  </span>
);

/** A single headline number with its label and an optional explanation. */
export const Stat = ({
  label,
  value,
  sub,
  tip,
  accent,
  tipSide = 'center',
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tip?: React.ReactNode;
  accent?: string;
  tipSide?: TipSide;
}) => (
  <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 fs-hover">
    <p className="fs-eyebrow flex items-center gap-1.5 text-zinc-400">
      {label}
      {tip && <InfoDot text={tip} side={tipSide} />}
    </p>
    <p className="fs-num mt-2.5 text-[30px] font-semibold leading-none" style={accent ? { color: accent } : { color: '#09090b' }}>
      {value}
    </p>
    {sub && <p className="mt-2 text-[12px] leading-snug text-zinc-500">{sub}</p>}
  </div>
);

/** A progress or score bar. Animates in once, then stays put. */
export const Meter = ({ value, color, className = '' }: { value: number; color: string; className?: string }) => (
  <div className={`fs-bar h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 ${className}`}>
    <span style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }} />
  </div>
);

export const Empty = ({ icon: Icon, title, body }: { icon?: React.ElementType; title: string; body?: React.ReactNode }) => (
  <div className="px-8 py-16 text-center">
    {Icon && <Icon className="mx-auto h-8 w-8 text-zinc-300" strokeWidth={1.5} />}
    <p className="fs-title mt-4 text-[15px] text-zinc-900">{title}</p>
    {body && <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-zinc-500">{body}</p>}
  </div>
);

/* ----------------------------------------------------------------- disclosure */

/**
 * A slim row that opens to reveal a longer explanation. Illustrations used to sit
 * in the page flow, which meant scrolling to the data meant scrolling past a
 * full-width picture every time. Collapsed by default, the help is one click
 * away for whoever wants it and invisible to whoever does not.
 */
export const Reveal = ({
  icon: Icon,
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  icon?: React.ElementType;
  title: string;
  summary: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`fs-card overflow-hidden transition ${open ? '' : 'hover:border-zinc-300'}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="fs-focus flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-zinc-50/80"
      >
        {Icon && (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="fs-title block text-[13.5px] text-zinc-900">{title}</span>
          <span className="block truncate text-[12px] text-zinc-500">{summary}</span>
        </span>
        <span className="hidden shrink-0 text-[12px] font-medium text-zinc-400 sm:block">{open ? 'Hide' : 'Show me'}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="fs-in border-t border-zinc-100">{children}</div>}
    </div>
  );
};

/* ------------------------------------------------------------- busy overlay */

/**
 * Covers the workspace while a long action runs. Scoring and the benchmark both
 * take several seconds; without this the page looks frozen and people click the
 * button again. It names the action, so the wait is explained rather than just
 * endured.
 */
export const BusyOverlay = ({
  open,
  title,
  body,
  steps,
}: {
  open: boolean;
  title: string;
  body: string;
  steps?: string[];
}) => {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fs-scrim fixed inset-0 z-[95] flex items-center justify-center bg-zinc-950/40 px-6 backdrop-blur-[3px]">
      <div
        role="status"
        aria-live="polite"
        className="fs-in w-full max-w-[430px] rounded-3xl bg-white p-9 text-center shadow-[0_32px_80px_-24px_rgba(16,24,40,0.5)]"
      >
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
        </span>
        <p className="fs-title mt-5 text-[20px] text-zinc-900">{title}</p>
        <p className="mt-2 text-[13px] leading-relaxed text-zinc-500">{body}</p>
        {steps && steps.length > 0 && (
          <ul className="mt-5 space-y-1.5 text-left">
            {steps.map((step) => (
              <li key={step} className="flex items-start gap-2 text-[12px] leading-relaxed text-zinc-500">
                <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-indigo-400" />
                {step}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------- drawer */

/**
 * A slide-over panel. Used for the guide, so the workspace itself never has to
 * carry a wall of instructions. Escape closes it and the page behind it stops
 * scrolling while it is open.
 */
export const Drawer = ({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90]">
      <div className="fs-scrim absolute inset-0 bg-zinc-950/35 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fs-drawer absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col bg-white shadow-[-24px_0_60px_-30px_rgba(16,24,40,0.45)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-100 px-6 py-5">
          <div className="min-w-0">
            <h2 className="fs-title text-[18px] text-zinc-900">{title}</h2>
            {subtitle && <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-500">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="fs-focus shrink-0 rounded-full p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="fs-scroll flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </aside>
    </div>
  );
};

/** Horizontal rule that carries a label, used to break long panels into steps. */
export const StepRule = ({ step, title, tip }: { step: number; title: string; tip?: React.ReactNode }) => (
  <div className="flex items-center gap-3">
    <span className="fs-num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-semibold text-white">
      {step}
    </span>
    <p className="fs-title flex items-center gap-2 text-[13.5px] text-zinc-900">
      {title}
      {tip && <InfoDot text={tip} />}
    </p>
    <span className="h-px flex-1 bg-zinc-100" />
  </div>
);
