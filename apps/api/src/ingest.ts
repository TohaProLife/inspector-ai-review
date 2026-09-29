import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { Multipart } from "@fastify/multipart";
import { SaxesParser } from "saxes";
import { openPromise, type Entry } from "yauzl";
import type {
  AcceptedUploadExtension,
  BinaryUploadRecord,
  UploadStage,
} from "@inspector-ai/contracts";
import { uploadPolicy } from "@inspector-ai/contracts";
import type { ObjectStorage } from "./storage.js";
import type {
  AuditedMutationCommand,
  InspectionRepository,
  RegisteredIngestedDocumentFile,
} from "./repository.js";
import type { AuthenticatedActor } from "./identity.js";
import {
  MalwareDetectedError,
  MalwareScannerUnavailableError,
  type MalwareScanner,
} from "./malware-scanner.js";

interface StagedFile {
  name: string;
  size: number;
  mimeType: string;
  sha256: string;
  sourcePath: string;
  header: Buffer;
  fileLimitExceeded: boolean;
  uploadLimitExceeded: boolean;
}

interface DetectedFormat {
  mimeType: string;
  compatibleMimeTypes: Set<string>;
}

const formatByExtension: Record<AcceptedUploadExtension, DetectedFormat> = {
  ".pdf": {
    mimeType: "application/pdf",
    compatibleMimeTypes: new Set(["application/pdf", "application/octet-stream"]),
  },
  ".docx": {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compatibleMimeTypes: new Set([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/octet-stream",
    ]),
  },
  ".xml": {
    mimeType: "application/xml",
    compatibleMimeTypes: new Set([
      "application/xml",
      "text/xml",
      "application/octet-stream",
    ]),
  },
  ".dwg": {
    mimeType: "image/vnd.dwg",
    compatibleMimeTypes: new Set([
      "application/acad",
      "application/dwg",
      "application/x-acad",
      "application/x-autocad",
      "application/octet-stream",
      "image/vnd.dwg",
    ]),
  },
};

function isAcceptedExtension(extension: string): extension is AcceptedUploadExtension {
  return uploadPolicy.acceptedExtensions.some((candidate) => candidate === extension);
}

export class FileIngestError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FileIngestError";
  }
}

function sanitizeFilename(input: string): string {
  const leaf = basename(input.replaceAll("\\", "/"));
  const clean = leaf
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
    .trim();
  return (clean || `document-${randomUUID().slice(0, 8)}`).slice(0, 180);
}

function hasPrefix(buffer: Buffer, prefix: string): boolean {
  return buffer.subarray(0, Buffer.byteLength(prefix)).equals(Buffer.from(prefix));
}

const execFileAsync = promisify(execFile);

async function validatePdf(file: StagedFile): Promise<void> {
  const tailLength = Math.min(file.size, 64 * 1024);
  const tail = Buffer.alloc(tailLength);
  const descriptor = await open(file.sourcePath, "r");
  try {
    const { bytesRead } = await descriptor.read(tail, 0, tailLength, file.size - tailLength);
    if (bytesRead !== tailLength || !/startxref\s+\d+\s+%%EOF[\x00-\x20]*$/.test(tail.toString("latin1"))) {
      throw new FileIngestError(415, "INVALID_PDF_STRUCTURE", `PDF-файл «${file.name}» обрезан или повреждён`);
    }
  } finally {
    await descriptor.close();
  }

  let stdout: string;
  let stderr: string;
  try {
    ({ stdout, stderr } = await execFileAsync("pdfinfo", [file.sourcePath], {
      timeout: 60_000,
      maxBuffer: 256 * 1024,
      env: { ...process.env, LC_ALL: "C" },
    }));
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
    if (failure.code === "ENOENT") {
      throw new FileIngestError(503, "PDF_VALIDATOR_UNAVAILABLE", "Проверка PDF временно недоступна; файл не сохранён");
    }
    if (failure.code === "ETIMEDOUT" || failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || failure.killed) {
      throw new FileIngestError(422, "PDF_VALIDATION_RESOURCE_LIMIT", `Проверка PDF-файла «${file.name}» превысила лимит ресурсов`);
    }
    if (/Incorrect password|Encrypted file/i.test(failure.stderr ?? "")) {
      throw new FileIngestError(422, "PDF_ENCRYPTED", `PDF-файл «${file.name}» зашифрован`);
    }
    throw new FileIngestError(415, "INVALID_PDF_STRUCTURE", `PDF-файл «${file.name}» не прошёл проверку структуры`);
  }

  const pages = /^Pages:\s*(\d+)\s*$/m.exec(stdout);
  const encrypted = /^Encrypted:\s*(yes|no)\b/m.exec(stdout);
  if (encrypted?.[1] === "yes") {
    throw new FileIngestError(422, "PDF_ENCRYPTED", `PDF-файл «${file.name}» зашифрован`);
  }
  if (!pages || !Number.isSafeInteger(Number(pages[1])) || Number(pages[1]) < 1
    || encrypted?.[1] !== "no" || /Syntax (?:Error|Warning)/i.test(stderr)) {
    throw new FileIngestError(415, "INVALID_PDF_STRUCTURE", `PDF-файл «${file.name}» не прошёл проверку структуры`);
  }
}

