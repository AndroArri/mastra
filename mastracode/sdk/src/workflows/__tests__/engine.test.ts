import { describe, it, expect, vi } from 'vitest';
import { WorkflowEngine } from '../workflow-engine.js';
import type { WorkflowConfig, WorkflowEvent } from '../types.js';

describe('WorkflowEngine & WorkflowRunner Integration Tests', () => {
  it('should execute a DAG workflow and stream events in real-time', async () => {
    const engine = new WorkflowEngine();

    const config: WorkflowConfig = {
      id: 'test-dag-workflow',
      steps: [
        {
          id: 'stepA',
          execute: async () => 'resultA',
        },
        {
          id: 'stepB',
          execute: async () => 'resultB',
        },
        {
          id: 'stepC',
          dependencies: ['stepA', 'stepB'],
          execute: async (ctx) => {
            const resA = ctx.stepResults.stepA;
            const resB = ctx.stepResults.stepB;
            return `${resA}_${resB}_resultC`;
          },
        },
      ],
    };

    engine.registerWorkflow(config);

    const { runId, stream, result } = engine.run('test-dag-workflow', { start: true });

    const receivedEvents: WorkflowEvent[] = [];
    stream.subscribe(evt => {
      receivedEvents.push(evt);
    });

    const finalState = await result;

    expect(finalState.status).toBe('success');
    expect(finalState.results).toEqual({
      stepA: 'resultA',
      stepB: 'resultB',
      stepC: 'resultA_resultB_resultC',
    });

    const eventTypes = receivedEvents.map(e => e.type);
    expect(eventTypes).toContain('workflow-start');
    expect(eventTypes).toContain('step-start');
    expect(eventTypes).toContain('step-success');
    expect(eventTypes).toContain('workflow-success');
  });

  it('should enforce ephemeral memory isolation per step', async () => {
    const engine = new WorkflowEngine();

    const config: WorkflowConfig = {
      id: 'memory-isolation-workflow',
      steps: [
        {
          id: 'step1',
          execute: async (ctx) => {
            ctx.ephemeralMemory.secret = 'step1_secret';
            ctx.ephemeralMemory.sharedKey = 100;
            return ctx.ephemeralMemory.secret;
          },
        },
        {
          id: 'step2',
          execute: async (ctx) => {
            // step2 should NOT see step1's ephemeral memory
            const hasStep1Secret = 'secret' in ctx.ephemeralMemory;
            ctx.ephemeralMemory.sharedKey = 200;
            return { hasStep1Secret, step2Key: ctx.ephemeralMemory.sharedKey };
          },
        },
      ],
    };

    engine.registerWorkflow(config);
    const { result } = engine.run('memory-isolation-workflow');
    const finalState = await result;

    expect(finalState.status).toBe('success');
    expect(finalState.results.step1).toBe('step1_secret');
    expect(finalState.results.step2).toEqual({
      hasStep1Secret: false,
      step2Key: 200,
    });
  });

  it('should trigger tripwires when execution limits are exceeded', async () => {
    const engine = new WorkflowEngine();

    const config: WorkflowConfig = {
      id: 'tripwire-workflow',
      tripwires: {
        maxStepExecutions: 2,
      },
      steps: [
        {
          id: 'step1',
          execute: async () => 'res1',
        },
        {
          id: 'step2',
          dependencies: ['step1'],
          execute: async () => 'res2',
        },
        {
          id: 'step3',
          dependencies: ['step2'],
          execute: async () => 'res3',
        },
      ],
    };

    engine.registerWorkflow(config);

    const { stream, result } = engine.run('tripwire-workflow');

    const events: WorkflowEvent[] = [];
    stream.subscribe(evt => events.push(evt));

    const finalState = await result;

    expect(finalState.status).toBe('tripwire');
    expect(finalState.error).toContain('Maximum step executions limit (2) reached');

    const tripwireEvent = events.find(e => e.type === 'tripwire-triggered');
    expect(tripwireEvent).toBeDefined();
    expect(tripwireEvent?.error).toContain('Maximum step executions limit (2) reached');
  });

  it('should support Human-in-the-Loop (HITL) suspend and interactive resume', async () => {
    const engine = new WorkflowEngine();

    const config: WorkflowConfig = {
      id: 'hitl-workflow',
      steps: [
        {
          id: 'initialStep',
          execute: async () => 'data_prepared',
        },
        {
          id: 'approvalStep',
          dependencies: ['initialStep'],
          execute: async (ctx) => {
            ctx.suspend({ question: 'Proceed with execution?', prepData: ctx.stepResults.initialStep });
          },
        },
        {
          id: 'finalStep',
          dependencies: ['approvalStep'],
          execute: async (ctx) => {
            return `finalized_${JSON.stringify(ctx.stepResults.approvalStep)}`;
          },
        },
      ],
    };

    engine.registerWorkflow(config);

    // 1. Initial run -> suspends on approvalStep
    const { runId, stream: stream1, result: result1 } = engine.run('hitl-workflow');
    const events1: WorkflowEvent[] = [];
    stream1.subscribe(e => events1.push(e));

    const state1 = await result1;

    expect(state1.status).toBe('suspended');
    expect(state1.suspendedStepId).toBe('approvalStep');
    expect(state1.suspendData).toEqual({
      question: 'Proceed with execution?',
      prepData: 'data_prepared',
    });

    const suspendEvent = events1.find(e => e.type === 'step-suspended');
    expect(suspendEvent).toBeDefined();
    expect(suspendEvent?.stepId).toBe('approvalStep');

    // 2. Interactive Resume with human feedback/input
    const { stream: stream2, result: result2 } = engine.resume(runId, 'approvalStep', { approved: true, userChoice: 'OPTION_A' });
    const events2: WorkflowEvent[] = [];
    stream2.subscribe(e => events2.push(e));

    const state2 = await result2;

    expect(state2.status).toBe('success');
    expect(state2.results.approvalStep).toEqual({ approved: true, userChoice: 'OPTION_A' });
    expect(state2.results.finalStep).toBe('finalized_{"approved":true,"userChoice":"OPTION_A"}');
  });
});
