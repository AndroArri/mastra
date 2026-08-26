/**
 * Real-time terminal execution tree renderer for subagents.
 * Renders hierarchical execution nodes with tree branching characters (├──, └──, │),
 * status indicators, models, and execution duration.
 */

import { Text } from '@earendil-works/pi-tui';
import type { TUI } from '@earendil-works/pi-tui';
import type { SubagentExecutionNode } from '@mastra/code-sdk';
import chalk from 'chalk';
import { BOX_INDENT, theme } from '../theme.js';
import { WidthAwareContainer } from './width-aware-container.js';

export interface SubagentExecutionTreeOptions {
  label?: string;
}

export class SubagentExecutionTreeComponent extends WidthAwareContainer {
  private ui: TUI;
  private nodes: SubagentExecutionNode[] = [];
  private label: string;

  constructor(nodes: SubagentExecutionNode[], ui: TUI, options?: SubagentExecutionTreeOptions) {
    super();
    this.nodes = nodes;
    this.ui = ui;
    this.label = options?.label ?? 'Subagent Execution Tree';
    this.rebuild();
  }

  public updateTree(nodes: SubagentExecutionNode[]): void {
    this.nodes = nodes;
    this.rebuild();
  }

  protected rebuildForWidth(termWidth: number): void {
    this.clear();

    if (!this.nodes || this.nodes.length === 0) {
      return;
    }

    const header = theme.bold(theme.fg('accent', `=== ${this.label} ===`));
    this.addChild(new Text(header, BOX_INDENT, 0));

    for (let i = 0; i < this.nodes.length; i++) {
      const isLast = i === this.nodes.length - 1;
      this.renderNode(this.nodes[i]!, '', isLast, termWidth);
    }

    this.invalidate();
    this.ui.requestRender();
  }

  private renderNode(node: SubagentExecutionNode, prefix: string, isLast: boolean, termWidth: number): void {
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = prefix + (isLast ? '    ' : '│   ');

    const statusSymbol =
      node.status === 'completed'
        ? chalk.green('✓')
        : node.status === 'failed'
          ? chalk.red('✗')
          : node.status === 'running'
            ? chalk.blue('⏳')
            : chalk.gray('○');

    const durationStr = node.endTime
      ? formatDuration(node.endTime - node.startTime)
      : formatDuration(Date.now() - node.startTime);

    const agentTag = chalk.bgBlue.black(` ${node.agentType} `);
    const modelTag = node.modelId ? chalk.gray(`[${node.modelId}]`) : '';
    const taskSummary = node.task.length > 50 ? `${node.task.slice(0, 47)}...` : node.task;

    const lineText = `${prefix}${connector}${statusSymbol} ${agentTag} ${taskSummary} ${modelTag} ${chalk.dim(durationStr)}`;
    this.addChild(new Text(lineText, BOX_INDENT, 0));

    if (node.children && node.children.length > 0) {
      for (let j = 0; j < node.children.length; j++) {
        const isChildLast = j === node.children.length - 1;
        this.renderNode(node.children[j]!, childPrefix, isChildLast, termWidth);
      }
    }
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
