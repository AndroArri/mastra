import { describe, expect, it, vi } from 'vitest';
import { SubagentOrchestrator, isolateContext } from '../subagent-orchestrator.js';

describe('Subagent Orchestrator & Parallel Execution Engine', () => {
  it('clones context to guarantee execution context isolation', () => {
    const originalContext = {
      user: 'alice',
      settings: { theme: 'dark' },
      items: [1, 2, 3],
    };

    const isolated = isolateContext(originalContext);

    expect(isolated).toEqual(originalContext);
    expect(isolated).not.toBe(originalContext);

    // Mutate isolated copy
    isolated.user = 'bob';
    (isolated.settings as any).theme = 'light';
    (isolated.items as any).push(4);

    // Original context must remain completely unaffected
    expect(originalContext.user).toBe('alice');
    expect(originalContext.settings.theme).toBe('dark');
    expect(originalContext.items).toEqual([1, 2, 3]);
  });

  it('invokes a single subagent and tracks execution tree status', async () => {
    const orchestrator = new SubagentOrchestrator();

    const result = await orchestrator.invokeSubagent({
      agentType: 'explore',
      task: 'Find database queries',
      context: { scope: 'src/db' },
      executor: async (node, ctx) => {
        expect(node.status).toBe('running');
        expect(ctx.scope).toBe('src/db');
        return 'Found 3 queries';
      },
    });

    expect(result.agentType).toBe('explore');
    expect(result.task).toBe('Find database queries');
    expect(result.status).toBe('completed');
    expect(result.result).toBe('Found 3 queries');

    const tree = orchestrator.getExecutionTree();
    expect(tree).toHaveLength(1);
    expect(tree[0]?.id).toBe(result.id);
    expect(tree[0]?.status).toBe('completed');
  });

  it('orchestrates subagents in parallel with strict context isolation between instances', async () => {
    const orchestrator = new SubagentOrchestrator();

    const sharedInitialContext = {
      sharedVar: 'base',
      counter: 0,
    };

    // Launch 3 subagents concurrently
    const nodes = await orchestrator.invokeParallel([
      {
        agentType: 'explore',
        task: 'Task A',
        context: sharedInitialContext,
        executor: async (_node, ctx) => {
          await new Promise(r => setTimeout(r, 20));
          ctx.counter = 100;
          ctx.agentSpecific = 'A';
          return 'Result A';
        },
      },
      {
        agentType: 'plan',
        task: 'Task B',
        context: sharedInitialContext,
        executor: async (_node, ctx) => {
          await new Promise(r => setTimeout(r, 10));
          ctx.counter = 200;
          ctx.agentSpecific = 'B';
          return 'Result B';
        },
      },
      {
        agentType: 'build',
        task: 'Task C',
        context: sharedInitialContext,
        executor: async (_node, ctx) => {
          await new Promise(r => setTimeout(r, 15));
          ctx.counter = 300;
          ctx.agentSpecific = 'C';
          return 'Result C';
        },
      },
    ]);

    expect(nodes).toHaveLength(3);
    expect(nodes.every(n => n.status === 'completed')).toBe(true);

    // Context isolation verification: each subagent node has its own context mutations
    expect(nodes[0]?.context.counter).toBe(100);
    expect(nodes[0]?.context.agentSpecific).toBe('A');

    expect(nodes[1]?.context.counter).toBe(200);
    expect(nodes[1]?.context.agentSpecific).toBe('B');

    expect(nodes[2]?.context.counter).toBe(300);
    expect(nodes[2]?.context.agentSpecific).toBe('C');

    // Shared initial context remains untouched
    expect(sharedInitialContext.counter).toBe(0);
  });

  it('supports child nested subagents in execution tree hierarchy', async () => {
    const orchestrator = new SubagentOrchestrator();

    const parentNode = await orchestrator.invokeSubagent({
      agentType: 'code-agent',
      task: 'Orchestrate feature build',
    });

    const childNode1 = await orchestrator.invokeSubagent({
      parentId: parentNode.id,
      agentType: 'explore',
      task: 'Inspect dependencies',
    });

    const childNode2 = await orchestrator.invokeSubagent({
      parentId: parentNode.id,
      agentType: 'plan',
      task: 'Plan implementation steps',
    });

    const tree = orchestrator.getExecutionTree();
    expect(tree).toHaveLength(1);
    expect(tree[0]?.id).toBe(parentNode.id);
    expect(tree[0]?.children).toHaveLength(2);
    expect(tree[0]?.children[0]?.id).toBe(childNode1.id);
    expect(tree[0]?.children[1]?.id).toBe(childNode2.id);
  });

  it('notifies subscribers in real time on tree updates', async () => {
    const orchestrator = new SubagentOrchestrator();
    const listener = vi.fn();

    const unsubscribe = orchestrator.subscribe(listener);

    await orchestrator.invokeSubagent({
      agentType: 'workflow-builder',
      task: 'Build automated workflow',
      executor: async () => 'Workflow ready',
    });

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});
