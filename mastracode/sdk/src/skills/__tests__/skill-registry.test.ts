import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SkillRegistry } from '../registry.js';

describe('SkillRegistry 3-Level Hierarchical Resolution & Integration Tests', () => {
  let tempDir: string;
  let workspaceDir: string;
  let homeDir: string;
  let customDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-registry-test-'));
    workspaceDir = path.join(tempDir, 'workspace');
    homeDir = path.join(tempDir, 'home');
    customDir = path.join(tempDir, 'custom-skills');

    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(homeDir, { recursive: true });
    await fs.mkdir(customDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('resolves skills using 3-level hierarchy (Workspace > User Global > Custom Config)', async () => {
    // 1. Level 3 (Custom Config)
    const customSkillDir = path.join(customDir, 'shared-skill');
    await fs.mkdir(customSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(customSkillDir, 'SKILL.md'),
      '---\nname: shared-skill\ndescription: Custom Config Version\n---\nCustom skill instructions',
    );

    // 2. Level 2 (User Global)
    const userSkillsDir = path.join(homeDir, '.mastra', 'skills');
    const userSkillDir = path.join(userSkillsDir, 'shared-skill');
    await fs.mkdir(userSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(userSkillDir, 'SKILL.md'),
      '---\nname: shared-skill\ndescription: User Global Version\n---\nUser global skill instructions',
    );

    // 3. Level 1 (Workspace)
    const wsSkillsDir = path.join(workspaceDir, '.mastra', 'skills');
    const wsSkillDir = path.join(wsSkillsDir, 'shared-skill');
    await fs.mkdir(wsSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(wsSkillDir, 'SKILL.md'),
      '---\nname: shared-skill\ndescription: Workspace Version\n---\nWorkspace skill instructions',
    );

    const registry = new SkillRegistry({
      workspaceDir,
      homeDir,
      customSkillDirs: [customDir],
    });

    await registry.load();

    // Verify Level 1 (Workspace) wins
    let skill = registry.getSkill('shared-skill');
    expect(skill).toBeDefined();
    expect(skill?.level).toBe('workspace');
    expect(skill?.description).toBe('Workspace Version');
    expect(skill?.instructions).toBe('Workspace skill instructions');

    // Remove Level 1 skill, reload -> Level 2 (User Global) wins
    await fs.rm(wsSkillDir, { recursive: true, force: true });
    await registry.load();

    skill = registry.getSkill('shared-skill');
    expect(skill).toBeDefined();
    expect(skill?.level).toBe('user');
    expect(skill?.description).toBe('User Global Version');
    expect(skill?.instructions).toBe('User global skill instructions');

    // Remove Level 2 skill, reload -> Level 3 (Custom Config) wins
    await fs.rm(userSkillDir, { recursive: true, force: true });
    await registry.load();

    skill = registry.getSkill('shared-skill');
    expect(skill).toBeDefined();
    expect(skill?.level).toBe('custom');
    expect(skill?.description).toBe('Custom Config Version');
    expect(skill?.instructions).toBe('Custom skill instructions');
  });

  it('respects precedence within Workspace (.mastra/skills > .mastracode/skills > .claude/skills > .agents/skills)', async () => {
    const mastraSkillDir = path.join(workspaceDir, '.mastra', 'skills', 'multi-format');
    const mastracodeSkillDir = path.join(workspaceDir, '.mastracode', 'skills', 'multi-format');
    const claudeSkillDir = path.join(workspaceDir, '.claude', 'skills', 'multi-format');

    await fs.mkdir(mastraSkillDir, { recursive: true });
    await fs.mkdir(mastracodeSkillDir, { recursive: true });
    await fs.mkdir(claudeSkillDir, { recursive: true });

    await fs.writeFile(
      path.join(mastraSkillDir, 'SKILL.md'),
      '---\nname: multi-format\ndescription: Mastra Format\n---\nMastra content',
    );
    await fs.writeFile(
      path.join(mastracodeSkillDir, 'SKILL.md'),
      '---\nname: multi-format\ndescription: Mastracode Format\n---\nMastracode content',
    );
    await fs.writeFile(
      path.join(claudeSkillDir, 'SKILL.md'),
      '---\nname: multi-format\ndescription: Claude Format\n---\nClaude content',
    );

    const registry = new SkillRegistry({ workspaceDir, homeDir });
    await registry.load();

    const skill = registry.getSkill('multi-format');
    expect(skill).toBeDefined();
    expect(skill?.description).toBe('Mastra Format');
    expect(skill?.instructions).toBe('Mastra content');
  });

  it('supports loading and executing prompt-driven skills', async () => {
    const wsSkillsDir = path.join(workspaceDir, '.mastra', 'skills', 'prompt-skill');
    await fs.mkdir(wsSkillsDir, { recursive: true });
    await fs.writeFile(
      path.join(wsSkillsDir, 'SKILL.md'),
      '---\nname: prompt-skill\ndescription: Prompt Skill Test\nuser-invocable: true\ngoal: true\n---\n# Prompt Skill\nFollow these steps.',
    );

    const registry = new SkillRegistry({ workspaceDir, homeDir });
    await registry.load();

    const skill = registry.getSkill('prompt-skill');
    expect(skill).toBeDefined();
    expect(skill?.type).toBe('prompt');
    expect(skill?.userInvocable).toBe(true);
    expect(skill?.metadata.goal).toBe(true);

    const result = await registry.executeSkill('prompt-skill');
    expect(result.success).toBe(true);
    expect(result.type).toBe('prompt');
    expect(result.instructions).toContain('# Prompt Skill');
  });

  it('supports loading and executing code-driven skills', async () => {
    const registry = new SkillRegistry({ workspaceDir, homeDir });
    await registry.load();

    registry.registerSkill({
      name: 'calculator-skill',
      description: 'Performs calculations',
      type: 'code',
      level: 'custom',
      handler: async (params?: Record<string, unknown>) => {
        const a = (params?.a as number) || 0;
        const b = (params?.b as number) || 0;
        return { sum: a + b };
      },
    });

    expect(registry.hasSkill('calculator-skill')).toBe(true);

    const execResult = await registry.executeSkill('calculator-skill', { a: 5, b: 10 });
    expect(execResult.success).toBe(true);
    expect(execResult.type).toBe('code');
    expect(execResult.result).toEqual({ sum: 15 });
  });

  it('exposes APIs and helpers for TUI & Factory UI', async () => {
    const wsSkillsDir = path.join(workspaceDir, '.mastra', 'skills', 'tui-skill');
    await fs.mkdir(wsSkillsDir, { recursive: true });
    await fs.writeFile(
      path.join(wsSkillsDir, 'SKILL.md'),
      '---\nname: tui-skill\ndescription: Skill for TUI\n---\nTUI instructions',
    );

    const registry = new SkillRegistry({ workspaceDir, homeDir });
    await registry.load();

    registry.registerSkill({
      name: 'code-custom-skill',
      description: 'Code custom skill',
      type: 'code',
      level: 'custom',
    });

    const summary = registry.getSummary();
    expect(summary.total).toBe(2);
    expect(summary.workspaceCount).toBe(1);
    expect(summary.customCount).toBe(1);

    const byLevel = registry.getSkillsByLevel();
    expect(byLevel.workspace).toHaveLength(1);
    expect(byLevel.custom).toHaveLength(1);

    const catalog = registry.formatSkillsCatalog();
    expect(catalog).toContain('<available_skills>');
    expect(catalog).toContain('name="tui-skill"');
    expect(catalog).toContain('TUI instructions');
  });
});
