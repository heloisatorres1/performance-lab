import { useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { resetDemo, saveRuleset } from '../data/actions';
import { useAppState } from '../data/state';
import { DEFINITIONS } from '../domain/export';
import type { Ruleset } from '../domain/verdict';
import { Callout, Card, Dialog, fmtDate, useToast } from '../components/ui';

const FIELDS: { key: keyof Ruleset; label: string; unit: string; step: number; hint: string }[] = [
  { key: 'minAvgFps', label: 'Minimum average frame rate', unit: 'FPS', step: 0.5, hint: 'Analysis window, warm-up excluded.' },
  { key: 'maxP95FrameMs', label: 'Maximum p95 frame time', unit: 'ms', step: 0.5, hint: 'Nearest-rank on raw frame intervals.' },
  { key: 'belowTargetFps', label: 'Below-target threshold', unit: 'FPS', step: 1, hint: 'A 1 s window below this counts as below target.' },
  { key: 'maxBelowTargetPct', label: 'Maximum time below target', unit: '%', step: 0.5, hint: 'Share of valid 1 s windows.' },
  { key: 'maxPeakMemoryMb', label: 'Maximum peak memory (PSS)', unit: 'MB', step: 10, hint: '1 GB = 1024 MB.' },
  { key: 'minCoverage', label: 'Minimum coverage', unit: '0–1', step: 0.01, hint: 'Below this, the verdict is Incomplete.' },
  { key: 'maxP95IncreaseMs', label: 'Compare: p95 increase allowed', unit: 'ms', step: 0.5, hint: 'Candidate vs baseline.' },
  { key: 'maxAvgFpsDecrease', label: 'Compare: average FPS drop allowed', unit: 'FPS', step: 0.5, hint: 'Candidate vs baseline.' },
  { key: 'maxPeakMemoryIncreaseMb', label: 'Compare: peak memory rise allowed', unit: 'MB', step: 10, hint: 'Candidate vs baseline.' },
];

export function SettingsPage() {
  const s = useAppState();
  const toast = useToast();
  const [draft, setDraft] = useState<Ruleset>(s.ruleset);
  const [confirm, setConfirm] = useState(false);
  const changed = FIELDS.some((f) => draft[f.key] !== s.ruleset[f.key]);
  const invalid = FIELDS.some((f) => !Number.isFinite(draft[f.key] as number) || (draft[f.key] as number) < 0) || draft.minCoverage > 1;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="meta">Threshold rules, measurement definitions and demo data.</div>
        </div>
      </div>
      <div className="split wide-side">
        <div className="stack">
          <Card title={`Ruleset: ${s.ruleset.name} v${s.ruleset.version}`} actions={<span className="subtle">Updated {fmtDate(s.ruleset.updatedAt)}</span>}>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                if (!changed || invalid) return;
                saveRuleset(Object.fromEntries(FIELDS.map((f) => [f.key, draft[f.key]])));
                toast('Saved as a new ruleset version. Reports re-evaluate against it.');
              }}
            >
              <p className="muted">There is no universal benchmark target or safe temperature. These are project rules and are versioned: saving creates a new version and keeps the old one.</p>
              <div className="grid cols-3">
                {FIELDS.map((f) => (
                  <div key={f.key} className="field">
                    <label htmlFor={f.key}>{f.label} ({f.unit})</label>
                    <input id={f.key} className="input num" type="number" step={f.step} min={0} value={draft[f.key] as number} onChange={(e) => setDraft({ ...draft, [f.key]: Number(e.target.value) })} />
                    <span className="hint">{f.hint}</span>
                  </div>
                ))}
              </div>
              {invalid && <Callout tone="bad">Values must be non-negative numbers; coverage is between 0 and 1.</Callout>}
              <div className="row">
                <button className="btn primary" disabled={!changed || invalid}><Save size={16} aria-hidden /> Save as version {s.ruleset.version + 1}</button>
                <button type="button" className="btn ghost" disabled={!changed} onClick={() => setDraft(s.ruleset)}>Discard changes</button>
              </div>
            </form>
          </Card>
          <Card title="Version history" className="flush">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Version</th><th>Updated</th><th className="r">Min avg FPS</th><th className="r">Max p95</th><th className="r">Max below target</th></tr></thead>
                <tbody>
                  {[s.ruleset, ...s.rulesetHistory.slice().reverse()].map((r) => (
                    <tr key={r.version}><td>v{r.version}{r.version === s.ruleset.version ? ' (current)' : ''}</td><td className="subtle">{fmtDate(r.updatedAt)}</td><td className="r num">{r.minAvgFps} FPS</td><td className="r num">{r.maxP95FrameMs} ms</td><td className="r num">{r.maxBelowTargetPct}%</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        <div className="stack">
          <Card title="Measurement definitions">
            <ul className="list">{Object.values(DEFINITIONS).map((d) => <li key={d} style={{ fontSize: 14 }} className="muted">{d}</li>)}</ul>
          </Card>
          <Card title="Demo data">
            <div className="stack-sm">
              <p className="muted">Sessions, rules and publications are kept in this browser's local storage. Fixtures are deterministic: the same seed always produces the same data.</p>
              <button className="btn" onClick={() => setConfirm(true)}><RotateCcw size={16} aria-hidden /> Reset demo</button>
            </div>
          </Card>
        </div>
      </div>
      {confirm && (
        <Dialog title="Reset the demo?" onClose={() => setConfirm(false)}>
          <div className="stack">
            <p className="muted">All sessions you recorded, markers, rule versions and publications in this browser are replaced with the original fixtures.</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn primary" onClick={() => { resetDemo(); setDraft(s.ruleset); setConfirm(false); toast('Demo reset.'); }}>Reset</button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
