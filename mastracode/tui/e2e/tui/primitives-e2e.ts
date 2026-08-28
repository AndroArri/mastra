import { expect } from './expect.js';
import type { McE2eScenario } from './types.js';

export const primitivesE2eScenario: McE2eScenario = {
  name: 'primitives-e2e',
  description: 'Deterministic E2E execution testing of all 10 Mastra primitives in TUI backed by AIMock fixture.',
  testName: 'executes deterministic Mastra primitives E2E test in TUI',
  useOpenAIModel: true,
  aimockFixture: 'primitives-e2e.json',
  async run({ terminal, runtime }) {
    runtime.startLiveOutput(terminal);
    runtime.printScreen('spawned', terminal);

    await (
      expect(terminal.getByText(/Mastra Code|Build|Plan|Fast|Type|Press|>/gi, { full: true, strict: false })) as any
    ).toBeVisible();
    runtime.printScreen('after startup', terminal);

    terminal.submit('Test deterministic Mastra primitives execution in TUI');
    await runtime.waitForScreenText(/Mastra Primitives TUI E2E Execution Completed/i, terminal);
    runtime.printScreen('after primitives prompt', terminal);

    terminal.keyCtrlC();
    runtime.printScreen('after Ctrl-C', terminal);
  },
};
