import { describe, expect, it, vi } from 'vitest';
import {
  attachMemoryStoreToContext,
  compressToCaveman,
  createMemoryStore,
  formatCavemanSummary,
  getMemoryStoreFromContext,
  getMemoryStoreState,
  searchMemoryLayers,
} from '../index.js';

describe('MemoryStore Multi-Level (Issue #16)', () => {
  describe('Layer 1: Working Memory', () => {
    it('stores and retrieves working memory messages for a session thread', async () => {
      const store = createMemoryStore({ defaultThreadId: 'thread-alpha' });

      await store.addWorkingMessage({ role: 'user', content: 'How do I setup Auth?' });
      await store.addWorkingMessage({ role: 'assistant', content: 'Use the AuthStorage module.' });

      const messages = store.getWorkingMemory('thread-alpha');
      expect(messages).toHaveLength(2);
      expect(messages[0]?.content).toBe('How do I setup Auth?');
      expect(messages[1]?.content).toBe('Use the AuthStorage module.');
    });

    it('respects window limit options', async () => {
      const store = createMemoryStore({ defaultThreadId: 'thread-alpha' });

      await store.addWorkingMessage({ role: 'user', content: 'Msg 1' });
      await store.addWorkingMessage({ role: 'assistant', content: 'Msg 2' });
      await store.addWorkingMessage({ role: 'user', content: 'Msg 3' });

      const limited = store.getWorkingMemory('thread-alpha', { limit: 2 });
      expect(limited).toHaveLength(2);
      expect(limited[0]?.content).toBe('Msg 2');
      expect(limited[1]?.content).toBe('Msg 3');
    });

    it('clears working memory for a specified thread', async () => {
      const store = createMemoryStore();
      await store.addWorkingMessage({ role: 'user', content: 'Hello' }, 't1');
      await store.addWorkingMessage({ role: 'user', content: 'World' }, 't2');

      store.clearWorkingMemory('t1');
      expect(store.getWorkingMemory('t1')).toHaveLength(0);
      expect(store.getWorkingMemory('t2')).toHaveLength(1);
    });

    it('automatically condenses overflow working memory into Observational Memory', async () => {
      const store = createMemoryStore({
        workingMemory: { maxMessages: 3 },
        observationalMemory: { autoCondenseThreshold: 1, caveman: true },
        defaultThreadId: 't-overflow',
      });

      await store.addWorkingMessage({ role: 'user', content: 'Sure! Basically I want to fix a bug in auth middleware.' });
      await store.addWorkingMessage({ role: 'assistant', content: 'I will analyze the token expiry logic now.' });
      await store.addWorkingMessage({ role: 'user', content: 'Great, thank you.' });

      expect(store.getWorkingMemory('t-overflow')).toHaveLength(3);
      expect(store.getObservations({ threadId: 't-overflow' })).toHaveLength(0);

      // Add 4th message -> triggers window overflow and auto-condenses first message into Observational Memory
      await store.addWorkingMessage({ role: 'assistant', content: 'Fix applied.' });

      expect(store.getWorkingMemory('t-overflow')).toHaveLength(3);
      const observations = store.getObservations({ threadId: 't-overflow' });
      expect(observations).toHaveLength(1);
      expect(observations[0]?.cavemanCompressed).toBe(true);
      expect(observations[0]?.observation).toContain('user ask: I want to fix bug in auth middleware.');
    });
  });

  describe('Layer 2: Observational Memory & Caveman Condensation', () => {
    it('compresses verbose responses into terse Caveman style', () => {
      const verboseText = `Sure! I would be happy to help you with that. The issue you are experiencing is basically a bug in auth middleware. Token expiry check use < not <=.`;
      const caveman = compressToCaveman(verboseText);

      expect(caveman).not.toContain('Sure!');
      expect(caveman).not.toContain('happy to help');
      expect(caveman).not.toContain('basically');
      expect(caveman).toContain('Issue you are experiencing is bug in auth middleware.');
    });

    it('condenses session message history into caveman observation records', async () => {
      const store = createMemoryStore({ defaultThreadId: 'thread-obs' });

      const record = await store.condenseAndStoreObservations(
        [
          { id: '1', role: 'user', content: 'Why does React component rerender?', createdAt: new Date() },
          { id: '2', role: 'assistant', content: 'Certainly! Saw inline object prop create new ref.', createdAt: new Date() },
        ],
        { threadId: 'thread-obs', forceCaveman: true },
      );

      expect(record.cavemanCompressed).toBe(true);
      expect(record.rawLogsCount).toBe(2);
      expect(record.observation).toContain('user ask: Why does React component rerender?');
      expect(record.observation).toContain('did: Saw inline object prop create new ref.');
    });

    it('allows toggling caveman compression state', () => {
      const store = createMemoryStore({ observationalMemory: { caveman: true } });
      expect(store.isCavemanEnabled()).toBe(true);

      store.enableCavemanCompression(false);
      expect(store.isCavemanEnabled()).toBe(false);
    });

    it('filters observations by scope, threadId, and resourceId', async () => {
      const store = createMemoryStore();

      await store.addObservation({
        threadId: 't1',
        scope: 'thread',
        observation: 'Thread observation 1',
        cavemanCompressed: true,
      });

      await store.addObservation({
        resourceId: 'res-project-x',
        scope: 'resource',
        observation: 'Resource observation X',
        cavemanCompressed: true,
      });

      const threadObs = store.getObservations({ threadId: 't1' });
      expect(threadObs).toHaveLength(1);
      expect(threadObs[0]?.observation).toBe('Thread observation 1');

      const resourceObs = store.getObservations({ scope: 'resource' });
      expect(resourceObs).toHaveLength(1);
      expect(resourceObs[0]?.resourceId).toBe('res-project-x');
    });
  });

  describe('Layer 3: Semantic Recall (Knowledge Graph & Vector Search)', () => {
    it('adds knowledge nodes and queries them with semantic search scoring', async () => {
      const store = createMemoryStore();

      await store.addKnowledgeNode({
        label: 'Auth Module',
        content: 'JWT token authentication service with LibSQL persistence.',
        category: 'architecture',
      });

      await store.addKnowledgeNode({
        label: 'UI Components',
        content: 'React components for TUI and Factory UI rendered with Tailwind.',
        category: 'frontend',
      });

      const results = await store.querySemanticRecall('token authentication', { category: 'architecture' });
      expect(results).toHaveLength(1);
      expect(results[0]?.node.label).toBe('Auth Module');
      expect(results[0]?.score).toBeGreaterThan(0);
    });

    it('uses vector embedder when provided for vector similarity search', async () => {
      const embedderMock = vi.fn(async (text: string) => {
        if (text.includes('Database Schema') || text.includes('sql database')) return [0.9, 0.1, 0];
        return [0.1, 0.9, 0];
      });

      const store = createMemoryStore({
        semanticRecall: { embedder: embedderMock },
      });

      await store.addKnowledgeNode({
        label: 'Database Schema',
        content: 'LibSQL database tables and indexes for Mastra store.',
        vector: [0.9, 0.1, 0],
      });

      await store.addKnowledgeNode({
        label: 'CSS Styling',
        content: 'Tailwind CSS classes for styling buttons.',
        vector: [0.1, 0.9, 0],
      });

      const results = await store.querySemanticRecall('sql database', { threshold: 0 });
      expect(results).toHaveLength(2);
      expect(results[0]?.node.label).toBe('Database Schema');
      expect(results[0]?.score).toBeGreaterThan(0.8);
    });

    it('allows deleting knowledge nodes', async () => {
      const store = createMemoryStore();
      const node = await store.addKnowledgeNode({ label: 'Temp Node', content: 'Temporary content' });

      expect(store.getKnowledgeNodes()).toHaveLength(1);
      const deleted = await store.deleteKnowledgeNode(node.id);
      expect(deleted).toBe(true);
      expect(store.getKnowledgeNodes()).toHaveLength(0);
    });
  });

  describe('Unified Search and Factory UI / TUI Helpers', () => {
    it('performs unified search across all 3 memory layers', async () => {
      const store = createMemoryStore({ defaultThreadId: 't-unified' });

      await store.addWorkingMessage({ role: 'user', content: 'How to configure OAuth gateway?' });
      await store.addObservation({
        threadId: 't-unified',
        observation: 'OAuth gateway requires MASTRA_GATEWAY_API_KEY environment variable.',
        scope: 'thread',
        cavemanCompressed: true,
      });
      await store.addKnowledgeNode({
        label: 'OAuth Gateway',
        content: 'Mastra OAuth gateway handles authentication routes.',
      });

      const results = await searchMemoryLayers(store, 'OAuth gateway', 't-unified');

      expect(results.working).toHaveLength(1);
      expect(results.observational).toHaveLength(1);
      expect(results.semantic).toHaveLength(1);
      expect(results.semantic[0]?.node.label).toBe('OAuth Gateway');
    });

    it('formats caveman observations summary for UI rendering', async () => {
      const store = createMemoryStore();
      await store.addObservation({
        scope: 'thread',
        observation: 'Bug in auth middleware. Token expiry fix applied.',
        reflection: 'Verified with vitest.',
        cavemanCompressed: true,
      });

      const summaryText = formatCavemanSummary(store.getObservations());
      expect(summaryText).toContain('CAVEMAN OBSERVATIONS SUMMARY');
      expect(summaryText).toContain('Bug in auth middleware.');
      expect(summaryText).toContain('Verified with vitest.');
    });

    it('attaches and retrieves MemoryStore from RequestContext-like object', async () => {
      const store = createMemoryStore();
      const storeMap = new Map<string, unknown>();
      const ctx = {
        get: (k: string) => storeMap.get(k),
        set: (k: string, v: unknown) => storeMap.set(k, v),
      };

      attachMemoryStoreToContext(ctx, store);
      const retrieved = getMemoryStoreFromContext(ctx);

      expect(retrieved).toBe(store);
      const state = await getMemoryStoreState(store, 't1');
      expect(state.cavemanEnabled).toBe(true);
    });
  });
});
