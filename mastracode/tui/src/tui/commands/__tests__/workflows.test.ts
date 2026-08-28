import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runWorkflow: vi.fn(),
  resumeWorkflow: vi.fn(),
}));

vi.mock('@mastra/code-sdk/workflows/service', () => ({
  deleteWorkflow: vi.fn(),
  getWorkflow: vi.fn(),
  listWorkflows: vi.fn(),
  runWorkflow: mocks.runWorkflow,
  resumeWorkflow: mocks.resumeWorkflow,
}));

import { handleWorkflowsCommand } from '../workflows.js';

function createCtx() {
  return {
    controller: {
      getMastra: vi.fn(() => undefined),
    },
    showError: vi.fn(),
    showInfo: vi.fn(),
  } as any;
}

describe('handleWorkflowsCommand', () => {
  beforeEach(() => {
    mocks.runWorkflow.mockReset();
  });

  it.each(['help', '?', '--help'])('shows %s without requiring a Mastra instance', async subcommand => {
    const ctx = createCtx();

    await handleWorkflowsCommand(ctx, [subcommand]);

    expect(ctx.controller.getMastra).not.toHaveBeenCalled();
    expect(ctx.showError).not.toHaveBeenCalled();
    expect(ctx.showInfo).toHaveBeenCalledWith(expect.stringContaining('Dynamic Workflows'));
  });

  it('preserves repeated spaces in workflow run JSON input', async () => {
    const mastra = {};
    const ctx = createCtx();
    ctx.controller.getMastra.mockReturnValue(mastra);
    mocks.runWorkflow.mockResolvedValue({ status: 'success', result: { greeting: 'Hello' } });

    await handleWorkflowsCommand(
      ctx,
      ['run', 'greeting', '{"name":"Ada', 'Lovelace"}'],
      'run greeting {"name":"Ada  Lovelace"}',
    );

    expect(mocks.runWorkflow).toHaveBeenCalledWith(
      mastra,
      'greeting',
      { name: 'Ada  Lovelace' },
      undefined,
      expect.any(Function),
    );
    expect(ctx.showError).not.toHaveBeenCalled();
  });

  it.each([
    ['a string', 'connection lost'],
    ['an object with a message', { message: 'connection lost' }],
  ])('preserves non-Error workflow command failures from %s', async (_source, failure) => {
    const ctx = createCtx();
    ctx.controller.getMastra.mockReturnValue({});
    mocks.runWorkflow.mockRejectedValue(failure);

    await handleWorkflowsCommand(ctx, ['run', 'greeting'], 'run greeting {}');

    expect(ctx.showError).toHaveBeenCalledWith('Workflow command failed: connection lost');
  });

  it('handles suspended workflow status cleanly and shows resume instructions', async () => {
    const mastra = {};
    const ctx = createCtx();
    ctx.controller.getMastra.mockReturnValue(mastra);
    mocks.runWorkflow.mockResolvedValue({
      status: 'suspended',
      runId: 'run-123',
      suspendedStepId: 'approvalStep',
      suspendData: { question: 'Proceed?' },
    });

    await handleWorkflowsCommand(ctx, ['run', 'hitl-workflow'], 'run hitl-workflow {}');

    expect(ctx.showError).not.toHaveBeenCalled();
    expect(ctx.showInfo).toHaveBeenCalledWith(
      expect.stringContaining(
        'workflow suspended (waiting for approval/input) at step "approvalStep" (runId: run-123)',
      ),
    );
  });

  it('resumes suspended workflow with user input', async () => {
    const mastra = {};
    const ctx = createCtx();
    ctx.controller.getMastra.mockReturnValue(mastra);
    mocks.resumeWorkflow.mockResolvedValue({
      status: 'success',
      runId: 'run-123',
      result: 'finalized_{"approved":true}',
    });

    await handleWorkflowsCommand(
      ctx,
      ['resume', 'hitl-workflow', 'run-123', 'approvalStep', '{"approved":true}'],
      'resume hitl-workflow run-123 approvalStep {"approved":true}',
    );

    expect(mocks.resumeWorkflow).toHaveBeenCalledWith(
      mastra,
      'hitl-workflow',
      'run-123',
      'approvalStep',
      { approved: true },
      undefined,
      expect.any(Function),
    );
    expect(ctx.showError).not.toHaveBeenCalled();
    expect(ctx.showInfo).toHaveBeenCalledWith(expect.stringContaining('✓ done'));
  });
});
