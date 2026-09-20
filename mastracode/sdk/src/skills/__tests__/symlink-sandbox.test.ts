import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectValidSkillDirectories, isSymlinkSafe, validateSymlink } from '../symlink-sandbox.js';

const isWin = process.platform === 'win32';

async function createSymlink(target: string, linkPath: string, type: 'dir' | 'file' = 'dir') {
  const symlinkType = isWin && type === 'dir' ? 'junction' : type;
  try {
    await fs.symlink(target, linkPath, symlinkType);
  } catch (err: any) {
    if (isWin && (err.code === 'EPERM' || err.code === 'UNKNOWN')) {
      await fs.symlink(target, linkPath, 'junction');
    } else {
      throw err;
    }
  }
}

describe('Symlink Sandboxing Security Tests', () => {
  let tempDir: string;
  let workspaceDir: string;
  let outsideDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-sandbox-test-'));
    workspaceDir = path.join(tempDir, 'workspace');
    outsideDir = path.join(tempDir, 'outside');

    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('allows valid symlink pointing inside the workspace boundary', async () => {
    const targetSkill = path.join(workspaceDir, 'internal-skill');
    await fs.mkdir(targetSkill, { recursive: true });
    await fs.writeFile(path.join(targetSkill, 'SKILL.md'), '# Internal Skill');

    const skillsDir = path.join(workspaceDir, '.mastra', 'skills');
    await fs.mkdir(skillsDir, { recursive: true });

    const symlinkPath = path.join(skillsDir, 'internal-skill');
    await createSymlink(targetSkill, symlinkPath, 'dir');

    const result = validateSymlink(symlinkPath, [workspaceDir]);
    expect(result.valid).toBe(true);
    expect(result.realPath).toBe(await fs.realpath(targetSkill));
    expect(isSymlinkSafe(symlinkPath, [workspaceDir])).toBe(true);
  });

  it('rejects symlink pointing outside the workspace boundary (directory traversal)', async () => {
    const secretTarget = path.join(outsideDir, 'secret-skill');
    await fs.mkdir(secretTarget, { recursive: true });
    await fs.writeFile(path.join(secretTarget, 'SKILL.md'), '# Secret Outside Skill');

    const skillsDir = path.join(workspaceDir, '.mastra', 'skills');
    await fs.mkdir(skillsDir, { recursive: true });

    const maliciousSymlink = path.join(skillsDir, 'escaped-skill');
    await createSymlink(secretTarget, maliciousSymlink, 'dir');

    const result = validateSymlink(maliciousSymlink, [workspaceDir]);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('escapes all allowed sandbox boundaries');
    expect(isSymlinkSafe(maliciousSymlink, [workspaceDir])).toBe(false);
  });

  it('rejects broken symlinks gracefully', async () => {
    const nonExistentTarget = path.join(workspaceDir, 'does-not-exist');
    const skillsDir = path.join(workspaceDir, '.mastra', 'skills');
    await fs.mkdir(skillsDir, { recursive: true });

    const brokenSymlink = path.join(skillsDir, 'broken-link');
    await createSymlink(nonExistentTarget, brokenSymlink, 'dir');

    const result = validateSymlink(brokenSymlink, [workspaceDir]);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Path does not exist|broken symlink/i);
  });

  it('rejects circular symlinks without crashing or infinite loop', async () => {
    const skillsDir = path.join(workspaceDir, '.mastra', 'skills');
    await fs.mkdir(skillsDir, { recursive: true });

    const linkA = path.join(skillsDir, 'link-a');
    const linkB = path.join(skillsDir, 'link-b');

    // Create circular reference linkA -> linkB -> linkA
    await createSymlink(linkB, linkA, 'file');
    await createSymlink(linkA, linkB, 'file');

    const result = validateSymlink(linkA, [workspaceDir]);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/circular symlink|Path does not exist/i);
  });

  it('collectValidSkillDirectories filters out malicious and broken symlinks', async () => {
    const skillsDir = path.join(workspaceDir, '.mastra', 'skills');
    await fs.mkdir(skillsDir, { recursive: true });

    // Valid internal skill directory
    const validSkill = path.join(skillsDir, 'valid-skill');
    await fs.mkdir(validSkill, { recursive: true });

    // Valid symlinked skill (inside workspace)
    const sharedSkill = path.join(workspaceDir, 'shared-skill');
    await fs.mkdir(sharedSkill, { recursive: true });
    const validSymlink = path.join(skillsDir, 'valid-symlink');
    await createSymlink(sharedSkill, validSymlink, 'dir');

    // Escaping symlink (pointing outside workspace)
    const escapedTarget = path.join(outsideDir, 'outside-skill');
    await fs.mkdir(escapedTarget, { recursive: true });
    const escapedSymlink = path.join(skillsDir, 'escaped-symlink');
    await createSymlink(escapedTarget, escapedSymlink, 'dir');

    // Broken symlink
    const brokenSymlink = path.join(skillsDir, 'broken-symlink');
    await createSymlink(path.join(workspaceDir, 'non-existent'), brokenSymlink, 'dir');

    const collected = collectValidSkillDirectories(skillsDir, [workspaceDir]);

    expect(collected).toContain(validSkill);
    expect(collected).toContain(validSymlink);
    expect(collected).not.toContain(escapedSymlink);
    expect(collected).not.toContain(brokenSymlink);
  });
});
