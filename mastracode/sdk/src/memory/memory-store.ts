import { randomUUID } from 'node:crypto';
import { condenseMessagesToCaveman } from './caveman-condenser.js';
import type {
  KnowledgeNode,
  MemoryMessage,
  MemorySearchAllResult,
  MemoryStoreOptions,
  MemorySummary,
  ObservationRecord,
  ObservationalMemoryOptions,
  SemanticRecallQueryOptions,
  SemanticRecallResult,
  WorkingMemoryOptions,
} from './types.js';

/**
 * Calculates cosine similarity between two numeric vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Fallback keyword/token match score when vector embeddings are not available.
 */
function textSimilarityScore(query: string, text: string): number {
  if (!query || !text) return 0;
  const qTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const textLower = text.toLowerCase();

  let matches = 0;
  for (const token of qTokens) {
    if (textLower.includes(token)) {
      matches++;
    }
  }
  return qTokens.length > 0 ? matches / qTokens.length : 0;
}

/**
 * Multi-level MemoryStore managing Working Memory, Observational Memory (Caveman), and Semantic Recall (Knowledge Graph).
 */
export class MemoryStore {
  private workingMemoryMap: Map<string, MemoryMessage[]> = new Map();
  private observations: ObservationRecord[] = [];
  private knowledgeNodes: Map<string, KnowledgeNode> = new Map();

  private workingMemoryOpts: Required<WorkingMemoryOptions>;
  private observationalMemoryOpts: Required<ObservationalMemoryOptions>;
  private options: MemoryStoreOptions;

  constructor(options: MemoryStoreOptions = {}) {
    this.options = options;
    this.workingMemoryOpts = {
      maxMessages: options.workingMemory?.maxMessages ?? 20,
      maxTokens: options.workingMemory?.maxTokens ?? 100_000,
    };
    this.observationalMemoryOpts = {
      caveman: options.observationalMemory?.caveman ?? true,
      autoCondenseThreshold: options.observationalMemory?.autoCondenseThreshold ?? 10,
      scope: options.observationalMemory?.scope ?? 'thread',
    };
  }

  // --- Working Memory Layer ---

  public getWorkingMemory(threadId?: string, opts?: { limit?: number }): MemoryMessage[] {
    const targetThread = threadId ?? this.options.defaultThreadId ?? 'default';
    const messages = this.workingMemoryMap.get(targetThread) ?? [];
    if (opts?.limit && opts.limit > 0) {
      return messages.slice(-opts.limit);
    }
    return [...messages];
  }

