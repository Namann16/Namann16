import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

type Tone = 'positive' | 'negative' | 'neutral' | 'caution' | 'accent';

const TONE_CLASSES: Record<Tone, string> = {
  positive: 'bg-positive-50 text-positive-700 border-positive-100 dark:bg-positive-700/15 dark:text-positive-100 dark:border-positive-700/30',
  negative: 'bg-negative-50 text-negative-700 border-negative-100 dark:bg-negative-700/15 dark:text-negative-100 dark:border-negative-700/30',
  caution: 'bg-caution-50 text-caution-700 border-caution-100 dark:bg-caution-700/15 dark:text-caution-100 dark:border-caution-700/30',
  accent: 'bg-accent-50 text-accent-700 border-accent-100 dark:bg-accent-700/20 dark:text-accent-100 dark:border-accent-700/40',
  neutral: 'bg-ink-100 text-ink-600 border-ink-200 dark:bg-ink-800 dark:text-ink-300 dark:border-ink-700',
};

export function Badge({ tone = 'neutral', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-semibold ${TONE_CLASSES[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function Card({
  title, description, actions, children, className = '', padded = true,
}: {
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean;
}) {
  return (
    <section className={`surface overflow-hidden ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-ink-200 px-4 py-2.5 dark:border-ink-800/60">
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-semibold text-ink-900 dark:text-ink-100">{title}</h2>}
            {description && <p className="mt-0.5 text-2xs text-ink-500 dark:text-ink-400">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-ink-900 dark:text-ink-50">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-400">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Empty state.
 *
 * Always says what is missing and what to do about it, rather than showing a blank panel —
 * the user should never have to guess why an analysis is unavailable.
 */
export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-ink-300 px-6 py-10 text-center dark:border-ink-700">
      <p className="text-[13px] font-semibold text-ink-700 dark:text-ink-200">{title}</p>
      <p className="mt-1.5 max-w-lg text-[12.5px] leading-relaxed text-ink-500 dark:text-ink-400">{message}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-ink-500 dark:text-ink-400" role="status">
      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4z" />
      </svg>
      {label}
    </div>
  );
}

/** Info tooltip used for ratio explanations. Opens on hover and on keyboard focus. */
export function InfoTip({ label, children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <span className="relative inline-flex" ref={ref}>
      <button
        type="button"
        aria-label={label ?? 'More information'}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-ink-300 text-[9px] font-bold leading-none text-ink-500 hover:border-accent-400 hover:text-accent-600 dark:border-ink-600 dark:text-ink-400"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.preventDefault(); setOpen((v) => !v); }}
      >
        i
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-5 z-50 w-72 -translate-x-1/2 rounded-md border border-ink-200 bg-white p-3 text-left text-[12px] font-normal leading-relaxed text-ink-700 shadow-raised dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200"
        >
          {children}
        </span>
      )}
    </span>
  );
}

export function Field({
  label, hint, error, children, required,
}: { label: string; hint?: string; error?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-2xs font-semibold uppercase tracking-wider text-ink-600 dark:text-ink-400">
        {label}
        {required && <span className="text-negative-600" aria-hidden="true">*</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-2xs text-ink-500 dark:text-ink-400">{hint}</span>}
      {error && <span className="mt-1 block text-2xs text-negative-600">{error}</span>}
    </label>
  );
}

export function Banner({ tone = 'neutral', title, children, onDismiss }: { tone?: Tone; title?: string; children: ReactNode; onDismiss?: () => void }) {
  return (
    <div className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-[12.5px] ${TONE_CLASSES[tone]}`} role={tone === 'negative' ? 'alert' : 'status'}>
      <div>
        {title && <p className="font-semibold">{title}</p>}
        <div className="leading-relaxed">{children}</div>
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="shrink-0 text-2xs font-semibold underline underline-offset-2" aria-label="Dismiss">
          Dismiss
        </button>
      )}
    </div>
  );
}

/** A value with its provenance, so the reader always knows whether a figure was entered or derived. */
export function SourceDot({ source }: { source: 'entered' | 'calculated' | 'missing' }) {
  if (source === 'missing') return null;
  const calculated = source === 'calculated';
  return (
    <span
      title={calculated ? 'Calculated by the analysis engine' : 'Entered or imported'}
      className={`ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${calculated ? 'bg-accent-400' : 'bg-ink-300 dark:bg-ink-600'}`}
      aria-hidden="true"
    />
  );
}

export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/40 p-4 pt-[6vh]" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className={`surface relative w-full ${wide ? 'max-w-4xl' : 'max-w-lg'}`}>
        <header className="flex items-center justify-between border-b border-ink-200 px-4 py-3 dark:border-ink-800/60">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          <button type="button" className="btn-ghost px-2 py-0.5" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
