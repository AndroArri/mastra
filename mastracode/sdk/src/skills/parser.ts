import fs from 'node:fs';
import path from 'node:path';
import type { SkillDefinition, SkillLevel, SkillMetadata, SkillType } from './types.js';

/**
 * Simple YAML frontmatter parser for markdown content.
 */
export function parseFrontmatter(content: string): { metadata: SkillMetadata; body: string } {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { metadata: {}, body: content.trim() };
  }

  const yamlStr = match[1];
  const body = match[2].trim();
  const metadata: SkillMetadata = {};

  const lines = yamlStr.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let valueStr = trimmed.slice(colonIdx + 1).trim();

    // Strip outer quotes if any
    if (
      (valueStr.startsWith('"') && valueStr.endsWith('"')) ||
      (valueStr.startsWith("'") && valueStr.endsWith("'"))
    ) {
      valueStr = valueStr.slice(1, -1);
    }

    if (valueStr === 'true') {
      metadata[key] = true;
    } else if (valueStr === 'false') {
      metadata[key] = false;
    } else if (valueStr.startsWith('[') && valueStr.endsWith(']')) {
      metadata[key] = valueStr
        .slice(1, -1)
        .split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else if (!isNaN(Number(valueStr)) && valueStr !== '') {
      metadata[key] = Number(valueStr);
    } else {
      metadata[key] = valueStr;
    }
  }

  return { metadata, body };
}

/**
 * Parses a skill directory or file path into a SkillDefinition.
 */
export async function parseSkillPath(
  skillPath: string,
  level: SkillLevel = 'custom',
): Promise<SkillDefinition | null> {
  const resolvedPath = path.resolve(skillPath);

  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  let dirPath: string;
  let filePath: string | undefined;

  const stat = fs.statSync(resolvedPath);
  if (stat.isFile()) {
    dirPath = path.dirname(resolvedPath);
    filePath = resolvedPath;
  } else if (stat.isDirectory()) {
    dirPath = resolvedPath;
  } else {
    return null;
  }

  let instructions: string | undefined;
  let metadata: SkillMetadata = {};
  let markdownFile: string | undefined = filePath;

  if (!markdownFile) {
    const candidates = ['SKILL.md', 'skill.md', 'README.md'];
    for (const cand of candidates) {
      const p = path.join(dirPath, cand);
      if (fs.existsSync(p)) {
        markdownFile = p;
        break;
      }
    }
  }

  if (markdownFile && fs.existsSync(markdownFile)) {
    try {
      const content = fs.readFileSync(markdownFile, 'utf-8');
      const parsed = parseFrontmatter(content);
      metadata = parsed.metadata;
      instructions = parsed.body;
    } catch {
      // Ignore read errors
    }
  }

  // Look for code entrypoint
  const codeCandidates = ['index.js', 'index.ts', 'skill.js', 'skill.ts', 'script.js'];
  let codeFile: string | undefined;
  for (const cand of codeCandidates) {
    const p = path.join(dirPath, cand);
    if (fs.existsSync(p)) {
      codeFile = p;
      break;
    }
  }

  // Determine SkillType
  let type: SkillType = 'prompt';
  if (codeFile && instructions) {
    type = 'hybrid';
  } else if (codeFile) {
    type = 'code';
  }

  const name =
    metadata.name ||
    (filePath ? path.basename(filePath, path.extname(filePath)) : path.basename(dirPath));

  const description =
    metadata.description ||
    (instructions ? instructions.split(/\r?\n/)[0].replace(/^#+\s*/, '') : `Skill ${name}`);

  const userInvocableRaw = metadata['user-invocable'] ?? metadata.userInvocable;
  const userInvocable = typeof userInvocableRaw === 'boolean' ? userInvocableRaw : true;

  let handler: ((params?: Record<string, unknown>) => Promise<unknown> | unknown) | undefined;

  if (codeFile) {
    handler = async (params?: Record<string, unknown>) => {
      try {
        const mod = await import(codeFile!);
        const fn = mod.default || mod.run || mod.execute || mod.handler;
        if (typeof fn === 'function') {
          return await fn(params);
        }
        return mod;
      } catch (err) {
        throw new Error(`Failed to execute code skill "${name}": ${err instanceof Error ? err.message : String(err)}`);
      }
    };
  }

  return {
    name,
    description,
    type,
    level,
    dirPath,
    filePath: markdownFile || codeFile || filePath,
    metadata,
    instructions,
    userInvocable,
    handler,
  };
}
