import { describe, expect, it } from "vitest";
import { InspectorStore } from "../src/store.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import type { ProtocolRenderedArtifactContent } from "../src/repository.js";

function fixture() {
  const store = new InspectorStore({ publicChecks: [], parameters: [], manifest: new Map() });
  const protocol = store.getProtocols("CHK-TYUMENSKAYA-5-001")[0];
  if (!protocol) throw Error("Missing frozen demo protocol");
  const snapshot = store.getProtocolExport(protocol.id)!;
  const bytes = Buffer.from("%PDF-1.4\nhand-authored immutable cache fixture\n");
  const content: ProtocolRenderedArtifactContent = { protocolId: protocol.id, format: "pdf", templateVersion: "report-v1",
    snapshotHash: sha256(canonicalJson(snapshot)), bytes, contentHash: sha256(bytes), mediaType: "application/pdf" };
  return { store, content };
}

describe("frozen demo rendered artifact cache", () => {
  it("keeps exact first bytes and isolates caller-owned Buffers", () => {
    const { store, content } = fixture();
    const expected = Buffer.from(content.bytes);
    const first = store.saveRenderedProtocolArtifact(content);
    expect(first).toMatchObject({ contentHash: content.contentHash });
    if (!first || first === "AUTH_REQUIRED") throw Error("Save refused");
    content.bytes.fill(0); first.bytes.fill(1);
    const read = store.getRenderedProtocolArtifact(content);
    expect(read).not.toBe("AUTH_REQUIRED");
    if (!read || read === "AUTH_REQUIRED") throw Error("Read refused");
    expect(read.bytes).toEqual(expected);
    const alternative = Buffer.from("different renderer output");
    const replay = store.saveRenderedProtocolArtifact({ ...content, bytes: alternative, contentHash: sha256(alternative) });
    expect(replay).toEqual(read);
    expect(store.saveRenderedProtocolArtifact({ ...content, templateVersion: "report-v2", bytes: alternative, contentHash: sha256(alternative) }))
      .toMatchObject({ bytes: alternative });
  });

  it("rejects forged source/hash, invalid keys, MIME, empty and oversized bytes", () => {
    const { store, content } = fixture();
    const invalid = [
      { snapshotHash: "0".repeat(64) }, { protocolId: "foreign" }, { templateVersion: "../invalid" },
      { contentHash: "0".repeat(64) }, { mediaType: "text/html" }, { format: "html" },
      { bytes: Buffer.alloc(0), contentHash: sha256(Buffer.alloc(0)) },
      { bytes: Buffer.alloc(16777217), contentHash: sha256(Buffer.alloc(16777217)) },
    ];
    for (const mutation of invalid) expect(store.saveRenderedProtocolArtifact({ ...content, ...mutation } as ProtocolRenderedArtifactContent)).toBeUndefined();
    expect(store.getRenderedProtocolArtifact(content)).toBeUndefined();
  });

  it.each(["docx", "xml"] as const)("keeps %s as a separate format", format => {
    const { store, content } = fixture();
    const mediaType = format === "xml" ? "application/xml" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(store.saveRenderedProtocolArtifact({ ...content, format, mediaType })).toMatchObject({ format, mediaType });
    expect(store.getRenderedProtocolArtifact(content)).toBeUndefined();
  });
});
