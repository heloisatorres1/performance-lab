import { useEffect, useState } from 'react';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, ImageOff, Pause, Play } from 'lucide-react';
import { ALIGN_TOLERANCE_MS, alignCapture, CLOCK_UNCERTAINTY_MS } from '../domain/align';
import { fmtClock } from '../domain/analysis';
import { captureDataUrl } from '../domain/art';
import type { Capture, CaptureMode, Gap, TimelineEvent } from '../domain/types';

interface Props {
  captures: Capture[];
  gaps: Gap[];
  events: TimelineEvent[];
  mode: CaptureMode;
  seed: number;
  t: number | null;
  onSelect: (t: number) => void;
}

/** Shows the capture nearest the selected time, within tolerance, with its offset. */
export function Evidence({ captures, gaps, events, mode, seed, t, onSelect }: Props) {
  const [playing, setPlaying] = useState(false);
  const align = t === null ? null : alignCapture(captures, gaps, t);
  const idx = align?.kind === 'match' ? captures.indexOf(align.capture) : -1;

  useEffect(() => {
    if (!playing) return;
    const h = setInterval(() => {
      const cur = idx < 0 ? 0 : idx + 1;
      if (cur >= captures.length) {
        setPlaying(false);
        return;
      }
      onSelect(captures[cur].t);
    }, 500);
    return () => clearInterval(h);
  }, [playing, idx, captures, onSelect]);

  if (mode === 'off') {
    return (
      <div className="evidence-empty">
        <div>
          <ImageOff aria-hidden />
          <p>Screen capture was off for this session.</p>
        </div>
      </div>
    );
  }
  const go = (i: number) => {
    const c = captures[Math.max(0, Math.min(captures.length - 1, i))];
    if (c) onSelect(c.t);
  };
  const event = t !== null ? events.find((e) => Math.abs(e.t - t) <= 2000) : undefined;
  const label = mode === 'video' ? 'Video frame' : 'Screenshot';
  return (
    <div className="stack-sm">
      {align?.kind === 'match' ? (
        <>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>
              {label} at {fmtClock(align.capture.t, true)}
            </strong>
            <span className="subtle num">
              Offset {align.offsetMs === 0 ? '0.0' : `${align.offsetMs > 0 ? '+' : '−'}${(Math.abs(align.offsetMs) / 1000).toFixed(1)}`} s
            </span>
          </div>
          {event && <span className="badge violet" style={{ alignSelf: 'flex-start' }}>Event: {event.label}</span>}
          <img className="evidence-img" src={captureDataUrl(align.capture, seed)} alt={`Simulated ${label.toLowerCase()} at ${fmtClock(align.capture.t, true)}: ${align.capture.scene} scene, level ${align.capture.level}`} />
        </>
      ) : (
        <div className="evidence-empty" role="status">
          <div>
            <ImageOff aria-hidden />
            <p>
              {t === null
                ? 'Select a time on a chart to see the matching capture.'
                : align?.kind === 'none' && align.reason === 'capture-gap'
                  ? 'No nearby capture: captures are missing in this interval.'
                  : `No nearby capture within ±${ALIGN_TOLERANCE_MS / 1000} s.`}
            </p>
            {align?.kind === 'none' && align.nearestOffsetMs !== undefined && <p className="subtle">Nearest is {(Math.abs(align.nearestOffsetMs) / 1000).toFixed(1)} s away.</p>}
          </div>
        </div>
      )}
      {captures.length > 0 && (
        <>
          <div className="thumbs" aria-label="Neighbouring captures">
            {[idx - 1, idx, idx + 1].map((i) =>
              i >= 0 && i < captures.length ? (
                <button key={i} type="button" aria-current={i === idx} onClick={() => go(i)} aria-label={`${label} at ${fmtClock(captures[i].t, true)}`}>
                  <img src={captureDataUrl(captures[i], seed)} alt="" />
                  <span className="subtle num">{fmtClock(captures[i].t, true)}</span>
                </button>
              ) : null,
            )}
          </div>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="icon-btn" type="button" onClick={() => go(0)} aria-label="First capture"><ChevronFirst size={18} /></button>
            <button className="icon-btn" type="button" onClick={() => go(idx - 1)} disabled={idx <= 0} aria-label="Previous capture"><ChevronLeft size={18} /></button>
            <span className="badge outline num" aria-label={`Capture ${idx + 1} of ${captures.length}`}>{idx >= 0 ? idx + 1 : '–'} / {captures.length}</span>
            <button className="icon-btn" type="button" onClick={() => setPlaying((v) => !v)} aria-label={playing ? 'Pause stepping' : 'Step through captures'}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
            <button className="icon-btn" type="button" onClick={() => go(idx + 1)} disabled={idx >= captures.length - 1} aria-label="Next capture"><ChevronRight size={18} /></button>
            <button className="icon-btn" type="button" onClick={() => go(captures.length - 1)} aria-label="Last capture"><ChevronLast size={18} /></button>
          </div>
          <p className="hint">
            {mode === 'screenshots' ? 'Screenshot sequence: stepping shows actual screenshots in order. It is not a video. ' : 'Video timeline: seeks the simulated video by presentation timestamp. '}
            Matching tolerance ±{ALIGN_TOLERANCE_MS / 1000} s; clock uncertainty ±{CLOCK_UNCERTAINTY_MS} ms.
          </p>
        </>
      )}
    </div>
  );
}
