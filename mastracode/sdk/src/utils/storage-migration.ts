/**
 * Storage migration utility — copies threads, messages, and dynamic workflows
 * from a source storage provider to a target storage provider.
 */

import type { MastraCompositeStore } from '@mastra/core/storage';

export interface StorageMigrationResult {
  threadsCopied: number;
  messagesCopied: number;
  workflowsCopied: number;
}

/**
 * Copy threads, messages, and persisted dynamic workflows from source storage to target storage.
 */
export async function migrateStorage(
  source: MastraCompositeStore,
  target: MastraCompositeStore,
): Promise<StorageMigrationResult> {
  const threads = await source.getThreads();
  let messagesCount = 0;

  for (const thread of threads) {
    await target.saveThread({ thread });
    const messages = await source.getMessages({ threadId: thread.id });
    if (messages.length > 0) {
      await target.saveMessages({ messages });
      messagesCount += messages.length;
    }
  }

  let workflowsCount = 0;
  const sourceAny = source as any;
  const targetAny = target as any;
  if (typeof sourceAny.getWorkflows === 'function' && typeof targetAny.saveWorkflow === 'function') {
    const workflows = await sourceAny.getWorkflows();
    for (const wf of workflows) {
      await targetAny.saveWorkflow({ workflow: wf });
      workflowsCount++;
    }
  }

  return {
    threadsCopied: threads.length,
    messagesCopied: messagesCount,
    workflowsCopied: workflowsCount,
  };
}
