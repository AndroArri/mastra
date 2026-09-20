import { WorkflowStream } from './workflow-stream.js';
import type {
  WorkflowConfig,
  WorkflowRunState,
  WorkflowStepConfig,
  WorkflowStepState,
  WorkflowEvent,
  StepMemory,
  StepExecutionContext,
} from './types.js';

export class WorkflowRunner {
  private config: WorkflowConfig;
  private state: WorkflowRunState;
  private stream: WorkflowStream;
  private stepExecutionCount = 0;

  constructor(config: WorkflowConfig, runId: string, initialState?: WorkflowRunState) {
    this.config = config;
    this.stream = new WorkflowStream();

    if (initialState) {
      this.state = initialState;
    } else {
      const stepStates: Record<string, { status: WorkflowStepState }> = {};
      for (const step of config.steps) {
        stepStates[step.id] = { status: 'pending' };
      }

      this.state = {
        runId,
        workflowId: config.id,
        status: 'idle',
        stepStates,
        results: {},
      };
    }
  }

  getStream(): WorkflowStream {
    return this.stream;
  }

  getState(): WorkflowRunState {
    return { ...this.state };
  }

  async run(initialInput?: unknown): Promise<WorkflowRunState> {
    this.state.status = 'running';
    this.state.startTime = Date.now();

    this.emitEvent({
      type: 'workflow-start',
      runId: this.state.runId,
      data: { initialInput, workflowId: this.config.id },
      timestamp: Date.now(),
    });

    await this.executeDag(initialInput);

    return this.state;
  }

  async resume(stepId: string, resumeInput?: unknown): Promise<WorkflowRunState> {
    if (this.state.status !== 'suspended' || this.state.suspendedStepId !== stepId) {
      throw new Error(`Cannot resume step "${stepId}": workflow is not suspended on this step.`);
    }

    const stepState = this.state.stepStates[stepId];
    if (stepState) {
      stepState.status = 'success';
      stepState.output = resumeInput;
      stepState.endTime = Date.now();
      this.state.results[stepId] = resumeInput;
    }

    this.state.suspendedStepId = undefined;
    this.state.suspendData = undefined;
    this.state.status = 'running';

    this.emitEvent({
      type: 'step-success',
      runId: this.state.runId,
      stepId,
      data: resumeInput,
      timestamp: Date.now(),
    });

    await this.executeDag();

    return this.state;
  }

  private emitEvent(event: WorkflowEvent): void {
    this.stream.emit(event);
  }

  private checkTripwires(): string | null {
    const tripwires = this.config.tripwires;
    if (!tripwires) return null;

    if (tripwires.maxStepExecutions !== undefined && this.stepExecutionCount >= tripwires.maxStepExecutions) {
      return `Tripwire triggered: Maximum step executions limit (${tripwires.maxStepExecutions}) reached.`;
    }

    if (tripwires.timeoutMs !== undefined && this.state.startTime) {
      const elapsed = Date.now() - this.state.startTime;
      if (elapsed >= tripwires.timeoutMs) {
        return `Tripwire triggered: Execution timeout (${tripwires.timeoutMs}ms) exceeded.`;
      }
    }

    return null;
  }

