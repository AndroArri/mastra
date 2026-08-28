import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionManager } from '../connection-manager.js';
import { SecretStore } from '../secret-store.js';

describe('ConnectionManager', () => {
  let testGlobalDir: string;
  let testWorkspaceDir: string;
  let secretStore: SecretStore;
  let connectionManager: ConnectionManager;

  beforeEach(() => {
    const uniqueId = Math.random().toString(36).substring(2, 9);
    testGlobalDir = join(tmpdir(), `mastra-conn-global-${uniqueId}`);
    testWorkspaceDir = join(tmpdir(), `mastra-conn-workspace-${uniqueId}`);

    secretStore = new SecretStore({
      globalDir: testGlobalDir,
      workspaceDir: testWorkspaceDir,
      encryptionKey: 'conn-secret-key-999',
    });

    connectionManager = new ConnectionManager({
      globalDir: testGlobalDir,
      workspaceDir: testWorkspaceDir,
      secretStore,
    });
  });

  afterEach(() => {
    if (existsSync(testGlobalDir)) {
      rmSync(testGlobalDir, { recursive: true, force: true });
    }
    if (existsSync(testWorkspaceDir)) {
      rmSync(testWorkspaceDir, { recursive: true, force: true });
    }
  });

  it('should create and retrieve a connection with valid schema', async () => {
    const created = await connectionManager.createConnection({
      id: 'openai-dev',
      name: 'OpenAI Dev',
      type: 'openai',
      scope: 'global',
      config: { baseUrl: 'https://api.openai.com/v1' },
      credentials: { apiKey: 'sk-test-12345' },
    });

    expect(created.id).toBe('openai-dev');
    expect(created.type).toBe('openai');

    const fetched = await connectionManager.getConnection('openai-dev');
    expect(fetched).toBeDefined();
    expect(fetched?.name).toBe('OpenAI Dev');
  });

  it('should resolve credentials from SecretStore and process.env fallback', async () => {
    await connectionManager.createConnection({
      id: 'db-prod',
      name: 'Postgres Prod',
      type: 'postgres',
      scope: 'workspace',
      credentials: { password: 'super-secret-db-pass' },
    });

    const resolved = await connectionManager.getResolvedCredentials('db-prod');
    expect(resolved.password).toBe('super-secret-db-pass');
  });

  it('should override global connection with workspace connection of same ID', async () => {
    await connectionManager.createConnection({
      id: 'api-service',
      name: 'Global Service',
      type: 'http',
      scope: 'global',
      config: { url: 'https://global.example.com' },
    });

    await connectionManager.createConnection({
      id: 'api-service',
      name: 'Workspace Service',
      type: 'http',
      scope: 'workspace',
      config: { url: 'https://workspace.example.com' },
    });

    const conn = await connectionManager.getConnection('api-service', { scope: 'auto' });
    expect(conn?.name).toBe('Workspace Service');
    expect(conn?.config.url).toBe('https://workspace.example.com');
  });

  it('should ping a connection using custom ping handler', async () => {
    await connectionManager.createConnection({
      id: 'custom-service',
      name: 'Custom Service',
      type: 'custom',
      scope: 'global',
    });

    connectionManager.registerPingHandler('custom', async (conn) => {
      return conn.id === 'custom-service';
    });

    const pingResult = await connectionManager.ping('custom-service');
    expect(pingResult.ok).toBe(true);
    expect(pingResult.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should handle ping failure for non-existent connection', async () => {
    const pingResult = await connectionManager.ping('non-existent-id');
    expect(pingResult.ok).toBe(false);
    expect(pingResult.error).toContain('not found');
  });

  it('should update connection and delete connection', async () => {
    await connectionManager.createConnection({
      id: 'to-update',
      name: 'Initial Name',
      type: 'http',
      scope: 'global',
    });

    const updated = await connectionManager.updateConnection('to-update', {
      name: 'Updated Name',
    });
    expect(updated.name).toBe('Updated Name');

    const deleted = await connectionManager.deleteConnection('to-update');
    expect(deleted).toBe(true);

    const check = await connectionManager.getConnection('to-update');
    expect(check).toBeUndefined();
  });
});
