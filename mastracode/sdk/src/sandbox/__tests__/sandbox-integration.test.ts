import { describe, expect, it, vi } from 'vitest';
import {
  SandboxFilesystem,
  SandboxSessionManager,
  registerSandboxReattach,
  reattachProjectSandbox,
  IsolatedSandboxRunner,
  createIsolatedSandbox,
  validateSandboxPath,
  authorizeSandboxAccess,
  SanitizedSandboxContext,
  SandboxSecurityError,
  SandboxAuthorizationError,
} from '../index.js';
import type { SandboxCommandResult, SandboxExec } from '../filesystem.js';

class FakeSandboxExec implements SandboxExec {
  readonly id: string;
  readonly calls: string[] = [];
  private responder: (script: string) => SandboxCommandResult;

  constructor(id = 'fake-sandbox-exec', responder?: (script: string) => SandboxCommandResult) {
    this.id = id;
    this.responder = responder ?? (() => ({ exitCode: 0, stdout: '', stderr: '' }));
  }

  async executeCommand(command: string, args?: string[]): Promise<SandboxCommandResult> {
    const script = command === 'sh' && args?.[0] === '-c' ? args[1]! : [command, ...(args ?? [])].join(' ');
    this.calls.push(script);
    return this.responder(script);
  }
}

const WORKDIR = '/workspace/test-repo';

function isContainmentCheck(script: string): boolean {
  return script.startsWith('p=');
}

function realpathResult(realPath: string): SandboxCommandResult {
  return { exitCode: 0, stdout: `${WORKDIR}\n${realPath}`, stderr: '' };
}

