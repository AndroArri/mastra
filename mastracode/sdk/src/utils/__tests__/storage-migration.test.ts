import { describe, expect, it, vi } from 'vitest';
import { migrateStorage } from '../storage-migration.js';

describe('migrateStorage', () => {
  it('migrates threads and messages from source to target store', async () => {
    const sourceStore = {
      getThreads: vi.fn().mockResolvedValue([
        { id: 'thread-1', resourceId: 'res-1' },
        { id: 'thread-2', resourceId: 'res-1' },
      ]),
      getMessages: vi.fn().mockImplementation(async ({ threadId }) => {
        if (threadId === 'thread-1') {
          return [{ id: 'msg-1', content: 'hello' }];
        }
        return [];
      }),
      getWorkflows: vi.fn().mockResolvedValue([{ id: 'wf-1', name: 'Workflow 1' }]),
    };

    const targetStore = {
      saveThread: vi.fn().mockResolvedValue(undefined),
      saveMessages: vi.fn().mockResolvedValue(undefined),
      saveWorkflow: vi.fn().mockResolvedValue(undefined),
    };

    const result = await migrateStorage(sourceStore as any, targetStore as any);

    expect(result.threadsCopied).toBe(2);
    expect(result.messagesCopied).toBe(1);
    expect(result.workflowsCopied).toBe(1);

    expect(targetStore.saveThread).toHaveBeenCalledTimes(2);
    expect(targetStore.saveMessages).toHaveBeenCalledTimes(1);
    expect(targetStore.saveWorkflow).toHaveBeenCalledTimes(1);
  });
});
