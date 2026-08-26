/**
 * Subagent management panel component for inspecting and controlling subagents in TUI.
 * Uses pi-tui overlay pattern.
 */
import { Box, Container, getKeybindings, matchesKey, Spacer, Text } from '@earendil-works/pi-tui';
import type { Focusable, TUI } from '@earendil-works/pi-tui';
import chalk from 'chalk';
import { decodePrintableShortcut } from '../key-input.js';
import type { SubagentRunRecord, TUIState } from '../state.js';
import { theme } from '../theme.js';

export interface SubagentPanelOptions {
  tui: TUI;
  state: TUIState;
  onSelectModel: (agentType: string) => void;
  onClose: () => void;
}

export class SubagentPanelComponent extends Container implements Focusable {
  public focused: boolean = false;
  private tui: TUI;
  private state: TUIState;
  private onSelectModel: (agentType: string) => void;
  private onCloseCallback: () => void;

  private activeTab: 'runs' | 'models' = 'runs';
  private viewMode: 'list' | 'transcript' = 'list';
  private selectedRunIndex: number = 0;
  private selectedModelIndex: number = 0;
  private transcriptScrollOffset: number = 0;

  constructor(options: SubagentPanelOptions) {
    super();
    this.tui = options.tui;
    this.state = options.state;
    this.onSelectModel = options.onSelectModel;
    this.onCloseCallback = options.onClose;

    this.rebuild();
  }

