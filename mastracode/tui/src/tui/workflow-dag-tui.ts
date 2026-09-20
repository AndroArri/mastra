import type { WorkflowStepState } from '@mastra/code-sdk/workflows/types';

export interface WorkflowDagTuiStep {
  id: string;
  name?: string;
  dependencies?: string[];
}

export interface WorkflowDagTuiStepState {
  status: WorkflowStepState;
  output?: unknown;
  error?: string;
}

// ANSI Escape Helpers for TUI Styling
const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
  red: '\x1b[31m',
  bgBlueBlack: '\x1b[44m\x1b[30m',
  bgGreenBlack: '\x1b[42m\x1b[30m',
  bgRedWhite: '\x1b[41m\x1b[37m',
  bgYellowBlack: '\x1b[43m\x1b[30m',
  bgMagentaWhite: '\x1b[45m\x1b[37m',
  bgGrayWhite: '\x1b[100m\x1b[37m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
};

export function renderWorkflowDagTui(
  steps: WorkflowDagTuiStep[],
  stepStates: Record<string, WorkflowDagTuiStepState> = {},
): string {
  if (!steps || steps.length === 0) {
    return `${ansi.gray}(empty workflow DAG)${ansi.reset}`;
  }

  // Calculate topological levels
  const levelMap = new Map<string, number>();

  const getLevel = (id: string, visited = new Set<string>()): number => {
    if (levelMap.has(id)) return levelMap.get(id)!;
    if (visited.has(id)) return 0;
    visited.add(id);

    const step = steps.find(s => s.id === id);
    if (!step || !step.dependencies || step.dependencies.length === 0) {
      levelMap.set(id, 0);
      return 0;
    }

    const maxDepLevel = Math.max(...step.dependencies.map(depId => getLevel(depId, new Set(visited))));
    const lvl = maxDepLevel + 1;
    levelMap.set(id, lvl);
    return lvl;
  };

  steps.forEach(s => getLevel(s.id));

  const levels: string[][] = [];
  steps.forEach(s => {
    const lvl = levelMap.get(s.id) ?? 0;
    while (levels.length <= lvl) {
      levels.push([]);
    }
    levels[lvl]!.push(s.id);
  });

  const getStatusBadge = (status: WorkflowStepState = 'pending') => {
    switch (status) {
      case 'running':
        return `${ansi.bgBlueBlack} ▶ RUNNING ${ansi.reset}`;
      case 'success':
        return `${ansi.bgGreenBlack} ✓ SUCCESS ${ansi.reset}`;
      case 'failed':
        return `${ansi.bgRedWhite} ✗ FAILED ${ansi.reset}`;
      case 'suspended':
        return `${ansi.bgYellowBlack} ⏸ SUSPENDED ${ansi.reset}`;
      case 'tripwire':
        return `${ansi.bgMagentaWhite} ⚠️ TRIPWIRE ${ansi.reset}`;
      default:
        return `${ansi.bgGrayWhite} ○ PENDING ${ansi.reset}`;
    }
  };

  const getStatusColor = (status: WorkflowStepState = 'pending') => {
    switch (status) {
      case 'running':
        return ansi.blue;
      case 'success':
        return ansi.green;
      case 'failed':
        return ansi.red;
      case 'suspended':
        return ansi.yellow;
      case 'tripwire':
        return ansi.magenta;
      default:
        return ansi.gray;
    }
  };

  const lines: string[] = [];

  levels.forEach((lvlStepIds, lvlIdx) => {
    lines.push(`${ansi.bold}${ansi.cyan}[ Layer ${lvlIdx + 1} ]${ansi.reset}`);

    lvlStepIds.forEach(stepId => {
      const step = steps.find(s => s.id === stepId)!;
      const stateInfo = stepStates[stepId] ?? { status: 'pending' };
      const badge = getStatusBadge(stateInfo.status);
      const color = getStatusColor(stateInfo.status);

      const title = step.name || stepId;
      const deps =
        step.dependencies && step.dependencies.length > 0
          ? `${ansi.gray} (deps: ${step.dependencies.join(', ')})${ansi.reset}`
          : '';

      const top = `${color}┌─ ${ansi.reset}${ansi.bold}${ansi.white}${title}${ansi.reset}${deps} ${color}${'─'.repeat(Math.max(2, 40 - title.length))}${ansi.reset}`;
      const mid = `${color}│ ${ansi.reset}${badge}${stateInfo.error ? `${ansi.red} Err: ${stateInfo.error}${ansi.reset}` : ''}`;
      const bot = `${color}└${'─'.repeat(45)}${ansi.reset}`;

      lines.push(top);
      lines.push(mid);
      lines.push(bot);
    });

    if (lvlIdx < levels.length - 1) {
      lines.push(`${ansi.gray}      │${ansi.reset}`);
      lines.push(`${ansi.gray}      ▼${ansi.reset}`);
    }
  });

  return lines.join('\n');
}
