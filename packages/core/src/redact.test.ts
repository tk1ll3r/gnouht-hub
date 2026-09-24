import { describe, expect, it } from "vitest";
import { REDACTED, redactSecrets } from "./redact";

describe("redactSecrets", () => {
  it.each([
    ["aws key", "key AKIAIOSFODNN7EXAMPLE in notes"],
    ["github token", `token ghp_${"a".repeat(36)} here`],
    ["llm key", `export KEY=sk-ant-${"x".repeat(40)}`],
    ["openai project key", `sk-proj-${"Ab1_".repeat(8)}`],
    ["supabase secret", `sb_secret_${"N7UND0UgjKTVK".repeat(2)}`],
    ["jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"],
    ["google api key", `AIza${"B".repeat(35)}`],
  ])("redacts a %s", (_name, text) => {
    const result = redactSecrets(text);
    expect(result.count).toBe(1);
    expect(result.text).toContain(REDACTED);
  });

  it("removes whole private key blocks", () => {
    const text = "before\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----\nafter";
    expect(redactSecrets(text).text).toBe(`before\n${REDACTED}\nafter`);
  });

  it("keeps the label of password-like assignments", () => {
    expect(redactSecrets('db password = "hunter2hunter2"').text).toBe(`db password = "${REDACTED}"`);
    expect(redactSecrets("Mật khẩu: MatKhau@2026").text).toBe(`Mật khẩu: ${REDACTED}`);
    expect(redactSecrets("api_key: abcdef123456").text).toBe(`api_key: ${REDACTED}`);
  });

  it("keeps the user and host of URLs with embedded credentials", () => {
    expect(redactSecrets("postgres://admin:s3cretpw@db.local:5432/x").text).toBe(`postgres://admin:${REDACTED}@db.local:5432/x`);
  });

  it("leaves ordinary prose alone and is idempotent", () => {
    const prose = "Password policy: see section 3. The key finding is that sk is short.";
    expect(redactSecrets(prose)).toEqual({ text: prose, count: 0, kinds: [] });
    const once = redactSecrets("password=abcdefgh").text;
    expect(redactSecrets(once)).toMatchObject({ text: once, count: 0 });
  });
});
