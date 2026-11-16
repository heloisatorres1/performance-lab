import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../data/state';
import { buildReport, type Report } from '../domain/report';

/** Re-renders every `ms` while active. */
export function useNow(ms: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ms === null) return;
    const h = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(h);
  }, [ms]);
  return now;
}

export function useReport(id: string | undefined): Report | null {
  const s = useAppState();
  const session = s.sessions.find((x) => x.id === id);
  return useMemo(() => (session && session.recordedMs > 0 ? buildReport(session, s.ruleset) : null), [session, s.ruleset]);
}

/** Linked cursor shared by every chart and the evidence panel. */
export function useLinkedCursor(initial: number | null = null) {
  const [selected, setSelected] = useState<number | null>(initial);
  const [hover, setHover] = useState<number | null>(null);
  const onCursor = (t: number | null, commit: boolean) => {
    if (commit) {
      setSelected(t);
      setHover(null);
    } else setHover(t);
  };
  return { cursor: hover ?? selected, selected, setSelected, onCursor };
}
