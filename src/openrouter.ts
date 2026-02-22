import * as https from "https";

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterResponse {
  choices: { message: { content: string } }[];
}

export function callOpenRouter(
  apiKey: string,
  model: string,
  messages: OpenRouterMessage[],
  signal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, messages });

    const req = https.request(
      {
        hostname: "openrouter.ai",
        path: "/api/v1/chat/completions",
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/martinkovacs/vscode-inline-edit",
          "X-Title": "Inline Edit VS Code Extension",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`OpenRouter API error (${res.statusCode}): ${data}`));
            return;
          }
          try {
            const parsed: OpenRouterResponse = JSON.parse(data);
            const content = parsed.choices?.[0]?.message?.content;
            if (!content) {
              reject(new Error("No content in OpenRouter response"));
              return;
            }
            resolve(content);
          } catch (e) {
            reject(new Error(`Failed to parse OpenRouter response: ${data}`));
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
