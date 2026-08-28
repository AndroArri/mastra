import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkflowDagViewer } from '../WorkflowDagViewer';

describe('WorkflowDagViewer Component', () => {
  const mockSteps = [
    { id: 'step1', name: 'Step 1: Init' },
    { id: 'step2', name: 'Step 2: Process', dependencies: ['step1'] },
    { id: 'step3', name: 'Step 3: Approval', dependencies: ['step2'], requiresApproval: true },
  ];

  it('renders all workflow DAG step nodes and status indicators', () => {
    const stepStates = {
      step1: { status: 'success' as const, output: { ok: true } },
      step2: { status: 'running' as const },
      step3: { status: 'pending' as const },
    };

    render(<WorkflowDagViewer steps={mockSteps} stepStates={stepStates} />);

    expect(screen.getByText('Step 1: Init')).toBeInTheDocument();
    expect(screen.getByText('Step 2: Process')).toBeInTheDocument();
    expect(screen.getByText('Step 3: Approval')).toBeInTheDocument();

    expect(screen.getByText('Success')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('renders resume button for suspended steps and triggers callback', () => {
    const onResumeStep = vi.fn();
    const stepStates = {
      step1: { status: 'success' as const },
      step2: { status: 'success' as const },
      step3: { status: 'suspended' as const },
    };

    render(
      <WorkflowDagViewer
        steps={mockSteps}
        stepStates={stepStates}
        onResumeStep={onResumeStep}
      />
    );

    const resumeBtn = screen.getByRole('button', { name: /resume/i });
    expect(resumeBtn).toBeInTheDocument();

    fireEvent.click(resumeBtn);
    expect(onResumeStep).toHaveBeenCalledWith('step3');
  });
});
