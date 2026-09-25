// Best-effort secret scrubbing for document text before it leaves the owner's PC (and again on
// ingest). It is a safety net for credentials pasted into notes, not a guarantee: files that are
// secrets by nature are excluded by name in the agent.

interface Rule {
  name: string;
  pattern: RegExp;
  /** Keeps a prefix (e.g. "password: ") and replaces only the value. */
  keepGroup?: number;
}

const RULES: readonly Rule[] = [
  { name: "private-key", pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g },
  { name: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { name: "slack-token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { name: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "stripe-key", pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: "llm-api-key", pattern: /\bsk-(?:ant-|proj-|or-v1-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: "supabase-secret", pattern: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: "url-credentials", pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(@)/gi, keepGroup: 1 },
  {
    name: "assignment",
    // password = "…", api_key: …, mật khẩu: …  (value up to the end of the token)
    pattern: /((?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|mật khẩu|mat khau)\s*[:=]\s*["']?)([^\s"'`,;]{6,})/giu,
    keepGroup: 1,
  },
];

export const REDACTED = "[redacted]";

export interface RedactionResult {
  text: string;
  count: number;
  kinds: string[];
}

export function redactSecrets(text: string): RedactionResult {
  let count = 0;
  const kinds = new Set<string>();
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (...args: unknown[]) => {
      const match = args[0] as string;
      if (match.includes(REDACTED)) return match;
      count++;
      kinds.add(rule.name);
      if (rule.keepGroup) {
        const prefix = args[rule.keepGroup] as string;
        const suffix = rule.name === "url-credentials" ? (args[2] as string) : "";
        return `${prefix}${REDACTED}${suffix}`;
      }
      return REDACTED;
    });
  }
  return { text: out, count, kinds: [...kinds] };
}
