/**
 * Re-export sandbox reattach seam from `sdk/src/sandbox/session.ts`
 * for backward compatibility.
 */
export { registerSandboxReattach, reattachProjectSandbox } from '../sandbox/session.js';
export type {
  MinimalSandboxHandle as ReattachedSandbox,
  SandboxReattachOptions,
  SandboxReattachFn,
} from '../sandbox/session.js';
