import React, { useState } from 'react';
import type { SubagentExecutionNode } from '@mastra/code-sdk';

export interface SubagentExecutionTreeProps {
  nodes: SubagentExecutionNode[];
  className?: string;
}

const AGENT_TYPE_BADGES: Record<string, { bg: string; text: string; label: string }> = {
  'code-agent': { bg: 'bg-purple-100 dark:bg-purple-950/40', text: 'text-purple-700 dark:text-purple-300', label: 'Primary Code Agent' },
  explore: { bg: 'bg-blue-100 dark:bg-blue-950/40', text: 'text-blue-700 dark:text-blue-300', label: 'Explore' },
  plan: { bg: 'bg-amber-100 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-300', label: 'Plan' },
  build: { bg: 'bg-emerald-100 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-300', label: 'Build' },
  'workflow-builder': { bg: 'bg-indigo-100 dark:bg-indigo-950/40', text: 'text-indigo-700 dark:text-indigo-300', label: 'Workflow Builder' },
};

function formatDuration(ms?: number): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const SubagentTreeNodeItem: React.FC<{ node: SubagentExecutionNode; isLast?: boolean }> = ({ node }) => {
  const [expanded, setExpanded] = useState(false);
  const duration = node.endTime ? node.endTime - node.startTime : Date.now() - node.startTime;
  const badgeConfig = AGENT_TYPE_BADGES[node.agentType] || {
    bg: 'bg-zinc-100 dark:bg-zinc-800',
    text: 'text-zinc-700 dark:text-zinc-300',
    label: node.agentType,
  };

  const statusIcons = {
    pending: <span className="w-2 h-2 rounded-full bg-zinc-400 inline-block mr-2" title="Pending" />,
    running: (
      <span className="inline-block mr-2 text-blue-500 animate-spin" title="Running">
        ⏳
      </span>
    ),
    completed: (
      <span className="inline-block mr-2 text-emerald-500 font-bold" title="Completed">
        ✓
      </span>
    ),
    failed: (
      <span className="inline-block mr-2 text-red-500 font-bold" title="Failed">
        ✗
      </span>
    ),
    cancelled: (
      <span className="inline-block mr-2 text-amber-500 font-bold" title="Cancelled">
        ⊘
      </span>
    ),
  };

  return (
    <div className="relative pl-4 border-l border-zinc-200 dark:border-zinc-800 my-2 text-sm font-sans">
      <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/60 dark:border-zinc-800/60">
        <div className="flex items-center gap-2 overflow-hidden min-w-0">
          {statusIcons[node.status] || statusIcons.pending}
          <span
            className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${badgeConfig.bg} ${badgeConfig.text}`}
          >
            {badgeConfig.label}
          </span>
          <span className="truncate text-zinc-900 dark:text-zinc-100 font-medium">{node.task}</span>
        </div>

        <div className="flex items-center gap-3 shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
          {node.modelId && (
            <span className="font-mono bg-zinc-200/50 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
              {node.modelId}
            </span>
          )}
          <span>{formatDuration(duration)}</span>
          {(node.result != null || node.error != null) && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
            >
              {expanded ? 'Collapse' : 'Details'}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-2 p-2.5 rounded bg-zinc-100/70 dark:bg-zinc-900 text-xs font-mono overflow-x-auto text-zinc-800 dark:text-zinc-200">
          {node.error && <div className="text-red-600 dark:text-red-400 font-semibold mb-1">Error: {node.error}</div>}
          {node.result && (
            <div>
              <span className="text-zinc-500 font-semibold block mb-1">Output:</span>
              <pre className="whitespace-pre-wrap">
                {typeof node.result === 'string' ? node.result : JSON.stringify(node.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {node.children && node.children.length > 0 && (
        <div className="ml-2 mt-1">
          {node.children.map(child => (
            <SubagentTreeNodeItem key={child.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
};

export const SubagentExecutionTree: React.FC<SubagentExecutionTreeProps> = ({ nodes, className = '' }) => {
  if (!nodes || nodes.length === 0) {
    return null;
  }

  return (
    <div className={`w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-zinc-200 dark:border-zinc-800">
        <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">Subagent Execution Tree</span>
        <span className="text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-2 py-0.5 rounded-full font-mono">
          {nodes.length} root node{nodes.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div>
        {nodes.map(node => (
          <SubagentTreeNodeItem key={node.id} node={node} />
        ))}
      </div>
    </div>
  );
};
