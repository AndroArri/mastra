import { generatePKCE } from './pkce.js';
import type { OAuthCredentials } from './types.js';
import { SecretStore, type SecretScope } from '../connections/secret-store.js';

export interface PKCEAuthorizeOptions {
  authorizationUrl: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
  state?: string;
  additionalParams?: Record<string, string>;
}

export interface PKCEAuthorizeResult {
  url: string;
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

export interface PKCETokenExchangeOptions {
  tokenUrl: string;
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientSecret?: string;
  additionalParams?: Record<string, string>;
}

export class PKCEOAuthFlow {
  /**
   * Generates authorization URL with PKCE parameters for Factory UI / Web flow.
   */
  static async generateAuthorizationUrl(options: PKCEAuthorizeOptions): Promise<PKCEAuthorizeResult> {
    const { verifier, challenge } = await generatePKCE();
    const state = options.state ?? Math.random().toString(36).substring(2, 15);

    const url = new URL(options.authorizationUrl);
    url.searchParams.set('client_id', options.clientId);
    url.searchParams.set('redirect_uri', options.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);

    if (options.scope) {
      url.searchParams.set('scope', options.scope);
    }

    if (options.additionalParams) {
      for (const [key, value] of Object.entries(options.additionalParams)) {
        url.searchParams.set(key, value);
      }
    }

    return {
      url: url.toString(),
      state,
      codeVerifier: verifier,
      codeChallenge: challenge,
    };
  }

  /**
   * Exchanges authorization code for access and refresh tokens.
   */
  static async exchangeCodeForToken(options: PKCETokenExchangeOptions): Promise<OAuthCredentials> {
    const bodyParams = new URLSearchParams();
    bodyParams.set('grant_type', 'authorization_code');
    bodyParams.set('client_id', options.clientId);
    bodyParams.set('code', options.code);
    bodyParams.set('redirect_uri', options.redirectUri);
    bodyParams.set('code_verifier', options.codeVerifier);

    if (options.clientSecret) {
      bodyParams.set('client_secret', options.clientSecret);
    }

    if (options.additionalParams) {
      for (const [key, value] of Object.entries(options.additionalParams)) {
        bodyParams.set(key, value);
      }
    }

    const response = await fetch(options.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed (HTTP ${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;

    return {
      access: data.access_token,
      refresh: data.refresh_token ?? '',
      expires: Date.now() + expiresIn * 1000,
      token_type: data.token_type ?? 'Bearer',
      scope: data.scope,
      ...data,
    };
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
