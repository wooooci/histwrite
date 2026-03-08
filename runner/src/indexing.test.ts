import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import JSZip from "jszip";

import { indexMaterials } from "./indexing.js";
import { ensureHistwriteProject } from "./project.js";

async function writeDocx(filePath: string, paragraphs: string[]) {
  const zip = new JSZip();
  const xml =
    `<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>` +
    `<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">` +
    `<w:body>` +
    paragraphs
      .map(
        (p) =>
          `<w:p><w:r><w:t>${p.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</w:t></w:r></w:p>`,
      )
      .join("") +
    `</w:body></w:document>`;
  zip.file("word/document.xml", xml);
  // Minimal required files to make it look like a docx zip.
  zip.file("[Content_Types].xml", `<?xml version=\"1.0\" encoding=\"UTF-8\"?>`);
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  await fs.writeFile(filePath, buf);
}

describe("indexMaterials", () => {
  it("indexes txt/md/docx and skips internal folders", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `histwrite-runner-${randomUUID()}-`));
    const projectDir = path.join(tmp, "proj");
    const layout = await ensureHistwriteProject(projectDir);

    await fs.mkdir(layout.materialsDir, { recursive: true });
    await fs.writeFile(path.join(layout.materialsDir, "a.txt"), "hello\n", "utf8");
    await fs.writeFile(path.join(layout.materialsDir, "b.md"), "# title\n", "utf8");
    await writeDocx(path.join(layout.materialsDir, "c.docx"), ["para1", "para2"]);
    await fs.mkdir(path.join(layout.materialsDir, "_index"), { recursive: true });
    await fs.writeFile(path.join(layout.materialsDir, "_index", "should-not-be-seen.txt"), "x", "utf8");

    const lib = await indexMaterials({ layout, materialsDir: layout.materialsDir });
    expect(lib.materials.length).toBe(3);

    const kinds = lib.materials.map((m) => m.kind).sort();
    expect(kinds).toEqual(["docx", "md", "txt"]);

    // Text extraction should exist for docx.
    const docx = lib.materials.find((m) => m.kind === "docx");
    expect(docx?.textPath).toBeTruthy();
    const extracted = docx?.textPath
      ? await fs.readFile(path.join(layout.projectDir, docx.textPath), "utf8")
      : "";
    expect(extracted).toContain("para1");
    expect(extracted).toContain("para2");
  });
});
