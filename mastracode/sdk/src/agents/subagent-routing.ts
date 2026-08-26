/**
 * Model routing for the primary agent (code-agent) and specialized subagents
 * (explore, plan, build, workflow-builder).
 */

import type { GatewayLanguageModel } from '@mastra/core/llm';
import type { RequestContext } from '@mastra/core/request-context';
import { loadSettings } from '../onboarding/settings.js';
import type { ThinkingLevelSetting } from '../thinking.js';
import { resolveModel, resolveModelWithFallback } from './model.js';

export type PrimaryAgentType = 'code-agent';
export type SpecializedSubagentType = 'explore' | 'plan' | 'build' | 'workflow-builder';
export type KnownAgentType = PrimaryAgentType | SpecializedSubagentType | string;

export interface AgentModelRoutingConfig {
  /** Model ID routing per agent type */
  agentModels: Record<string, string>;
  /** Optional fallback model IDs per agent type */
  fallbackModels?: Record<string, string[]>;
}

export const DEFAULT_SUBAGENT_MODELS: Record<string, string> = {
  'code-agent': 'openai/gpt-5.5',
  explore: 'openai/gpt-5.4-mini',
  plan: 'openai/gpt-5.5',
  build: 'anthropic/claude-sonnet-4-5',
  'workflow-builder': 'openai/gpt-5.5',
};

export class SubagentModelRouter {
  private routingConfig: AgentModelRoutingConfig;
  private settingsPath?: string;

  constructor(config?: Partial<AgentModelRoutingConfig>, settingsPath?: string) {
    this.settingsPath = settingsPath;
    this.routingConfig = {
      agentModels: {
        ...DEFAULT_SUBAGENT_MODELS,
        ...(config?.agentModels ?? {}),
      },
      fallbackModels: config?.fallbackModels ?? {},
    };
  }

  /**
   * Set or update model routing for a specific agent type.
   */
  setModelForAgent(agentType: KnownAgentType, modelId: string): void {
    this.routingConfig.agentModels[agentType] = modelId;
  }

  /**
   * Resolve configured model ID for a specific agent type.
   * Priority:
   * 1. Explicit override passed in parameters
   * 2. User settings (`models.subagentModels[agentType]` or `models.modeDefaults[agentType]`)
   * 3. Router instance configuration
   * 4. Default model fallback
   */
  resolveModelIdForAgent(agentType: KnownAgentType, overrideModelId?: string): string {
    if (overrideModelId) {
      return overrideModelId;
    }

    try {
      const settings = loadSettings(this.settingsPath);
      const configuredSubagentModel = settings.models?.subagentModels?.[agentType];
      if (configuredSubagentModel) {
        return configuredSubagentModel;
      }

      const configuredModeDefault = settings.models?.modeDefaults?.[agentType];
      if (configuredModeDefault) {
        return configuredModeDefault;
      }
    } catch {
      // Fall through to router config if settings reading fails
    }

    return (
      this.routingConfig.agentModels[agentType] ||
      DEFAULT_SUBAGENT_MODELS[agentType] ||
      DEFAULT_SUBAGENT_MODELS['code-agent']!
    );
  }

  /**
   * Resolve an actual GatewayLanguageModel instance for an agent type.
   */
  resolveAgentModel(
    agentType: KnownAgentType,
    options?: {
      overrideModelId?: string;
      thinkingLevel?: ThinkingLevelSetting;
      requestContext?: RequestContext;
      onFallback?: (failedModelId: string, fallbackModelId: string, error: unknown) => void;
    },
  ): GatewayLanguageModel {
    const primaryModelId = this.resolveModelIdForAgent(agentType, options?.overrideModelId);
    const fallbacks = this.routingConfig.fallbackModels?.[agentType] ?? [];

    if (fallbacks.length > 0) {
      return resolveModelWithFallback(primaryModelId, {
        fallbackModelIds: fallbacks,
        thinkingLevel: options?.thinkingLevel,
        requestContext: options?.requestContext,
        onFallback: options?.onFallback,
      });
    }

    return resolveModel(primaryModelId, {
      thinkingLevel: options?.thinkingLevel,
      requestContext: options?.requestContext,
    });
  }
}

export const defaultSubagentModelRouter = new SubagentModelRouter();

export function resolveAgentModel(
  agentType: KnownAgentType,
  options?: {
    overrideModelId?: string;
    thinkingLevel?: ThinkingLevelSetting;
    requestContext?: RequestContext;
  },
): GatewayLanguageModel {
  return defaultSubagentModelRouter.resolveAgentModel(agentType, options);
}
