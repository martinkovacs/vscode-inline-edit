import * as vscode from "vscode";
import * as https from "https";
import * as crypto from "crypto";

const AUTH_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://console.anthropic.com/api/oauth/token";
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const SCOPES = "org:create_api_key user:profile user:inference";

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ── Shared API call ────────────────────────────────────────────────────

interface AnthropicResponse {
  content: { type: string; text: string }[];
}

/**
 * Call the Anthropic Messages API.
 * `auth` is either an API key (x-api-key) or an OAuth Bearer token.
 */
export function callAnthropic(
  auth: { type: "apikey"; key: string } | { type: "oauth"; token: string },
  model: string,
  messages: { role: string; content: string }[],
  signal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
    const userMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const body = JSON.stringify({
      model,
      max_tokens: 8192,
      system: systemMsg,
      messages: userMessages,
    });

    const authHeader =
      auth.type === "apikey"
        ? { "x-api-key": auth.key }
        : { Authorization: `Bearer ${auth.token}` };

    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          ...authHeader,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(
              new Error(`Anthropic API error (${res.statusCode}): ${data}`)
            );
            return;
          }
          try {
            const parsed: AnthropicResponse = JSON.parse(data);
            const text = parsed.content?.find((c) => c.type === "text")?.text;
            if (!text) {
              reject(new Error("No text content in Anthropic response"));
              return;
            }
            resolve(text);
          } catch {
            reject(new Error(`Failed to parse Anthropic response: ${data}`));
          }
        });
      }
    );

    req.on("error", reject);

    if (signal) {
      signal.addEventListener("abort", () => {
        req.destroy();
        reject(new Error("Request aborted"));
      });
    }

    req.write(body);
    req.end();
  });
}

// ── OAuth provider ─────────────────────────────────────────────────────

export class AnthropicOAuthProvider {
  private secrets: vscode.SecretStorage;
  private accessToken: string | undefined;
  private refreshToken: string | undefined;

  constructor(secrets: vscode.SecretStorage) {
    this.secrets = secrets;
  }

  async initialize(): Promise<void> {
    this.accessToken =
      (await this.secrets.get("anthropic.oauthAccessToken")) || undefined;
    this.refreshToken =
      (await this.secrets.get("anthropic.oauthRefreshToken")) || undefined;
  }

  get loggedIn(): boolean {
    return !!this.accessToken;
  }

  get token(): string | undefined {
    return this.accessToken;
  }

  async login(): Promise<void> {
    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(
      crypto.createHash("sha256").update(verifier).digest()
    );
    const state = base64url(crypto.randomBytes(16));

    const params = new URLSearchParams({
      code: "true",
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });

    const authUrl = `${AUTH_URL}?${params}`;
    await vscode.env.openExternal(vscode.Uri.parse(authUrl));

    const code = await vscode.window.showInputBox({
      prompt:
        "Log in with Claude in the browser, then paste the authorization code shown on the redirect page",
      placeHolder: "Paste authorization code here",
      ignoreFocusOut: true,
    });

    if (!code) {
      throw new Error("Login cancelled");
    }

    const tokens = await this.exchangeCode(code.trim(), verifier);
    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token;

    await this.secrets.store("anthropic.oauthAccessToken", this.accessToken);
    if (this.refreshToken) {
      await this.secrets.store("anthropic.oauthRefreshToken", this.refreshToken);
    }
  }

  private exchangeCode(
    code: string,
    verifier: string
  ): Promise<{ access_token: string; refresh_token?: string }> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      });

      const url = new URL(TOKEN_URL);
      const req = https.request(
        {
          hostname: url.hostname,
          path: url.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            if (res.statusCode !== 200) {
              reject(
                new Error(
                  `Anthropic token exchange failed (${res.statusCode}): ${data}`
                )
              );
              return;
            }
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error("Failed to parse token response"));
            }
          });
        }
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  async refresh(): Promise<boolean> {
    if (!this.refreshToken) {
      return false;
    }

    try {
      const tokens = await new Promise<{
        access_token: string;
        refresh_token?: string;
      }>((resolve, reject) => {
        const body = JSON.stringify({
          grant_type: "refresh_token",
          client_id: CLIENT_ID,
          refresh_token: this.refreshToken,
        });

        const url = new URL(TOKEN_URL);
        const req = https.request(
          {
            hostname: url.hostname,
            path: url.pathname,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            },
          },
          (res) => {
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => {
              if (res.statusCode !== 200) {
                reject(new Error(`Token refresh failed (${res.statusCode})`));
                return;
              }
              try {
                resolve(JSON.parse(data));
              } catch {
                reject(new Error("Failed to parse refresh response"));
              }
            });
          }
        );
        req.on("error", reject);
        req.write(body);
        req.end();
      });

      this.accessToken = tokens.access_token;
      if (tokens.refresh_token) {
        this.refreshToken = tokens.refresh_token;
      }

      await this.secrets.store("anthropic.oauthAccessToken", this.accessToken);
      if (this.refreshToken) {
        await this.secrets.store(
          "anthropic.oauthRefreshToken",
          this.refreshToken
        );
      }
      return true;
    } catch {
      return false;
    }
  }

  async logout(): Promise<void> {
    this.accessToken = undefined;
    this.refreshToken = undefined;
    await this.secrets.delete("anthropic.oauthAccessToken");
    await this.secrets.delete("anthropic.oauthRefreshToken");
  }
}
