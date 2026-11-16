import { PublishError, type ReportPublisher } from './types';

export interface PublicationSnapshot {
  kind: 'report' | 'comparison';
  title: string;
  properties: Record<string, string>;
  summary: string[];
  table?: string[][];
  caveats: string[];
  charts: string[];
  includeRaw: boolean;
  reportLink: string;
}

export type StepStatus = 'pending' | 'done' | 'failed' | 'uncertain';

export interface PublishStep {
  id: string;
  label: string;
  kind: 'page' | 'chart' | 'raw';
  dedupeKey: string;
  status: StepStatus;
  resultId?: string;
}

export interface PublishAttempt {
  at: string;
  step: string;
  outcome: 'done' | 'failed' | 'timeout' | 'reconciled' | 'rate_limited' | 'permission';
  detail: string;
}

export type PublicationStatus = 'pending' | 'published' | 'partial' | 'failed' | 'uncertain';

export interface Publication {
  id: string;
  sourceId: string;
  revision: number;
  destinationId: string;
  destinationName: string;
  /** Frozen at creation. Changed analysis needs a new revision. */
  snapshot: PublicationSnapshot;
  analysisKey: string;
  createdAt: string;
  status: PublicationStatus;
  pageId?: string;
  pageUrl?: string;
  steps: PublishStep[];
  attempts: PublishAttempt[];
}

export function newPublication(input: { id: string; sourceId: string; revision: number; destinationId: string; destinationName: string; snapshot: PublicationSnapshot; analysisKey: string; at: string }): Publication {
  const key = `${input.sourceId}:r${input.revision}:${input.destinationId}`;
  const steps: PublishStep[] = [
    { id: 'page', label: 'Create page', kind: 'page', dedupeKey: `${key}:page`, status: 'pending' },
    ...input.snapshot.charts.map((c, i): PublishStep => ({ id: `chart-${i}`, label: `Upload chart image: ${c}`, kind: 'chart', dedupeKey: `${key}:chart:${i}`, status: 'pending' })),
    ...(input.snapshot.includeRaw ? [{ id: 'raw', label: 'Attach raw data bundle', kind: 'raw' as const, dedupeKey: `${key}:raw`, status: 'pending' as const }] : []),
  ];
  const { at, ...rest } = input;
  return { ...rest, createdAt: at, status: 'pending', steps, attempts: [] };
}

function summarise(steps: PublishStep[]): PublicationStatus {
  const page = steps[0];
  if (page.status === 'uncertain') return 'uncertain';
  if (page.status !== 'done') return page.status === 'failed' ? 'failed' : 'pending';
  if (steps.every((s) => s.status === 'done')) return 'published';
  return steps.some((s) => s.status === 'failed') ? 'partial' : 'pending';
}

/**
 * Runs the remaining steps once, in order. Completed steps are never repeated;
 * an uncertain page is looked up by dedupe key before any new create, so a
 * retry cannot duplicate a page. Stops at the first failure.
 */
export async function runPublication(pub: Publication, publisher: ReportPublisher, now: () => string): Promise<Publication> {
  const steps = pub.steps.map((s) => ({ ...s }));
  const attempts = [...pub.attempts];
  let pageId = pub.pageId;
  let pageUrl = pub.pageUrl;
  for (const step of steps) {
    if (step.status === 'done') continue;
    const at = now();
    try {
      if (step.kind === 'page') {
        if (step.status === 'uncertain') {
          const found = await publisher.findPage(step.dedupeKey);
          if (found) {
            step.status = 'done';
            step.resultId = found.pageId;
            pageId = found.pageId;
            pageUrl = found.url;
            attempts.push({ at, step: step.label, outcome: 'reconciled', detail: `Found ${found.pageId} from the earlier request; nothing re-created.` });
            continue;
          }
        }
        const res = await publisher.createPage({
          dedupeKey: step.dedupeKey,
          destinationId: pub.destinationId,
          title: pub.snapshot.title,
          properties: pub.snapshot.properties,
          blocks: [...pub.snapshot.summary, ...pub.snapshot.caveats.map((c) => `Caveat: ${c}`), `Interactive report: ${pub.snapshot.reportLink}`],
        });
        step.status = 'done';
        step.resultId = res.pageId;
        pageId = res.pageId;
        pageUrl = res.url;
        attempts.push({ at, step: step.label, outcome: 'done', detail: `Created ${res.pageId}.` });
      } else {
        if (!pageId) throw new PublishError('No page to attach to.', 'failed');
        const res = await publisher.uploadAsset({ pageId, dedupeKey: step.dedupeKey, name: step.label, kind: step.kind });
        step.status = 'done';
        step.resultId = res.assetId;
        attempts.push({ at, step: step.label, outcome: 'done', detail: `Uploaded as ${res.assetId}.` });
      }
    } catch (err) {
      const e = err instanceof PublishError ? err : new PublishError(String((err as Error)?.message ?? err), 'failed');
      step.status = e.kind === 'timeout' ? 'uncertain' : 'failed';
      attempts.push({ at, step: step.label, outcome: e.kind === 'timeout' ? 'timeout' : e.kind === 'rate_limited' ? 'rate_limited' : e.kind === 'permission' ? 'permission' : 'failed', detail: e.message });
      break;
    }
  }
  return { ...pub, steps, attempts, pageId, pageUrl, status: summarise(steps) };
}

/** A retry re-runs failed and uncertain steps; done steps stay done. */
export function prepareRetry(pub: Publication): Publication {
  return { ...pub, steps: pub.steps.map((s) => (s.status === 'failed' ? { ...s, status: 'pending' } : s)) };
}
