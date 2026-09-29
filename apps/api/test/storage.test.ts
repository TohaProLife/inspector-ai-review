import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalObjectStorage } from "../src/storage.js";

describe("local immutable object storage", () => {
  let directory: string;
  let sourcePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "inspector-storage-test-"));
    sourcePath = join(directory, "source.bin");
    await writeFile(sourcePath, "first version");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("never overwrites an existing key and blocks paths outside its root", async () => {
    const root = join(directory, "objects");
    const storage = new LocalObjectStorage(root);
    const input = {
      key: "objects/OBJ-1/originals/digest/document.pdf",
      sourcePath,
      contentType: "application/pdf",
      size: 13,
      sha256: "digest",
    };

    await storage.putFile(input);
    await writeFile(sourcePath, "second version");
    await storage.putFile(input);

    expect(await readFile(join(root, input.key), "utf8")).toBe("first version");
    const stored = await storage.getFile(input.key);
    const chunks: Buffer[] = [];
    for await (const chunk of stored.body) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString("utf8")).toBe("first version");
    expect(stored.size).toBe(13);
    await expect(storage.putFile({ ...input, key: "../escape.pdf" })).rejects.toThrow(
      "Storage key escapes the configured root",
    );
    await expect(storage.getFile("../escape.pdf")).rejects.toThrow("Storage key escapes the configured root");
  });
});
