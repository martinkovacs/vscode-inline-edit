import * as https from "https";

interface AnthropicContent {
  type: "text";
  text: string;
}

interface AnthropicResponse {
  content: AnthropicContent[];
}

export function callAnthropic(
  apiKey: string,
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

    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "x-api-key": apiKey,
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