function isZip(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    ((buffer[2] === 0x03 && buffer[3] === 0x04) ||
      (buffer[2] === 0x05 && buffer[3] === 0x06) ||
      (buffer[2] === 0x07 && buffer[3] === 0x08))
  );
}

function looksLikeXml(buffer: Buffer): boolean {
  try {
    const prefix = new TextDecoder(detectXmlEncoding(buffer), { fatal: true })
      .decode(buffer)
      .replace(/^\uFEFF/, "")
      .trimStart();
    return prefix.startsWith("<?xml") || /^<[A-Za-z_:]/.test(prefix);
  } catch {
    return false;
  }
}

function detectXmlEncoding(buffer: Buffer): "utf-8" | "utf-16le" | "utf-16be" {
  if (
    (buffer[0] === 0xff && buffer[1] === 0xfe) ||
    (buffer[0] === 0x3c && buffer[1] === 0x00 && buffer[2] === 0x3f && buffer[3] === 0x00)
  ) {
    return "utf-16le";
  }
  if (
    (buffer[0] === 0xfe && buffer[1] === 0xff) ||
    (buffer[0] === 0x00 && buffer[1] === 0x3c && buffer[2] === 0x00 && buffer[3] === 0x3f)
  ) {
    return "utf-16be";
  }
  return "utf-8";
}

async function parseXmlStream(
  stream: Readable,
  name: string,
  maxBytes = 50 * 1024 * 1024,
): Promise<string> {
  const parser = new SaxesParser({ xmlns: true, fileName: name });
  let decoder: TextDecoder | undefined;
  let parseError: Error | undefined;
  let hasDoctype = false;
  let rootElement = "";
  let bytes = 0;

  parser.on("error", (error) => {
    parseError ??= error;
  });
  parser.on("doctype", () => {
    hasDoctype = true;
  });
  parser.on("opentag", (tag) => {
    rootElement ||= tag.local;
  });

  for await (const chunk of stream) {
    const payload = chunk as Buffer;
    bytes += payload.length;
    if (bytes > maxBytes) throw new Error(`XML payload ${name} exceeds its safe parsing limit`);
    decoder ??= new TextDecoder(detectXmlEncoding(payload), { fatal: true });
    parser.write(decoder.decode(payload, { stream: true }));
  }
  parser.write(decoder?.decode() ?? "").close();
  if (parseError || hasDoctype || !rootElement) {
    throw new FileIngestError(
      415,
      "UNSUPPORTED_FILE_FORMAT",
      `XML-файл «${name}» повреждён или содержит запрещённый DOCTYPE`,
    );
  }
  return rootElement;
}

async function validateXml(file: StagedFile): Promise<void> {
  await parseXmlStream(createReadStream(file.sourcePath), file.name);
}

