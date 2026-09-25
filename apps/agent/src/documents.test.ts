import { strToU8, zipSync } from "fflate";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CloudClient } from "./cloud";
import { HashCache, syncFolder } from "./docsync";
import { isNoisyPath } from "./daemon";
import { checkFolderScope, CODE_PRESET, DEFAULT_INCLUDE, extractText, folderKey, folderLabel, listFolder, pptxText, type WatchedFolder } from "./documents";

let root: string;
let outside: string;

function docx(paragraphs: string[]): Uint8Array {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join("");
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    "word/document.xml": strToU8(
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    ),
  });
}

function pptx(slides: Record<number, string[]>): Uint8Array {
  const files: Record<string, Uint8Array> = { "ppt/presentation.xml": strToU8("<p:presentation/>") };
  for (const [n, lines] of Object.entries(slides)) {
    const paragraphs = lines.map((l) => `<a:p><a:r><a:t>${l}</a:t></a:r></a:p>`).join("");
    files[`ppt/slides/slide${n}.xml`] = strToU8(`<p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree><p:sp><p:txBody>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  }
  return zipSync(files);
}

/** A minimal one-page PDF showing `text` (pdf.js rebuilds the cross-reference table if offsets are off). */
function pdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(out);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "hub-docs-"));
  outside = mkdtempSync(join(tmpdir(), "hub-outside-"));
  const write = (rel: string, content: string | Uint8Array) => {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), content);
  };
  write("Tiến độ.md", "\uFEFF# Tiến độ\n- [x] Chọn đề tài\n- [ ] Viết báo cáo 📅 2026-10-05\napi_key: sk-ant-abcdefghijklmnopqrstuvwxyz0123\n");
  write("notes/meeting.txt", "Họp nhóm thứ 5");
  write("notes/report.docx", docx(["Báo cáo giữa kỳ", "Phần 1: Giới thiệu"]));
  write("papers/survey.pdf", pdf("Intrusion detection survey"));
  write(".git/HEAD.md", "hidden");
  write(".obsidian/workspace.md", "hidden");
  write("node_modules/pkg/readme.md", "dependency");
  write("my-secrets.md", "do not read");
  write("~$report.docx", "office lock file");
  write("big.txt", "x".repeat(4 * 1024 * 1024 + 1));
  write("app/src/main.ts", "export function main() {}\n");
  write("app/src/util.py", "def helper():\n    pass\n");
  write("app/Dockerfile", "FROM node:24\n");
  write("app/config.yaml", "db:\n  password: hunter22\n");
  write("app/package-lock.json", "{}");
  write("app/dist/bundle.js", "minified");
  write("app/vendor/lib/x.go", "package x");
  write("app/public/app.min.js", "minified");
  write("app/src/generated.ts", "x".repeat(1024 * 1024 + 1));
  writeFileSync(join(outside, "private.md"), "outside the folder");
  symlinkSync(outside, join(root, "linked"), "dir");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const folder = (): WatchedFolder => ({ root, name: "Demo", slug: "demo", include: DEFAULT_INCLUDE, exclude: [] });

describe("listFolder", () => {
  it("lists only included files, skipping hidden, dependency, secret-looking, oversized and linked paths", async () => {
    const listing = await listFolder(folder());
    expect(listing.files.map((f) => f.path)).toEqual(["notes/meeting.txt", "notes/report.docx", "Tiến độ.md"]);
    expect(listing.skipped).toBe(1); // big.txt
    expect(listing.truncated).toBe(false);
  });

  it("honours extra include and exclude globs", async () => {
    const listing = await listFolder({ ...folder(), include: [...DEFAULT_INCLUDE, "**/*.pdf"], exclude: ["notes/**"] });
    expect(listing.files.map((f) => f.path)).toEqual(["papers/survey.pdf", "Tiến độ.md"]);
  });

  it("indexes source files only with the --code preset, never build output, lock files or configuration", async () => {
    const plain = await listFolder({ ...folder(), root: join(root, "app") });
    expect(plain.files).toEqual([]);
    const code = await listFolder({ ...folder(), root: join(root, "app"), include: CODE_PRESET });
    expect(code.files.map((f) => `${f.path}:${f.kind}`)).toEqual(["Dockerfile:code", "src/main.ts:code", "src/util.py:code"]);
    expect(code.skipped).toBe(1); // generated.ts is over the 1 MB source limit
    const withConfig = await listFolder({ ...folder(), root: join(root, "app"), include: [...CODE_PRESET, "**/*.yaml"] });
    expect(withConfig.files.map((f) => f.path)).toContain("config.yaml");
  });

  it("refuses to list a missing root instead of reporting an empty folder", async () => {
    await expect(listFolder({ ...folder(), root: join(root, "does-not-exist") })).rejects.toThrow(/cannot read/);
  });

  it("stops at the file limit and says so", async () => {
    const listing = await listFolder(folder(), 2);
    expect(listing.files).toHaveLength(2);
    expect(listing.truncated).toBe(true);
  });
});

describe("folder identity and scope", () => {
  it("hashes the absolute path, case-insensitively on Windows, and labels with the last segments", () => {
    expect(folderKey("C:\\Users\\X\\Research", "win32")).toBe(folderKey("c:\\users\\x\\research\\", "win32"));
    expect(folderKey("/home/x/Research", "linux")).not.toBe(folderKey("/home/x/research", "linux"));
    expect(folderKey(root)).toMatch(/^[0-9a-f]{64}$/);
    expect(folderLabel("/home/x/Research/IDS")).toBe("…/Research/IDS");
  });

  it("refuses drive roots and the home folder", () => {
    expect(checkFolderScope("/")).toMatch(/drive/);
    expect(checkFolderScope(homedir())).toMatch(/home/);
    expect(checkFolderScope(root)).toBeNull();
  });
});

describe("extractText", () => {
  it("decodes Markdown (BOM stripped) and redacts secrets before anything leaves the PC", async () => {
    const result = await extractText("markdown", strToU8("\uFEFF# Hi\napi_key: sk-ant-abcdefghijklmnopqrstuvwxyz0123"));
    expect(result.text.startsWith("# Hi")).toBe(true);
    expect(result.text).not.toContain("sk-ant");
    expect(result.redactions).toBe(1);
  });

  it("reads UTF-16 text files", async () => {
    const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from("Tiến").flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
    expect((await extractText("text", utf16)).text).toBe("Tiến");
  });

  it("extracts Word paragraphs", async () => {
    const result = await extractText("docx", docx(["Báo cáo giữa kỳ", "Phần 1"]));
    expect(result.error).toBeNull();
    expect(result.text).toContain("Báo cáo giữa kỳ");
    expect(result.text).toContain("Phần 1");
  });

  it("extracts slides in order with headings", async () => {
    expect(await pptxText(pptx({ 2: ["Kết quả"], 1: ["Giới thiệu", "A &amp; B"] }))).toBe("## Slide 1\nGiới thiệu\nA & B\n\n## Slide 2\nKết quả");
  });

  it("extracts PDF text per page", async () => {
    const result = await extractText("pdf", pdf("Intrusion detection survey"));
    expect(result.error).toBeNull();
    expect(result.text).toMatch(/^## Page 1\nIntrusion detection survey/);
  });

  it("reads source files as text, redacts them, and skips binaries with a source extension", async () => {
    const source = await extractText("code", new TextEncoder().encode('const password = "correct-horse";\nexport {};\n'));
    expect(source).toMatchObject({ redactions: 1, error: null });
    expect(source.text).not.toContain("correct-horse");
    const binary = await extractText("code", new Uint8Array([0x4d, 0x41, 0x54, 0x00, 0x01, 0x02]));
    expect(binary).toMatchObject({ text: "", error: "looks like a binary file, skipped" });
  });

  it("reports unreadable files instead of throwing", async () => {
    const result = await extractText("docx", strToU8("not a zip"));
    expect(result.text).toBe("");
    expect(result.error).toMatch(/could not read docx/);
  });
});

describe("syncFolder", () => {
  function fakeHub(need: (paths: string[]) => string[]) {
    const calls: {
      path: string;
      body: { slug?: string; manifest?: { path: string }[]; documents?: { path: string; chunks: string[]; checklist: { status: string }[] | null; milestones: { dueDate: string }[] }[] };
    }[] = [];
    const fetchImpl = (async (url: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ path: url.pathname, body });
      const json =
        url.pathname === "/api/agent/projects"
          ? { projectId: "7e0f5c2a-9a39-4bd2-8f53-3f0c1f0e9a11", archived: false, need: need(body.manifest.map((m: { path: string }) => m.path)) }
          : { stored: body.documents.length, failed: 0 };
      return new Response(JSON.stringify(json), { status: 200 });
    }) as typeof fetch;
    return { calls, cloud: new CloudClient("https://hub.test", "0b8f4f7e-6d8c-4d8a-9d43-0c6a3c6f1b10", "A".repeat(43), fetchImpl, 1) };
  }

  it("sends the manifest, then uploads only what the hub needs", async () => {
    const { calls, cloud } = fakeHub((paths) => paths.filter((p) => p.endsWith(".md")));
    const result = await syncFolder(cloud, folder(), new HashCache(null));
    expect(result).toMatchObject({ files: 3, uploaded: 1, archived: false });
    expect(calls.map((c) => c.path)).toEqual(["/api/agent/projects", "/api/agent/documents"]);
    expect(calls[0]!.body.slug).toBe("demo");
    const uploaded = calls[1]!.body.documents!;
    expect(uploaded.map((d) => d.path)).toEqual(["Tiến độ.md"]);
    // Parsed on the PC: redacted text as contiguous chunks, checklist items and dated milestones.
    expect(uploaded[0]!.chunks.join("")).not.toContain("sk-ant");
    expect(uploaded[0]!.checklist?.map((i) => i.status)).toEqual(["done", "todo"]);
    expect(uploaded[0]!.milestones.map((m) => m.dueDate)).toEqual(["2026-10-05"]);
  });

  it("never reads a path the hub asks for unless it listed that path itself", async () => {
    const { calls, cloud } = fakeHub(() => ["my-secrets.md", "../../etc/passwd", "linked/private.md", ".git/HEAD.md"]);
    const result = await syncFolder(cloud, folder(), new HashCache(null));
    expect(result.uploaded).toBe(0);
    expect(calls.map((c) => c.path)).toEqual(["/api/agent/projects"]);
  });

  it("reuses cached hashes for unchanged files", async () => {
    const cache = new HashCache(null);
    const { calls, cloud } = fakeHub(() => []);
    await syncFolder(cloud, folder(), cache);
    const listing = await listFolder(folder());
    expect(listing.files.every((f) => cache.get(f) !== null)).toBe(true);
    expect(calls[0]!.body.manifest).toHaveLength(3);
  });
});

describe("isNoisyPath", () => {
  it("ignores dependency and build folders inside a watched folder, but not the folders above it", () => {
    const watched = join(tmpdir(), "out", "bin", "thesis");
    expect(isNoisyPath(join(watched, "notes", "a.md"), [watched])).toBe(false);
    expect(isNoisyPath(join(watched, "node_modules", "x", "a.md"), [watched])).toBe(true);
    expect(isNoisyPath(join(watched, "target", "debug", "main"), [watched])).toBe(true);
    expect(isNoisyPath(join(watched, ".git", "HEAD"), [watched])).toBe(true);
    expect(isNoisyPath(watched, [watched])).toBe(false);
  });
});
