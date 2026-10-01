import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useId } from 'react';
import { useI18n } from '../lib/i18n';

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-hidden="true"
    />
  );
}

export function LoadingState({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-sm text-ink-muted" role="status">
      <Spinner className="text-brand-600" />
      <span>{label ?? t('state.loading')}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="card p-6 text-center" role="alert">
      <p className="text-base font-semibold text-ink">{t('state.errorTitle')}</p>
      <p className="mt-1 text-sm text-ink-muted">{message ?? t('common.somethingWentWrong')}</p>
      {onRetry ? (
        <button type="button" className="btn-secondary mt-4" onClick={onRetry}>
          {t('common.retry')}
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title?: string; body: string; action?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="card p-8 text-center">
      <p className="text-base font-semibold text-ink">{title ?? t('state.emptyTitle')}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Badge({ children, tone = 'bg-slate-100 text-slate-700' }: { children: ReactNode; tone?: string }) {
  return <span className={`chip ${tone}`}>{children}</span>;
}

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

export function Field({ label, hint, error, required, children }: FieldProps) {
  const generatedId = useId();
  const { t } = useI18n();
  const id = `field-${generatedId}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
        {required ? (
          <span className="ml-1 text-red-600" aria-hidden="true">
            *
          </span>
        ) : (
          <span className="ml-1 text-xs font-normal text-ink-soft">{`(${t('common.optional')})`}</span>
        )}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({ invalid, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input {...props} aria-invalid={invalid} className={`input ${props.className ?? ''}`} />;
}

export function TextArea({ invalid, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea {...props} aria-invalid={invalid} className={`input min-h-[96px] ${props.className ?? ''}`} />;
}

export function Select({ invalid, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select {...props} aria-invalid={invalid} className={`input ${props.className ?? ''}`}>
      {children}
    </select>
  );
}

export function StarRating({
  value,
  onChange,
  readOnly = false,
  size = 'md',
}: {
  value: number;
  onChange?: (value: number) => void;
  readOnly?: boolean;
  size?: 'sm' | 'md';
}) {
  const dimension = size === 'sm' ? 'text-base' : 'text-2xl';
  return (
    <div className={`flex items-center gap-1 ${dimension}`} role={readOnly ? 'img' : 'radiogroup'} aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readOnly}
          aria-label={`${star}`}
          aria-pressed={!readOnly ? value === star : undefined}
          onClick={readOnly ? undefined : () => onChange?.(star)}
          className={`${readOnly ? 'cursor-default' : 'cursor-pointer'} rounded leading-none ${
            star <= value ? 'text-amber-500' : 'text-slate-300'
          }`}
        >
          {star <= value ? '\u2605' : '\u2606'}
        </button>
      ))}
    </div>
  );
}

export function SectionHeading({
  title,
  action,
  hint,
  id,
}: {
  title: string;
  action?: ReactNode;
  hint?: string;
  /** Set when another element points here via aria-labelledby or an anchor. */
  id?: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 id={id} className="text-lg font-semibold text-ink">
          {title}
        </h2>
        {hint ? <p className="text-sm text-ink-muted">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function StatTile({ label, value, tone = 'text-ink' }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
    </div>
  );
}
