import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ZipFile } from "yazl";
import { buildApp } from "../src/app.js";
import { MalwareDetectedError, type MalwareScanner } from "../src/malware-scanner.js";
import type { ObjectStorage, PutStoredFileInput } from "../src/storage.js";

class MemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, Buffer>();

  async putFile(input: PutStoredFileInput): Promise<void> {
    if (this.objects.has(input.key)) return;
    this.objects.set(input.key, await readFile(input.sourcePath));
  }

  async getFile(key: string): Promise<{ body: Readable; size: number }> {
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error("Object not found");
    return { body: Readable.from(bytes), size: bytes.byteLength };
  }
}

class CleanMalwareScanner implements MalwareScanner {
  async scanFile(): Promise<void> {}
}

function multipartFile(
  filename: string,
  mimeType: string,
  contents: Buffer,
): { headers: Record<string, string>; payload: Buffer } {
  return multipartFiles([{ filename, mimeType, contents }]);
}

function multipartFiles(
  files: Array<{ filename: string; mimeType: string; contents: Buffer }>,
): { headers: Record<string, string>; payload: Buffer } {
  const boundary = "----inspector-ai-test-boundary";
  const parts = files.flatMap(({ filename, mimeType, contents }) => [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
    ),
    contents,
    Buffer.from("\r\n"),
  ]);
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(parts),
  };
}

function createDocx(documentXml: string): Promise<Buffer> {
  const archive = new ZipFile();
  const chunks: Buffer[] = [];
  archive.outputStream.on("data", (chunk) => chunks.push(chunk as Buffer));
  const complete = new Promise<Buffer>((resolve, reject) => {
    archive.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    archive.outputStream.on("error", reject);
  });
  archive.addBuffer(
    Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "[Content_Types].xml",
  );
  archive.addBuffer(Buffer.from(documentXml), "word/document.xml");
  archive.end();
  return complete;
}

async function createObject(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/objects",
    payload: { name: "Тестовый объект", address: "г. Москва, тестовый адрес" },
  });
  expect(response.statusCode).toBe(201);
  return response.json().id as string;
}

