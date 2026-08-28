import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { SecretStore } from '../secret-store.js';

describe('SecretStore', () => {
  let testGlobalDir: string;
  let testWorkspaceDir: string;
  let secretStore: SecretStore;

  beforeEach(() => {
    const uniqueId = Math.random().toString(36).substring(2, 9);
    testGlobalDir = join(tmpdir(), `mastra-test-global-${uniqueId}`);
    testWorkspaceDir = join(tmpdir(), `mastra-test-workspace-${uniqueId}`);

    secretStore = new SecretStore({
      globalDir: testGlobalDir,
      workspaceDir: testWorkspaceDir,
      encryptionKey: 'test-secret-key-12345',
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

  it('should set and get encrypted secrets in global scope', async () => {
    await secretStore.setSecret('GLOBAL_KEY', 'global-value-123', { scope: 'global' });
    const val = await secretStore.getSecret('GLOBAL_KEY', { scope: 'global' });
    expect(val).toBe('global-value-123');
  });

  it('should set and get encrypted secrets in workspace scope', async () => {
    await secretStore.setSecret('WS_KEY', 'workspace-value-456', { scope: 'workspace' });
    const val = await secretStore.getSecret('WS_KEY', { scope: 'workspace' });
    expect(val).toBe('workspace-value-456');
  });

  it('should override global secret with workspace secret when scope is auto', async () => {
    await secretStore.setSecret('SHARED_KEY', 'global-shared', { scope: 'global' });
    await secretStore.setSecret('SHARED_KEY', 'workspace-shared', { scope: 'workspace' });

    const valAuto = await secretStore.getSecret('SHARED_KEY', { scope: 'auto' });
    expect(valAuto).toBe('workspace-shared');

    const valGlobal = await secretStore.getSecret('SHARED_KEY', { scope: 'global' });
    expect(valGlobal).toBe('global-shared');
  });

  it('should fallback to process.env when key is not in secret store and scope is auto', async () => {
    process.env['MASTRA_TEST_ENV_FALLBACK'] = 'env-value-789';

    try {
      const val = await secretStore.getSecret('MASTRA_TEST_ENV_FALLBACK', { scope: 'auto' });
      expect(val).toBe('env-value-789');

      const hasVal = await secretStore.hasSecret('MASTRA_TEST_ENV_FALLBACK', { scope: 'auto' });
      expect(hasVal).toBe(true);
    } finally {
      delete process.env['MASTRA_TEST_ENV_FALLBACK'];
    }
  });

  it('should delete secrets correctly', async () => {
    await secretStore.setSecret('TO_DELETE', 'secret-val', { scope: 'global' });
    expect(await secretStore.hasSecret('TO_DELETE')).toBe(true);

    const deleted = await secretStore.deleteSecret('TO_DELETE');
    expect(deleted).toBe(true);
    expect(await secretStore.hasSecret('TO_DELETE')).toBe(false);
  });

  it('should list all secrets across scopes', async () => {
    await secretStore.setSecret('G1', 'val1', { scope: 'global' });
    await secretStore.setSecret('W1', 'val2', { scope: 'workspace' });

    const keys = await secretStore.listSecrets({ scope: 'auto' });
    expect(keys).toContain('G1');
    expect(keys).toContain('W1');
  });
});
