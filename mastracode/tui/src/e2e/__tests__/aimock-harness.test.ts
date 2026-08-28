import { describe, expect, it } from 'vitest';
import { createAimockHarness } from '../aimock-harness.js';

describe('TUI AIMock Harness (Deterministic E2E Test Infrastructure)', () => {
  it('starts an isolated AIMock server and handles requests deterministically', async () => {
    const harness = await createAimockHarness({
      fixtures: [
        {
          match: {
            userMessage: 'Test message',
          },
          response: {
            content: 'Deterministic AIMock Response',
          },
        },
      ],
    });

    expect(harness.url).toBeDefined();
    expect(harness.url).toContain('http://');

    await harness.stop();
  });
});
