import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { z } from 'zod';
import { SecretStore, type SecretScope, type SecretResolveScope } from './secret-store.js';

export const ConnectionTypeSchema = z.enum([
  'postgres',
  'libsql',
  'openai',
  'anthropic',
  'github',
  'http',
  'custom',
]);

export type ConnectionType = z.infer<typeof ConnectionTypeSchema> | string;

export const ConnectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string(),
  description: z.string().optional(),
  scope: z.enum(['global', 'workspace']).default('global'),
  config: z.record(z.string(), z.unknown()).default({}),
  credentials: z.record(z.string(), z.string()).default({}),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Connection = z.infer<typeof ConnectionSchema>;

export const CreateConnectionInputSchema = ConnectionSchema.omit({
  createdAt: true,
  updatedAt: true,
}).partial({
  scope: true,
  config: true,
  credentials: true,
});

export type CreateConnectionInput = z.infer<typeof CreateConnectionInputSchema>;

export interface ConnectionPingResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface ConnectionManagerOptions {
  secretStore?: SecretStore;
  globalDir?: string;
  workspaceDir?: string;
}

export type CustomPingHandler = (
  connection: Connection,
  resolvedCredentials: Record<string, string>,
) => Promise<boolean>;

export class ConnectionManager {
  private secretStore: SecretStore;
  private globalDir: string;
  private workspaceDir: string;
  private customPingHandlers = new Map<string, CustomPingHandler>();

  constructor(options?: ConnectionManagerOptions) {
    this.globalDir = options?.globalDir ?? join(homedir(), '.mastra');
    this.workspaceDir = options?.workspaceDir ?? join(process.cwd(), '.mastra');
    this.secretStore =
      options?.secretStore ??
      new SecretStore({
        globalDir: this.globalDir,
        workspaceDir: this.workspaceDir,
      });
  }

  private getFilePath(scope: SecretScope): string {
    const dir = scope === 'workspace' ? this.workspaceDir : this.globalDir;
    return join(dir, 'connections.json');
  }

  private readStore(scope: SecretScope): Record<string, Connection> {
    const filePath = this.getFilePath(scope);
    if (!existsSync(filePath)) {
      return {};
    }

    try {
      const fileContent = readFileSync(filePath, 'utf8');
      const data = JSON.parse(fileContent);
      return data;
    } catch {
      return {};
    }
  }

  private writeStore(scope: SecretScope, connections: Record<string, Connection>): void {
    const filePath = this.getFilePath(scope);
    const dir = dirname(filePath);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    writeFileSync(filePath, JSON.stringify(connections, null, 2), { mode: 0o600 });
  }

  /**
   * Registers a custom ping handler for a specific connection type.
   */
  registerPingHandler(type: string, handler: CustomPingHandler): void {
    this.customPingHandlers.set(type, handler);
  }

  /**
   * Creates a new connection and persists credentials to SecretStore.
   */
  async createConnection(input: CreateConnectionInput): Promise<Connection> {
    const scope = input.scope ?? 'global';
    const now = new Date().toISOString();

    const connection: Connection = ConnectionSchema.parse({
      ...input,
      scope,
      createdAt: now,
      updatedAt: now,
    });

    // Save credentials to SecretStore if provided
    if (connection.credentials && Object.keys(connection.credentials).length > 0) {
      for (const [credKey, credValue] of Object.entries(connection.credentials)) {
        const secretKey = `conn:${connection.id}:${credKey}`;
        await this.secretStore.setSecret(secretKey, credValue, { scope });
        // Store reference in connection credentials schema
        connection.credentials[credKey] = secretKey;
      }
    }

    const store = this.readStore(scope);
    store[connection.id] = connection;
    this.writeStore(scope, store);

    return connection;
  }

  /**
   * Gets a connection by ID.
   * Checks workspace first if scope is 'auto' or 'workspace', then global.
   */
  async getConnection(id: string, options?: { scope?: SecretResolveScope }): Promise<Connection | undefined> {
    const scope = options?.scope ?? 'auto';

    if (scope === 'workspace' || scope === 'auto') {
      const workspaceStore = this.readStore('workspace');
      if (id in workspaceStore) {
        return workspaceStore[id];
      }
    }

    if (scope === 'global' || scope === 'auto') {
      const globalStore = this.readStore('global');
      if (id in globalStore) {
        return globalStore[id];
      }
    }

    return undefined;
  }

  /**
   * Updates an existing connection.
   */
  async updateConnection(id: string, updates: Partial<CreateConnectionInput>): Promise<Connection> {
    const existing = await this.getConnection(id);
    if (!existing) {
      throw new Error(`Connection with id '${id}' not found.`);
    }

    const targetScope = updates.scope ?? existing.scope;
    const now = new Date().toISOString();

    const updatedConnection: Connection = ConnectionSchema.parse({
      ...existing,
      ...updates,
      id: existing.id,
      scope: targetScope,
      updatedAt: now,
    });

    if (updates.credentials) {
      for (const [credKey, credValue] of Object.entries(updates.credentials)) {
        const secretKey = `conn:${id}:${credKey}`;
        await this.secretStore.setSecret(secretKey, credValue, { scope: targetScope });
        updatedConnection.credentials[credKey] = secretKey;
      }
    }

    const store = this.readStore(targetScope);
    store[id] = updatedConnection;
    this.writeStore(targetScope, store);

    // If scope changed, clean up old scope file entry
    if (targetScope !== existing.scope) {
      const oldStore = this.readStore(existing.scope);
      delete oldStore[id];
      this.writeStore(existing.scope, oldStore);
    }

    return updatedConnection;
  }