function createTestFs(responder?: (script: string) => SandboxCommandResult) {
  const wrapped = (script: string): SandboxCommandResult => {
    if (responder) return responder(script);
    if (isContainmentCheck(script)) return realpathResult(WORKDIR);
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  const sandbox = new FakeSandboxExec('test-sandbox', wrapped);
  const fs = new SandboxFilesystem({ sandbox, workdir: WORKDIR });
  return { sandbox, fs };
}

describe('Sandbox Integration Tests', () => {
  describe('1. Base64 Transports & File Operations', () => {
    it('reads binary and text files via base64 stream decoding', async () => {
      const originalText = 'Hello Mastra Sandbox!';
      const b64Data = Buffer.from(originalText, 'utf8').toString('base64');
      const { sandbox, fs } = createTestFs(script => {
        if (isContainmentCheck(script)) return realpathResult(`${WORKDIR}/src/app.ts`);
        return { exitCode: 0, stdout: b64Data, stderr: '' };
      });

      const textResult = await fs.readFile('/src/app.ts', { encoding: 'utf8' });
      expect(textResult).toBe(originalText);

      const bufferResult = await fs.readFile('/src/app.ts');
      expect(Buffer.isBuffer(bufferResult)).toBe(true);
      expect(bufferResult.toString('utf8')).toBe(originalText);
      expect(sandbox.calls.some(c => c.includes(`base64 < '${WORKDIR}/src/app.ts'`))).toBe(true);
    });

    it('writes files using base64 pipe decoding', async () => {
      const { sandbox, fs } = createTestFs(script => {
        if (isContainmentCheck(script)) return realpathResult(`${WORKDIR}/docs/readme.md`);
        return { exitCode: 0, stdout: '', stderr: '' };
      });

      const textToWrite = '# Mastra Sandbox Docs';
      const b64Expected = Buffer.from(textToWrite).toString('base64');
      await fs.writeFile('/docs/readme.md', textToWrite);

      const writeCall = sandbox.calls.find(c => c.includes('base64 -d'));
      expect(writeCall).toBeDefined();
      expect(writeCall).toContain(b64Expected);
      expect(writeCall).toContain(`> '${WORKDIR}/docs/readme.md'`);
    });

    it('appends content via base64 append pipe', async () => {
      const { sandbox, fs } = createTestFs(script => {
        if (isContainmentCheck(script)) return realpathResult(`${WORKDIR}/log.txt`);
        return { exitCode: 0, stdout: '', stderr: '' };
      });

      const appendContent = 'log line 1\n';
      const b64Expected = Buffer.from(appendContent).toString('base64');
      await fs.appendFile('/log.txt', appendContent);

      const appendCall = sandbox.calls.find(c => c.includes('>>'));
      expect(appendCall).toBeDefined();
      expect(appendCall).toContain(b64Expected);
      expect(appendCall).toContain(`>> '${WORKDIR}/log.txt'`);
    });
  });

  describe('2. Path Traversal & Security Containment Guards', () => {
    it('rejects lexical path traversal attempting to escape workdir root', () => {
      const { fs } = createTestFs();
      expect(() => fs.resolveAbsolutePath('../../etc/passwd')).toThrow(/Path escapes workspace root/);
    });

    it('rejects symlinks whose realpath escapes workspace root', async () => {
      const { fs } = createTestFs(script => {
        if (isContainmentCheck(script)) return realpathResult('/etc/passwd');
        return { exitCode: 0, stdout: '', stderr: '' };
      });

      await expect(fs.readFile('/symlink-to-passwd')).rejects.toThrow(
        /escapes workspace root \(symlink\)/,
      );
    });

    it('rejects write operations where parent directory is a symlink escaping workdir', async () => {
      const { sandbox, fs } = createTestFs(script => {
        if (isContainmentCheck(script)) return realpathResult('/var/log');
        return { exitCode: 0, stdout: '', stderr: '' };
      });

      await expect(fs.writeFile('/escaped-dir/subfile.txt', 'data')).rejects.toThrow(
        /escapes workspace root \(symlink\)/,
      );
      expect(sandbox.calls.some(c => c.includes('base64 -d'))).toBe(false);
    });
  });

  describe('3. Sandbox Session Management & Re-attachment', () => {
    it('creates, retrieves, and tracks sandbox sessions', () => {
      const manager = new SandboxSessionManager();
      const session = manager.createSession({
        providerSandboxId: 'sbx-prov-100',
        workdir: WORKDIR,
        actingUserId: 'user-alpha',
        isolationType: 'docker',
      });

      expect(session.id).toBeDefined();
      expect(session.status).toBe('active');
      expect(manager.getSession(session.id)).toEqual(session);
      expect(manager.findSessionByProviderId('sbx-prov-100')).toEqual(session);
    });

    it('handles session re-attachment with actingUserId propagation', async () => {
      const mockExec = new FakeSandboxExec('reattached-sandbox');
      const reattachSpy = vi.fn().mockResolvedValue(mockExec);
      registerSandboxReattach(reattachSpy);

      const manager = new SandboxSessionManager();
      const session = manager.createSession({
        providerSandboxId: 'sbx-prov-200',
        workdir: WORKDIR,
        actingUserId: 'user-original',
      });

      const reattached = await manager.reattachSession(session.id, { actingUserId: 'user-override' });

      expect(reattachSpy).toHaveBeenCalledWith('sbx-prov-200', { actingUserId: 'user-override' });
      expect(reattached.status).toBe('active');
      expect(reattached.sandbox).toBe(mockExec);
    });

    it('re-attaches directly via reattachProjectSandbox helper', async () => {
      const mockExec = new FakeSandboxExec('direct-reattach-sandbox');
      const reattachSpy = vi.fn().mockResolvedValue(mockExec);
      registerSandboxReattach(reattachSpy);

      const result = await reattachProjectSandbox('sbx-direct-123', { actingUserId: 'usr-99' });

      expect(result).toBe(mockExec);
      expect(reattachSpy).toHaveBeenCalledWith('sbx-direct-123', { actingUserId: 'usr-99' });
    });

    it('marks sessions as poisoned on preflight failure and handles termination', async () => {
      const manager = new SandboxSessionManager();
      const session = manager.createSession({
        providerSandboxId: 'sbx-poisoned-1',
        workdir: WORKDIR,
      });

      manager.markPoisoned(session.id);
      expect(manager.getSession(session.id)?.status).toBe('poisoned');

      await manager.terminateSession(session.id);
      expect(manager.getSession(session.id)?.status).toBe('terminated');
    });
  });

  describe('4. Containerized Isolation Fallback (Docker / MicroVM)', () => {
    it('initializes isolated sandbox runner and reports requested isolation', () => {
      const runner = createIsolatedSandbox({
        requestedIsolation: 'docker',
        allowFallbackToLocal: true,
      });

      expect(runner.isolationType).toBe('docker');
    });

    it('falls back to local shell execution with onFallback callback when Docker is missing', async () => {
      const fallbackSpy = vi.fn();
      const runner = new IsolatedSandboxRunner({
        requestedIsolation: 'docker',
        allowFallbackToLocal: true,
        dockerPath: 'non_existent_docker_bin_xyz',
        onFallback: fallbackSpy,
      });

      const result = await runner.executeCommand('echo "test-fallback"');

      expect(runner.isolationType).toBe('local');
      expect(fallbackSpy).toHaveBeenCalledWith('docker', 'local', expect.any(String));
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('test-fallback');
    });
  });

  describe('5. TUI and Factory UI Authorization Checks & Path Security', () => {
    it('validates sandbox paths and throws SandboxSecurityError on null bytes or prohibited paths', () => {
      expect(() => validateSandboxPath('/etc/passwd', WORKDIR)).toThrow(SandboxSecurityError);
      expect(() => validateSandboxPath('file\0.txt', WORKDIR)).toThrow(SandboxSecurityError);
      expect(() => validateSandboxPath('../../escape', WORKDIR)).toThrow(SandboxSecurityError);

      const valid = validateSandboxPath('src/main.ts', WORKDIR);
      expect(valid).toBe(`${WORKDIR}/src/main.ts`);
    });

    it('authorizes operation against security policy for TUI and Factory UI context', () => {
      const tuiContext = {
        interfaceType: 'tui' as const,
        policy: { readOnly: true, allowedInterfaces: ['tui' as const] },
      };

      expect(() =>
        authorizeSandboxAccess(tuiContext, { operation: 'read', targetPath: 'src/index.ts', workdir: WORKDIR }),
      ).not.toThrow();

      expect(() =>
        authorizeSandboxAccess(tuiContext, { operation: 'write', targetPath: 'src/index.ts', workdir: WORKDIR }),
      ).toThrow(SandboxAuthorizationError);
    });

    it('SanitizedSandboxContext wraps filesystem operations with authorization enforcement', async () => {
      const mockExec = new FakeSandboxExec('sanitized-sandbox', script => {
        if (isContainmentCheck(script)) return realpathResult(`${WORKDIR}/src/index.ts`);
        return { exitCode: 0, stdout: Buffer.from('sanitized-content').toString('base64'), stderr: '' };
      });

      const sanitizedCtx = new SanitizedSandboxContext({
        sandbox: mockExec,
        workdir: WORKDIR,
        authContext: {
          interfaceType: 'factory-ui',
          policy: { readOnly: false, allowedInterfaces: ['factory-ui'] },
        },
      });

      const content = await sanitizedCtx.readFile('src/index.ts', { encoding: 'utf8' });
      expect(content).toBe('sanitized-content');

      await expect(sanitizedCtx.readFile('/etc/passwd')).rejects.toThrow(SandboxSecurityError);
    });
  });
});
