import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, scryptSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';

export type SecretScope = 'global' | 'workspace';
export type SecretResolveScope = 'global' | 'workspace' | 'auto';

export interface SecretStoreOptions {
  /** Directory for global credentials. Default: ~/.mastra */
  globalDir?: string;
  /** Directory for workspace credentials. Default: .mastra in process.cwd() */
  workspaceDir?: string;
  /** Optional encryption key override. Default: env MASTRA_ENCRYPTION_KEY / MASTRA_SECRET_KEY or deterministic machine fallback */
  encryptionKey?: string;
}

interface EncryptedPayload {
  iv: string;
  tag: string;
  data: string;
}

export class SecretStore {
  private globalDir: string;
  private workspaceDir: string;
  private key: Buffer;

  constructor(options?: SecretStoreOptions) {
    this.globalDir = options?.globalDir ?? join(homedir(), '.mastra');
    this.workspaceDir = options?.workspaceDir ?? join(process.cwd(), '.mastra');

    const rawKey =
      options?.encryptionKey ??
      process.env.MASTRA_ENCRYPTION_KEY ??
      process.env.MASTRA_SECRET_KEY ??
      `mastra-default-secret-key-${homedir()}`;

    this.key = scryptSync(rawKey, 'mastra-credentials-salt', 32);
  }

  private getFilePath(scope: SecretScope): string {
    const dir = scope === 'workspace' ? this.workspaceDir : this.globalDir;
    return join(dir, 'credentials.enc');
  }

  private encrypt(text: string): EncryptedPayload {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      data: encrypted.toString('hex'),
    };
  }

  private decrypt(payload: EncryptedPayload): string {
    const iv = Buffer.from(payload.iv, 'hex');
    const tag = Buffer.from(payload.tag, 'hex');
    const encryptedText = Buffer.from(payload.data, 'hex');

    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
    return decrypted.toString('utf8');
  }

  private readStore(scope: SecretScope): Record<string, string> {
    const filePath = this.getFilePath(scope);
    if (!existsSync(filePath)) {
      return {};
    }

    try {
      const fileContent = readFileSync(filePath, 'utf8');
      const payload: EncryptedPayload = JSON.parse(fileContent);
      const decryptedJson = this.decrypt(payload);
      return JSON.parse(decryptedJson);
    } catch {
      return {};
    }
  }

  private writeStore(scope: SecretScope, secrets: Record<string, string>): void {
    const filePath = this.getFilePath(scope);
    const dir = dirname(filePath);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    const jsonString = JSON.stringify(secrets);
    const encryptedPayload = this.encrypt(jsonString);

    writeFileSync(filePath, JSON.stringify(encryptedPayload, null, 2), { mode: 0o600 });
  }

  /**
   * Retrieves a secret by key.
   * Checks specified scope (or workspace then global if 'auto').
   * If not found in encrypted file, falls back automatically to process.env.
   */
  async getSecret(key: string, options?: { scope?: SecretResolveScope }): Promise<string | undefined> {
    const scope = options?.scope ?? 'auto';

    if (scope === 'workspace' || scope === 'auto') {
      const workspaceSecrets = this.readStore('workspace');
      if (key in workspaceSecrets) {
        return workspaceSecrets[key];
      }
    }

    if (scope === 'global' || scope === 'auto') {
      const globalSecrets = this.readStore('global');
      if (key in globalSecrets) {
        return globalSecrets[key];
      }
    }

    // Fallback automatico su process.env
    if (scope === 'auto') {
      return process.env[key];
    }

    return undefined;
  }

  /**
   * Sets and encrypts a secret in the specified scope (default 'global').
   */
  async setSecret(key: string, value: string, options?: { scope?: SecretScope }): Promise<void> {
    const scope = options?.scope ?? 'global';
    const secrets = this.readStore(scope);
    secrets[key] = value;
    this.writeStore(scope, secrets);
  }

  /**
   * Deletes a secret from specified scope (or both if 'auto').
   */
  async deleteSecret(key: string, options?: { scope?: SecretResolveScope }): Promise<boolean> {
    const scope = options?.scope ?? 'auto';
    let deleted = false;

    if (scope === 'workspace' || scope === 'auto') {
      const secrets = this.readStore('workspace');
      if (key in secrets) {
        delete secrets[key];
        this.writeStore('workspace', secrets);
        deleted = true;
      }
    }

    if (scope === 'global' || scope === 'auto') {
      const secrets = this.readStore('global');
      if (key in secrets) {
        delete secrets[key];
        this.writeStore('global', secrets);
        deleted = true;
      }
    }

    return deleted;
  }

  /**
   * Lists stored secret keys for specified scope (or combined if 'auto').
   */
  async listSecrets(options?: { scope?: SecretResolveScope }): Promise<string[]> {
    const scope = options?.scope ?? 'auto';
    const keys = new Set<string>();

    if (scope === 'workspace' || scope === 'auto') {
      Object.keys(this.readStore('workspace')).forEach(k => keys.add(k));
    }

    if (scope === 'global' || scope === 'auto') {
      Object.keys(this.readStore('global')).forEach(k => keys.add(k));
    }

    return Array.from(keys);
  }

  /**
   * Checks whether a secret key exists in SecretStore or process.env (when scope is 'auto').
   */
  async hasSecret(key: string, options?: { scope?: SecretResolveScope }): Promise<boolean> {
    const val = await this.getSecret(key, options);
    return val !== undefined;
  }
}