  private getRuns(): SubagentRunRecord[] {
    return Array.from(this.state.subagentRuns.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  private getAgentTypes(): Array<{ id: string; label: string; description: string }> {
    const controllerWithConfig = this.state.controller as unknown as {
      config?: { subagents?: Array<{ id: string; name: string; description: string }> };
    };
    const configured = controllerWithConfig.config?.subagents;
    if (configured && configured.length > 0) {
      return configured.map(s => ({ id: s.id, label: s.name, description: s.description }));
    }
    return [
      { id: 'explore', label: 'Explore', description: 'Read-only codebase exploration' },
      { id: 'plan', label: 'Plan', description: 'Read-only analysis and planning' },
      { id: 'execute', label: 'Execute', description: 'Task execution with write access' },
    ];
  }

  private rebuild(): void {
    this.children = [];

    // Header
    const titleBox = new Box(1, 0);
    titleBox.addChild(new Text(chalk.bold.cyan('╭── Subagents Management Panel ──────────────────────────────────╮')));
    this.addChild(titleBox);

    // Tab bar
    const tabBar = new Box(1, 0);
    const runsCount = this.state.subagentRuns.size;
    const runsTabStr = this.activeTab === 'runs'
      ? chalk.bold.bgCyan.black(` [1] Runs & Activity (${runsCount}) `)
      : chalk.gray(` [1] Runs & Activity (${runsCount}) `);
    const modelsTabStr = this.activeTab === 'models'
      ? chalk.bold.bgCyan.black(' [2] Model Configuration ')
      : chalk.gray(' [2] Model Configuration ');
    tabBar.addChild(new Text(`${runsTabStr} ${modelsTabStr}`));
    this.addChild(tabBar);
    this.addChild(new Spacer(1));

    if (this.viewMode === 'transcript') {
      this.renderTranscriptView();
    } else if (this.activeTab === 'runs') {
      this.renderRunsTab();
    } else {
      this.renderModelsTab();
    }
  }

  private renderRunsTab(): void {
    const runs = this.getRuns();
    if (runs.length === 0) {
      const emptyBox = new Box(1, 0);
      emptyBox.addChild(new Text(chalk.yellow('No subagent executions recorded in this session.')));
      this.addChild(emptyBox);
      this.addChild(new Spacer(1));
    } else {
      if (this.selectedRunIndex < 0) this.selectedRunIndex = 0;
      if (this.selectedRunIndex >= runs.length) this.selectedRunIndex = runs.length - 1;

      const runsBox = new Box(1, 0);
      runs.forEach((run, idx) => {
        const isSelected = idx === this.selectedRunIndex;
        const prefix = isSelected ? chalk.cyan('› ') : '  ';

        let statusIcon = chalk.yellow('⋯');
        if (run.status === 'completed') statusIcon = chalk.green('✓');
        else if (run.status === 'error') statusIcon = chalk.red('✗');
        else if (run.status === 'aborted') statusIcon = chalk.gray('⊘');

        const durationStr = run.durationMs
          ? `${(run.durationMs / 1000).toFixed(1)}s`
          : run.endedAt
            ? `${((run.endedAt - run.startedAt) / 1000).toFixed(1)}s`
            : `${((Date.now() - run.startedAt) / 1000).toFixed(1)}s`;

        const typeStr = chalk.bold(run.agentType.padEnd(8));
        const modelStr = run.modelId ? chalk.dim(`[${run.modelId}]`) : '';
        const taskPreview = run.task.length > 40 ? run.task.slice(0, 37) + '...' : run.task;

        let lineText = `${prefix}${statusIcon} ${typeStr} ${taskPreview.padEnd(40)} ${modelStr} (${durationStr})`;
        if (isSelected) {
          lineText = chalk.bgGray(lineText);
        }
        runsBox.addChild(new Text(lineText));
      });
      this.addChild(runsBox);
      this.addChild(new Spacer(1));
    }

    // Controls footer
    const footerBox = new Box(1, 0);
    footerBox.addChild(
      new Text(
        chalk.dim(
          'Controls: [↑/↓] Navigate  [Enter/v] View Transcript  [x] Stop Run  [m] Configure Model  [Tab] Switch Tab  [Esc] Close',
        ),
      ),
    );
    this.addChild(footerBox);
  }

  private renderModelsTab(): void {
    const agentTypes = this.getAgentTypes();
    if (this.selectedModelIndex < 0) this.selectedModelIndex = 0;
    if (this.selectedModelIndex >= agentTypes.length) this.selectedModelIndex = agentTypes.length - 1;

    const modelsBox = new Box(1, 0);
    modelsBox.addChild(new Text(chalk.bold('Subagent Model Configurations:')));
    modelsBox.addChild(new Spacer(1));

    agentTypes.forEach((at, idx) => {
      const isSelected = idx === this.selectedModelIndex;
      const prefix = isSelected ? chalk.cyan('› ') : '  ';

      const currentModel = this.state.session.subagents.model.get({ agentType: at.id });
      const modelDisplay = currentModel ? chalk.green(currentModel) : chalk.dim('Default (Inherit)');

      let lineText = `${prefix}${chalk.bold(at.label.padEnd(10))} ${at.description.padEnd(35)} Model: ${modelDisplay}`;
      if (isSelected) {
        lineText = chalk.bgGray(lineText);
      }
      modelsBox.addChild(new Text(lineText));
    });
    this.addChild(modelsBox);
    this.addChild(new Spacer(1));

    const footerBox = new Box(1, 0);
    footerBox.addChild(
      new Text(chalk.dim('Controls: [↑/↓] Select Type  [Enter] Change Model  [Tab] Switch Tab  [Esc] Close')),
    );
    this.addChild(footerBox);
  }

  private renderTranscriptView(): void {
    const runs = this.getRuns();
    const run = runs[this.selectedRunIndex];
    if (!run) {
      this.viewMode = 'list';
      this.rebuild();
      return;
    }

    const headerBox = new Box(1, 0);
    headerBox.addChild(
      new Text(chalk.bold.yellow(`Transcript Inspector: ${run.agentType} subagent (${run.toolCallId})`)),
    );
    headerBox.addChild(new Text(chalk.dim(`Task: ${run.task}`)));
    const statusColor = run.status === 'completed' ? chalk.green : run.status === 'running' ? chalk.yellow : chalk.red;
    headerBox.addChild(new Text(chalk.dim(`Status: ${statusColor(run.status.toUpperCase())} | Model: ${run.modelId ?? 'default'}`)));
    headerBox.addChild(new Spacer(1));
    this.addChild(headerBox);

    const bodyBox = new Box(1, 0);
    if (run.activities.length === 0) {
      bodyBox.addChild(new Text(chalk.dim('  (No activity log records captured yet)')));
    } else {
      const activitiesToRender = run.activities.slice(this.transcriptScrollOffset, this.transcriptScrollOffset + 12);
      activitiesToRender.forEach(act => {
        if (act.kind === 'tool') {
          const statusChar = act.done ? (act.isError ? chalk.red('✗') : chalk.green('✓')) : chalk.yellow('⋯');
          const argsStr = act.args ? chalk.dim(` ${JSON.stringify(act.args)}`) : '';
          bodyBox.addChild(new Text(`  ${statusChar} ${chalk.cyan(act.name ?? 'tool')}${argsStr}`));
          if (act.result) {
            const preview = act.result.length > 80 ? act.result.slice(0, 77) + '...' : act.result;
            bodyBox.addChild(new Text(chalk.dim(`    └─ ${preview}`)));
          }
        } else if (act.kind === 'text') {
          const preview = (act.text ?? '').trim();
          if (preview.length > 0) {
            const truncated = preview.length > 100 ? preview.slice(0, 97) + '...' : preview;
            bodyBox.addChild(new Text(chalk.italic.gray(`  " ${truncated} "`)));
          }
        }
      });
    }

    if (run.finalResult) {
      bodyBox.addChild(new Spacer(1));
      bodyBox.addChild(new Text(chalk.bold('Final Result:')));
      const resLines = run.finalResult.split('\n').slice(0, 5);
      resLines.forEach(l => bodyBox.addChild(new Text(chalk.dim(`  ${l}`))));
    }

    this.addChild(bodyBox);
    this.addChild(new Spacer(1));

    const footerBox = new Box(1, 0);
    footerBox.addChild(
      new Text(chalk.dim('Controls: [↑/↓/PgUp/PgDn] Scroll  [x] Stop Subagent  [Esc/b] Back to List')),
    );
    this.addChild(footerBox);
  }

  public handleInput(data: string): void {
    const key = getKeybindings(data);
    const printable = decodePrintableShortcut(data);

    if (matchesKey(data, 'escape')) {
      if (this.viewMode === 'transcript') {
        this.viewMode = 'list';
        this.rebuild();
        this.tui.requestRender();
      } else {
        this.onCloseCallback();
      }
      return;
    }

    if (matchesKey(data, 'tab')) {
      this.activeTab = this.activeTab === 'runs' ? 'models' : 'runs';
      this.viewMode = 'list';
      this.rebuild();
      this.tui.requestRender();
      return;
    }

    if (printable === '1') {
      this.activeTab = 'runs';
      this.viewMode = 'list';
      this.rebuild();
      this.tui.requestRender();
      return;
    }

    if (printable === '2') {
      this.activeTab = 'models';
      this.viewMode = 'list';
      this.rebuild();
      this.tui.requestRender();
      return;
    }

    if (this.viewMode === 'transcript') {
      if (key === 'up' && this.transcriptScrollOffset > 0) {
        this.transcriptScrollOffset--;
        this.rebuild();
        this.tui.requestRender();
      } else if (key === 'down') {
        const runs = this.getRuns();
        const run = runs[this.selectedRunIndex];
        if (run && this.transcriptScrollOffset < Math.max(0, run.activities.length - 12)) {
          this.transcriptScrollOffset++;
          this.rebuild();
          this.tui.requestRender();
        }
      } else if (printable === 'b' || printable === 'B') {
        this.viewMode = 'list';
        this.rebuild();
        this.tui.requestRender();
      } else if (printable === 'x' || printable === 'X') {
        this.stopSelectedSubagent();
      }
      return;
    }

    // List mode
    if (this.activeTab === 'runs') {
      const runs = this.getRuns();
      if (key === 'up' && this.selectedRunIndex > 0) {
        this.selectedRunIndex--;
        this.rebuild();
        this.tui.requestRender();
      } else if (key === 'down' && this.selectedRunIndex < runs.length - 1) {
        this.selectedRunIndex++;
        this.rebuild();
        this.tui.requestRender();
      } else if (matchesKey(data, 'enter') || printable === 'v' || printable === 'V') {
        if (runs.length > 0 && runs[this.selectedRunIndex]) {
          this.viewMode = 'transcript';
          this.transcriptScrollOffset = 0;
          this.rebuild();
          this.tui.requestRender();
        }
      } else if (printable === 'm' || printable === 'M') {
        this.activeTab = 'models';
        this.rebuild();
        this.tui.requestRender();
      } else if (printable === 'x' || printable === 'X') {
        this.stopSelectedSubagent();
      }
    } else {
      // Models tab
      const agentTypes = this.getAgentTypes();
      if (key === 'up' && this.selectedModelIndex > 0) {
        this.selectedModelIndex--;
        this.rebuild();
        this.tui.requestRender();
      } else if (key === 'down' && this.selectedModelIndex < agentTypes.length - 1) {
        this.selectedModelIndex++;
        this.rebuild();
        this.tui.requestRender();
      } else if (matchesKey(data, 'enter')) {
        const selected = agentTypes[this.selectedModelIndex];
        if (selected) {
          this.onSelectModel(selected.id);
        }
      }
    }
  }

  private stopSelectedSubagent(): void {
    const runs = this.getRuns();
    const run = runs[this.selectedRunIndex];
    if (run && run.status === 'running') {
      run.status = 'aborted';
      run.endedAt = Date.now();
      const component = this.state.pendingSubagents.get(run.toolCallId);
      if (component) {
        component.finish(true, Date.now() - run.startedAt, 'Stopped by user');
        this.state.pendingSubagents.delete(run.toolCallId);
      }
      this.rebuild();
      this.tui.requestRender();
    }
  }
}
