import type { SessionState } from './types';

/**
 * draft → checking → ready → starting → recording → stopping → processing → complete,
 * with failed / cancelled / interrupted branches. Terminal states never
 * resume: a continuation is a new session that records the gap.
 */
export const TRANSITIONS: Record<SessionState, SessionState[]> = {
  draft: ['checking', 'cancelled'],
  checking: ['ready', 'draft', 'failed'],
  ready: ['starting', 'draft', 'cancelled'],
  starting: ['recording', 'failed', 'cancelled'],
  recording: ['stopping', 'interrupted', 'failed', 'cancelled'],
  stopping: ['processing', 'failed'],
  processing: ['complete', 'failed'],
  complete: [],
  failed: [],
  cancelled: [],
  interrupted: [],
};

export const TERMINAL: SessionState[] = ['complete', 'failed', 'cancelled', 'interrupted'];

export function canTransition(from: SessionState, to: SessionState) {
  return TRANSITIONS[from].includes(to);
}

export function transition<T extends { state: SessionState }>(s: T, to: SessionState): T {
  if (!canTransition(s.state, to)) throw new Error(`Invalid session transition: ${s.state} → ${to}`);
  return { ...s, state: to };
}

export const STATE_LABEL: Record<SessionState, string> = {
  draft: 'Draft',
  checking: 'Checking',
  ready: 'Ready',
  starting: 'Starting',
  recording: 'Recording',
  stopping: 'Stopping',
  processing: 'Processing',
  complete: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
};
