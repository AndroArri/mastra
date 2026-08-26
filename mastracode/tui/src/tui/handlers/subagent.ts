/**
 * Event handlers for subagent delegation events:
 * subagent_start, subagent_tool_start, subagent_tool_end, subagent_end.
 */
import { insertChatComponentWithBoundarySpacing } from '../chat-boundary-reconciliation.js';
import { SubagentExecutionComponent } from '../components/subagent-execution.js';
import { flushRender, requestRender } from '../render-scheduler.js';

import type { EventHandlerContext } from './types.js';

export function handleSubagentStart(
  ctx: EventHandlerContext,
  toolCallId: string,
  agentType: string,
  task: string,
  modelId?: string,
  forked?: boolean,
): void {
  const { state } = ctx;
  state.subagentRuns.set(toolCallId, {
    toolCallId,
    agentType,
    task,
    modelId,
    forked,
    status: 'running',
    startedAt: Date.now(),
    activities: [],
  });

  const component = new SubagentExecutionComponent(agentType, task, state.ui, modelId, {
    collapseOnComplete: false,
    expandOnComplete: state.quietMode,
    forked,
  });
  state.pendingSubagents.set(toolCallId, component);
  state.allToolComponents.push(component as any);

  // Insert before the current streamingComponent so subagent box
  // appears between pre-subagent text and post-subagent text
  if (state.streamingComponent) {
    const idx = state.chatContainer.children.indexOf(state.streamingComponent as any);
    if (idx >= 0) {
      insertChatComponentWithBoundarySpacing(state.chatContainer, component, idx);
    } else {
      insertChatComponentWithBoundarySpacing(state.chatContainer, component);
    }
  } else {
    insertChatComponentWithBoundarySpacing(state.chatContainer, component);
  }

  flushRender(state);
}

export function handleSubagentToolStart(
  ctx: EventHandlerContext,
  toolCallId: string,
  subToolName: string,
  subToolArgs: unknown,
): void {
  const run = ctx.state.subagentRuns.get(toolCallId);
  if (run) {
    run.activities.push({
      kind: 'tool',
      timestamp: Date.now(),
      name: subToolName,
      args: subToolArgs,
      done: false,
    });
  }

  const component = ctx.state.pendingSubagents.get(toolCallId);
  if (component) {
    component.addToolStart(subToolName, subToolArgs);
    requestRender(ctx.state);
  }
}

export function handleSubagentToolEnd(
  ctx: EventHandlerContext,
  toolCallId: string,
  subToolName: string,
  subToolResult: unknown,
  isError: boolean,
): void {
  const run = ctx.state.subagentRuns.get(toolCallId);
  if (run) {
    const act = run.activities.slice().reverse().find(a => a.kind === 'tool' && a.name === subToolName && !a.done);
    const resultStr = typeof subToolResult === 'string' ? subToolResult : JSON.stringify(subToolResult);
    if (act) {
      act.result = resultStr;
      act.isError = isError;
      act.done = true;
    } else {
      run.activities.push({
        kind: 'tool',
        timestamp: Date.now(),
        name: subToolName,
        result: resultStr,
        isError,
        done: true,
      });
    }
  }

  const component = ctx.state.pendingSubagents.get(toolCallId);
  if (component) {
    component.addToolEnd(subToolName, subToolResult, isError);
    requestRender(ctx.state);
  }
}

export function handleSubagentTextDelta(
  ctx: EventHandlerContext,
  toolCallId: string,
  delta: string,
): void {
  const run = ctx.state.subagentRuns.get(toolCallId);
  if (run) {
    const lastAct = run.activities[run.activities.length - 1];
    if (lastAct && lastAct.kind === 'text') {
      lastAct.text = (lastAct.text ?? '') + delta;
    } else {
      run.activities.push({
        kind: 'text',
        timestamp: Date.now(),
        text: delta,
      });
    }
  }
}

export function handleSubagentEnd(
  ctx: EventHandlerContext,
  toolCallId: string,
  isError: boolean,
  durationMs: number,
  result?: string,
): void {
  const run = ctx.state.subagentRuns.get(toolCallId);
  if (run) {
    if (run.status === 'running') {
      run.status = isError ? 'error' : 'completed';
    }
    run.endedAt = Date.now();
    run.durationMs = durationMs;
    run.finalResult = result;
  }

  const component = ctx.state.pendingSubagents.get(toolCallId);
  if (component) {
    component.finish(isError, durationMs, result);
    ctx.state.pendingSubagents.delete(toolCallId);
    flushRender(ctx.state);
  }
}
