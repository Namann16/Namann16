import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

type Tone = 'positive' | 'negative' | 'neutral' | 'caution' | 'accent';

/*
 * Apple tones. A tinted status element is a low-opacity fill of its own hue with the hue itself as
 * the text colour — never a saturated block, and never outlined. Apple reserves solid fills for
 * the one primary action on a screen, so a badge that used one would compete with it.
 */
const TONE_CLASSES: Record<Tone, string> = {
  positive: 'bg-positive-500/12 text-positive-600 dark:bg-positive-400/18 dark:text-positive-400',
  negative: 'bg-negative-500/12 text-negative-600 dark:bg-negative-400/18 dark:text-negative-400',
  caution: 'bg-caution-500/14 text-caution-600 dark:bg-caution-400/18 dark:text-caution-400',
  accent: 'bg-accent-600/12 text-accent-600 dark:bg-accent-600/[0.08]0/20 dark:text-accent-500',
  neutral: 'bg-ink-500/12 text-ink-600 dark:bg-ink-400/16 dark:text-ink-400',
};

export function Badge({ tone = 'neutral', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`badge ${TONE_CLASSES[tone]} ${className}`}>
      {children}
    </span>
  );
}

/**
 * Segmented control — Apple's control for choosing one of a few exclusive views.
 *
 * The selected segment is a raised thumb on a recessed track, which is what makes the choice read
 * as a position rather than as a set of independent buttons.
 */
export function Segmented<T extends string>({
  options, value, onChange, label, className = '',
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={`segmented ${className}`} role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          className="segment"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
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
        <header className="hairline flex items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-headline font-semibold">{title}</h2>}
            {description && <p className="mt-1 text-footnote leading-snug text-ink-500 dark:text-ink-400">{description}</p>}
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
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-title-1 font-semibold">{title}</h1>
        {description && (
          <p className="mt-1.5 max-w-3xl text-callout leading-relaxed text-ink-500 dark:text-ink-400">{description}</p>
        )}
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
    <div className="surface flex flex-col items-center justify-center px-6 py-12 text-center">
      <p className="text-title-3 font-semibold">{title}</p>
      <p className="mt-2 max-w-lg text-callout leading-relaxed text-ink-500 dark:text-ink-400">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * Skeleton placeholder.
 *
 * Shown while an analysis is being calculated. A shape that matches the content it stands in for
 * tells the reader what is about to arrive and keeps the layout from jumping when it does; a
 * spinner in the middle of an empty page tells them only that something is happening.
 *
 * It is hidden from assistive technology and paired with a live region that announces the state in
 * words, because a shimmering rectangle means nothing read aloud.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

/** The dashboard's shape, drawn as placeholders. */
export function AnalysisSkeleton({ label = 'Calculating analysis' }: { label?: string }) {
  return (
    <div className="space-y-5">
      <span className="sr-only" role="status" aria-live="polite">{label}</span>
      <div className="space-y-2">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-3.5 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="surface space-y-2 px-3 py-2.5">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="surface space-y-3 p-4">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-44 w-full" />
          </div>
        ))}
      </div>
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
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-ink-500/14 text-[9px] font-semibold leading-none text-ink-500 transition-colors hover:bg-accent-600/16 hover:text-accent-600 dark:text-ink-400 dark:hover:text-accent-500"
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
          className="material-thick absolute left-1/2 top-5 z-50 w-72 -translate-x-1/2 rounded-xl p-3 text-left text-subheadline font-normal leading-relaxed shadow-sheet"
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
      <span className="mb-1 flex items-center gap-1 text-footnote text-ink-500 dark:text-ink-400">
        {label}
        {required && <span className="text-negative-600" aria-hidden="true">*</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-footnote text-ink-500 dark:text-ink-400">{hint}</span>}
      {error && <span className="mt-1 block text-footnote text-negative-600 dark:text-negative-400">{error}</span>}
    </label>
  );
}

/*
 * A banner needs more presence than a badge. The badge tints work at 12–14% because a badge sits
 * on a white card and is only a few characters wide; a full-width notice at that strength
 * disappears against the grouped background, so it gets its own slightly stronger fill and keeps
 * the label colour at full strength.
 */
const BANNER_TONE_CLASSES: Record<Tone, string> = {
  positive: 'bg-positive-500/[0.16] text-positive-700 dark:bg-positive-400/[0.16] dark:text-positive-300',
  negative: 'bg-negative-500/[0.16] text-negative-700 dark:bg-negative-400/[0.16] dark:text-negative-300',
  caution: 'bg-caution-500/[0.20] text-caution-700 dark:bg-caution-400/[0.16] dark:text-caution-300',
  accent: 'bg-accent-600/[0.14] text-accent-800 dark:bg-accent-500/[0.18] dark:text-accent-300',
  neutral: 'bg-ink-500/[0.14] text-ink-700 dark:bg-ink-400/[0.14] dark:text-ink-200',
};

export function Banner({ tone = 'neutral', title, children, onDismiss }: { tone?: Tone; title?: string; children: ReactNode; onDismiss?: () => void }) {
  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-xl px-3.5 py-2.5 text-callout ${BANNER_TONE_CLASSES[tone]}`}
      role={tone === 'negative' ? 'alert' : 'status'}
    >
      <div>
        {title && <p className="font-semibold">{title}</p>}
        <div className="leading-relaxed">{children}</div>
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="shrink-0 text-footnote font-medium" aria-label="Dismiss">
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
      className={`ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${calculated ? 'bg-accent-600 dark:bg-accent-600/[0.08]0' : 'bg-ink-400 dark:bg-ink-600'}`}
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
    <div className="scrim fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[6vh]" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className={`sheet relative w-full ${wide ? 'max-w-4xl' : 'max-w-lg'}`}>
        {/* A sheet's title is centred with the dismiss action trailing it, as on iOS and iPadOS. */}
        <header className="hairline relative flex items-center justify-center px-12 py-3">
          <h2 className="text-headline font-semibold">{title}</h2>
          <button
            type="button"
            className="absolute right-3 flex h-6 w-6 items-center justify-center rounded-full bg-ink-500/14 text-[11px] font-medium text-ink-500 transition-colors hover:bg-ink-500/24 dark:text-ink-400"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
