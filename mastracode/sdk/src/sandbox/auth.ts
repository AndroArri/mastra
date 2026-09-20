/**
 * Sandbox Authorization & Security Path Validation
 *
 * Enforces strict anti-path-traversal rules, forbidden system path checks,
 * operation level permission validation, and security context wrapping for
 * TUI (Terminal UI) and Factory UI interactions.
 */

import { posix as posixPath } from 'node:path';
import type { SandboxExec } from './filesystem.js';
import { SandboxFilesystem } from './filesystem.js';

export type SandboxInterface = 'tui' | 'factory-ui' | 'agent' | 'system';
export type SandboxOperation = 'read' | 'write' | 'execute' | 'delete';

export class SandboxSecurityError extends Error {
  readonly code = 'SANDBOX_SECURITY_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'SandboxSecurityError';
  }
}

export class SandboxAuthorizationError extends Error {
  readonly code = 'SANDBOX_AUTHORIZATION_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'SandboxAuthorizationError';
  }
}

export interface SandboxSecurityPolicy {
  /** Enforce read-only mode for file mutations and execution. */
  readOnly?: boolean;
  /** Allowed interfaces for this policy. Default: all interfaces allowed. */
  allowedInterfaces?: SandboxInterface[];
  /** Paths/directories that are forbidden even within workdir or root (e.g. system files). */
  forbiddenPaths?: string[];
  /** Allowed command prefixes for shell execution. */
  allowedCommandPrefixes?: string[];
  /** Maximum allowed file size in bytes for read/write. */
  maxFileSize?: number;
}

export interface SandboxAuthContext {
  /** Source interface requesting access ('tui' | 'factory-ui' | 'agent' | 'system'). */
  interfaceType: SandboxInterface;
  /** Acting user identity or token subject. */
  actingUserId?: string;
  /** Associated user roles or scope permissions. */
  roles?: string[];
  /** Active security policy. */
  policy?: SandboxSecurityPolicy;
}

/** Standard system paths that are prohibited regardless of workdir setting. */
const DEFAULT_SYSTEM_FORBIDDEN_PATTERNS = [
  '/etc',
  '/sys',
  '/proc',
  '/dev',
  '/boot',
  '/root',
  'c:\\windows',
  'c:\\program files',
];

/**
 * Validate and normalize a sandbox target path, enforcing strict anti-traversal
 * guards and forbidden path restrictions.
 */
export function validateSandboxPath(
  inputPath: string,
  workdir: string,
  policy?: SandboxSecurityPolicy,
): string {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new SandboxSecurityError('Invalid path: path cannot be empty');
  }

  // Reject null bytes
  if (inputPath.includes('\0')) {
    throw new SandboxSecurityError('Invalid path: null byte detected in path');
  }

  const normalizedWorkdir = posixPath.normalize(workdir);
  const normalizedInput = posixPath.normalize(inputPath);

  // Check forbidden system path patterns
  const lowerInput = normalizedInput.toLowerCase();
  for (const forbidden of DEFAULT_SYSTEM_FORBIDDEN_PATTERNS) {
    if (lowerInput === forbidden || lowerInput.startsWith(`${forbidden}/`) || lowerInput.startsWith(`${forbidden}\\`)) {
      throw new SandboxSecurityError(`Access to system path is forbidden: ${inputPath}`);
    }
  }

  if (policy?.forbiddenPaths) {
    for (const forbidden of policy.forbiddenPaths) {
      const normForbidden = posixPath.normalize(forbidden).toLowerCase();
      if (lowerInput === normForbidden || lowerInput.startsWith(`${normForbidden}/`)) {
        throw new SandboxSecurityError(`Access to forbidden path: ${inputPath}`);
      }
    }
  }

  // Compute resolved absolute path relative to workdir
  let resolved: string;
  if (normalizedInput === normalizedWorkdir) {
    resolved = normalizedWorkdir;
  } else if (normalizedInput.startsWith(`${normalizedWorkdir}/`)) {
    resolved = normalizedInput;
  } else if (inputPath.startsWith('/')) {
    resolved = posixPath.normalize(posixPath.join(normalizedWorkdir, inputPath.slice(1)));
  } else {
    resolved = posixPath.normalize(posixPath.join(normalizedWorkdir, normalizedInput));
  }

  // Traversal containment check: path must stay inside workdir
  if (resolved !== normalizedWorkdir && !resolved.startsWith(`${normalizedWorkdir}/`)) {
    throw new SandboxSecurityError(`Path escapes sandbox workspace root: ${inputPath}`);
  }

  return resolved;
}

