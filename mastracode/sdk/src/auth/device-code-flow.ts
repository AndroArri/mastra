import {
  createDeviceCodePollState,
  pollDeviceCodeUntilComplete,
  type DeviceCodePollOutcome,
  type DeviceCodePollState,
} from './device-code.js';
import type { OAuthCredentials } from './types.js';
import { SecretStore, type SecretScope } from '../connections/secret-store.js';

export interface DeviceAuthOptions {
  deviceAuthorizationUrl: string;
  clientId: string;
  scope?: string;
  additionalParams?: Record<string, string>;
}

export interface DeviceAuthResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
}

export interface DevicePollOptions {
  tokenUrl: string;
  clientId: string;
  deviceCode: string;
  state?: DeviceCodePollState;
  expiresIn?: number;
  interval?: number;
  signal?: AbortSignal;
}

export class DeviceCodeOAuthFlow {
  /**
   * Initiates Device Authorization Request (RFC 8628).
   */
  static async startDeviceAuthorization(options: DeviceAuthOptions): Promise<DeviceAuthResponse> {
    const bodyParams = new URLSearchParams();
    bodyParams.set('client_id', options.clientId);

    if (options.scope) {
      bodyParams.set('scope', options.scope);
    }

    if (options.additionalParams) {
      for (const [key, value] of Object.entries(options.additionalParams)) {
        bodyParams.set(key, value);
      }
    }

    const response = await fetch(options.deviceAuthorizationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Device authorization failed (HTTP ${response.status}): ${errorText}`);
    }

    const data = await response.json();

    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      verificationUriComplete: data.verification_uri_complete,
      expiresIn: typeof data.expires_in === 'number' ? data.expires_in : 600,
      interval: typeof data.interval === 'number' ? data.interval : 5,
    };
  }

  /**
   * Polls the token endpoint until authentication is complete or fails (for TUI).
   */
  static async pollForToken(options: DevicePollOptions): Promise<OAuthCredentials> {
    const pollState =
      options.state ??
      createDeviceCodePollState({
        expiresInSeconds: options.expiresIn ?? 600,
        intervalSeconds: options.interval ?? 5,
      });

    const pollOnce = async (): Promise<DeviceCodePollOutcome<OAuthCredentials>> => {
      const bodyParams = new URLSearchParams();
      bodyParams.set('grant_type', 'urn:ietf:params:oauth:grant-type:device_code');
      bodyParams.set('client_id', options.clientId);
      bodyParams.set('device_code', options.deviceCode);

      try {
        const response = await fetch(options.tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: bodyParams.toString(),
        });

        const data = await response.json();

        if (response.ok && data.access_token) {
          const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
          return {
            status: 'complete',
            result: {
              access: data.access_token,
              refresh: data.refresh_token ?? '',
              expires: Date.now() + expiresIn * 1000,
              token_type: data.token_type ?? 'Bearer',
              scope: data.scope,
              ...data,
            },
          };
        }

        const error = data.error || 'unknown_error';
        if (error === 'authorization_pending') {
          return { status: 'pending', intervalSeconds: data.interval };
        }
        if (error === 'slow_down') {
          return { status: 'slow_down', intervalSeconds: data.interval };
        }

        return {
          status: 'failed',
          error: data.error_description || error,
        };
      } catch (err) {
        return {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    };

    return pollDeviceCodeUntilComplete({
      state: pollState,
      pollOnce,
      signal: options.signal,
    });
  }

  /**
   * Saves OAuth credentials to SecretStore under the specified scope.
   */
  static async saveCredentials(
    providerId: string,
    credentials: OAuthCredentials,
    options?: { secretStore?: SecretStore; scope?: SecretScope },
  ): Promise<void> {
    const store = options?.secretStore ?? new SecretStore();
    const scope = options?.scope ?? 'global';

    await store.setSecret(`oauth:${providerId}:access`, credentials.access, { scope });
    if (credentials.refresh) {
      await store.setSecret(`oauth:${providerId}:refresh`, credentials.refresh, { scope });
    }
    await store.setSecret(`oauth:${providerId}:expires`, String(credentials.expires), { scope });
  }
}
