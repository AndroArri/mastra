import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import type { WorkflowConfig } from './types.js';

/**
 * Example HITL (Human-in-the-Loop) Workflow Configuration.
 *
 * Step 1 (dataPrep): Prepares data.
 * Step 2 (approvalStep): Suspends workflow execution via ctx.suspend().
 * Step 3 (finalStep): Executes once resumed with user approval/feedback.
 */
export const hitlExampleWorkflowConfig: WorkflowConfig = {
  id: 'hitl-workflow',
  steps: [
    {
      id: 'dataPrep',
      execute: async () => ({ prepData: 'data_prepared_payload' }),
    },
    {
      id: 'approvalStep',
      dependencies: ['dataPrep'],
      execute: async ctx => {
        const rawData = ctx.stepResults?.dataPrep;
        const prepData =
          typeof rawData === 'object' && rawData !== null && 'prepData' in rawData
            ? (rawData as { prepData: unknown }).prepData
            : rawData;
        ctx.suspend({
          question: 'Proceed with execution?',
          prepData,
        });
      },
    },

    {
      id: 'finalStep',
      dependencies: ['approvalStep'],
      execute: async ctx => {
        return `finalized_${JSON.stringify(ctx.stepResults.approvalStep)}`;
      },
    },
  ],
};

const dataPrepStep = createStep({
  id: 'dataPrep',
  inputSchema: z.object({}).passthrough(),
  outputSchema: z.object({ prepData: z.string() }),
  execute: async () => ({ prepData: 'data_prepared_payload' }),
});

const approvalStep = createStep({
  id: 'approvalStep',
  inputSchema: z.object({ prepData: z.string() }).passthrough(),
  outputSchema: z.any(),
  suspendSchema: z.object({ question: z.string(), prepData: z.any() }).passthrough(),
  resumeSchema: z.any(),
  execute: async ctx => {
    if (ctx.resumeData) {
      return ctx.resumeData;
    }
    const rawData = (ctx as any).getStepResult?.('dataPrep') ?? (ctx as any).stepResults?.dataPrep;
    const prepData =
      typeof rawData === 'object' && rawData !== null && 'prepData' in rawData ? (rawData as any).prepData : rawData;
    return await ctx.suspend({
      question: 'Proceed with execution?',
      prepData,
    });
  },
});

const finalStep = createStep({
  id: 'finalStep',
  inputSchema: z.any(),
  outputSchema: z.string(),
  execute: async ctx => {
    const approvalResult = (ctx as any).getStepResult?.('approvalStep') ?? (ctx as any).stepResults?.approvalStep;
    return `finalized_${JSON.stringify(approvalResult)}`;
  },
});

export const hitlMastraWorkflow = createWorkflow({
  id: 'hitl-workflow',
  description: 'HITL Test Workflow per PR 23',
  inputSchema: z.object({}).passthrough(),
  outputSchema: z.string(),
})
  .then(dataPrepStep)
  .then(approvalStep)
  .then(finalStep)
  .commit();

/**
 * Registers the HITL test workflow on a WorkflowEngine or Mastra instance.
 */
export async function registerHitlExampleWorkflow(engineOrMastra: any): Promise<void> {
  if (typeof engineOrMastra?.registerWorkflow === 'function') {
    engineOrMastra.registerWorkflow(hitlExampleWorkflowConfig);
  } else if (typeof engineOrMastra?.addWorkflow === 'function') {
    engineOrMastra.addWorkflow(hitlMastraWorkflow);
  }
}
