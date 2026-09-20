export interface WorkflowDagNode {
  id: string;
  name?: string;
  description?: string;
  dependencies?: string[];
  requiresApproval?: boolean;
}

export interface LayoutNode extends WorkflowDagNode {
  x: number;
  y: number;
  level: number;
}

export interface LayoutEdge {
  from: LayoutNode;
  to: LayoutNode;
}

export interface DagLayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

export function computeDagLayout(steps: WorkflowDagNode[]): DagLayoutResult {
  if (!steps || steps.length === 0) {
    return { nodes: [], edges: [], width: 600, height: 200 };
  }

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

    const maxDepLevel = Math.max(
      ...step.dependencies.map(depId => getLevel(depId, new Set(visited)))
    );
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
    levels[lvl].push(s.id);
  });

  const NODE_WIDTH = 180;
  const NODE_HEIGHT = 70;
  const LEVEL_GAP = 120;
  const NODE_GAP = 30;

  const maxLevelNodes = Math.max(...levels.map(l => l.length), 1);
  const calculatedWidth = Math.max(600, levels.length * (NODE_WIDTH + LEVEL_GAP) + 60);
  const calculatedHeight = Math.max(220, maxLevelNodes * (NODE_HEIGHT + NODE_GAP) + 60);

  const layoutNodesMap = new Map<string, LayoutNode>();

  levels.forEach((lvlNodes, lvlIndex) => {
    const startX = 40 + lvlIndex * (NODE_WIDTH + LEVEL_GAP);
    const totalHeight = lvlNodes.length * NODE_HEIGHT + (lvlNodes.length - 1) * NODE_GAP;
    const startY = (calculatedHeight - totalHeight) / 2;

    lvlNodes.forEach((stepId, nodeIdx) => {
      const step = steps.find(s => s.id === stepId)!;
      const x = startX;
      const y = startY + nodeIdx * (NODE_HEIGHT + NODE_GAP);
      const node: LayoutNode = { ...step, x, y, level: lvlIndex };
      layoutNodesMap.set(stepId, node);
    });
  });

  const layoutNodes = Array.from(layoutNodesMap.values());
  const layoutEdges: LayoutEdge[] = [];

  steps.forEach(step => {
    const toNode = layoutNodesMap.get(step.id);
    if (toNode && step.dependencies) {
      step.dependencies.forEach(depId => {
        const fromNode = layoutNodesMap.get(depId);
        if (fromNode) {
          layoutEdges.push({ from: fromNode, to: toNode });
        }
      });
    }
  });

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: calculatedWidth,
    height: calculatedHeight,
  };
}
