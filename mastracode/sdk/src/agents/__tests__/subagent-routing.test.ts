import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUBAGENT_MODELS,
  SubagentModelRouter,
  resolveAgentModel,
} from '../subagent-routing.js';

describe('Subagent Model Routing Integration', () => {
  it('resolves correct default models for primary code-agent and specialized subagents', () => {
    const router = new SubagentModelRouter();

    expect(router.resolveModelIdForAgent('code-agent')).toBe('openai/gpt-5.5');
    expect(router.resolveModelIdForAgent('explore')).toBe('openai/gpt-5.4-mini');
    expect(router.resolveModelIdForAgent('plan')).toBe('openai/gpt-5.5');
    expect(router.resolveModelIdForAgent('build')).toBe('anthropic/claude-sonnet-4-5');
    expect(router.resolveModelIdForAgent('workflow-builder')).toBe('openai/gpt-5.5');
  });

  it('allows setting custom model routing per agent type', () => {
    const router = new SubagentModelRouter();

    router.setModelForAgent('explore', 'openai/gpt-5.4');
    router.setModelForAgent('build', 'anthropic/claude-haiku-4-5');

    expect(router.resolveModelIdForAgent('explore')).toBe('openai/gpt-5.4');
    expect(router.resolveModelIdForAgent('build')).toBe('anthropic/claude-haiku-4-5');
  });

  it('respects explicit override model ID over router defaults', () => {
    const router = new SubagentModelRouter();

    const resolved = router.resolveModelIdForAgent('explore', 'custom-provider/custom-model');
    expect(resolved).toBe('custom-provider/custom-model');
  });

  it('exports DEFAULT_SUBAGENT_MODELS map containing all specified agents', () => {
    expect(DEFAULT_SUBAGENT_MODELS['code-agent']).toBeDefined();
    expect(DEFAULT_SUBAGENT_MODELS['explore']).toBeDefined();
    expect(DEFAULT_SUBAGENT_MODELS['plan']).toBeDefined();
    expect(DEFAULT_SUBAGENT_MODELS['build']).toBeDefined();
    expect(DEFAULT_SUBAGENT_MODELS['workflow-builder']).toBeDefined();
  });
});
