import { describe, expect, it } from 'vitest';
import { createDeterministicPrimitiveHarness, type MastraPrimitiveType } from '../primitives.js';

describe('DeterministicPrimitiveHarness (10 Mastra Primitives)', () => {
  const harness = createDeterministicPrimitiveHarness();

  const primitives: MastraPrimitiveType[] = [
    'agent',
    'tool',
    'workflow',
    'memory',
    'voice',
    'storage',
    'rag',
    'observability',
    'evals',
    'mcp',
  ];

  it('evaluates all 10 core Mastra primitives deterministically', async () => {
    for (const primitive of primitives) {
      const result = await harness.evaluatePrimitive({
        primitive,
        inputData: { sampleQuery: `testing-${primitive}` },
      });

      expect(result.primitive).toBe(primitive);
      expect(result.passed).toBe(true);
      expect(result.score).toBe(1.0);
      expect(result.deterministic).toBe(true);
      expect(result.details.output).toBeDefined();
    }
  });

  it('allows custom mock overrides for any primitive', async () => {
    harness.registerMock('agent', (input) => ({
      customResponse: true,
      originalInput: input,
    }));

    const result = await harness.evaluatePrimitive({
      primitive: 'agent',
      inputData: 'custom prompt',
    });

    expect(result.passed).toBe(true);
    expect(result.details.output).toEqual({
      customResponse: true,
      originalInput: 'custom prompt',
    });
  });
});
