/**
 * Containerized Isolation Fallback (Docker / MicroVM)
 *
 * Provides isolated sandbox execution backed by Docker containers, MicroVMs,
 * or fallback local execution when container runtimes are unavailable.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { SandboxCommandResult, SandboxExec } from './filesystem.js';
import type { SandboxIsolationType } from './session.js';

const execAsync = promisify(exec);

export interface ContainerIsolationConfig {
  /** Desired isolation type. Defaults to 'docker' with fallback to 'local'. */
  requestedIsolation?: SandboxIsolationType;
  /** Docker image to run container in (e.g. 'node:20-alpine'). */
  image?: string;
  /** Existing Docker container ID or name to execute commands in. */
  containerId?: string;
  /** MicroVM ID if running under a MicroVM supervisor (e.g. Firecracker). */
  microVmId?: string;
  /** Path or command name for docker CLI binary. Defaults to 'docker'. */
  dockerPath?: string;
  /** Working directory inside the container/VM. */
  workdir?: string;
  /** Environment variables to pass into execution. */
  env?: Record<string, string>;
  /** Whether to fall back to local host execution if Docker/MicroVM is missing/fails. Default true. */
  allowFallbackToLocal?: boolean;
  /** Callback emitted when isolation fallback occurs. */
  onFallback?: (from: SandboxIsolationType, to: SandboxIsolationType, reason: string) => void;
}

export class IsolatedSandboxRunner implements SandboxExec {
  readonly id: string;
  private currentIsolation: SandboxIsolationType;
  private readonly config: ContainerIsolationConfig;
  private dockerChecked = false;
  private dockerAvailable = false;

  constructor(options?: ContainerIsolationConfig & { id?: string }) {
    this.id = options?.id ?? `isolated-sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.config = {
      requestedIsolation: 'docker',
      allowFallbackToLocal: true,
      dockerPath: 'docker',
      workdir: '/workspace',
      ...options,
    };
    this.currentIsolation = this.config.requestedIsolation ?? 'docker';
  }

  /** Get current active isolation type (may differ from requested if fallback occurred). */
  get isolationType(): SandboxIsolationType {
    return this.currentIsolation;
  }

  /** Check if Docker runtime is available on host system. */
  async isDockerAvailable(): Promise<boolean> {
    if (this.dockerChecked) return this.dockerAvailable;
    try {
      const dockerBin = this.config.dockerPath ?? 'docker';
      await execAsync(`${dockerBin} --version`);
      this.dockerAvailable = true;
    } catch {
      this.dockerAvailable = false;
    }
    this.dockerChecked = true;
    return this.dockerAvailable;
  }

  /** Execute a command inside the isolated container, microvm, or local fallback shell. */
  async executeCommand(
    command: string,
    args?: string[],
    options?: { timeout?: number },
  ): Promise<SandboxCommandResult> {
    const fullCommand = args?.length ? `${command} ${args.map(a => `'${a.replace(/'/g, `'\\''`)}'`).join(' ')}` : command;

    if (this.currentIsolation === 'docker') {
      const available = await this.isDockerAvailable();
      if (!available) {
        if (this.config.allowFallbackToLocal) {
          this.fallbackToLocal('Docker binary or daemon is not available on host system.');
        } else {
          throw new Error('Docker isolation requested but Docker runtime is not available on host.');
        }
      }
    }

    if (this.currentIsolation === 'microvm') {
      if (!this.config.microVmId) {
        if (this.config.allowFallbackToLocal) {
          this.fallbackToLocal('MicroVM instance not configured or unreachable.');
        } else {
          throw new Error('MicroVM isolation requested but no microVmId configured.');
        }
      }
    }

    // Execute according to active isolation type
    if (this.currentIsolation === 'docker' && this.dockerAvailable) {
      return this.executeInDocker(fullCommand, options?.timeout);
    } else if (this.currentIsolation === 'microvm' && this.config.microVmId) {
      return this.executeInMicroVM(fullCommand, options?.timeout);
    } else if (this.currentIsolation === 'mock') {
      return { exitCode: 0, stdout: '', stderr: '' };
    } else {
      return this.executeInLocalShell(fullCommand, options?.timeout);
    }
  }

  private fallbackToLocal(reason: string): void {
    const previous = this.currentIsolation;
    this.currentIsolation = 'local';
    if (this.config.onFallback) {
      this.config.onFallback(previous, 'local', reason);
    }
  }

  private async executeInDocker(fullCommand: string, timeoutMs?: number): Promise<SandboxCommandResult> {
    const dockerBin = this.config.dockerPath ?? 'docker';
    const workdirArg = this.config.workdir ? `-w '${this.config.workdir}'` : '';
    let cmdString: string;

    if (this.config.containerId) {
      cmdString = `${dockerBin} exec ${workdirArg} '${this.config.containerId}' sh -c '${fullCommand.replace(/'/g, `'\\''`)}'`;
    } else {
      const img = this.config.image ?? 'alpine:latest';
      cmdString = `${dockerBin} run --rm ${workdirArg} '${img}' sh -c '${fullCommand.replace(/'/g, `'\\''`)}'`;
    }

    return this.runShellCommand(cmdString, timeoutMs);
  }

  private async executeInMicroVM(fullCommand: string, timeoutMs?: number): Promise<SandboxCommandResult> {
    const vmId = this.config.microVmId;
    const cmdString = `microvm-cli exec --id '${vmId}' -- sh -c '${fullCommand.replace(/'/g, `'\\''`)}'`;
    return this.runShellCommand(cmdString, timeoutMs);
  }

  private async executeInLocalShell(fullCommand: string, timeoutMs?: number): Promise<SandboxCommandResult> {
    let cmdString = fullCommand;
    if (process.platform === 'win32') {
      // If on Windows and command is sh -c '...', strip sh wrapper or run command directly
      const match = /^sh\s+-c\s+['"](.*)['"]$/s.exec(fullCommand);
      if (match) {
        cmdString = match[1]!;
      }
    } else {
      cmdString = fullCommand.startsWith('sh -c ')
        ? fullCommand
        : `sh -c '${fullCommand.replace(/'/g, `'\\''`)}'`;
    }
    return this.runShellCommand(cmdString, timeoutMs);
  }

  private async runShellCommand(cmdString: string, timeoutMs?: number): Promise<SandboxCommandResult> {
    try {
      const { stdout, stderr } = await execAsync(cmdString, {
        timeout: timeoutMs ?? 30_000,
        env: { ...process.env, ...this.config.env },
        windowsHide: true,
      });
      return { exitCode: 0, stdout: stdout.toString(), stderr: stderr.toString() };
    } catch (err: unknown) {
      const errorObj = err as { code?: number; stdout?: string | Buffer; stderr?: string | Buffer };
      return {
        exitCode: typeof errorObj.code === 'number' ? errorObj.code : 1,
        stdout: errorObj.stdout ? errorObj.stdout.toString() : '',
        stderr: errorObj.stderr ? errorObj.stderr.toString() : (err instanceof Error ? err.message : String(err)),
      };
    }
  }
}

/** Helper factory to create an isolated sandbox runner. */
export function createIsolatedSandbox(config?: ContainerIsolationConfig): IsolatedSandboxRunner {
  return new IsolatedSandboxRunner(config);
}
