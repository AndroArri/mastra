import { randomUUID } from 'node:crypto';
import { WorkflowRunner } from './workflow-runner.js';
import { WorkflowStream } from './workflow-stream.js';
import type { WorkflowConfig, WorkflowRunState } from './types.js';

export interface RunWorkflowResult {
  runId: string;
  stream: WorkflowStream;
  result: Promise<WorkflowRunState>;
}

export class WorkflowEngine {
  private workflows = new Map<string, WorkflowConfig>();
  private activeRunners = new Map<string, WorkflowRunner>();

  registerWorkflow(config: WorkflowConfig): void {
    if (!config.id) {
      throw new Error('WorkflowConfig must have a valid id');
    }
    this.workflows.set(config.id, config);
  }

  getWorkflow(id: string): WorkflowConfig | undefined {
    return this.workflows.get(id);
  }

  listWorkflows(): WorkflowConfig[] {
    return Array.from(this.workflows.values());
  }

  run(workflowId: string, initialInput?: unknown): RunWorkflowResult {
    const config = this.getWorkflow(workflowId);
    if (!config) {
      throw new Error(`Workflow "${workflowId}" not found in WorkflowEngine registry.`);
    }

    const runId = `run_${randomUUID()}`;
    const runner = new WorkflowRunner(config, runId);
    this.activeRunners.set(runId, runner);

    const stream = runner.getStream();
    const result = runner.run(initialInput);

    return { runId, stream, result };
  }

  resume(runId: string, stepId: string, resumeInput?: unknown): RunWorkflowResult {
    const runner = this.activeRunners.get(runId);
    if (!runner) {
      throw new Error(`Active workflow run "${runId}" not found for resume.`);
    }

    const stream = runner.getStream();
    const result = runner.resume(stepId, resumeInput);

    return { runId, stream, result };
  }

  getRunState(runId: string): WorkflowRunState | undefined {
    return this.activeRunners.get(runId)?.getState();
  }
}