/**
 * Authorize an operation requested by TUI, Factory UI, or Agent context against policy.
 */
export function authorizeSandboxAccess(
  context: SandboxAuthContext,
  request: { operation: SandboxOperation; targetPath?: string; workdir?: string; command?: string },
): void {
  const policy = context.policy;

  // Interface authorization check
  if (policy?.allowedInterfaces && !policy.allowedInterfaces.includes(context.interfaceType)) {
    throw new SandboxAuthorizationError(
      `Interface '${context.interfaceType}' is not authorized for sandbox access`,
    );
  }

  // Read-only check for write/delete/execute operations
  if (policy?.readOnly && request.operation !== 'read') {
    throw new SandboxAuthorizationError(
      `Operation '${request.operation}' denied: Sandbox is running in read-only mode for ${context.interfaceType}`,
    );
  }

  // Path authorization & traversal check
  if (request.targetPath && request.workdir) {
    validateSandboxPath(request.targetPath, request.workdir, policy);
  }

  // Command execution prefix restriction check
  if (request.operation === 'execute' && request.command && policy?.allowedCommandPrefixes) {
    const cmd = request.command.trim();
    const isAllowed = policy.allowedCommandPrefixes.some(prefix => cmd.startsWith(prefix));
    if (!isAllowed) {
      throw new SandboxAuthorizationError(`Command execution denied: command '${cmd}' does not match allowed prefixes`);
    }
  }
}

export interface SanitizedSandboxContextOptions {
  sandbox: SandboxExec;
  workdir: string;
  authContext: SandboxAuthContext;
}

/**
 * High-level wrapper providing secure, authorized filesystem and command execution
 * tailored for TUI and Factory UI integrations.
 */
export class SanitizedSandboxContext {
  readonly filesystem: SandboxFilesystem;
  readonly workdir: string;
  readonly authContext: SandboxAuthContext;
  private readonly sandbox: SandboxExec;

  constructor(options: SanitizedSandboxContextOptions) {
    this.sandbox = options.sandbox;
    this.workdir = posixPath.normalize(options.workdir);
    this.authContext = options.authContext;
    this.filesystem = new SandboxFilesystem({ sandbox: options.sandbox, workdir: this.workdir });
  }

  async readFile(path: string, options?: { encoding?: BufferEncoding }): Promise<string | Buffer> {
    authorizeSandboxAccess(this.authContext, {
      operation: 'read',
      targetPath: path,
      workdir: this.workdir,
    });
    return this.filesystem.readFile(path, options);
  }

  async writeFile(path: string, content: string | Buffer, options?: { overwrite?: boolean }): Promise<void> {
    authorizeSandboxAccess(this.authContext, {
      operation: 'write',
      targetPath: path,
      workdir: this.workdir,
    });
    return this.filesystem.writeFile(path, content, options);
  }

  async deleteFile(path: string, options?: { force?: boolean }): Promise<void> {
    authorizeSandboxAccess(this.authContext, {
      operation: 'delete',
      targetPath: path,
      workdir: this.workdir,
    });
    return this.filesystem.deleteFile(path, options);
  }

  async executeCommand(command: string, args?: string[], options?: { timeout?: number }) {
    authorizeSandboxAccess(this.authContext, {
      operation: 'execute',
      command: args?.length ? `${command} ${args.join(' ')}` : command,
      workdir: this.workdir,
    });
    return this.sandbox.executeCommand(command, args, options);
  }
}
