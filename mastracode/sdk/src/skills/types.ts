export type SkillLevel = 'workspace' | 'user' | 'custom';

export type SkillType = 'prompt' | 'code' | 'hybrid';

export interface SkillMetadata {
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  userInvocable?: boolean;
  'user-invocable'?: boolean;
  goal?: boolean;
  tags?: string[];
  [key: string]: unknown;
}

export interface SkillDefinition {
  name: string;
  description: string;
  type: SkillType;
  level: SkillLevel;
  dirPath?: string;
  filePath?: string;
  metadata: SkillMetadata;
  instructions?: string;
  userInvocable: boolean;
  handler?: (params?: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface SkillDefinitionInput {
  name: string;
  description?: string;
  type?: SkillType;
  level?: SkillLevel;
  dirPath?: string;
  filePath?: string;
  metadata?: SkillMetadata;
  instructions?: string;
  userInvocable?: boolean;
  handler?: (params?: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface SkillExecutionResult {
  success: boolean;
  skillName: string;
  type: SkillType;
  result?: unknown;
  instructions?: string;
  error?: string;
}

export interface SkillRegistryOptions {
  /** Root directory of the project / workspace. */
  workspaceDir?: string;
  /** Home directory for user global skills. Defaults to os.homedir(). */
  homeDir?: string;
  /** Config directory name (e.g. '.mastra' or '.mastracode'). Defaults to '.mastra'. */
  configDir?: string;
  /** Custom / fallback skill directories (Level 3). */
  customSkillDirs?: string[];
  /** Allowed root paths for symlink sandbox checks. */
  allowedRoots?: string[];
  /** Enforce strict symlink sandboxing (default: true). */
  strictSymlinks?: boolean;
}

export interface SymlinkValidationResult {
  valid: boolean;
  linkPath: string;
  realPath?: string;
  reason?: string;
}

export interface SkillsSummary {
  total: number;
  workspaceCount: number;
  userCount: number;
  customCount: number;
  skills: Array<{
    name: string;
    level: SkillLevel;
    type: SkillType;
    userInvocable: boolean;
  }>;
}
