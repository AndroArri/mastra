/**
 * Parallel invocation & orchestration engine for subagents with
 * execution context isolation and real-time execution tree tracking.
 */

import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@mastra/core/request-context';
import { SubagentModelRouter, defaultSubagentModelRouter } from './subagent-routing.js';
import type { KnownAgentType } from './subagent-routing.js';

export type SubagentExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SubagentExecutionNode {
  id: string;
  parentId?: string;
  agentType: KnownAgentType;
  task: string;
  status: SubagentExecutionStatus;
  modelId?: string;
  startTime: number;
  endTime?: number;
  result?: unknown;
  error?: string;
  /** Isolated execution context snapshot for this subagent instance */
  context: Record<string, unknown>;
  /** Child execution nodes spawned by this subagent */
  children: SubagentExecutionNode[];
}

export type SubagentExecutor = (
  node: SubagentExecutionNode,
  isolatedContext: Record<string, unknown>,
) => Promise<unknown>;

export interface SubagentTaskConfig {
  id?: string;
  parentId?: string;
  agentType: KnownAgentType;
  task: string;
  context?: Record<string, unknown>;
  modelId?: string;
  requestContext?: RequestContext;
  executor?: SubagentExecutor;
}

/**
 * Deep clones execution context to ensure execution isolation
 * between concurrent subagent invocations.
 */
export function isolateContext(context?: Record<string, unknown>): Record<string, unknown> {
  if (!context) return {};
  try {
    return structuredClone(context);
  } catch {
    // Fallback shallow clone + nested object copies if structuredClone fails on non-serializable elements
    const isolated: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(context)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        isolated[key] = { ...val };
      } else if (Array.isArray(val)) {
        isolated[key] = [...val];
      } else {
        isolated[key] = val;
      }
    }
    return isolated;
  }
}

export type ExecutionTreeListener = (tree: SubagentExecutionNode[]) => void;

export class SubagentOrchestrator {
  private nodesMap: Map<string, SubagentExecutionNode> = new Map();
  private rootNodeIds: Set<string> = new Set();
  private modelRouter: SubagentModelRouter;
  private defaultExecutor?: SubagentExecutor;
  private listeners: Set<ExecutionTreeListener> = new Set();

  constructor(options?: { modelRouter?: SubagentModelRouter; defaultExecutor?: SubagentExecutor }) {
    this.modelRouter = options?.modelRouter ?? defaultSubagentModelRouter;
    this.defaultExecutor = options?.defaultExecutor;
  }

  /**
   * Subscribe to execution tree state updates in real time.
   */
  subscribe(listener: ExecutionTreeListener): () => void {
    this.listeners.add(listener);
    // Initial emit
    listener(this.getExecutionTree());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const treeSnapshot = this.getExecutionTree();
    for (const listener of this.listeners) {
      try {
        listener(treeSnapshot);
      } catch {
        // Prevent listener errors from stopping orchestration
      }
    }
  }

  /**
   * Returns the current root-level hierarchy of the execution tree.
   */
  getExecutionTree(): SubagentExecutionNode[] {
    const roots: SubagentExecutionNode[] = [];
    for (const rootId of this.rootNodeIds) {
      const rootNode = this.nodesMap.get(rootId);
      if (rootNode) {
        roots.push(this.cloneNodeHierarchy(rootNode));
      }
    }
    return roots;
  }

  /**
   * Retrieve a specific node by ID.
   */
  getNode(id: string): SubagentExecutionNode | undefined {
    const node = this.nodesMap.get(id);
    return node ? this.cloneNodeHierarchy(node) : undefined;
  }

  /**
   * Invoke a single subagent with context isolation and state tracking.
   */
  async invokeSubagent(config: SubagentTaskConfig): Promise<SubagentExecutionNode> {
    const id = config.id ?? randomUUID();
    const isolatedCtx = isolateContext(config.context);
    const resolvedModelId = this.modelRouter.resolveModelIdForAgent(config.agentType, config.modelId);

    const node: SubagentExecutionNode = {
      id,
      parentId: config.parentId,
      agentType: config.agentType,
      task: config.task,
      status: 'running',
      modelId: resolvedModelId,
      startTime: Date.now(),
      context: isolatedCtx,
      children: [],
    };

    this.nodesMap.set(id, node);

    if (config.parentId && this.nodesMap.has(config.parentId)) {
      const parentNode = this.nodesMap.get(config.parentId)!;
      parentNode.children.push(node);
    } else {
      this.rootNodeIds.add(id);
    }

    this.notifyListeners();

    const executor = config.executor ?? this.defaultExecutor;

    try {
      if (!executor) {
        // Default simulated successful execution when no custom executor provided
        node.result = `Subagent [${config.agentType}] completed task: ${config.task}`;
      } else {
        node.result = await executor(node, isolatedCtx);
      }
      node.status = 'completed';
    } catch (err: any) {
      node.status = 'failed';
      node.error = err?.message ?? String(err);
    } finally {
      node.endTime = Date.now();
      this.notifyListeners();
    }

    return this.cloneNodeHierarchy(node);
  }

  /**
   * Invoke multiple subagents in parallel with isolated execution contexts.
   */
  async invokeParallel(configs: SubagentTaskConfig[]): Promise<SubagentExecutionNode[]> {
    const promises = configs.map(config => this.invokeSubagent(config));
    return Promise.all(promises);
  }

  /**
   * Clear recorded tree execution state.
   */
  reset(): void {
    this.nodesMap.clear();
    this.rootNodeIds.clear();
    this.notifyListeners();
  }

  private cloneNodeHierarchy(node: SubagentExecutionNode): SubagentExecutionNode {
    return {
      ...node,
      context: isolateContext(node.context),
      children: node.children.map(child => this.cloneNodeHierarchy(child)),
    };
  }
}
