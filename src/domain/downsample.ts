// Display-only decimation. Each bucket keeps its minimum and maximum so short
// spikes stay visible. Report numbers never come from this output.

export interface Point {
  t: number;
  v: number | null;
}

export function minMaxDecimate(ts: ArrayLike<number>, vs: ArrayLike<number | null>, fromMs: number, toMs: number, buckets: number): Point[] {
  const span = toMs - fromMs;
  if (span <= 0 || buckets <= 0) return [];
  const width = span / buckets;
  const out: Point[] = [];
  let b = -1;
  let minV = 0;
  let maxV = 0;
  let minT = 0;
  let maxT = 0;
  let has = false;
  let lastT = -Infinity;
  const flush = () => {
    if (!has) return;
    if (minT <= maxT) out.push({ t: minT, v: minV }, { t: maxT, v: maxV });
    else out.push({ t: maxT, v: maxV }, { t: minT, v: minV });
  };
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t < fromMs || t > toMs) continue;
    const v = vs[i];
    if (v === null) {
      flush();
      has = false;
      out.push({ t, v: null });
      continue;
    }
    // A long silence between observations is a gap: break the line.
    if (t - lastT > Math.max(3000, width * 3) && lastT !== -Infinity) {
      flush();
      has = false;
      out.push({ t: lastT + 1, v: null });
    }
    lastT = t;
    const nb = Math.floor((t - fromMs) / width);
    if (nb !== b || !has) {
      flush();
      b = nb;
      has = true;
      minV = maxV = v;
      minT = maxT = t;
      continue;
    }
    if (v < minV) {
      minV = v;
      minT = t;
    }
    if (v > maxV) {
      maxV = v;
      maxT = t;
    }
  }
  flush();
  return out;
}
