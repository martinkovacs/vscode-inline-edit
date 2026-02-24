import * as vscode from "vscode";
import * as http from "http";
import * as https from "https";
import * as crypto from "crypto";

const AUTH_DOMAIN = "auth.openai.com";
const AUTH_PATH = "/authorize";
const TOKEN_PATH = "/oauth/token";
const CLIENT_ID = "DRivsnm2Mu42T3KOpqdtwB3NYviHYzwD";
const REDIRECT_PORT = 1455;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/auth/callback`;
const SCOPE = "openid profile email offline_access";

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function extractAccountId(jwt: string): string | undefined {
  try {
    const payload = JSON.parse(
      Buffer.from(jwt.split(".")[1], "base64url").toString("utf-8")
    );
    return (
      payload.chatgpt_account_id ??
      payload["https://api.openai.com/auth"]?.chatgpt_account_id ??
      undefined
    );
  } catch {
    return undefined;
  }
}

export class ChatGPTProvider {
  private secrets: vscode.SecretStorage;
  private accessToken: string | undefined;
  private accountId: string | undefined;

  constructor(secrets: vscode.SecretStorage) {
    this.secrets = secrets;
  }

  async initialize(): Promise<void> {
    const token = await this.secrets.get("chatgpt.accessToken");
    if (token) {
      this.accessToken = token;
      this.accountId = extractAccountId(token);
    }
  }

  get loggedIn(): boolean {
    return !!this.accessToken;
  }

  // ── OAuth login ──────────────────────────────────────────────────────

  async login(): Promise<void> {
    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(
      crypto.createHash("sha256").update(verifier).digest()
    );
    const state = base64url(crypto.randomBytes(16));

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });

    const authUrl = `https://${AUTH_DOMAIN}${AUTH_PATH}?${params}`;

    const code = await new Promise<string>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url!, `http://localhost:${REDIRECT_PORT}`);
        if (url.pathname !== "/auth/callback") {
          res.writeHead(404);
          res.end();
          return;
        }

        const error = url.searchParams.get("error");
        if (error) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<h2>Login failed.</h2><p>You can close this tab.</p>");
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (url.searchParams.get("state") !== state) {
          res.writeHead(400);
          res.end("State mismatch");
          server.close();
          reject(new Error("OAuth state mismatch"));
          return;
        }

        const authCode = url.searchParams.get("code");
        if (!authCode) {
          res.writeHead(400);
          res.end("Missing code");
          server.close();
          reject(new Error("Missing authorization code"));
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<h2>Login successful!</h2><p>You can close this tab and return to VS Code.</p>"
        );
        server.close();
        resolve(authCode);
      });

      server.listen(REDIRECT_PORT, () => {
        vscode.env.openExternal(vscode.Uri.parse(authUrl));
      });

      const timeout = setTimeout(() => {
        server.close();
        reject(new Error("Login timed out after 2 minutes"));
      }, 120_000);

      server.on("close", () => clearTimeout(timeout));
    });

    const tokens = await this.exchangeCode(code, verifier);
    this.accessToken = tokens.access_token;
    this.accountId = extractAccountId(this.accessToken);

    await this.secrets.store("chatgpt.accessToken", this.accessToken);
    if (tokens.refresh_token) {
      await this.secrets.store("chatgpt.refreshToken", tokens.refresh_token);
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

      const req = https.request(
        {
          hostname: AUTH_DOMAIN,
          path: TOKEN_PATH,
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
                  `Token exchange failed (${res.statusCode}): ${data}`
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

  // ── API call ─────────────────────────────────────────────────────────

  async call(
    messages: { role: string; content: string }[],
    signal?: AbortSignal
  ): Promise<string> {
    if (!this.accessToken) {
      throw new Error("Not logged in to ChatGPT");
    }

    const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
    const userMsg = messages.find((m) => m.role === "user")?.content ?? "";
    const sessionId = crypto.randomUUID();

    const body = JSON.stringify({
      model: "gpt-5",
      instructions: systemMsg,
      input: userMsg,
      tools: [
        {
          type: "function",
          name: "shell",
          description: "Runs a shell command",
          parameters: {
            type: "object",
            properties: {
              command: { type: "array", items: { type: "string" } },
            },
            required: ["command"],
            additionalProperties: false,
          },
        },
        {
          type: "function",
          name: "update_plan",
          description: "Update the plan",
          parameters: {
            type: "object",
            properties: {
              plan: { type: "string" },
            },
            required: ["plan"],
            additionalProperties: false,
          },
        },
      ],
      stream: true,
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "chatgpt.com",
          path: "/backend-api/codex/responses",
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "OpenAI-Beta": "responses=experimental",
            session_id: sessionId,
            originator: "codex_cli_rs",
            ...(this.accountId
              ? { "chatgpt-account-id": this.accountId }
              : {}),
          },
        },
        (res) => {
          if (res.statusCode === 401) {
            this.accessToken = undefined;
            this.secrets.delete("chatgpt.accessToken");
            reject(
              new Error("ChatGPT session expired. Please log in again.")
            );
            return;
          }
          if (res.statusCode !== 200) {
            let errData = "";
            res.on("data", (c) => (errData += c));
            res.on("end", () =>
              reject(
                new Error(
                  `ChatGPT API error (${res.statusCode}): ${errData}`
                )
              )
            );
            return;
          }

          // Parse SSE stream, collecting text deltas
          let text = "";
          let buffer = "";
          let currentEvent = "";

          res.on("data", (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (line.startsWith("event: ")) {
                currentEvent = line.slice(7).trim();
              } else if (line.startsWith("data: ")) {
                const jsonStr = line.slice(6);
                if (jsonStr === "[DONE]") {
                  continue;
                }
                try {
                  const data = JSON.parse(jsonStr);
                  if (
                    currentEvent === "response.output_text.delta" &&
                    typeof data.delta === "string"
                  ) {
                    text += data.delta;
                  }
                } catch {
                  // skip unparseable lines
                }
              }
            }
          });

          res.on("end", () => {
            if (text) {
              resolve(text);
            } else {
              reject(new Error("No text content in ChatGPT response"));
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

  // ── Logout ───────────────────────────────────────────────────────────

  async logout(): Promise<void> {
    this.accessToken = undefined;
    this.accountId = undefined;
    await this.secrets.delete("chatgpt.accessToken");
    await this.secrets.delete("chatgpt.refreshToken");
  }
}
