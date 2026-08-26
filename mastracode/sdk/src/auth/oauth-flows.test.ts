import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { PKCEOAuthFlow } from './pkce-flow.js';
import { DeviceCodeOAuthFlow } from './device-code-flow.js';
import { SecretStore } from '../connections/secret-store.js';

describe('OAuth Flows (PKCE & Device Code)', () => {
  let testGlobalDir: string;
  let testWorkspaceDir: string;
  let secretStore: SecretStore;

  beforeEach(() => {
    const uniqueId = Math.random().toString(36).substring(2, 9);
    testGlobalDir = join(tmpdir(), `mastra-oauth-global-${uniqueId}`);
    testWorkspaceDir = join(tmpdir(), `mastra-oauth-workspace-${uniqueId}`);

    secretStore = new SecretStore({
      globalDir: testGlobalDir,
      workspaceDir: testWorkspaceDir,
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

  describe('PKCEOAuthFlow', () => {
    it('should generate valid authorization URL with PKCE parameters', async () => {
      const result = await PKCEOAuthFlow.generateAuthorizationUrl({
        authorizationUrl: 'https://auth.example.com/oauth/authorize',
        clientId: 'test-client-id',
        redirectUri: 'http://localhost:3000/callback',
        scope: 'read write',
      });

      expect(result.url).toContain('client_id=test-client-id');
      expect(result.url).toContain('code_challenge_method=S256');
      expect(result.codeVerifier.length).toBeGreaterThan(10);
      expect(result.codeChallenge.length).toBeGreaterThan(10);
      expect(result.state).toBeDefined();
    });

    it('should save OAuth credentials in specified scope via SecretStore', async () => {
      await PKCEOAuthFlow.saveCredentials(
        'factory-provider',
        {
          access: 'access-token-123',
          refresh: 'refresh-token-456',
          expires: Date.now() + 3600000,
        },
        { secretStore, scope: 'workspace' },
      );

      const access = await secretStore.getSecret('oauth:factory-provider:access', { scope: 'workspace' });
      const refresh = await secretStore.getSecret('oauth:factory-provider:refresh', { scope: 'workspace' });

      expect(access).toBe('access-token-123');
      expect(refresh).toBe('refresh-token-456');
    });
  });

  describe('DeviceCodeOAuthFlow', () => {
    it('should save credentials obtained from Device Code flow', async () => {
      await DeviceCodeOAuthFlow.saveCredentials(
        'tui-provider',
        {
          access: 'tui-access-999',
          refresh: 'tui-refresh-888',
          expires: Date.now() + 7200000,
        },
        { secretStore, scope: 'global' },
      );

      const access = await secretStore.getSecret('oauth:tui-provider:access', { scope: 'global' });
      const refresh = await secretStore.getSecret('oauth:tui-provider:refresh', { scope: 'global' });

      expect(access).toBe('tui-access-999');
      expect(refresh).toBe('tui-refresh-888');
    });
  });
});
