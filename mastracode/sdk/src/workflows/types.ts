/**
 * Type definitions for Mastra Workflows Streamed Execution Engine, DAG, Tripwires, and HITL.
 */

export type WorkflowStepState = 'pending' | 'running' | 'success' | 'failed' | 'suspended' | 'tripwire';

export type WorkflowRunStatus = 'idle' | 'running' | 'success' | 'failed' | 'suspended' | 'tripwire';

export type StepMemory = Record<string, unknown>;

export interface StepExecutionContext<TInput = unknown, TStepContext = unknown> {
  runId: string;
  stepId: string;
  input: TInput;
  /** Ephemeral memory unique to this step invocation. Isolated from other steps. */
  ephemeralMemory: StepMemory;
  /** Results of previously completed dependency steps */
  stepResults: Record<string, unknown>;
  /** Step specific context or metadata */
  context?: TStepContext;
  /** Call to suspend execution for Human-in-the-Loop (HITL) approval/input */
  suspend: (payload?: unknown) => void;
}

export interface WorkflowStepConfig<TInput = any, TOutput = any, TStepContext = any> {
  id: string;
  name?: string;
  description?: string;
  /** List of step IDs that must complete before this step can execute */
  dependencies?: string[];
  /** Flag to automatically suspend step for approval before execution */
  requiresApproval?: boolean;
  /** Step execution function */
  execute: (ctx: StepExecutionContext<TInput, TStepContext>) => Promise<TOutput> | TOutput;
}

export interface TripwireConfig {
  /** Maximum total step executions allowed across the workflow run */
  maxStepExecutions?: number;
  /** Maximum iterations allowed for repeating / cyclical nodes */
  maxIterations?: number;
  /** Maximum recursion depth allowed */
  maxRecursionDepth?: number;
  /** Maximum overall execution time in milliseconds */
  timeoutMs?: number;
}

export interface WorkflowConfig {
  id: string;
  name?: string;
  description?: string;
  steps: WorkflowStepConfig[];
  tripwires?: TripwireConfig;
}

export type WorkflowEventType =
  | 'workflow-start'
  | 'step-start'
  | 'step-progress'
  | 'step-success'
  | 'step-error'
  | 'step-suspended'
  | 'workflow-success'
  | 'workflow-error'
  | 'workflow-suspended'
  | 'tripwire-triggered';

export interface WorkflowEvent {
  type: WorkflowEventType;
  runId: string;
  stepId?: string;
  data?: unknown;
  error?: string;
  timestamp: number;
}

export interface StepStateInfo {
  status: WorkflowStepState;
  output?: unknown;
  error?: string;
  startTime?: number;
  endTime?: number;
  ephemeralMemorySnapshot?: StepMemory;
}

export interface WorkflowRunState {
  runId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  stepStates: Record<string, StepStateInfo>;
  results: Record<string, unknown>;
  suspendedStepId?: string;
  suspendData?: unknown;
  startTime?: number;
  endTime?: number;
  error?: string;
}
