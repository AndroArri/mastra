/**
 * Sandbox Session Management & Re-attachment
 *
 * Manages sandbox session lifecycles, session state tracking, session revival/re-attachment,
 * and integration with the web tenant/fleet provider.
 */

import type { SandboxExec } from './filesystem.js';

export type SandboxSessionStatus = 'active' | 'detached' | 'terminated' | 'poisoned' | 'reattaching';
export type SandboxIsolationType = 'docker' | 'microvm' | 'local' | 'mock';

export interface MinimalSandboxHandle extends SandboxExec {
  start?(): Promise<void>;
  stop?(): Promise<void>;
}

export interface SandboxSessionOptions {
  /** Unique session ID (or automatically generated). */
  id?: string;
  /** Provider sandbox ID (e.g., VM or container ID). */
  providerSandboxId: string;
  /** Absolute working directory path inside the sandbox. */
  workdir: string;
  /** Type of isolation backing this sandbox session. */
  isolationType?: SandboxIsolationType;
  /** Subject / user context who owns or acts on this session. */
  actingUserId?: string;
  /** Live sandbox instance if already provisioned. */
  sandbox?: MinimalSandboxHandle;
  /** Custom session metadata. */
  metadata?: Record<string, unknown>;
}

export interface SandboxSessionRecord {
  readonly id: string;
  readonly providerSandboxId: string;
  readonly workdir: string;
  readonly isolationType: SandboxIsolationType;
  readonly actingUserId?: string;
  status: SandboxSessionStatus;
  createdAt: Date;
  lastAttachedAt: Date;
  metadata: Record<string, unknown>;
  sandbox?: MinimalSandboxHandle;
}

export interface SandboxReattachOptions {
  actingUserId?: string;
}

export type SandboxReattachFn = (
  providerSandboxId: string,
  options?: SandboxReattachOptions,
) => Promise<MinimalSandboxHandle>;

let globalReattachFn: SandboxReattachFn | undefined;

/** Register global sandbox reattach handler (called by web surface or fleet provider). */
export function registerSandboxReattach(fn: SandboxReattachFn): void {
  globalReattachFn = fn;
}

/** Reattach to an existing sandbox by provider sandbox ID. */
export async function reattachProjectSandbox(
  providerSandboxId: string,
  options?: SandboxReattachOptions,
): Promise<MinimalSandboxHandle> {
  if (!globalReattachFn) {
    throw new Error(
      'No sandbox reattach implementation registered. Sandbox-backed workspaces are only available when the web surface has called registerSandboxReattach().',
    );
  }
  return globalReattachFn(providerSandboxId, options);
}

export class SandboxSessionManager {
  private sessions = new Map<string, SandboxSessionRecord>();

  /** Create and register a new sandbox session. */
  createSession(options: SandboxSessionOptions): SandboxSessionRecord {
    const id = options.id ?? `sbx-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record: SandboxSessionRecord = {
      id,
      providerSandboxId: options.providerSandboxId,
      workdir: options.workdir,
      isolationType: options.isolationType ?? 'local',
      actingUserId: options.actingUserId,
      status: 'active',
      createdAt: new Date(),
      lastAttachedAt: new Date(),
      metadata: options.metadata ?? {},
      sandbox: options.sandbox,
    };
    this.sessions.set(id, record);
    return record;
  }

  /** Retrieve session by ID. */
  getSession(sessionId: string): SandboxSessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  /** Find session by provider sandbox ID. */
  findSessionByProviderId(providerSandboxId: string): SandboxSessionRecord | undefined {
    for (const session of this.sessions.values()) {
      if (session.providerSandboxId === providerSandboxId) {
        return session;
      }
    }
    return undefined;
  }

  /** Reattach an existing session or create a session by reattaching through the registered reattach handler. */
  async reattachSession(
    sessionIdOrProviderId: string,
    options?: SandboxReattachOptions,
  ): Promise<SandboxSessionRecord> {
    let session = this.getSession(sessionIdOrProviderId) ?? this.findSessionByProviderId(sessionIdOrProviderId);

    if (session) {
      session.status = 'reattaching';
      try {
        if (globalReattachFn) {
          session.sandbox = await globalReattachFn(session.providerSandboxId, {
            actingUserId: options?.actingUserId ?? session.actingUserId,
          });
        }
        session.status = 'active';
        session.lastAttachedAt = new Date();
        return session;
      } catch (err) {
        session.status = 'detached';
        throw err;
      }
    }

    // No existing session record; attempt direct reattach via provider sandbox ID
    const handle = await reattachProjectSandbox(sessionIdOrProviderId, options);
    session = this.createSession({
      providerSandboxId: sessionIdOrProviderId,
      workdir: '/workspace',
      sandbox: handle,
      actingUserId: options?.actingUserId,
    });
    return session;
  }

  /** Terminate a session. */
  async terminateSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.status = 'terminated';
    if (session.sandbox?.stop) {
      await session.sandbox.stop();
    }
  }

  /** Mark a session as poisoned (e.g. when git preflight or initialization fails). */
  markPoisoned(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'poisoned';
    }
  }

  /** List active sessions. */
  listSessions(): SandboxSessionRecord[] {
    return Array.from(this.sessions.values());
  }

  /** Clear all session records. */
  clear(): void {
    this.sessions.clear();
  }
}

/** Global default session manager instance for easy consumption. */
export const defaultSandboxSessionManager = new SandboxSessionManager();
