import os from 'node:os';
import path from 'node:path';
import { parseSkillPath } from './parser.js';
import { collectValidSkillDirectories, validateSymlink } from './symlink-sandbox.js';
import type {
  SkillDefinition,
  SkillDefinitionInput,
  SkillExecutionResult,
  SkillLevel,
  SkillRegistryOptions,
  SkillsSummary,
  SkillType,
  SymlinkValidationResult,
} from './types.js';

export class SkillRegistry {
  private options: SkillRegistryOptions;
  private skillsMap: Map<string, SkillDefinition> = new Map();
  private levelSkills: Record<SkillLevel, Map<string, SkillDefinition>> = {
    workspace: new Map(),
    user: new Map(),
    custom: new Map(),
  };

  constructor(options: SkillRegistryOptions = {}) {
    this.options = {
      configDir: '.mastra',
      strictSymlinks: true,
      homeDir: options.homeDir || os.homedir(),
      ...options,
    };
  }

  /**
   * Clears all registered skills.
   */
  public clear(): void {
    this.skillsMap.clear();
    this.levelSkills.workspace.clear();
    this.levelSkills.user.clear();
    this.levelSkills.custom.clear();
  }

  /**
   * Resolves and loads all skills across the 3 hierarchical levels:
   * 1. Workspace (.mastra/skills/ > <configDir>/skills/ > .claude/skills/ > .agents/skills/)
   * 2. User Global (~/.mastra/skills/ > ~/<configDir>/skills/ > ~/.claude/skills/ > ~/.agents/skills/)
   * 3. Custom Config (customSkillDirs & programmatically registered skills)
   */
  public async load(): Promise<void> {
    this.clear();
    const { workspaceDirs, userDirs, customDirs } = this.resolveSkillDirectories();
    const allowedRoots = this.getAllowedRoots();

    // Level 3: Custom Config
    for (const dir of customDirs) {
      await this.scanDirectory(dir, 'custom', allowedRoots);
    }

    // Level 2: User Global
    const userAllowedRoots = allowedRoots.length > 0 ? allowedRoots : [this.options.homeDir || os.homedir()];
    for (const dir of userDirs) {
      await this.scanDirectory(dir, 'user', userAllowedRoots);
    }

    // Level 1: Workspace (Highest Precedence)
    if (this.options.workspaceDir) {
      const wsAllowedRoots = allowedRoots.length > 0 ? allowedRoots : [this.options.workspaceDir];
      for (const dir of workspaceDirs) {
        await this.scanDirectory(dir, 'workspace', wsAllowedRoots);
      }
    }

    this.rebuildConsolidatedMap();
  }

  /**
   * Returns allowed roots for symlink sandboxing.
   */
  public getAllowedRoots(): string[] {
    const roots: string[] = [];
    if (this.options.allowedRoots) {
      roots.push(...this.options.allowedRoots);
    }
    if (this.options.workspaceDir) {
      roots.push(this.options.workspaceDir);
    }
    if (this.options.homeDir) {
      roots.push(this.options.homeDir);
    }
    if (this.options.customSkillDirs) {
      roots.push(...this.options.customSkillDirs);
    }
    return Array.from(new Set(roots.map(r => path.resolve(r))));
  }

  /**
   * Resolves skill search paths organized by precedence within each level.
   */
  public resolveSkillDirectories(): {
    workspaceDirs: string[];
    userDirs: string[];
    customDirs: string[];
  } {
    const workspaceDir = this.options.workspaceDir ? path.resolve(this.options.workspaceDir) : undefined;
    const homeDir = path.resolve(this.options.homeDir || os.homedir());
    const configDirName = this.options.configDir || '.mastra';

    const workspaceDirs: string[] = [];
    if (workspaceDir) {
      workspaceDirs.push(path.join(workspaceDir, '.mastra', 'skills'));
      if (configDirName !== '.mastra') {
        workspaceDirs.push(path.join(workspaceDir, configDirName, 'skills'));
      }
      workspaceDirs.push(path.join(workspaceDir, '.mastracode', 'skills'));
      workspaceDirs.push(path.join(workspaceDir, '.claude', 'skills'));
      workspaceDirs.push(path.join(workspaceDir, '.agents', 'skills'));
    }

    const userDirs: string[] = [
      path.join(homeDir, '.mastra', 'skills'),
    ];
    if (configDirName !== '.mastra') {
      userDirs.push(path.join(homeDir, configDirName, 'skills'));
    }
    userDirs.push(path.join(homeDir, '.mastracode', 'skills'));
    userDirs.push(path.join(homeDir, '.claude', 'skills'));
    userDirs.push(path.join(homeDir, '.agents', 'skills'));

    const customDirs = (this.options.customSkillDirs || []).map(d => path.resolve(d));

    return {
      workspaceDirs: Array.from(new Set(workspaceDirs)),
      userDirs: Array.from(new Set(userDirs)),
      customDirs: Array.from(new Set(customDirs)),
    };
  }

  /**
   * Scans a specific skills root directory and parses contained skills.
   */
  private async scanDirectory(skillsRootDir: string, level: SkillLevel, allowedRoots: string[]): Promise<void> {
    const validSkillDirs = collectValidSkillDirectories(skillsRootDir, allowedRoots);

    for (const skillDir of validSkillDirs) {
      try {
        const skill = await parseSkillPath(skillDir, level);
        if (skill) {
          // Inside a level, earlier directories take precedence over later ones
          if (!this.levelSkills[level].has(skill.name)) {
            this.levelSkills[level].set(skill.name, skill);
          }
        }
      } catch {
        // Skip unparseable skills
      }
    }
  }

