/**
 * Deterministic Test Harness & Evals for Mastra's 10 Core Primitives.
 * 
 * Provides mock-isolated evaluation utilities for:
 * 1. Agent
 * 2. Tool
 * 3. Workflow
 * 4. Memory
 * 5. Voice
 * 6. Storage/Sync
 * 7. RAG/Vector/Embeddings
 * 8. Observability/Tracer
 * 9. Evals
 * 10. MCP/ACP Protocol
 */

export type MastraPrimitiveType =
  | 'agent'
  | 'tool'
  | 'workflow'
  | 'memory'
  | 'voice'
  | 'storage'
  | 'rag'
  | 'observability'
  | 'evals'
  | 'mcp';

export interface PrimitiveEvalInput<T = unknown> {
  primitive: MastraPrimitiveType;
  inputData: T;
  expectedOutput?: unknown;
  metadata?: Record<string, unknown>;
}

export interface MastraPrimitiveEvalResult {
  primitive: MastraPrimitiveType;
  passed: boolean;
  score: number; // 0.0 to 1.0
  latencyMs: number;
  deterministic: boolean;
  details: Record<string, unknown>;
}

export class DeterministicPrimitiveHarness {
  private mocks: Map<MastraPrimitiveType, (input: unknown) => unknown> = new Map();

  constructor() {
    this.registerDefaultMocks();
  }

  private registerDefaultMocks() {
    // 1. Agent Primitive Mock
    this.mocks.set('agent', (input) => ({
      status: 'completed',
      output: typeof input === 'string' ? `[Mock Agent Response] to "${input}"` : { response: 'Deterministic Agent Output' },
      tokensUsed: 42,
    }));

    // 2. Tool Primitive Mock
    this.mocks.set('tool', (input) => ({
      success: true,
      result: input ? { executed: true, params: input } : { status: 'ok' },
    }));

    // 3. Workflow Primitive Mock
    this.mocks.set('workflow', (input) => ({
      state: 'finished',
      stepsCompleted: ['step-1', 'step-2'],
      output: input ?? { workflowResult: 'success' },
    }));

    // 4. Memory Primitive Mock
    this.mocks.set('memory', (input) => ({
      recalledMessages: [
        { role: 'user', content: 'Previous context' },
        { role: 'assistant', content: 'Remembered response' },
      ],
      query: input,
    }));

    // 5. Voice Primitive Mock
    this.mocks.set('voice', (input) => ({
      audioUrl: 'mock://audio-stream.wav',
      transcript: typeof input === 'string' ? input : 'Deterministic spoken text',
    }));

    // 6. Storage/Sync Primitive Mock
    this.mocks.set('storage', (input) => ({
      synced: true,
      recordId: 'mock-rec-123',
      storedData: input,
    }));

    // 7. RAG/Vector/Embeddings Primitive Mock
    this.mocks.set('rag', (input) => ({
      matches: [
        { id: 'doc-1', score: 0.95, text: 'Relevant document snippet' },
        { id: 'doc-2', score: 0.88, text: 'Secondary doc match' },
      ],
      embedding: Array(1536).fill(0.01),
      query: input,
    }));

    // 8. Observability/Tracer Primitive Mock
    this.mocks.set('observability', (input) => ({
      traceId: 'trace-deterministic-0001',
      spans: [
        { spanId: 'span-1', name: 'agent.run', durationMs: 12 },
        { spanId: 'span-2', name: 'tool.execute', durationMs: 5 },
      ],
      input,
    }));

    // 9. Evals Primitive Mock
    this.mocks.set('evals', (input) => ({
      evaluated: true,
      score: 1.0,
      reasons: ['Output meets criteria', 'Deterministic match'],
      input,
    }));

    // 10. MCP/ACP Primitive Mock
    this.mocks.set('mcp', (input) => ({
      connected: true,
      toolsDiscovered: ['mcp_tool_1', 'mcp_tool_2'],
      channelState: 'active',
      request: input,
    }));
  }

  public registerMock(primitive: MastraPrimitiveType, mockFn: (input: unknown) => unknown) {
    this.mocks.set(primitive, mockFn);
  }

  public async evaluatePrimitive<T = unknown>(evalInput: PrimitiveEvalInput<T>): Promise<MastraPrimitiveEvalResult> {
    const startTime = Date.now();
    const mockFn = this.mocks.get(evalInput.primitive);
    if (!mockFn) {
      throw new Error(`No mock handler registered for primitive: ${evalInput.primitive}`);
    }

    const output = await Promise.resolve(mockFn(evalInput.inputData));
    const latencyMs = Date.now() - startTime;

    let score = 1.0;
    let passed = true;

    if (evalInput.expectedOutput !== undefined) {
      const match = JSON.stringify(output) === JSON.stringify(evalInput.expectedOutput);
      passed = match;
      score = match ? 1.0 : 0.0;
    }

    return {
      primitive: evalInput.primitive,
      passed,
      score,
      latencyMs,
      deterministic: true,
      details: {
        input: evalInput.inputData,
        output,
        expected: evalInput.expectedOutput,
      },
    };
  }
}

export function createDeterministicPrimitiveHarness(): DeterministicPrimitiveHarness {
  return new DeterministicPrimitiveHarness();
}