  public async addWorkingMessage(
    msg: Omit<MemoryMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: Date },
    threadId?: string,
  ): Promise<MemoryMessage> {
    const targetThread = threadId ?? this.options.defaultThreadId ?? 'default';
    const existing = this.workingMemoryMap.get(targetThread) ?? [];

    const fullMessage: MemoryMessage = {
      id: msg.id ?? randomUUID(),
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt ?? new Date(),
      threadId: targetThread,
      tokens: msg.tokens,
      metadata: msg.metadata,
    };

    existing.push(fullMessage);
    this.workingMemoryMap.set(targetThread, existing);

    // Auto-condense older working memory into Observational Memory when overflow occurs
    const overflowCount = existing.length - this.workingMemoryOpts.maxMessages;
    if (overflowCount > 0 && this.observationalMemoryOpts.autoCondenseThreshold > 0) {
      const messagesToCondense = existing.slice(0, overflowCount);
      const remainingMessages = existing.slice(overflowCount);
      this.workingMemoryMap.set(targetThread, remainingMessages);

      await this.condenseAndStoreObservations(messagesToCondense, {
        threadId: targetThread,
        resourceId: this.options.defaultResourceId,
      });
    }

    return fullMessage;
  }

  public clearWorkingMemory(threadId?: string): void {
    const targetThread = threadId ?? this.options.defaultThreadId ?? 'default';
    this.workingMemoryMap.delete(targetThread);
  }

  public setWorkingMemoryWindowSize(maxMessages: number): void {
    this.workingMemoryOpts.maxMessages = maxMessages;
  }

  // --- Observational Memory Layer ---

  public isCavemanEnabled(): boolean {
    return this.observationalMemoryOpts.caveman;
  }

  public enableCavemanCompression(enabled: boolean): void {
    this.observationalMemoryOpts.caveman = enabled;
  }

  public async addObservation(
    obs: Omit<ObservationRecord, 'id' | 'timestamp'> & { id?: string; timestamp?: Date },
  ): Promise<ObservationRecord> {
    const record: ObservationRecord = {
      id: obs.id ?? randomUUID(),
      threadId: obs.threadId ?? this.options.defaultThreadId,
      resourceId: obs.resourceId ?? this.options.defaultResourceId,
      scope: obs.scope ?? this.observationalMemoryOpts.scope,
      observation: obs.observation,
      reflection: obs.reflection,
      rawLogsCount: obs.rawLogsCount ?? 1,
      cavemanCompressed: obs.cavemanCompressed ?? this.isCavemanEnabled(),
      timestamp: obs.timestamp ?? new Date(),
      metadata: obs.metadata,
    };

    this.observations.push(record);
    return record;
  }

  public getObservations(filter?: {
    threadId?: string;
    resourceId?: string;
    scope?: 'thread' | 'resource';
  }): ObservationRecord[] {
    return this.observations.filter(obs => {
      if (filter?.threadId && obs.threadId !== filter.threadId) return false;
      if (filter?.resourceId && obs.resourceId !== filter.resourceId) return false;
      if (filter?.scope && obs.scope !== filter.scope) return false;
      return true;
    });
  }

  public async condenseAndStoreObservations(
    messages: MemoryMessage[],
    opts?: { threadId?: string; resourceId?: string; forceCaveman?: boolean },
  ): Promise<ObservationRecord> {
    const useCaveman = opts?.forceCaveman ?? this.isCavemanEnabled();
    const condensed = condenseMessagesToCaveman(messages);

    const record = await this.addObservation({
      threadId: opts?.threadId ?? this.options.defaultThreadId,
      resourceId: opts?.resourceId ?? this.options.defaultResourceId,
      scope: opts?.resourceId ? 'resource' : this.observationalMemoryOpts.scope,
      observation: condensed.observation,
      reflection: condensed.reflection,
      rawLogsCount: condensed.count,
      cavemanCompressed: useCaveman,
    });

    return record;
  }

  // --- Semantic Recall Layer (Knowledge Graph) ---

  public async addKnowledgeNode(
    node: Omit<KnowledgeNode, 'id' | 'createdAt'> & { id?: string; createdAt?: Date },
  ): Promise<KnowledgeNode> {
    const id = node.id ?? randomUUID();
    let vector = node.vector;

    // Generate vector embedding if embedder is provided and vector missing
    if (!vector && this.options.semanticRecall?.embedder) {
      try {
        vector = await this.options.semanticRecall.embedder(`${node.label}: ${node.content}`);
      } catch {
        // Embedder fallback
      }
    }

    const fullNode: KnowledgeNode = {
      id,
      label: node.label,
      content: node.content,
      category: node.category,
      vector,
      scope: node.scope,
      resourceId: node.resourceId ?? this.options.defaultResourceId,
      metadata: node.metadata,
      createdAt: node.createdAt ?? new Date(),
    };

    this.knowledgeNodes.set(id, fullNode);
    return fullNode;
  }

  public async querySemanticRecall(
    query: string,
    options?: SemanticRecallQueryOptions,
  ): Promise<SemanticRecallResult[]> {
    const topK = options?.topK ?? 5;
    const threshold = options?.threshold ?? 0.1;

    let queryVector: number[] | undefined;
    if (this.options.semanticRecall?.embedder) {
      try {
        queryVector = await this.options.semanticRecall.embedder(query);
      } catch {
        // Embedder fallback
      }
    }

    const results: SemanticRecallResult[] = [];

    for (const node of this.knowledgeNodes.values()) {
      if (options?.category && node.category !== options.category) continue;
      if (options?.scope && node.scope !== options.scope) continue;

      let score = 0;
      if (queryVector && node.vector) {
        score = cosineSimilarity(queryVector, node.vector);
      } else if (node.vector && options?.query) {
        // If node has vector but query does not have embedded vector, check text
        score = textSimilarityScore(query, `${node.label} ${node.content}`);
      } else {
        score = textSimilarityScore(query, `${node.label} ${node.content}`);
      }

      if (score >= threshold) {
        results.push({ node, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  public getKnowledgeNodes(filter?: { category?: string; resourceId?: string }): KnowledgeNode[] {
    const nodes = Array.from(this.knowledgeNodes.values());
    return nodes.filter(n => {
      if (filter?.category && n.category !== filter.category) return false;
      if (filter?.resourceId && n.resourceId !== filter.resourceId) return false;
      return true;
    });
  }

  public async deleteKnowledgeNode(id: string): Promise<boolean> {
    return this.knowledgeNodes.delete(id);
  }

  // --- Multi-layer Unified Operations ---

  public async searchAllLayers(query: string, threadId?: string): Promise<MemorySearchAllResult> {
    const targetThread = threadId ?? this.options.defaultThreadId ?? 'default';

    // Working memory matching
    const workingMessages = this.getWorkingMemory(targetThread).filter(m =>
      m.content.toLowerCase().includes(query.toLowerCase()),
    );

    // Observational memory matching
    const observational = this.getObservations({ threadId: targetThread }).filter(
      obs =>
        obs.observation.toLowerCase().includes(query.toLowerCase()) ||
        (obs.reflection && obs.reflection.toLowerCase().includes(query.toLowerCase())),
    );

    // Semantic recall matching
    const semantic = await this.querySemanticRecall(query);

    return {
      working: workingMessages,
      observational,
      semantic,
    };
  }

  public async getSummary(threadId?: string): Promise<MemorySummary> {
    const targetThread = threadId ?? this.options.defaultThreadId ?? 'default';
    const workingMessages = this.getWorkingMemory(targetThread);
    const observations = this.getObservations({ threadId: targetThread });

    return {
      workingCount: workingMessages.length,
      observationsCount: observations.length,
      knowledgeNodesCount: this.knowledgeNodes.size,
      scope: this.observationalMemoryOpts.scope,
      cavemanEnabled: this.isCavemanEnabled(),
      threadId: targetThread,
      resourceId: this.options.defaultResourceId,
    };
  }
}
