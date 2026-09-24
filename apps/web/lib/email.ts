import "server-only";
import { Resend } from "resend";
import { env } from "./env";

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Sends through Resend from noreply@gnouht.space. Without an API key (local dev) the send is skipped. */
export async function sendEmail(message: OutgoingEmail): Promise<{ sent: boolean; error?: string }> {
  const key = env().RESEND_API_KEY;
  if (!key) return { sent: false, error: "RESEND_API_KEY not set" };
  const { error } = await new Resend(key).emails.send({ from: env().EMAIL_FROM, ...message });
  return error ? { sent: false, error: error.message } : { sent: true };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function inline(value: string): string {
  // Escape first (titles come from Moodle feeds and other users), then apply the tiny markdown we emit.
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

/**
 * Renders the brief's small markdown dialect (### headings, - and 1. lists, **bold**) as email-safe
 * HTML. Everything is escaped, so feed or task titles cannot inject markup into the email.
 */
export function briefToHtml(markdown: string, appUrl: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const line of markdown.split("\n")) {
    const heading = /^###\s+(.*)$/.exec(line);
    const bullet = /^-\s+(.*)$/.exec(line);
    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (heading) {
      close();
      out.push(`<h3 style="margin:18px 0 6px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#666b75">${inline(heading[1]!)}</h3>`);
    } else if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      if (list !== kind) {
        close();
        out.push(`<${kind} style="margin:0;padding-left:20px">`);
        list = kind;
      }
      out.push(`<li style="margin:4px 0">${inline((bullet ?? numbered)![1]!)}</li>`);
    } else if (line.trim()) {
      close();
      out.push(`<p style="margin:6px 0">${inline(line)}</p>`);
    }
  }
  close();
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#15171a;font-size:14px;line-height:1.55">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e3e6eb;border-radius:12px;padding:24px">
${out.join("\n")}
<p style="margin:20px 0 0"><a href="${escapeHtml(appUrl)}/today" style="color:#2458e6">Open today in the hub →</a></p>
<p style="margin:16px 0 0;font-size:12px;color:#666b75">You get this because morning briefs are on. Turn them off in Settings.</p>
</div></body></html>`;
}