async function validateDocx(file: StagedFile): Promise<void> {
  const requiredEntries = new Map<string, Entry>();
  let entryCount = 0;
  let uncompressedBytes = 0;
  let archive: Awaited<ReturnType<typeof openPromise>> | undefined;

  try {
    archive = await openPromise(file.sourcePath, {
      autoClose: false,
      lazyEntries: true,
      decodeStrings: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    for await (const entry of archive.eachEntry()) {
      entryCount += 1;
      uncompressedBytes += entry.uncompressedSize;
      if (entry.fileName === "[Content_Types].xml" || entry.fileName === "word/document.xml") {
        requiredEntries.set(entry.fileName, entry);
      }

      const compressionRatio = entry.compressedSize === 0
        ? entry.uncompressedSize > 0 ? Number.POSITIVE_INFINITY : 1
        : entry.uncompressedSize / entry.compressedSize;
      if (
        entryCount > 10_000 ||
        !Number.isSafeInteger(uncompressedBytes) ||
        uncompressedBytes > 200 * 1024 * 1024 ||
        compressionRatio > 100 ||
        entry.isEncrypted() ||
        !entry.canDecodeFileData()
      ) {
        throw new Error("Unsafe DOCX container");
      }
    }
    const contentTypes = requiredEntries.get("[Content_Types].xml");
    const document = requiredEntries.get("word/document.xml");
    if (!contentTypes || !document) throw new Error("Missing DOCX entries");

    const contentTypesRoot = await parseXmlStream(
      await archive.openReadStreamPromise(contentTypes),
      `${file.name}:[Content_Types].xml`,
      10 * 1024 * 1024,
    );
    const documentRoot = await parseXmlStream(
      await archive.openReadStreamPromise(document),
      `${file.name}:word/document.xml`,
      200 * 1024 * 1024,
    );
    if (contentTypesRoot !== "Types" || documentRoot !== "document") {
      throw new Error("Invalid DOCX XML roots");
    }
  } catch {
    throw new FileIngestError(
      415,
      "UNSUPPORTED_FILE_FORMAT",
      `DOCX-файл «${file.name}» повреждён или не прошёл проверку контейнера`,
    );
  } finally {
    archive?.close();
  }
}

const uploadLocks = new WeakMap<InspectionRepository, Map<string, Promise<void>>>();

async function withObjectUploadLock<T>(
  store: InspectionRepository,
  objectId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const locks = uploadLocks.get(store) ?? new Map<string, Promise<void>>();
  uploadLocks.set(store, locks);
  const previous = locks.get(objectId) ?? Promise.resolve();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  locks.set(objectId, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(objectId) === tail) locks.delete(objectId);
  }
}

async function detectFormat(file: StagedFile): Promise<DetectedFormat> {
  const extension = extname(file.name).toLowerCase();
  const format = isAcceptedExtension(extension) ? formatByExtension[extension] : undefined;
  const signatureMatches =
    extension === ".pdf"
      ? hasPrefix(file.header, "%PDF-")
      : extension === ".dwg"
        ? hasPrefix(file.header, "AC10")
        : extension === ".docx"
          ? isZip(file.header)
          : extension === ".xml"
            ? looksLikeXml(file.header)
            : false;
  const declaredMime = file.mimeType.toLowerCase().split(";", 1)[0] || "application/octet-stream";

  if (!format || !signatureMatches || !format.compatibleMimeTypes.has(declaredMime)) {
    throw new FileIngestError(
      415,
      "UNSUPPORTED_FILE_FORMAT",
      `Файл «${file.name}» не соответствует поддерживаемому формату ${uploadPolicy.acceptedExtensions.map((item) => item.slice(1).toUpperCase()).join(", ")}`,
    );
  }
  if (extension === ".xml") await validateXml(file);
  if (extension === ".docx") await validateDocx(file);
  return format;
}

async function stageFile(
  part: Extract<Multipart, { type: "file" }>,
  directory: string,
  remainingUploadBytes: number,
): Promise<StagedFile> {
  const sourcePath = join(directory, randomUUID());
  const hash = createHash("sha256");
  const headerChunks: Buffer[] = [];
  let headerBytes = 0;
  let size = 0;
  let storedBytes = 0;
  let uploadLimitExceeded = false;

  const inspect = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      hash.update(chunk);
      if (headerBytes < 4_096) {
        const slice = chunk.subarray(0, 4_096 - headerBytes);
        headerChunks.push(slice);
        headerBytes += slice.length;
      }
      const writableBytes = Math.max(0, Math.min(chunk.length, remainingUploadBytes - storedBytes));
      if (writableBytes < chunk.length) uploadLimitExceeded = true;
      storedBytes += writableBytes;
      callback(null, writableBytes > 0 ? chunk.subarray(0, writableBytes) : undefined);
    },
  });

  await pipeline(part.file, inspect, createWriteStream(sourcePath, { flags: "wx" }));

  return {
    name: sanitizeFilename(part.filename),
    size,
    mimeType: part.mimetype || "application/octet-stream",
    sha256: hash.digest("hex"),
    sourcePath,
    header: Buffer.concat(headerChunks),
    fileLimitExceeded: part.file.truncated,
    uploadLimitExceeded,
  };
}

