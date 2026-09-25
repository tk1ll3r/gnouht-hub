import { describe, expect, it } from "vitest";
import { briefToHtml, inviteEmail } from "./email";

describe("briefToHtml", () => {
  it("renders headings, lists and bold text", () => {
    const html = briefToHtml("**Thu — 1 urgent.**\n\n### Do first\n1. **Lab 3** — due soon\n\n### Today\n- 07:30–09:45 · NT219", "https://hub.gnouht.space");
    expect(html).toContain("<strong>Thu — 1 urgent.</strong>");
    expect(html).toContain("<ol");
    expect(html).toContain("<li style=\"margin:4px 0\"><strong>Lab 3</strong> — due soon</li>");
    expect(html).toContain("<ul");
    expect(html).toContain('href="https://hub.gnouht.space/today"');
  });

  it("escapes markup coming from task titles or feeds", () => {
    const html = briefToHtml('1. **<img src=x onerror=alert(1)>** — "quoted"', "https://hub.gnouht.space");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&quot;quoted&quot;");
  });
});

describe("inviteEmail", () => {
  it("escapes user-chosen names and links", () => {
    const mail = inviteEmail({ groupName: '<script>x</script> "NT219"', inviterName: "Gi<b>na", link: "https://hub.gnouht.space/invite/abc?x=1&y=2", expiresOn: "2026-10-01" });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<b>na");
    expect(mail.html).toContain("&lt;script&gt;x&lt;/script&gt; &quot;NT219&quot;");
    expect(mail.html).toContain('href="https://hub.gnouht.space/invite/abc?x=1&amp;y=2"');
    expect(mail.text).toContain("https://hub.gnouht.space/invite/abc?x=1&y=2");
  });
});