describe("binary document ingest", () => {
  let app: FastifyInstance;
  let storage: MemoryObjectStorage;
  let validPdf: Buffer;

  beforeEach(async () => {
    validPdf = await readFile(new URL("./fixtures/valid.pdf", import.meta.url));
    storage = new MemoryObjectStorage();
    app = await buildApp({ storage, malwareScanner: new CleanMalwareScanner() });
  });

  afterEach(async () => {
    await app.close();
  });

  it("streams a real PDF, computes its digest and stores it under an immutable safe key", async () => {
    const objectId = await createObject(app);
    const pdf = validPdf;
    const multipart = multipartFile("../Раздел ПД.pdf", "application/pdf", pdf);

    const response = await app.inject({
      method: "POST",
      url: `/api/objects/${objectId}/files?stage=PD`,
      ...multipart,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      objectId,
      status: "ACCEPTED",
      files: [
        {
          name: "Раздел ПД.pdf",
          size: pdf.length,
          stage: "PD",
          mimeType: "application/pdf",
          status: "STORED",
        },
      ],
    });
    expect(response.json().files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(storage.objects).toHaveLength(1);
    const [key, stored] = [...storage.objects.entries()][0];
    expect(key).toMatch(new RegExp(`^objects/${objectId}/originals/[a-f0-9]{64}/`));
    expect(key).not.toContain("..");
    expect(stored).toEqual(pdf);
  });

  it("keeps a newly uploaded object separate from the demo seed", async () => {
    const objectId = await createObject(app);
    const multipart = multipartFile(
      "new-object.pdf",
      "application/pdf",
      validPdf,
    );
    const upload = await app.inject({
      method: "POST",
      url: `/api/objects/${objectId}/files?stage=PD`,
      ...multipart,
    });

    const started = await app.inject({ method: "POST", url: `/api/objects/${objectId}/checks` });
    const checkId = started.json().id as string;
    const findings = await app.inject({ method: "GET", url: `/api/checks/${checkId}/findings` });
    const coverage = await app.inject({ method: "GET", url: `/api/checks/${checkId}/coverage` });
    const finalized = await app.inject({ method: "POST", url: `/api/checks/${checkId}/finalize` });
    const submission = await app.inject({ method: "GET", url: `/api/checks/${checkId}/submission` });

    expect(upload.statusCode).toBe(201);
    expect(started.statusCode).toBe(201);
    expect(started.json()).toMatchObject({
      objectId,
      mode: "NORMAL",
      status: "PARTIAL",
      stats: { total: 132, unsupported: 132, candidates: 0, negativeVerified: 0 },
    });
    expect(findings.json().items).toEqual([]);
    expect(coverage.json().items).toHaveLength(132);
    expect(finalized.statusCode).toBe(409);
    expect(finalized.json().error).toBe("INCOMPLETE_ANALYSIS");
    expect(submission.statusCode).toBe(409);
    expect(submission.json().error).toBe("INCOMPLETE_ANALYSIS");
  });

  it("deduplicates the same bytes without inflating the object file count", async () => {
    const objectId = await createObject(app);
    const pdf = validPdf;
    const first = multipartFile("first.pdf", "application/pdf", pdf);
    const second = multipartFile("same-content.pdf", "application/pdf", pdf);

    const [firstResponse, secondResponse] = await Promise.all([
      app.inject({ method: "POST", url: `/api/objects/${objectId}/files?stage=RD`, ...first }),
      app.inject({ method: "POST", url: `/api/objects/${objectId}/files?stage=RD`, ...second }),
    ]);
    const objectResponse = await app.inject({ method: "GET", url: `/api/objects/${objectId}` });

    expect(firstResponse.statusCode).toBe(201);
    expect(secondResponse.statusCode).toBe(201);
    expect([firstResponse.json().files[0].status, secondResponse.json().files[0].status].sort()).toEqual([
      "DUPLICATE",
      "STORED",
    ]);
    expect(storage.objects).toHaveLength(1);
    expect(objectResponse.json().fileCount).toBe(1);
    expect(objectResponse.json().stages.find((item: { stage: string }) => item.stage === "RD").fileCount).toBe(1);
  });

  it("keeps a new stage association when the underlying bytes are already stored", async () => {
    const objectId = await createObject(app);
    const pdf = validPdf;

    await app.inject({
      method: "POST",
      url: `/api/objects/${objectId}/files?stage=PD`,
      ...multipartFile("shared.pdf", "application/pdf", pdf),
    });
    const duplicate = await app.inject({
      method: "POST",
      url: `/api/objects/${objectId}/files?stage=ID`,
      ...multipartFile("shared.pdf", "application/pdf", pdf),
    });
    const objectResponse = await app.inject({ method: "GET", url: `/api/objects/${objectId}` });

    expect(duplicate.json().files[0].status).toBe("DUPLICATE");
    expect(storage.objects).toHaveLength(1);
    expect(objectResponse.json().fileCount).toBe(2);
    expect(objectResponse.json().stages.find((item: { stage: string }) => item.stage === "PD").fileCount).toBe(1);
    expect(objectResponse.json().stages.find((item: { stage: string }) => item.stage === "ID").fileCount).toBe(1);
  });

  it("accepts a well-formed XML document and rejects a renamed empty ZIP as DOCX", async () => {
    const objectId = await createObject(app);
    const xml = multipartFile(
      "model.xml",
      "application/xml",
      Buffer.from('<?xml version="1.0" encoding="UTF-8"?><model><item id="1"/></model>'),
    );
    const emptyZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18)]);

    const accepted = await app.inject({
      method: "POST",
      url: `/api/objects/${objectId}/files?stage=PD`,
      ...xml,
    });
    const rejected = await app.inject({
      method: "POST",
      url: `/api/objects/${objectId}/files?stage=RD`,
      ...multipartFile("fake.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", emptyZip),
    });

    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().files[0].mimeType).toBe("application/xml");
    expect(rejected.statusCode).toBe(415);
    expect(rejected.json().error).toBe("UNSUPPORTED_FILE_FORMAT");
  });

  it("supports UTF-16 XML and validates the XML payloads inside DOCX", async () => {
    const objectId = await createObject(app);
    const utf16Xml = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('<?xml version="1.0"?><model><item/></model>', "utf16le"),
    ]);
    const validDocx = await createDocx(
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
    );
    const corruptDocx = await createDocx("not XML");

    const xmlResponse = await app.inject({
      method: "POST",
      url: `/api/objects/${objectId}/files?stage=PD`,
      ...multipartFile("utf16.xml", "application/xml", utf16Xml),
    });
    const docxResponse = await app.inject({
      method: "POST",
      url: `/api/objects/${objectId}/files?stage=RD`,
      ...multipartFile(
        "valid.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        validDocx,
      ),
    });
    const corruptResponse = await app.inject({
      method: "POST",
      url: `/api/objects/${objectId}/files?stage=ID`,
      ...multipartFile(
        "corrupt.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        corruptDocx,
      ),
    });

    expect(xmlResponse.statusCode).toBe(201);
    expect(docxResponse.statusCode).toBe(201);
    expect(corruptResponse.statusCode).toBe(415);
    expect(corruptResponse.json().error).toBe("UNSUPPORTED_FILE_FORMAT");
  });

  it("enforces both the per-file and aggregate upload limits", async () => {
    await app.close();
    app = await buildApp({ storage, malwareScanner: new CleanMalwareScanner(), maxFileBytes: 16, maxUploadBytes: 30 });
    const objectId = await createObject(app);
    const oversized = multipartFile("large.pdf", "application/pdf", Buffer.from("%PDF-1.7\n0123456789\n%%EOF\n"));

    const fileResponse = await app.inject({
      method: "POST",
      url: `/api/objects/${objectId}/files?stage=PD`,
      ...oversized,
    });

    await app.close();
    app = await buildApp({ storage, malwareScanner: new CleanMalwareScanner(), maxFileBytes: 20, maxUploadBytes: 24 });
    const aggregateObjectId = await createObject(app);
    const aggregate = multipartFiles([
      { filename: "one.pdf", mimeType: "application/pdf", contents: Buffer.from("%PDF-1.7\nA\n") },
      { filename: "two.pdf", mimeType: "application/pdf", contents: Buffer.from("%PDF-1.7\nB\n") },
      { filename: "three.pdf", mimeType: "application/pdf", contents: Buffer.from("%PDF-1.7\nC\n") },
    ]);
    const aggregateResponse = await app.inject({
      method: "POST",
      url: `/api/objects/${aggregateObjectId}/files?stage=PD`,
      ...aggregate,
    });

    expect(fileResponse.statusCode).toBe(413);
    expect(fileResponse.json().error).toBe("FILE_TOO_LARGE");
    expect(aggregateResponse.statusCode).toBe(413);
    expect(aggregateResponse.json().error).toBe("UPLOAD_TOO_LARGE");
    expect(storage.objects).toHaveLength(0);
  });

  it("rejects an extension whose bytes are not the declared document type", async () => {
    const objectId = await createObject(app);
    const multipart = multipartFile("not-a-pdf.pdf", "application/pdf", Buffer.from("plain text"));

    const response = await app.inject({
      method: "POST",
      url: `/api/objects/${objectId}/files?stage=PD`,
      ...multipart,
    });

    expect(response.statusCode).toBe(415);
    expect(response.json().error).toBe("UNSUPPORTED_FILE_FORMAT");
    expect(storage.objects).toHaveLength(0);
  });

  it("rejects PDFs with zero pages, truncated trailer, or encryption before storage", async () => {
    const objectId = await createObject(app);
    const encryptedPdf = await readFile(new URL("./fixtures/encrypted.pdf", import.meta.url));
    const encryptedEmptyPasswordPdf = await readFile(new URL("./fixtures/encrypted-empty-password.pdf", import.meta.url));
    const zeroPagePdf = await readFile(new URL("./fixtures/zero-page.pdf", import.meta.url));
    const invalidFiles = [
      { filename: "empty.pdf", bytes: zeroPagePdf, code: "INVALID_PDF_STRUCTURE", status: 415 },
      {
        filename: "truncated.pdf",
        bytes: validPdf.subarray(0, validPdf.lastIndexOf(Buffer.from("%%EOF"))),
        code: "INVALID_PDF_STRUCTURE",
        status: 415,
      },
      { filename: "locked.pdf", bytes: encryptedPdf, code: "PDF_ENCRYPTED", status: 422 },
      { filename: "encrypted-empty-password.pdf", bytes: encryptedEmptyPasswordPdf, code: "PDF_ENCRYPTED", status: 422 },
    ];

    for (const { filename, bytes, code, status } of invalidFiles) {
      const response = await app.inject({
        method: "POST",
        url: `/api/objects/${objectId}/files?stage=PD`,
        ...multipartFile(filename, "application/pdf", bytes),
      });
      expect(response.statusCode).toBe(status);
      expect(response.json().error).toBe(code);
      expect(storage.objects).toHaveLength(0);
    }
    const objectResponse = await app.inject({ method: "GET", url: `/api/objects/${objectId}` });
    expect(objectResponse.json().fileCount).toBe(0);
  });

  it("rejects the whole upload when one PDF in the batch is malformed", async () => {
    const objectId = await createObject(app);
    const response = await app.inject({
      method: "POST",
      url: `/api/objects/${objectId}/files?stage=RD`,
      ...multipartFiles([
        { filename: "valid.pdf", mimeType: "application/pdf", contents: validPdf },
        { filename: "damaged.pdf", mimeType: "application/pdf", contents: Buffer.from("%PDF-1.7\n%%EOF\n") },
      ]),
    });

    expect(response.statusCode).toBe(415);
    expect(response.json().error).toBe("INVALID_PDF_STRUCTURE");
    expect(storage.objects).toHaveLength(0);
    const objectResponse = await app.inject({ method: "GET", url: `/api/objects/${objectId}` });
    expect(objectResponse.json().fileCount).toBe(0);
  });

  it("rejects an unknown document stage before storing files", async () => {
    const objectId = await createObject(app);
    const multipart = multipartFile("project.pdf", "application/pdf", Buffer.from("%PDF-1.7\n%%EOF\n"));

    const response = await app.inject({
      method: "POST",
      url: `/api/objects/${objectId}/files?stage=UNKNOWN`,
      ...multipart,
    });

    expect(response.statusCode).toBe(400);
    expect(storage.objects).toHaveLength(0);
  });

  it("never moves a file rejected by antivirus into object storage", async () => {
    await app.close();
    const malwareScanner: MalwareScanner = {
      async scanFile() {
        throw new MalwareDetectedError("Win.Test.EICAR_HDB-1");
      },
    };
    app = await buildApp({ storage, malwareScanner });
    const objectId = await createObject(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/objects/${objectId}/files?stage=PD`,
      ...multipartFile("infected.pdf", "application/pdf", Buffer.from("%PDF-1.7\nEICAR\n%%EOF\n")),
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe("MALWARE_DETECTED");
    expect(storage.objects).toHaveLength(0);
  });

  it("does not start analysis before at least one binary document is stored", async () => {
    const objectId = await createObject(app);

    const response = await app.inject({ method: "POST", url: `/api/objects/${objectId}/checks` });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("DOCUMENTS_REQUIRED");
  });
});
