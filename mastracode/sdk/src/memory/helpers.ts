import { MemoryStore } from './memory-store.js';
import type {
  MemorySearchAllResult,
  MemoryStoreOptions,
  MemorySummary,
  ObservationRecord,
  RequestContextLike,
} from './types.js';

/**
 * Factory helper to instantiate MemoryStore with default or custom options.
 */
export function createMemoryStore(options?: MemoryStoreOptions): MemoryStore {
  return new MemoryStore(options);
}

/**
 * Helper to retrieve a MemoryStore instance attached to a RequestContext.
 */
export function getMemoryStoreFromContext(requestContext?: RequestContextLike): MemoryStore | undefined {
  if (!requestContext) return undefined;
  return requestContext.get('memoryStore') as MemoryStore | undefined;
}

/**
 * Attaches a MemoryStore instance to a RequestContext for downstream access.
 */
export function attachMemoryStoreToContext(requestContext: RequestContextLike, store: MemoryStore): void {
  requestContext.set('memoryStore', store);
}

/**
 * Formats a list of Observational Memory records into a clean Caveman text summary for TUI or Factory UI rendering.
 */
export function formatCavemanSummary(observations: ObservationRecord[]): string {
  if (!observations || observations.length === 0) {
    return 'No historical observations.';
  }

  const lines: string[] = ['=== CAVEMAN OBSERVATIONS SUMMARY ==='];
  for (const obs of observations) {
    const scopeBadge = obs.scope === 'resource' ? '[RESOURCE]' : '[THREAD]';
    lines.push(`• ${scopeBadge} ${obs.observation}`);
    if (obs.reflection) {
      lines.push(`  ↳ Reflection: ${obs.reflection}`);
    }
  }

  return lines.join('\n');
}

/**
 * Helper hook for Factory UI and TUI to fetch multi-layer memory state.
 */
export async function getMemoryStoreState(store: MemoryStore, threadId?: string): Promise<MemorySummary> {
  return store.getSummary(threadId);
}

/**
 * Helper hook for Factory UI and TUI to perform multi-layer unified memory search.
 */
export async function searchMemoryLayers(
  store: MemoryStore,
  query: string,
  threadId?: string,
): Promise<MemorySearchAllResult> {
  return store.searchAllLayers(query, threadId);
}