export async function ingestMultipartFiles(options: {
  objectId: string;
  stage: UploadStage;
  parts: AsyncIterable<Multipart>;
  store: InspectionRepository;
  storage: ObjectStorage;
  maxUploadBytes: number;
  malwareScanner: MalwareScanner;
  actor?: AuthenticatedActor;
  command?: AuditedMutationCommand;
}): Promise<{ upload: BinaryUploadRecord; replayed: boolean }> {
  const directory = await mkdtemp(join(tmpdir(), "inspector-ai-upload-"));
  const staged: StagedFile[] = [];
  let requestBytes = 0;
  let fileLimitExceeded = false;
  let uploadLimitExceeded = false;

  try {
    for await (const part of options.parts) {
      if (part.type !== "file") continue;
      const remainingUploadBytes = fileLimitExceeded || uploadLimitExceeded
        ? 0
        : Math.max(0, options.maxUploadBytes - requestBytes);
      const file = await stageFile(part, directory, remainingUploadBytes);
      requestBytes += file.size;
      fileLimitExceeded ||= file.fileLimitExceeded;
      uploadLimitExceeded ||= file.uploadLimitExceeded || requestBytes > options.maxUploadBytes;
      if (!file.fileLimitExceeded && !file.uploadLimitExceeded) staged.push(file);
    }
    if (fileLimitExceeded) {
      throw new FileIngestError(
        413, "FILE_TOO_LARGE",
        `Размер одного файла превышает ${uploadPolicy.maxFileBytes / (1024 * 1024)} МиБ`,
      );
    }
    if (uploadLimitExceeded) {
      throw new FileIngestError(413, "UPLOAD_TOO_LARGE", "Общий размер пакета превышает 200 МБ");
    }
    if (staged.length === 0) {
      throw new FileIngestError(400, "EMPTY_UPLOAD", "Добавьте хотя бы один файл");
    }

    const formats = await Promise.all(staged.map(detectFormat));
    for (const file of staged) {
      try {
        await options.malwareScanner.scanFile(file.sourcePath);
      } catch (error) {
        if (error instanceof MalwareDetectedError) {
          throw new FileIngestError(422, "MALWARE_DETECTED", `Файл «${file.name}» отклонён антивирусом`);
        }
        if (error instanceof MalwareScannerUnavailableError) {
          throw new FileIngestError(
            503,
            "MALWARE_SCANNER_UNAVAILABLE",
            "Антивирусная проверка временно недоступна; файл не сохранён",
          );
        }
        throw error;
      }
    }
    for (const file of staged) {
      if (extname(file.name).toLowerCase() === ".pdf") await validatePdf(file);
    }
    return await withObjectUploadLock(options.store, options.objectId, async () => {
      const batchHashes = new Set<string>();
      const files: RegisteredIngestedDocumentFile[] = [];

      for (let index = 0; index < staged.length; index += 1) {
        const file = staged[index];
        const duplicate = (await options.store.hasIngestedFile(options.objectId, file.sha256, options.actor))
          || batchHashes.has(file.sha256);
        const status = duplicate ? "DUPLICATE" : "STORED";
        const key = `objects/${options.objectId}/originals/${file.sha256}/${file.name}`;

        if (!duplicate) {
          await options.storage.putFile({
            key,
            sourcePath: file.sourcePath,
            contentType: formats[index].mimeType,
            size: file.size,
            sha256: file.sha256,
          });
          batchHashes.add(file.sha256);
        }
        files.push({
          id: `FIL-${randomUUID().slice(0, 8).toUpperCase()}`,
          name: file.name,
          size: file.size,
          stage: options.stage,
          mimeType: formats[index].mimeType,
          sha256: file.sha256,
          scanStatus: "CLEAN",
          status,
          storageKey: key,
        });
      }

      if (options.command) {
        if (!options.store.registerIngestedFilesCommand) {
          throw new FileIngestError(
            503,
            "COMMAND_RECEIPTS_UNAVAILABLE",
            "Хранилище не поддерживает надёжную регистрацию загрузки",
          );
        }
        const result = await options.store.registerIngestedFilesCommand(
          options.objectId,
          files,
          options.command,
        );
        if (result.kind === "idempotency_conflict") {
          throw new FileIngestError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Idempotency-Key уже использован для другой загрузки",
          );
        }
        if (result.kind === "forbidden") {
          throw new FileIngestError(403, "FORBIDDEN", "Нет права загружать документы объекта");
        }
        if (result.kind === "not_found") {
          throw new FileIngestError(404, "NOT_FOUND", "Объект не найден");
        }
        if (result.kind === "invalid_state") {
          throw new FileIngestError(409, result.code, result.message);
        }
        return { upload: result.value, replayed: result.replayed };
      }
      const upload = await options.store.registerIngestedFiles(options.objectId, files, options.actor);
      if (!upload) throw new FileIngestError(404, "NOT_FOUND", "Объект не найден");
      return { upload, replayed: false };
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