  /**
   * Deletes a connection.
   */
  async deleteConnection(id: string, options?: { scope?: SecretResolveScope }): Promise<boolean> {
    const scope = options?.scope ?? 'auto';
    let deleted = false;

    const deleteFromScope = async (s: SecretScope) => {
      const store = this.readStore(s);
      if (id in store) {
        const conn = store[id];
        if (conn?.credentials) {
          for (const credKey of Object.keys(conn.credentials)) {
            await this.secretStore.deleteSecret(`conn:${id}:${credKey}`, { scope: s });
          }
        }
        delete store[id];
        this.writeStore(s, store);
        return true;
      }
      return false;
    };

    if (scope === 'workspace' || scope === 'auto') {
      if (await deleteFromScope('workspace')) deleted = true;
    }

    if (scope === 'global' || scope === 'auto') {
      if (await deleteFromScope('global')) deleted = true;
    }

    return deleted;
  }

  /**
   * Lists connections from specified scope (or combined with workspace override if 'auto').
   */
  async listConnections(options?: { scope?: SecretResolveScope }): Promise<Connection[]> {
    const scope = options?.scope ?? 'auto';
    const connectionMap = new Map<string, Connection>();

    if (scope === 'global' || scope === 'auto') {
      const globalStore = this.readStore('global');
      for (const conn of Object.values(globalStore)) {
        connectionMap.set(conn.id, conn);
      }
    }

    if (scope === 'workspace' || scope === 'auto') {
      const workspaceStore = this.readStore('workspace');
      for (const conn of Object.values(workspaceStore)) {
        // Workspace connections override global ones with the same ID
        connectionMap.set(conn.id, conn);
      }
    }

    return Array.from(connectionMap.values());
  }

  /**
   * Resolves connection credentials from SecretStore or process.env.
   */
  async getResolvedCredentials(id: string): Promise<Record<string, string>> {
    const connection = await this.getConnection(id);
    if (!connection) {
      throw new Error(`Connection with id '${id}' not found.`);
    }

    const resolved: Record<string, string> = {};

    for (const [credKey, refOrValue] of Object.entries(connection.credentials)) {
      // Secret key format: conn:<id>:<key> or generic secret name or direct value
      const secretValue = await this.secretStore.getSecret(refOrValue);
      if (secretValue !== undefined) {
        resolved[credKey] = secretValue;
      } else {
        // Try direct key lookup in SecretStore
        const directSecret = await this.secretStore.getSecret(`conn:${id}:${credKey}`);
        resolved[credKey] = directSecret ?? refOrValue;
      }
    }

    return resolved;
  }

  /**
   * Performs an health check (ping) on a connection.
   */
  async ping(id: string): Promise<ConnectionPingResult> {
    const startTime = Date.now();
    const connection = await this.getConnection(id);

    if (!connection) {
      return {
        ok: false,
        latencyMs: 0,
        error: `Connection '${id}' not found.`,
      };
    }

    try {
      const credentials = await this.getResolvedCredentials(id);

      // Check custom handler first
      const customHandler = this.customPingHandlers.get(connection.type);
      if (customHandler) {
        const ok = await customHandler(connection, credentials);
        return {
          ok,
          latencyMs: Date.now() - startTime,
          error: ok ? undefined : 'Custom ping check failed.',
        };
      }

      // Default ping logic based on type
      const config = connection.config || {};
      const baseUrl =
        (config.baseUrl as string) ||
        (config.url as string) ||
        (connection.type === 'github'
          ? 'https://api.github.com'
          : connection.type === 'openai'
            ? 'https://api.openai.com/v1/models'
            : connection.type === 'anthropic'
              ? 'https://api.anthropic.com/v1/messages'
              : undefined);

      if (baseUrl && (baseUrl.startsWith('http://') || baseUrl.startsWith('https://'))) {
        const headers: Record<string, string> = {
          'User-Agent': 'Mastra-ConnectionManager-Ping',
        };

        const apiKey = credentials.apiKey || credentials.token || credentials.secretKey;
        if (apiKey) {
          if (connection.type === 'anthropic') {
            headers['x-api-key'] = apiKey;
            headers['anthropic-version'] = '2023-06-01';
          } else {
            headers['Authorization'] = `Bearer ${apiKey}`;
          }
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
          const response = await fetch(baseUrl, {
            method: 'GET',
            headers,
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          const latencyMs = Date.now() - startTime;
          // HTTP 2xx, 3xx, or 401/403/404 from legitimate service means network endpoint is reachable
          if (response.ok || (response.status >= 400 && response.status < 500)) {
            return {
              ok: response.ok,
              latencyMs,
              error: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`,
            };
          }

          return {
            ok: false,
            latencyMs,
            error: `HTTP ping failed with status ${response.status}`,
          };
        } catch (fetchErr) {
          clearTimeout(timeoutId);
          return {
            ok: false,
            latencyMs: Date.now() - startTime,
            error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
          };
        }
      }

      // Default fallback for non-HTTP or unconfigured connections: if record exists and valid schema
      return {
        ok: true,
        latencyMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
