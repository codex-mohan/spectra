/**
 * GitHub Copilot device-code OAuth flow.
 *
 * Ported from opencode `copilot.ts` and pi-mono-ref `github-copilot.ts`.
 * Two-step exchange:
 *   1. GitHub device code → GitHub access token (the "refresh" credential)
 *   2. GitHub access token → Copilot session token (the "access" credential)
 *
 * Refresh re-fetches the Copilot session token using the stored GitHub access
 * token (step 2 only).
 */

import type { ProviderAuthCallbacks } from './provider-auth.js';
import type { OauthCredential } from './auth-store.js';

// ── Constants ──────────────────────────────────────────────────────────

/** GitHub Copilot Chat VS-Code extension client id (device-flow capable). */
const CLIENT_ID = 'Ov23li8tweQw6odWQebz';

const SCOPE = 'read:user';

/** Seconds to add when GitHub asks us to slow down (RFC 8628 §3.5). */
const SLOW_DOWN_INCREMENT_S = 5;

/** Safety buffer so we don't poll the server slightly too early. */
const OAUTH_POLL_SAFETY_MS = 3_000;

/** Skew subtracted from expires_at to avoid edge-expiry. */
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

// ── Types ──────────────────────────────────────────────────────────────

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
}

// ── URL helpers ────────────────────────────────────────────────────────

function githubUrls(domain: string) {
  return {
    deviceCode: `https://${domain}/login/device/code`,
    accessToken: `https://${domain}/login/oauth/access_token`,
    copilotToken: `https://api.${domain}/copilot_internal/v2/token`,
  };
}

// ── Fetch helpers ──────────────────────────────────────────────────────

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GitHub Copilot request failed: ${response.status} ${response.statusText}${text ? `: ${text}` : ''}`);
  }
  return response.json();
}

// ── Abortable sleep ────────────────────────────────────────────────────

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Login cancelled'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Login cancelled'));
      },
      { once: true },
    );
  });
}

// ── Device-flow: start ─────────────────────────────────────────────────

async function startDeviceFlow(domain: string): Promise<DeviceCodeResponse> {
  const urls = githubUrls(domain);
  const data = await fetchJson(urls.deviceCode, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'GitHubCopilotChat/0.35.0',
    },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }),
  });

  if (!data || typeof data !== 'object') {
    throw new Error('Invalid device code response');
  }

  const r = data as Record<string, unknown>;
  if (
    typeof r.device_code !== 'string' ||
    typeof r.user_code !== 'string' ||
    typeof r.verification_uri !== 'string' ||
    typeof r.interval !== 'number' ||
    typeof r.expires_in !== 'number'
  ) {
    throw new Error('Device code response missing required fields');
  }

  return {
    device_code: r.device_code,
    user_code: r.user_code,
    verification_uri: r.verification_uri,
    interval: r.interval,
    expires_in: r.expires_in,
  };
}

// ── Device-flow: poll for GitHub access token ──────────────────────────

async function pollForGitHubAccessToken(
  domain: string,
  deviceCode: string,
  intervalSeconds: number,
  expiresIn: number,
  signal?: AbortSignal,
): Promise<string> {
  const urls = githubUrls(domain);
  const deadline = Date.now() + expiresIn * 1000;
  let intervalMs = Math.max(1_000, Math.floor(intervalSeconds * 1000));

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Login cancelled');

    const remainingMs = deadline - Date.now();
    const waitMs = Math.min(intervalMs + OAUTH_POLL_SAFETY_MS, remainingMs);
    await abortableSleep(waitMs, signal);

    const raw = await fetchJson(urls.accessToken, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'GitHubCopilotChat/0.35.0',
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    if (raw && typeof raw === 'object') {
      const r = raw as Record<string, unknown>;

      // Success
      if (typeof r.access_token === 'string') return r.access_token;

      // Protocol-level errors
      if (typeof r.error === 'string') {
        const error = r.error;
        if (error === 'authorization_pending') continue;

        if (error === 'slow_down') {
          // RFC 8628 §3.5: add 5 s to current interval, or use server hint.
          intervalMs =
            typeof r.interval === 'number' && r.interval > 0
              ? r.interval * 1000
              : Math.max(1_000, intervalMs + SLOW_DOWN_INCREMENT_S * 1_000);
          continue;
        }

        const desc = typeof r.error_description === 'string' ? `: ${r.error_description}` : '';
        throw new Error(`Device flow failed: ${error}${desc}`);
      }
    }
  }

  throw new Error('Device flow timed out');
}

// ── Exchange GitHub access token for Copilot session token ─────────────

async function exchangeForCopilotToken(
  githubAccessToken: string,
  domain: string,
): Promise<{ access: string; expires: number }> {
  const urls = githubUrls(domain);
  const raw = await fetchJson(urls.copilotToken, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${githubAccessToken}`,
      'User-Agent': 'GitHubCopilotChat/0.35.0',
    },
  });

  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid Copilot token response');
  }

  const r = raw as Record<string, unknown>;
  if (typeof r.token !== 'string' || typeof r.expires_at !== 'number') {
    throw new Error('Copilot token response missing required fields');
  }

  return {
    access: r.token,
    // expires_at is epoch seconds; convert to ms and subtract skew.
    expires: r.expires_at * 1_000 - EXPIRY_SKEW_MS,
  };
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Run the GitHub Copilot device-code OAuth flow.
 *
 * 1. Optionally ask for a GitHub Enterprise domain.
 * 2. Start device flow and hand the user a verification URL + code.
 * 3. Poll until the user authorises.
 * 4. Exchange the GitHub access token for a short-lived Copilot session token.
 */
