import React, { useMemo } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertTriangle,
  PauseCircle,
  Play,
} from 'lucide-react';
import type { WorkflowStepState } from '@mastra/code-sdk/workflows/types';
import { computeDagLayout, type WorkflowDagNode } from './dag-layout.js';

export type { WorkflowDagNode };

export interface WorkflowDagViewerProps {
  steps: WorkflowDagNode[];
  stepStates: Record<string, { status: WorkflowStepState; output?: unknown; error?: string }>;
  onStepClick?: (stepId: string) => void;
  onResumeStep?: (stepId: string) => void;
  className?: string;
}

export const WorkflowDagViewer: React.FC<WorkflowDagViewerProps> = ({
  steps,
  stepStates,
  onStepClick,
  onResumeStep,
  className = '',
}) => {
  const { nodes, edges, width, height } = useMemo(() => {
    return computeDagLayout(steps);
  }, [steps]);

  const getStatusBadge = (status: WorkflowStepState = 'pending') => {
    switch (status) {
      case 'running':
        return {
          color: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
          icon: <Loader2 className="w-4 h-4 animate-spin text-blue-500" />,
          label: 'Running',
        };
      case 'success':
        return {
          color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
          icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
          label: 'Success',
        };
      case 'failed':
        return {
          color: 'bg-red-500/10 text-red-500 border-red-500/30',
          icon: <XCircle className="w-4 h-4 text-red-500" />,
          label: 'Failed',
        };
      case 'suspended':
        return {
          color: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
          icon: <PauseCircle className="w-4 h-4 text-amber-500" />,
          label: 'Suspended (HITL)',
        };
      case 'tripwire':
        return {
          color: 'bg-rose-950/40 text-rose-400 border-rose-600/50',
          icon: <AlertTriangle className="w-4 h-4 text-rose-400" />,
          label: 'Tripwire',
        };
      default:
        return {
          color: 'bg-zinc-800 text-zinc-400 border-zinc-700',
          icon: <Clock className="w-4 h-4 text-zinc-500" />,
          label: 'Pending',
        };
    }
  };

  return (
    <div className={`relative overflow-auto border border-zinc-800 bg-zinc-950 rounded-xl p-4 ${className}`}>
      <svg width={width} height={height} className="block">
        <defs>
          <marker
            id="dag-arrow"
            viewBox="0 0 10 10"
            refX="6"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#52525b" />
          </marker>
        </defs>

        {/* Draw Edges */}
        {edges.map((edge, idx) => {
          const startX = edge.from.x + 180;
          const startY = edge.from.y + 35;
          const endX = edge.to.x;
          const endY = edge.to.y + 35;

          const controlX1 = startX + 50;
          const controlX2 = endX - 50;

          const pathD = `M ${startX} ${startY} C ${controlX1} ${startY}, ${controlX2} ${endY}, ${endX} ${endY}`;

          return (
            <path
              key={`${edge.from.id}->${edge.to.id}-${idx}`}
              d={pathD}
              fill="none"
              stroke="#3f3f46"
              strokeWidth="2"
              markerEnd="url(#dag-arrow)"
            />
          );
        })}
      </svg>

      {/* Render Nodes overlay */}
      <div className="absolute top-4 left-4" style={{ width, height }}>
        {nodes.map(node => {
          const stateInfo = stepStates[node.id] ?? { status: 'pending' };
          const badge = getStatusBadge(stateInfo.status);

          return (
            <div
              key={node.id}
              onClick={() => onStepClick?.(node.id)}
              style={{
                position: 'absolute',
                left: `${node.x}px`,
                top: `${node.y}px`,
                width: '180px',
                height: '70px',
              }}
              className={`flex flex-col justify-between p-3 rounded-lg border text-xs cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg ${badge.color}`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-semibold text-zinc-100 truncate">{node.name || node.id}</span>
                {badge.icon}
              </div>

              <div className="flex items-center justify-between mt-1 text-[10px]">
                <span className="opacity-80">{badge.label}</span>
                {stateInfo.status === 'suspended' && onResumeStep && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onResumeStep(node.id);
                    }}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500 text-zinc-950 font-bold hover:bg-amber-400 transition-colors"
                  >
                    <Play className="w-2.5 h-2.5 fill-current" />
                    Resume
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
