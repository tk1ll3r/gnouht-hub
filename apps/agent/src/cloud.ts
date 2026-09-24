import { signedHeaders } from "@hub/core/protocol";
import { AGENT_VERSION } from "./version";

export class CloudError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CloudError";
  }
}

/**
 * Outbound-only client for the hub: every request is HMAC-signed with a fresh nonce (so a retry is a
 * new request, never a replay). Rate-limited requests (429) are retried twice with a growing delay.
 */
export class CloudClient {
  constructor(
    private readonly hubUrl: string,
    private readonly deviceId: string,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly retryDelayMs = 20_000,
  ) {}

  async post<T = unknown>(path: string, payload: unknown): Promise<T> {
    const body = JSON.stringify(payload);
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetchImpl(new URL(path, this.hubUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": `gnouht-hub-agent/${AGENT_VERSION}`,
          ...signedHeaders(this.deviceId, this.secret, "POST", path, body),
        },
        body,
        signal: AbortSignal.timeout(60_000),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.status === 429 && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * (attempt + 1)));
        continue;
      }
      if (!response.ok) throw new CloudError(json.error ?? `HTTP ${response.status}`, response.status);
      return json as T;
    }
  }
}

/** Unsigned pairing call: trades the one-time code for a device id and secret. */
export async function pairDevice(hubUrl: string, input: { code: string; name: string; platform: string }): Promise<{ deviceId: string; secret: string }> {
  const response = await fetch(new URL("/api/agent/pair", hubUrl), {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": `gnouht-hub-agent/${AGENT_VERSION}` },
    body: JSON.stringify({ ...input, agentVersion: AGENT_VERSION }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await response.json().catch(() => ({}))) as { error?: string; deviceId?: string; secret?: string };
  if (!response.ok || !json.deviceId || !json.secret) throw new CloudError(json.error ?? `HTTP ${response.status}`, response.status);
  return { deviceId: json.deviceId, secret: json.secret };
}
