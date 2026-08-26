import { describe, it, expect } from 'vitest';
import { renderWorkflowDagTui } from '../workflow-dag-tui.js';

describe('TUI Workflow DAG Renderer', () => {
  const mockSteps = [
    { id: 'step1', name: 'Step 1: Init' },
    { id: 'step2', name: 'Step 2: Fetch Data', dependencies: ['step1'] },
    { id: 'step3', name: 'Step 3: Process', dependencies: ['step2'] },
  ];

  it('renders TUI DAG with step titles, levels, and real-time status badges', () => {
    const stepStates = {
      step1: { status: 'success' as const },
      step2: { status: 'running' as const },
      step3: { status: 'pending' as const },
    };

    const output = renderWorkflowDagTui(mockSteps, stepStates);

    expect(output).toContain('Layer 1');
    expect(output).toContain('Layer 2');
    expect(output).toContain('Layer 3');

    expect(output).toContain('Step 1: Init');
    expect(output).toContain('Step 2: Fetch Data');
    expect(output).toContain('Step 3: Process');

    expect(output).toContain('SUCCESS');
    expect(output).toContain('RUNNING');
    expect(output).toContain('PENDING');
  });

  it('renders tripwire and suspended HITL statuses correctly in TUI', () => {
    const stepStates = {
      step1: { status: 'success' as const },
      step2: { status: 'suspended' as const },
      step3: { status: 'tripwire' as const, error: 'Max executions hit' },
    };

    const output = renderWorkflowDagTui(mockSteps, stepStates);

    expect(output).toContain('SUSPENDED');
    expect(output).toContain('TRIPWIRE');
    expect(output).toContain('Max executions hit');
  });
});
