import { describe, it, expect } from 'vitest';
import { hitlExampleWorkflowConfig, registerHitlExampleWorkflow } from '../hitl-example-workflow.js';
import { WorkflowEngine } from '../workflow-engine.js';

describe('HITL Example Workflow Fixture', () => {
  it('should register and execute hitl-workflow suspend and resume', async () => {
    const engine = new WorkflowEngine();
    await registerHitlExampleWorkflow(engine);

    // 1. Initial run -> suspends on approvalStep
    const { runId, result: phase1Result } = engine.run(hitlExampleWorkflowConfig.id);
    const state1 = await phase1Result;

    expect(state1.status).toBe('suspended');
    expect(state1.suspendedStepId).toBe('approvalStep');
    expect(state1.suspendData).toEqual({
      question: 'Proceed with execution?',
      prepData: 'data_prepared_payload',
    });

    // 2. Resume (Test 2) with user approval
    const userApproval = { approved: true, note: 'Approved by tester' };
    const { result: phase2Result } = engine.resume(runId, 'approvalStep', userApproval);
    const state2 = await phase2Result;

    expect(state2.status).toBe('success');
    expect(state2.results.approvalStep).toEqual(userApproval);
    expect(state2.results.finalStep).toBe(`finalized_${JSON.stringify(userApproval)}`);
  });

  it('should run and resume hitlMastraWorkflow via service.ts', async () => {
    const { Mastra } = await import('@mastra/core/mastra');
    const { MockStore } = await import('@mastra/core/storage');
    const { runWorkflow, resumeWorkflow } = await import('../service.js');
    const { hitlMastraWorkflow } = await import('../hitl-example-workflow.js');

    const mastra = new Mastra({
      storage: new MockStore(),
      workflows: { 'hitl-workflow': hitlMastraWorkflow },
      logger: false,
    });

    const runResult1 = await runWorkflow(mastra, 'hitl-workflow', {});
    expect(runResult1.status).toBe('suspended');
    expect(runResult1.runId).toBeDefined();

    const events: any[] = [];
    const runResult2 = await resumeWorkflow(
      mastra,
      'hitl-workflow',
      runResult1.runId!,
      'approvalStep',
      { approved: true },
      undefined,
      evt => events.push(evt),
    );
    expect(runResult2.status).toBe('success');
    expect(runResult2.result).toBe('finalized_{"approved":true}');
  });
});
