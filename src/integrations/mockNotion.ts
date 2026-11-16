import { PublishError, type ReportPublisher } from './types';

// In-memory stand-in for a Notion database. It never touches the network.

export interface NotionFaults {
  permissionNext: boolean;
  rateLimitNext: boolean;
  /** The next page is created remotely but the response times out. */
  timeoutNext: boolean;
  assetFailNext: boolean;
}

export interface MockNotionState {
  seq: number;
  pages: { pageId: string; dedupeKey: string; destinationId: string; title: string; properties: Record<string, string>; blocks: string[]; url: string }[];
  assets: { assetId: string; pageId: string; dedupeKey: string; name: string; kind: 'chart' | 'raw' }[];
  faults: NotionFaults;
}

export const noNotionFaults = (): NotionFaults => ({ permissionNext: false, rateLimitNext: false, timeoutNext: false, assetFailNext: false });
export const emptyNotion = (): MockNotionState => ({ seq: 0, pages: [], assets: [], faults: noNotionFaults() });

export interface NotionAccess {
  get(): MockNotionState;
  set(next: MockNotionState): void;
}

export function createMockNotion(access: NotionAccess): ReportPublisher {
  return {
    name: 'Demo Notion (simulated)',
    async createPage(input) {
      const r = access.get();
      if (r.faults.permissionNext) {
        access.set({ ...r, faults: { ...r.faults, permissionNext: false } });
        throw new PublishError('The integration has no access to this database (simulated 403). Share the database with the integration and retry.', 'permission');
      }
      if (r.faults.rateLimitNext) {
        access.set({ ...r, faults: { ...r.faults, rateLimitNext: false } });
        throw new PublishError('Rate limited (simulated 429). Retry after 1 s.', 'rate_limited', 1000);
      }
      const existing = r.pages.find((p) => p.dedupeKey === input.dedupeKey);
      if (existing) return { pageId: existing.pageId, url: existing.url };
      const seq = r.seq + 1;
      const pageId = `page-${String(seq).padStart(4, '0')}`;
      const url = `https://notion.example.com/${pageId}`;
      const timeout = r.faults.timeoutNext;
      access.set({
        ...r,
        seq,
        pages: [...r.pages, { pageId, url, ...input }],
        faults: timeout ? { ...r.faults, timeoutNext: false } : r.faults,
      });
      if (timeout) throw new PublishError('No response after 10 s (simulated). The page may exist.', 'timeout');
      return { pageId, url };
    },
    async findPage(dedupeKey) {
      const p = access.get().pages.find((x) => x.dedupeKey === dedupeKey);
      return p ? { pageId: p.pageId, url: p.url } : null;
    },
    async uploadAsset(input) {
      const r = access.get();
      if (r.faults.assetFailNext) {
        access.set({ ...r, faults: { ...r.faults, assetFailNext: false } });
        throw new PublishError(`Upload of ${input.name} failed (simulated 502).`, 'failed');
      }
      const existing = r.assets.find((a) => a.dedupeKey === input.dedupeKey);
      if (existing) return { assetId: existing.assetId };
      const seq = r.seq + 1;
      const assetId = `asset-${String(seq).padStart(4, '0')}`;
      access.set({ ...r, seq, assets: [...r.assets, { assetId, ...input }] });
      return { assetId };
    },
  };
}
