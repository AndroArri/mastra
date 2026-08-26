import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSubagentsCommand } from '../subagents.js';
import type { SlashCommandContext } from '../types.js';

const showModalOverlayMock = vi.fn();
const hideOverlayMock = vi.fn();

vi.mock('../../overlay.js', () => ({
  showModalOverlay: vi.fn((ui, component, options) => {
    showModalOverlayMock(ui, component, options);
  }),
}));

function createContext(subagents?: Array<{ id: string; name: string; description: string }>) {
  const chatContainer = {
    addChild: vi.fn(),
    invalidate: vi.fn(),
  };

  const ctx = {
    state: {
      subagentRuns: new Map(),
      controller: {
        config: {
          subagents,
        },
      },
      session: {
        subagents: {
          model: {
            get: vi.fn(),
            set: vi.fn(),
          },
        },
      },
      ui: {
        requestRender: vi.fn(),
        hideOverlay: hideOverlayMock,
      },
      chatContainer,
      activeInlineQuestion: undefined,
    },
    authStorage: {},
    showError: vi.fn(),
    showInfo: vi.fn(),
  } as unknown as SlashCommandContext;

  return { ctx, chatContainer };
}

describe('handleSubagentsCommand', () => {
  beforeEach(() => {
    showModalOverlayMock.mockReset();
    hideOverlayMock.mockReset();
  });

  it('opens SubagentPanelComponent modal overlay', async () => {
    const { ctx } = createContext();

    const cmdPromise = handleSubagentsCommand(ctx);

    expect(showModalOverlayMock).toHaveBeenCalledTimes(1);
    const component = showModalOverlayMock.mock.calls[0]?.[1];
    expect(component).toBeDefined();

    // Simulate closing the modal overlay
    component.handleInput('\x1b');
    await cmdPromise;

    expect(hideOverlayMock).toHaveBeenCalledTimes(1);
  });
});
