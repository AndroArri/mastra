import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubagentPanelComponent } from '../subagent-panel.js';
import type { TUIState } from '../../state.js';

function createMockState(): TUIState {
  const subagentRuns = new Map();
  subagentRuns.set('call-1', {
    toolCallId: 'call-1',
    agentType: 'explore',
    task: 'Search codebase for auth tokens',
    modelId: 'openai/gpt-5.5',
    status: 'running',
    startedAt: Date.now() - 5000,
    activities: [
      {
        kind: 'tool',
        timestamp: Date.now() - 4000,
        name: 'grep_search',
        args: { Query: 'authToken' },
        done: true,
        result: 'Found 3 matches',
      },
      {
        kind: 'text',
        timestamp: Date.now() - 2000,
        text: 'Searching through core authentication package...',
      },
    ],
  });

  subagentRuns.set('call-2', {
    toolCallId: 'call-2',
    agentType: 'plan',
    task: 'Design TUI overlay architecture',
    modelId: 'anthropic/claude-3.7-sonnet',
    status: 'completed',
    startedAt: Date.now() - 15000,
    endedAt: Date.now() - 2000,
    durationMs: 13000,
    finalResult: 'Architecture design ready.',
    activities: [],
  });

  return {
    subagentRuns,
    pendingSubagents: new Map(),
    session: {
      subagents: {
        model: {
          get: vi.fn(opts => (opts?.agentType === 'explore' ? 'openai/gpt-5.5' : null)),
          set: vi.fn(),
        },
      },
    },
    controller: {
      config: {},
    },
    ui: {
      requestRender: vi.fn(),
    },
  } as unknown as TUIState;
}

describe('SubagentPanelComponent', () => {
  it('instantiates and renders subagent runs list', () => {
    const state = createMockState();
    const mockTui = { requestRender: vi.fn() } as any;
    const onSelectModel = vi.fn();
    const onClose = vi.fn();

    const panel = new SubagentPanelComponent({
      tui: mockTui,
      state,
      onSelectModel,
      onClose,
    });

    expect(panel).toBeDefined();
    expect(panel.children.length).toBeGreaterThan(0);
  });

  it('switches between runs and models tabs', () => {
    const state = createMockState();
    const mockTui = { requestRender: vi.fn() } as any;
    const onSelectModel = vi.fn();
    const onClose = vi.fn();

    const panel = new SubagentPanelComponent({
      tui: mockTui,
      state,
      onSelectModel,
      onClose,
    });

    // Press tab or '2' to switch to models tab
    panel.handleInput('2');
    expect(mockTui.requestRender).toHaveBeenCalled();

    // Press '1' to switch back to runs tab
    panel.handleInput('1');
    expect(mockTui.requestRender).toHaveBeenCalledTimes(2);
  });

  it('opens transcript view and handles back key', () => {
    const state = createMockState();
    const mockTui = { requestRender: vi.fn() } as any;
    const onSelectModel = vi.fn();
    const onClose = vi.fn();

    const panel = new SubagentPanelComponent({
      tui: mockTui,
      state,
      onSelectModel,
      onClose,
    });

    // Press 'v' or Enter to open transcript of selected run
    panel.handleInput('v');
    expect(mockTui.requestRender).toHaveBeenCalled();

    // Press 'b' or Esc to exit transcript view
    panel.handleInput('b');
    expect(mockTui.requestRender).toHaveBeenCalledTimes(2);
  });

  it('stops running subagent on x key press', () => {
    const state = createMockState();
    const mockTui = { requestRender: vi.fn() } as any;
    const onSelectModel = vi.fn();
    const onClose = vi.fn();

    const panel = new SubagentPanelComponent({
      tui: mockTui,
      state,
      onSelectModel,
      onClose,
    });

    const run = state.subagentRuns.get('call-1');
    expect(run?.status).toBe('running');

    // Press 'x' to stop running subagent
    panel.handleInput('x');
    expect(run?.status).toBe('aborted');
  });

  it('calls onClose on escape key in list mode', () => {
    const state = createMockState();
    const mockTui = { requestRender: vi.fn() } as any;
    const onSelectModel = vi.fn();
    const onClose = vi.fn();

    const panel = new SubagentPanelComponent({
      tui: mockTui,
      state,
      onSelectModel,
      onClose,
    });

    panel.handleInput('\x1b');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