  /**
   * Rebuilds the consolidated skills map using 3-level hierarchical resolution:
   * Level 1 (Workspace) > Level 2 (User Global) > Level 3 (Custom Config).
   */
  private rebuildConsolidatedMap(): void {
    this.skillsMap.clear();

    // 1. Custom Config
    for (const skill of this.levelSkills.custom.values()) {
      this.skillsMap.set(skill.name, skill);
    }
    // 2. User Global (overwrites Custom)
    for (const skill of this.levelSkills.user.values()) {
      this.skillsMap.set(skill.name, skill);
    }
    // 3. Workspace (overwrites User Global and Custom)
    for (const skill of this.levelSkills.workspace.values()) {
      this.skillsMap.set(skill.name, skill);
    }
  }

  /**
   * List all resolved skills, optionally filtered by level, type, or userInvocable.
   */
  public listSkills(options?: {
    level?: SkillLevel;
    type?: SkillType;
    userInvocableOnly?: boolean;
  }): SkillDefinition[] {
    let skills = Array.from(this.skillsMap.values());

    if (options?.level) {
      skills = skills.filter(s => s.level === options.level);
    }
    if (options?.type) {
      skills = skills.filter(s => s.type === options.type);
    }
    if (options?.userInvocableOnly) {
      skills = skills.filter(s => s.userInvocable !== false);
    }

    return skills;
  }

  /**
   * Get a specific skill by name based on precedence resolution.
   */
  public getSkill(name: string): SkillDefinition | undefined {
    return this.skillsMap.get(name);
  }

  /**
   * Checks if a skill exists.
   */
  public hasSkill(name: string): boolean {
    return this.skillsMap.has(name);
  }

  /**
   * Register a skill programmatically.
   */
  public registerSkill(input: SkillDefinitionInput): SkillDefinition {
    const level: SkillLevel = input.level || 'custom';
    const type: SkillType = input.type || (input.handler && input.instructions ? 'hybrid' : input.handler ? 'code' : 'prompt');
    const name = input.name;

    const skill: SkillDefinition = {
      name,
      description: input.description || `Skill ${name}`,
      type,
      level,
      dirPath: input.dirPath,
      filePath: input.filePath,
      metadata: input.metadata || {},
      instructions: input.instructions,
      userInvocable: input.userInvocable ?? true,
      handler: input.handler,
    };

    this.levelSkills[level].set(name, skill);
    this.rebuildConsolidatedMap();
    return skill;
  }

  /**
   * Unregister a skill by name.
   */
  public unregisterSkill(name: string): boolean {
    let found = false;

    if (this.levelSkills.workspace.delete(name)) found = true;
    if (this.levelSkills.user.delete(name)) found = true;
    if (this.levelSkills.custom.delete(name)) found = true;

    if (found) {
      this.rebuildConsolidatedMap();
    }
    return found;
  }

  /**
   * Executes a skill by name (prompt-driven or code-driven).
   */
  public async executeSkill(name: string, params?: Record<string, unknown>): Promise<SkillExecutionResult> {
    const skill = this.getSkill(name);
    if (!skill) {
      return {
        success: false,
        skillName: name,
        type: 'prompt',
        error: `Skill "${name}" not found in registry`,
      };
    }

    if (skill.handler) {
      try {
        const result = await skill.handler(params);
        return {
          success: true,
          skillName: name,
          type: skill.type,
          result,
          instructions: skill.instructions,
        };
      } catch (err) {
        return {
          success: false,
          skillName: name,
          type: skill.type,
          error: err instanceof Error ? err.message : String(err),
          instructions: skill.instructions,
        };
      }
    }

    return {
      success: true,
      skillName: name,
      type: skill.type,
      instructions: skill.instructions,
      result: skill.instructions,
    };
  }

  /**
   * Group skills by resolution level.
   */
  public getSkillsByLevel(): Record<SkillLevel, SkillDefinition[]> {
    return {
      workspace: Array.from(this.levelSkills.workspace.values()),
      user: Array.from(this.levelSkills.user.values()),
      custom: Array.from(this.levelSkills.custom.values()),
    };
  }

  /**
   * Returns a structured summary of the registry for TUI and Factory UI displays.
   */
  public getSummary(): SkillsSummary {
    const skills = this.listSkills();
    return {
      total: skills.length,
      workspaceCount: this.levelSkills.workspace.size,
      userCount: this.levelSkills.user.size,
      customCount: this.levelSkills.custom.size,
      skills: skills.map(s => ({
        name: s.name,
        level: s.level,
        type: s.type,
        userInvocable: s.userInvocable,
      })),
    };
  }

  /**
   * Helper to format all available prompt instructions into an XML/Markdown skills catalog
   * suitable for agent prompt injection.
   */
  public formatSkillsCatalog(skills?: SkillDefinition[]): string {
    const targetSkills = skills || this.listSkills({ userInvocableOnly: true });
    if (targetSkills.length === 0) return '';

    const lines: string[] = ['<available_skills>'];
    for (const skill of targetSkills) {
      lines.push(`  <skill name="${skill.name}" level="${skill.level}" type="${skill.type}">`);
      lines.push(`    <description>${skill.description}</description>`);
      if (skill.instructions) {
        lines.push(`    <instructions>\n${skill.instructions}\n    </instructions>`);
      }
      lines.push(`  </skill>`);
    }
    lines.push('</available_skills>');
    return lines.join('\n');
  }

  /**
   * Validate symlink safety against the registry's allowed roots.
   */
  public validateSymlinkPath(linkPath: string): SymlinkValidationResult {
    return validateSymlink(linkPath, this.getAllowedRoots());
  }
}