  private async executeDag(initialInput?: unknown): Promise<void> {
    const stepsMap = new Map<string, WorkflowStepConfig>();
    for (const step of this.config.steps) {
      stepsMap.set(step.id, step);
    }

    // Keep executing runnable steps until no work can be scheduled
    while (this.state.status === 'running') {
      const tripwireReason = this.checkTripwires();
      if (tripwireReason) {
        this.state.status = 'tripwire';
        this.state.endTime = Date.now();
        this.state.error = tripwireReason;

        this.emitEvent({
          type: 'tripwire-triggered',
          runId: this.state.runId,
          error: tripwireReason,
          timestamp: Date.now(),
        });

        this.emitEvent({
          type: 'workflow-error',
          runId: this.state.runId,
          error: tripwireReason,
          timestamp: Date.now(),
        });

        this.stream.close();
        return;
      }

      // Find runnable steps (all dependencies satisfied and status is pending)
      const runnableSteps: WorkflowStepConfig[] = [];
      let pendingCount = 0;
      let runningCount = 0;

      for (const step of this.config.steps) {
        const stepState = this.state.stepStates[step.id]?.status ?? 'pending';

        if (stepState === 'running') {
          runningCount++;
        } else if (stepState === 'pending') {
          pendingCount++;

          const deps = step.dependencies ?? [];
          const depsFulfilled = deps.every(
            depId => this.state.stepStates[depId]?.status === 'success'
          );

          if (depsFulfilled) {
            runnableSteps.push(step);
          }
        }
      }

      if (runnableSteps.length === 0) {
        // If there are no runnable steps:
        if (runningCount > 0) {
          // Wait for running tasks (handled via Promise.all in step execution block below)
          break;
        }

        // Check if workflow is finished or blocked/failed
        const stepStatuses = Object.values(this.state.stepStates).map(s => s.status);
        const hasFailed = stepStatuses.some(s => s === 'failed' || s === 'tripwire');

        if (hasFailed) {
          this.state.status = 'failed';
          this.state.endTime = Date.now();
          this.emitEvent({
            type: 'workflow-error',
            runId: this.state.runId,
            error: 'Workflow step failed',
            timestamp: Date.now(),
          });
        } else if (pendingCount === 0) {
          this.state.status = 'success';
          this.state.endTime = Date.now();
          this.emitEvent({
            type: 'workflow-success',
            runId: this.state.runId,
            data: this.state.results,
            timestamp: Date.now(),
          });
        }
        break;
      }

      // Execute runnable steps in parallel
      const executions = runnableSteps.map(async step => {
        return this.executeStep(step, initialInput);
      });

      await Promise.all(executions);

      // If any step suspended during execution, pause workflow execution
      if ((this.state.status as string) === 'suspended') {
        this.emitEvent({
          type: 'workflow-suspended',
          runId: this.state.runId,
          data: { stepId: this.state.suspendedStepId, payload: this.state.suspendData },
          timestamp: Date.now(),
        });
        return;
      }

    }

    if (this.state.status === 'success' || this.state.status === 'failed' || this.state.status === 'tripwire') {
      this.stream.close();
    }
  }

  private async executeStep(step: WorkflowStepConfig, initialInput?: unknown): Promise<void> {
    const stepState = this.state.stepStates[step.id] ?? { status: 'pending' };
    stepState.status = 'running';
    stepState.startTime = Date.now();
    this.stepExecutionCount++;

    this.emitEvent({
      type: 'step-start',
      runId: this.state.runId,
      stepId: step.id,
      timestamp: Date.now(),
    });

    // Check HITL requiresApproval
    if (step.requiresApproval) {
      stepState.status = 'suspended';
      this.state.status = 'suspended';
      this.state.suspendedStepId = step.id;
      this.state.suspendData = { reason: 'Requires approval' };

      this.emitEvent({
        type: 'step-suspended',
        runId: this.state.runId,
        stepId: step.id,
        data: { reason: 'Requires approval' },
        timestamp: Date.now(),
      });
      return;
    }

    // Isolated Ephemeral Step Memory
    const ephemeralMemory: StepMemory = {};

    let suspended = false;
    let suspendPayload: unknown;

    const ctx: StepExecutionContext = {
      runId: this.state.runId,
      stepId: step.id,
      input: step.dependencies && step.dependencies.length > 0
        ? step.dependencies.reduce((acc, depId) => {
            acc[depId] = this.state.results[depId];
            return acc;
          }, {} as Record<string, unknown>)
        : initialInput,
      ephemeralMemory,
      stepResults: { ...this.state.results },
      suspend: (payload?: unknown) => {
        suspended = true;
        suspendPayload = payload;
      },
    };

    try {
      const output = await step.execute(ctx);

      if (suspended) {
        stepState.status = 'suspended';
        this.state.status = 'suspended';
        this.state.suspendedStepId = step.id;
        this.state.suspendData = suspendPayload;

        this.emitEvent({
          type: 'step-suspended',
          runId: this.state.runId,
          stepId: step.id,
          data: suspendPayload,
          timestamp: Date.now(),
        });
        return;
      }

      stepState.status = 'success';
      stepState.output = output;
      stepState.endTime = Date.now();
      stepState.ephemeralMemorySnapshot = { ...ephemeralMemory };
      this.state.results[step.id] = output;

      this.emitEvent({
        type: 'step-success',
        runId: this.state.runId,
        stepId: step.id,
        data: output,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      stepState.status = 'failed';
      stepState.error = errorMessage;
      stepState.endTime = Date.now();

      this.emitEvent({
        type: 'step-error',
        runId: this.state.runId,
        stepId: step.id,
        error: errorMessage,
        timestamp: Date.now(),
      });
    }
  }
}