export async function loginGitHubCopilot(callbacks: ProviderAuthCallbacks): Promise<OauthCredential> {
  callbacks.onProgress('Requesting GitHub device authorization…');

  // ── Optional: enterprise domain prompt ─────────────────────────────
  // The ProviderAuthCallbacks interface in this codebase does not have
  // onPrompt, so we default to github.com. Enterprise support can be
  // added by extending ProviderAuthCallbacks when needed.
  const domain = 'github.com';

  // ── Step 1: Start device flow ─────────────────────────────────────
  const device = await startDeviceFlow(domain);

  // ── Step 2: Show user the verification URL and code ───────────────
  callbacks.onAuth({
    url: device.verification_uri,
    instructions: `Enter code: ${device.user_code}`,
  });
  callbacks.onProgress(`Waiting for authorization (code ${device.user_code})…`);

  // ── Step 3: Poll for GitHub access token ──────────────────────────
  const githubAccessToken = await pollForGitHubAccessToken(
    domain,
    device.device_code,
    device.interval,
    device.expires_in,
    callbacks.signal,
  );

  callbacks.onProgress('Exchanging GitHub token for Copilot session…');

  // ── Step 4: Exchange for Copilot session token ────────────────────
  const { access, expires } = await exchangeForCopilotToken(githubAccessToken, domain);

  return {
    type: 'oauth',
    refresh: githubAccessToken, // GitHub access token; used by refresh
    access,                     // short-lived Copilot session token
    expires,
  };
}

/**
 * Refresh a GitHub Copilot credential.
 *
 * `refreshToken` is the stored GitHub access token. It is used to fetch a
 * fresh Copilot session token (the session token is short-lived and not
 * refreshable on its own).
 */
export async function refreshGitHubCopilotToken(
  refreshToken: string,
  signal?: AbortSignal,
): Promise<OauthCredential> {
  const domain = 'github.com';
  const urls = githubUrls(domain);

  const raw = await fetchJson(urls.copilotToken, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${refreshToken}`,
      'User-Agent': 'GitHubCopilotChat/0.35.0',
    },
    signal,
  });

  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid Copilot token response');
  }

  const r = raw as Record<string, unknown>;
  if (typeof r.token !== 'string' || typeof r.expires_at !== 'number') {
    throw new Error('Copilot token response missing required fields');
  }

  return {
    type: 'oauth',
    refresh: refreshToken,
    access: r.token,
    expires: r.expires_at * 1_000 - EXPIRY_SKEW_MS,
  };
}
