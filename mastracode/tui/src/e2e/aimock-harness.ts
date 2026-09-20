import { LLMock } from '@copilotkit/aimock';

export interface AimockHarnessOptions {
  port?: number;
  fixturePath?: string;
  fixtures?: Array<{
    match: {
      userMessage?: string;
      model?: string;
      endpoint?: string;
    };
    response: {
      content: string;
      [key: string]: unknown;
    };
  }>;
}

export interface AimockServerInstance {
  url: string;
  stop: () => Promise<void>;
  getRequests: () => unknown[];
  requestCount: () => number;
}

/**
 * Creates and starts a deterministic AIMock server for TUI testing.
 */
export async function createAimockHarness(options: AimockHarnessOptions = {}): Promise<AimockServerInstance> {
  const port = options.port ?? 0;
  const mock = new LLMock({ port });

  if (options.fixturePath) {
    mock.loadFixtureFile(options.fixturePath);
  }

  if (options.fixtures) {
    for (const fix of options.fixtures) {
      mock.addFixture(fix as any);
    }
  }

  await mock.start();

  return {
    url: mock.url,
    stop: async () => {
      await mock.stop();
    },
    getRequests: () => mock.getRequests() as unknown[],
    requestCount: () => mock.getRequests().length,
  };
}
