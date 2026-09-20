import { describe, it, expect } from 'vitest';
import { computeDagLayout } from '../dag-layout.js';

describe('Workflow DAG Layout Calculator', () => {
  const steps = [
    { id: 'stepA', name: 'Step A' },
    { id: 'stepB', name: 'Step B' },
    { id: 'stepC', name: 'Step C', dependencies: ['stepA', 'stepB'] },
    { id: 'stepD', name: 'Step D', dependencies: ['stepC'] },
  ];

  it('correctly calculates topological levels and positions for DAG nodes', () => {
    const layout = computeDagLayout(steps);

    expect(layout.nodes).toHaveLength(4);

    const nodeA = layout.nodes.find(n => n.id === 'stepA');
    const nodeB = layout.nodes.find(n => n.id === 'stepB');
    const nodeC = layout.nodes.find(n => n.id === 'stepC');
    const nodeD = layout.nodes.find(n => n.id === 'stepD');

    expect(nodeA?.level).toBe(0);
    expect(nodeB?.level).toBe(0);
    expect(nodeC?.level).toBe(1);
    expect(nodeD?.level).toBe(2);

    expect(nodeC?.x).toBeGreaterThan(nodeA?.x || 0);
    expect(nodeD?.x).toBeGreaterThan(nodeC?.x || 0);
  });

  it('correctly creates edges for step dependencies', () => {
    const layout = computeDagLayout(steps);

    expect(layout.edges).toHaveLength(3);

    const edgeAC = layout.edges.find(e => e.from.id === 'stepA' && e.to.id === 'stepC');
    const edgeBC = layout.edges.find(e => e.from.id === 'stepB' && e.to.id === 'stepC');
    const edgeCD = layout.edges.find(e => e.from.id === 'stepC' && e.to.id === 'stepD');

    expect(edgeAC).toBeDefined();
    expect(edgeBC).toBeDefined();
    expect(edgeCD).toBeDefined();
  });
});
