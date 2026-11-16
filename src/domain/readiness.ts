import { BOT_SCRIPTS, METRICS, build, compareVersions, device } from './catalog';
import type { SessionConfig } from './types';

export interface ReadinessCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'na';
  detail: string;
}

/** Simulated device storage for the demo profile. */
export const DEMO_FREE_STORAGE_MB = 2450;

export function estimateStorageMb(c: SessionConfig) {
  const telemetry = (c.durationSec * c.metrics.length * 40) / 1024 / 1024 + c.durationSec * 60 * 16 / 1024 / 1024;
  const captures = c.capture === 'screenshots' ? (c.durationSec / c.captureIntervalSec) * 0.25 : c.capture === 'video' ? c.durationSec * 0.6 : 0;
  return Math.ceil(telemetry + captures + 2);
}

/** Valid combinations come from the device profile, not from the UI. */
export function combinationProblems(c: SessionConfig): string[] {
  const d = device(c.deviceId);
  if (!d) return ['Choose a device.'];
  const out: string[] = [];
  if (d.collector === 'not-implemented') out.push(`${d.name}: no collector is implemented for ${d.platform === 'ios' ? 'iOS' : d.platform} yet.`);
  if (!d.connections.includes(c.connection)) out.push(`${c.connection === 'usb' ? 'USB' : 'Wireless'} is not available on ${d.name}.`);
  else if (!d.captures[c.connection].includes(c.capture)) out.push(`${c.capture === 'video' ? 'Video' : c.capture === 'screenshots' ? 'Screenshots' : 'No capture'} is not supported over ${c.connection === 'usb' ? 'USB' : 'wireless'} on ${d.name}.`);
  if (c.playMode === 'bot' && !d.botSupported) out.push(`Scripted play is not supported on ${d.name}.`);
  if (c.warmupSec >= c.durationSec) out.push('Warm-up must be shorter than the duration.');
  return out;
}

export function readiness(c: SessionConfig): ReadinessCheck[] {
  const d = device(c.deviceId);
  const b = build(c.buildId);
  const checks: ReadinessCheck[] = [];
  if (!d) return [{ id: 'device', label: 'Device paired', status: 'fail', detail: 'Choose a device.' }];
  const implemented = d.collector === 'simulated';
  checks.push({
    id: 'device',
    label: 'Device paired',
    status: implemented ? 'pass' : 'fail',
    detail: implemented ? `${d.name} (simulated profile) over ${c.connection === 'usb' ? 'USB' : 'wireless'}.` : 'No collector for this platform yet.',
  });
  checks.push({ id: 'game', label: 'Game identified', status: b ? 'pass' : 'fail', detail: b ? `Orbit Garden ${b.version} (com.example.orbitgarden).` : 'Choose a build.' });

  const unavailable = c.metrics.filter((m) => d.metrics[m] !== 'supported');
  checks.push({
    id: 'collectors',
    label: 'Collectors and permissions',
    status: !implemented ? 'fail' : unavailable.length ? 'warn' : 'pass',
    detail: unavailable.length
      ? `${unavailable.map((m) => `${METRICS[m].label} (${d.metrics[m]})`).join(', ')} will not be recorded.`
      : 'All selected metrics are available on this profile.',
  });

  const need = estimateStorageMb(c);
  checks.push({ id: 'storage', label: 'Storage available', status: need < DEMO_FREE_STORAGE_MB ? 'pass' : 'fail', detail: `~${(DEMO_FREE_STORAGE_MB / 1024).toFixed(1)} GB free, estimated need ~${need} MB.` });

  const capOk = d.captures[c.connection]?.includes(c.capture);
  checks.push({
    id: 'capture',
    label: 'Capture support',
    status: c.capture === 'off' ? 'na' : capOk ? 'pass' : 'fail',
    detail: c.capture === 'off' ? 'Screen capture is off.' : capOk ? `${c.capture === 'video' ? 'Video' : `Screenshots every ${c.captureIntervalSec} s (requested; actual intervals are recorded)`}.` : 'Not supported for this connection.',
  });

  if (c.playMode === 'bot') {
    const s = BOT_SCRIPTS.find((x) => x.id === c.botScriptId);
    const inRange = !!s && !!b && compareVersions(b.version, s.buildRange[0]) >= 0 && compareVersions(b.version, s.buildRange[1]) <= 0;
    checks.push({
      id: 'bot',
      label: 'Bot script validated',
      status: s && inRange && d.botSupported ? 'pass' : 'fail',
      detail: !s ? 'Choose a script.' : !inRange ? `${s.name} v${s.version} supports builds ${s.buildRange[0]}–${s.buildRange[1]}.` : `${s.name} v${s.version}, ${s.actions.length} actions, ${s.timeoutSec} s checkpoint timeout.`,
    });
  }
  if (c.metrics.includes('battery')) {
    const fb = c.fixtureBattery;
    checks.push({
      id: 'power',
      label: 'Power state',
      status: fb?.charging ? 'warn' : 'pass',
      detail: fb ? `Simulated reading: ${fb.startLevel}%, ${fb.charging ? 'charging (discharge analysis will be invalid)' : 'not charging'}.` : 'Read from the collector at start.',
    });
  }
  return checks;
}

export const isReady = (checks: ReadinessCheck[]) => checks.every((c) => c.status !== 'fail');
