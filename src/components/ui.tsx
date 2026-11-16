import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, CircleSlash, Info, XCircle } from 'lucide-react';
import { STATE_LABEL } from '../domain/lifecycle';
import type { Availability, SessionState } from '../domain/types';
import { VERDICT_LABEL, type VerdictState } from '../domain/verdict';

export function Card({ title, actions, children, className = '', id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`card ${className}`} aria-labelledby={title && id ? id : undefined}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2 id={id}>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Callout({ tone = 'neutral', children, icon }: { tone?: 'neutral' | 'warn' | 'bad' | 'good' | 'info'; children: ReactNode; icon?: ReactNode }) {
  const Icon = tone === 'warn' ? AlertTriangle : tone === 'bad' ? XCircle : tone === 'good' ? CheckCircle2 : Info;
  return (
    <div className={`callout ${tone}`} role={tone === 'bad' || tone === 'warn' ? 'status' : undefined}>
      {icon ?? <Icon size={18} aria-hidden />}
      <div>{children}</div>
    </div>
  );
}

const VERDICT_TONE: Record<VerdictState, string> = { within: 'good', review: 'warn', incomplete: 'bad', 'not-evaluated': 'outline' };
export function VerdictBadge({ state, big }: { state: VerdictState; big?: boolean }) {
  const Icon = state === 'within' ? CheckCircle2 : state === 'review' ? AlertTriangle : state === 'incomplete' ? XCircle : CircleDashed;
  return (
    <span className={`badge ${VERDICT_TONE[state]} ${big ? 'big' : ''}`}>
      <Icon size={big ? 18 : 14} aria-hidden /> {VERDICT_LABEL[state]}
    </span>
  );
}

const STATE_TONE: Partial<Record<SessionState, string>> = { complete: 'good', interrupted: 'warn', failed: 'bad', cancelled: 'outline', recording: 'bad' };
export function StateBadge({ state }: { state: SessionState }) {
  return <span className={`badge ${STATE_TONE[state] ?? 'info'}`}>{state === 'recording' ? <span className="rec-dot" aria-hidden /> : null}{STATE_LABEL[state]}</span>;
}

const AVAIL: Record<Availability, { label: string; tone: string }> = {
  supported: { label: 'Supported', tone: 'good' },
  unsupported: { label: 'Unsupported', tone: 'warn' },
  denied: { label: 'Permission denied', tone: 'bad' },
  'not-implemented': { label: 'Not implemented', tone: 'outline' },
};
export function AvailabilityBadge({ a }: { a: Availability }) {
  const Icon = a === 'supported' ? CheckCircle2 : a === 'not-implemented' ? CircleDashed : CircleSlash;
  return (
    <span className={`badge ${AVAIL[a].tone}`}>
      <Icon size={13} aria-hidden /> {AVAIL[a].label}
    </span>
  );
}

export function Stat({ label, value, unit, foot, color, icon }: { label: ReactNode; value: ReactNode; unit?: string; foot?: ReactNode; color?: string; icon?: ReactNode }) {
  return (
    <div className="stat">
      <div className="label">
        {icon}
        {label}
      </div>
      <div className="value" style={color ? { color } : undefined}>
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>('button, input, select, textarea, [href]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && el) {
        const items = Array.from(el.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, textarea, [href]'));
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <>
      <div className="dialog-backdrop" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2 style={{ marginBottom: 12 }}>{title}</h2>
        {children}
      </div>
    </>
  );
}

type Toast = { id: number; text: string };
const ToastCtx = createContext<(text: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export const fmt = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(d));
export const signed = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}`);
export const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');

export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
