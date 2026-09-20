import type { MastraCompositeStore } from '@mastra/core/storage';
import type { MastraVector } from '@mastra/core/vector';

export interface RequestContextLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export type MemoryRole = 'user' | 'assistant' | 'system' | 'tool';

export interface MemoryMessage {
  id: string;
  role: MemoryRole;
  content: string;
  createdAt: Date;
  threadId?: string;
  tokens?: number;
  metadata?: Record<string, unknown>;
}

export interface WorkingMemoryOptions {
  maxMessages?: number;
  maxTokens?: number;
}

export type MemoryScope = 'thread' | 'resource';

export interface ObservationRecord {
  id: string;
  threadId?: string;
  resourceId?: string;
  scope: MemoryScope;
  observation: string;
  reflection?: string;
  rawLogsCount?: number;
  cavemanCompressed: boolean;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface ObservationalMemoryOptions {
  caveman?: boolean;
  autoCondenseThreshold?: number;
  scope?: MemoryScope;
}

export interface KnowledgeNode {
  id: string;
  label: string;
  content: string;
  category?: string;
  vector?: number[];
  scope?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface SemanticRecallQueryOptions {
  query: string;
  topK?: number;
  threshold?: number;
  scope?: string;
  category?: string;
}

export interface SemanticRecallResult {
  node: KnowledgeNode;
  score: number;
}

export interface SemanticRecallOptions {
  vector?: MastraVector;
  embedder?: (text: string) => Promise<number[]>;
}

export interface MemoryStoreOptions {
  storage?: MastraCompositeStore;
  vector?: MastraVector;
  workingMemory?: WorkingMemoryOptions;
  observationalMemory?: ObservationalMemoryOptions;
  semanticRecall?: SemanticRecallOptions;
  defaultThreadId?: string;
  defaultResourceId?: string;
}

export interface MemorySummary {
  workingCount: number;
  observationsCount: number;
  knowledgeNodesCount: number;
  scope: MemoryScope;
  cavemanEnabled: boolean;
  threadId?: string;
  resourceId?: string;
}

export interface MemorySearchAllResult {
  working: MemoryMessage[];
  observational: ObservationRecord[];
  semantic: SemanticRecallResult[];
}
