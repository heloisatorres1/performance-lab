import { mulberry32 } from './simulate';
import type { Capture } from './types';

// Original illustration for the fictional game "Orbit Garden". Each simulated
// capture renders deterministically from its index, scene and level, and is
// marked DEMO so it can never be mistaken for a real screenshot.

const FLOWERS = ['#f2a7c3', '#c9a7f2', '#f6d365', '#ff9f80'];

function plant(x: number, y: number, stage: number, color: string) {
  if (stage === 0) return `<circle cx="${x}" cy="${y + 6}" r="3" fill="#6b4a2f"/>`;
  const stem = `<path d="M${x} ${y + 10} q -1 -10 0 -${6 + stage * 4}" stroke="#3f8f3a" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  const leaves = `<ellipse cx="${x - 6}" cy="${y + 2}" rx="7" ry="4" fill="#57b04f" transform="rotate(-25 ${x - 6} ${y + 2})"/><ellipse cx="${x + 6}" cy="${y}" rx="7" ry="4" fill="#4ea547" transform="rotate(25 ${x + 6} ${y})"/>`;
  if (stage < 3) return stem + leaves;
  const top = y - 6 - stage * 3;
  const petals = [0, 72, 144, 216, 288].map((a) => `<ellipse cx="${x}" cy="${top - 6}" rx="4" ry="7" fill="${color}" transform="rotate(${a} ${x} ${top})"/>`).join('');
  return stem + leaves + petals + `<circle cx="${x}" cy="${top}" r="3.5" fill="#fff4b0"/>`;
}

function hud(level: number, stars: number) {
  return `
  <rect x="12" y="14" width="62" height="24" rx="12" fill="#1d3b2a" opacity="0.85"/>
  <text x="43" y="31" font-family="Segoe UI, sans-serif" font-size="13" font-weight="700" fill="#fff" text-anchor="middle">Lv. ${level}</text>
  <rect x="196" y="14" width="62" height="24" rx="12" fill="#1d3b2a" opacity="0.85"/>
  <path d="M212 19 l3 6 6 1 -4.5 4 1 6 -5.5 -3 -5.5 3 1 -6 -4.5 -4 6 -1z" fill="#ffd34d"/>
  <text x="240" y="31" font-family="Segoe UI, sans-serif" font-size="13" font-weight="700" fill="#fff" text-anchor="middle">${stars}</text>
  <circle cx="40" cy="448" r="18" fill="#1d3b2a" opacity="0.85"/><path d="M33 448 h12 m-12 0 l5 -5 m-5 5 l5 5" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  <circle cx="230" cy="448" r="18" fill="#1d3b2a" opacity="0.85"/><circle cx="230" cy="448" r="6" fill="none" stroke="#fff" stroke-width="2.5"/>`;
}

export function captureSvg(c: Capture, seed = 7): string {
  const rng = mulberry32(seed * 997 + c.level * 31);
  const watermark = `<text x="135" y="472" font-family="Segoe UI, sans-serif" font-size="10" font-weight="700" fill="#ffffff" opacity="0.7" text-anchor="middle">DEMO · simulated capture</text>`;
  if (c.scene === 'loading') {
    const pct = Math.min(1, (c.t % 9000) / 9000 + 0.2);
    return wrap(`<rect width="270" height="480" fill="#13261d"/>
      <circle cx="135" cy="200" r="46" fill="none" stroke="#57b04f" stroke-width="6"/>
      <ellipse cx="135" cy="200" rx="72" ry="16" fill="none" stroke="#9fd8f0" stroke-width="3" transform="rotate(-18 135 200)"/>
      <text x="135" y="290" font-family="Segoe UI, sans-serif" font-size="18" font-weight="700" fill="#e9f5ec" text-anchor="middle">Orbit Garden</text>
      <rect x="60" y="320" width="150" height="8" rx="4" fill="#2c4a3a"/><rect x="60" y="320" width="${150 * pct}" height="8" rx="4" fill="#57b04f"/>
      <text x="135" y="350" font-family="Segoe UI, sans-serif" font-size="12" fill="#b9d6c2" text-anchor="middle">Loading garden…</text>${watermark}`);
  }
  const greenhouse = c.scene === 'greenhouse';
  const bg = greenhouse
    ? `<rect width="270" height="480" fill="#d7eef0"/>
       ${[0, 1, 2, 3].map((i) => `<rect x="${8 + i * 64}" y="40" width="58" height="160" fill="#eaf8f9" stroke="#7fb3b8" stroke-width="3"/>`).join('')}
       <path d="M0 40 L135 0 L270 40" fill="none" stroke="#7fb3b8" stroke-width="4"/>
       <rect y="200" width="270" height="280" fill="#cfe3c8"/>`
    : `<rect width="270" height="480" fill="#bfe7f5"/>
       <ellipse cx="200" cy="70" rx="58" ry="12" fill="none" stroke="#e7f6ff" stroke-width="5" transform="rotate(-12 200 70)"/>
       <circle cx="200" cy="70" r="20" fill="#9fd8f0"/>
       <ellipse cx="40" cy="190" rx="70" ry="50" fill="#4e9a48"/><ellipse cx="240" cy="180" rx="70" ry="55" fill="#468f41"/>
       <rect y="190" width="270" height="290" fill="#86c46f"/>
       <ellipse cx="135" cy="300" rx="125" ry="105" fill="#d9cdb4"/>`;
  const plots: string[] = [];
  for (let r = 0; r < 3; r++) {
    for (let col = 0; col < 3; col++) {
      const x = 75 + col * 60;
      const y = 245 + r * 52;
      const i = r * 3 + col;
      const stage = (Math.floor(c.index / 3) + i * 2 + Math.floor(rng() * 2)) % 5;
      plots.push(`<rect x="${x - 26}" y="${y - 22}" width="52" height="46" rx="8" fill="${greenhouse ? '#8a6a4a' : '#7a5636'}" stroke="#5b3f27" stroke-width="2"/>`);
      plots.push(plant(x, y, stage, FLOWERS[(i + c.level) % FLOWERS.length]));
    }
  }
  return wrap(bg + plots.join('') + hud(c.level, 8 + Math.floor(c.index / 5) % 40) + watermark);
}

function wrap(inner: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480" width="270" height="480">${inner}</svg>`;
}

export const captureDataUrl = (c: Capture, seed?: number) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(captureSvg(c, seed))}`;
