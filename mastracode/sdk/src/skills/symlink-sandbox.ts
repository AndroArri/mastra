import fs from 'node:fs';
import path from 'node:path';
import { isPathWithinRoot } from '../utils/path-security.js';
import type { SymlinkValidationResult } from './types.js';

/**
 * Validates whether a file or directory path (including symlinks) resolves safely
 * within at least one of the specified allowed root directories.
 *
 * Prevents directory traversal attacks via malicious symlinks (e.g. pointing to /etc/passwd or outside the workspace).
 */
export function validateSymlink(linkPath: string, allowedRoots: string[]): SymlinkValidationResult {
  const resolvedLinkPath = path.resolve(linkPath);

  if (!fs.existsSync(resolvedLinkPath)) {
    return {
      valid: false,
      linkPath: resolvedLinkPath,
      reason: 'Path does not exist or is a broken symlink',
    };
  }

  let realPath: string;
  try {
    realPath = fs.realpathSync(resolvedLinkPath);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      linkPath: resolvedLinkPath,
      reason: `Failed to resolve real path (possible circular symlink): ${errorMsg}`,
    };
  }

  if (!fs.existsSync(realPath)) {
    return {
      valid: false,
      linkPath: resolvedLinkPath,
      realPath,
      reason: 'Symlink target does not exist',
    };
  }

  if (allowedRoots.length === 0) {
    return {
      valid: true,
      linkPath: resolvedLinkPath,
      realPath,
    };
  }

  const isWithinAllowed = allowedRoots.some(root => {
    try {
      const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
      return isPathWithinRoot(realPath, realRoot);
    } catch {
      return isPathWithinRoot(realPath, path.resolve(root));
    }
  });

  if (!isWithinAllowed) {
    return {
      valid: false,
      linkPath: resolvedLinkPath,
      realPath,
      reason: `Symlink target "${realPath}" escapes all allowed sandbox boundaries: [${allowedRoots.join(', ')}]`,
    };
  }

  return {
    valid: true,
    linkPath: resolvedLinkPath,
    realPath,
  };
}

/**
 * Returns true if the symlink or path resolves within the allowed roots.
 */
export function isSymlinkSafe(linkPath: string, allowedRoots: string[]): boolean {
  return validateSymlink(linkPath, allowedRoots).valid;
}

/**
 * Safely collects valid skill directories within a parent skills directory,
 * skipping broken or escaping symlinks.
 */
export function collectValidSkillDirectories(skillsDir: string, allowedRoots: string[]): string[] {
  const resolvedSkillsDir = path.resolve(skillsDir);
  if (!fs.existsSync(resolvedSkillsDir)) {
    return [];
  }

  const validDirs: string[] = [];

  try {
    const entries = fs.readdirSync(resolvedSkillsDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(resolvedSkillsDir, entry.name);

      if (entry.isDirectory()) {
        const validation = validateSymlink(fullPath, allowedRoots);
        if (validation.valid) {
          validDirs.push(fullPath);
        }
      } else if (entry.isSymbolicLink()) {
        const validation = validateSymlink(fullPath, allowedRoots);
        if (validation.valid && validation.realPath) {
          try {
            const stat = fs.statSync(validation.realPath);
            if (stat.isDirectory()) {
              validDirs.push(fullPath);
            }
          } catch {
            // Ignore stat errors
          }
        }
      }
    }
  } catch {
    // Ignore readdir errors
  }

  return validDirs;
}
