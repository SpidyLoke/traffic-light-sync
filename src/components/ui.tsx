import type { ReactNode } from 'react';
import type { Confidence, FitStatus } from '../lib/model/fit';
import type { LightState } from '../lib/model/predict';
import { STATE_LABEL } from '../lib/model/predict';

export function Screen({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col px-4 pb-28 safe-top">
      <header className="flex items-center justify-between gap-3 pt-4 pb-3">
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {right}
      </header>
      {children}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-surface p-4 ${className}`}>{children}</div>;
}

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-accent text-on-accent border-accent',
  secondary: 'bg-surface-2 text-fg border-line',
  danger: 'bg-transparent text-stop border-stop',
  ghost: 'bg-transparent text-fg border-transparent',
};

export function Button({
  children,
  onClick,
  variant = 'secondary',
  className = '',
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-12 rounded-xl border-2 px-4 py-2 font-bold active:scale-[0.97] disabled:opacity-40 ${BTN[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export const CONF_LABEL: Record<Confidence, string> = { high: 'High', medium: 'Medium', low: 'Low', none: 'None' };

export function ConfidenceBadge({ confidence, status }: { confidence: Confidence; status: FitStatus }) {
  if (status === 'notFixedTime')
    return <span className="rounded-lg border-2 border-stop px-2 py-0.5 text-sm font-bold text-stop">Not fixed-time</span>;
  if (status === 'ambiguous')
    return <span className="rounded-lg border-2 border-warn px-2 py-0.5 text-sm font-bold text-warn">Ambiguous</span>;
  if (status === 'insufficient')
    return <span className="rounded-lg border-2 border-line px-2 py-0.5 text-sm font-bold text-muted">Not enough data</span>;
  const cls =
    confidence === 'high'
      ? 'bg-go text-on-go border-go'
      : confidence === 'medium'
        ? 'bg-warn text-on-warn border-warn'
        : 'border-warn text-warn';
  return <span className={`rounded-lg border-2 px-2 py-0.5 text-sm font-bold ${cls}`}>{CONF_LABEL[confidence]} confidence</span>;
}

export function stateClasses(s: LightState): string {
  switch (s) {
    case 'green':
      return 'bg-go text-on-go';
    case 'red':
      return 'bg-stop text-on-stop';
    case 'turningGreen':
    case 'turningRed':
      return 'bg-warn text-on-warn';
    default:
      return 'bg-surface-2 text-muted';
  }
}

export function StatePill({ state, big = false }: { state: LightState; big?: boolean }) {
  return (
    <span
      className={`inline-block rounded-xl font-black tracking-wide ${stateClasses(state)} ${
        big ? 'px-4 py-2 text-3xl' : 'px-2.5 py-1 text-base'
      }`}
    >
      {STATE_LABEL[state]}
    </span>
  );
}

export function GpsBadge({ status, accuracy }: { status: string; accuracy?: number }) {
  if (status !== 'active') {
    return <span className="rounded-lg border-2 border-stop px-2 py-0.5 text-sm font-bold text-stop">GPS {status}</span>;
  }
  const good = (accuracy ?? 99) <= 15;
  return (
    <span className={`rounded-lg border-2 px-2 py-0.5 text-sm font-bold tabular ${good ? 'border-go text-go' : 'border-warn text-warn'}`}>
      GPS ±{Math.round(accuracy ?? 0)} m
    </span>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-sm text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-xl border-2 border-line bg-surface-2 px-3 py-2.5 text-lg text-fg outline-none focus:border-accent';
