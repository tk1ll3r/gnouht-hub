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

/** Outbound-only client for the hub: every request is HMAC-signed with a fresh nonce. */
export class CloudClient {
  constructor(
    private readonly hubUrl: string,
    private readonly deviceId: string,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async post<T = unknown>(path: string, payload: unknown): Promise<T> {
    const body = JSON.stringify(payload);
    const response = await this.fetchImpl(new URL(path, this.hubUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": `gnouht-hub-agent/${AGENT_VERSION}`,
        ...signedHeaders(this.deviceId, this.secret, "POST", path, body),
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new CloudError(json.error ?? `HTTP ${response.status}`, response.status);
    return json as T;
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
