import { constants as fsConstants, fstat } from "node:fs";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { dirname, relative, resolve } from "node:path";
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface PutStoredFileInput {
  key: string;
  sourcePath: string;
  contentType: string;
  size: number;
  sha256: string;
}

/** New read-only verification branch. Omitting options preserves legacy behavior. */
export interface StoredFileReadOptions {
  readOnly: true;
  signal?: AbortSignal;
}

/** A native Readable owns its resource until close; observe error before async handoff. */
function ownStoredReadable(body: Readable, signal?: AbortSignal): { close: () => Promise<void> } {
  const completion = finished(body, { cleanup: true }).catch(() => {});
  let onAbort: (() => void) | undefined;
  const closed = body.closed ? Promise.resolve() : new Promise<void>((resolve) => {
    body.once("close", () => {
      if (onAbort) signal?.removeEventListener("abort", onAbort);
      resolve();
    });
  });
  if (signal && !body.closed) {
    onAbort = () => body.destroy(new DOMException("Stored read aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  }
  return { close: async () => {
    if (!body.destroyed) body.destroy();
    await completion;
    await closed;
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  } };
}

function assertStoredReadOptions(options: StoredFileReadOptions): void {
  if (options.readOnly !== true || options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
    throw new Error("Invalid read-only storage options");
  }
  options.signal?.throwIfAborted();
}

export interface ObjectStorage {
  putFile(input: PutStoredFileInput): Promise<void>;
  getFile(key: string, options?: StoredFileReadOptions): Promise<{
    body: Readable;
    size: number;
    contentType?: string;
  }>;
}

export class LocalObjectStorage implements ObjectStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async putFile(input: PutStoredFileInput): Promise<void> {
    const destination = this.resolveKey(input.key);
    await mkdir(dirname(destination), { recursive: true });
    try {
      await copyFile(input.sourcePath, destination, fsConstants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }

  async getFile(key: string, options?: StoredFileReadOptions): Promise<{ body: Readable; size: number }> {
    if (options !== undefined) return this.getReadOnlyFile(key, options);
    const source = this.resolveKey(key);
    const metadata = await stat(source);
    if (!metadata.isFile()) throw new Error("Storage key does not reference a file");
    return { body: createReadStream(source), size: metadata.size };
  }

  private async getReadOnlyFile(key: string, options: StoredFileReadOptions): Promise<{ body: Readable; size: number }> {
    assertStoredReadOptions(options);
    const source = this.resolveKey(key);
    const body = createReadStream(source, { signal: options.signal, autoClose: true,
      emitClose: true, highWaterMark: 64 * 1024 });
    const owned = ownStoredReadable(body, options.signal);
    try {
      const [fd] = await once(body, "open") as [number];
      options.signal?.throwIfAborted();
      const metadata = await new Promise<import("node:fs").Stats>((resolve, reject) => {
        fstat(fd, (error, stats) => error ? reject(error) : resolve(stats));
      });
      options.signal?.throwIfAborted();
      if (!metadata.isFile() || !Number.isSafeInteger(metadata.size) || metadata.size < 0) {
        throw new Error("Storage key does not reference a regular file");
      }
      return { body, size: metadata.size };
    } catch (error) {
      await owned.close();
      if (options.signal?.aborted) throw new DOMException("Stored read aborted", "AbortError");
      throw error;
    }
  }

  private resolveKey(key: string): string {
    const destination = resolve(this.root, key);
    const pathFromRoot = relative(this.root, destination);
    if (pathFromRoot.startsWith("..") || pathFromRoot === "") {
      throw new Error("Storage key escapes the configured root");
    }
    return destination;
  }
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private bucketReady: Promise<void> | undefined;

  constructor(
    private readonly bucket: string,
    options: { endpoint: string; accessKey: string; secretKey: string; region?: string },
  ) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region ?? "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: options.accessKey,
        secretAccessKey: options.secretKey,
      },
    });
  }

  async putFile(input: PutStoredFileInput): Promise<void> {
    await this.ensureBucket();
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          Body: createReadStream(input.sourcePath),
          ContentLength: input.size,
          ContentType: input.contentType,
          Metadata: { sha256: input.sha256 },
          IfNoneMatch: "*",
        }),
      );
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 409 && status !== 412) throw error;
    }
  }

  async getFile(key: string, options?: StoredFileReadOptions): Promise<{ body: Readable; size: number; contentType?: string }> {
    if (options !== undefined) return this.getReadOnlyFile(key, options);
    await this.ensureBucket();
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!(response.Body instanceof Readable) || response.ContentLength === undefined) {
      throw new Error("S3 object has no readable body or content length");
    }
    return {
      body: response.Body,
      size: response.ContentLength,
      ...(response.ContentType ? { contentType: response.ContentType } : {}),
    };
  }

  private async getReadOnlyFile(key: string, options: StoredFileReadOptions): Promise<{
    body: Readable; size: number; contentType?: string;
  }> {
    assertStoredReadOptions(options);
    // No HeadBucket/CreateBucket/ensureBucket: this branch performs no storage writes.
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { abortSignal: options.signal },
    );
    if (!(response.Body instanceof Readable)) {
      // Node SDK normally returns a native Readable. Release an unexpected web stream too.
      if (response.Body && typeof (response.Body as { cancel?: unknown }).cancel === "function") {
        await (response.Body as unknown as { cancel: () => Promise<void> }).cancel();
      }
      throw new Error("S3 object has no native readable body");
    }
    const body = response.Body;
    const owned = ownStoredReadable(body, options.signal);
    try {
      options.signal?.throwIfAborted();
      if (!Number.isSafeInteger(response.ContentLength) || Number(response.ContentLength) < 0
        || response.ContentType !== undefined && typeof response.ContentType !== "string") {
        throw new Error("S3 object has invalid content metadata");
      }
      return { body, size: response.ContentLength!,
        ...(response.ContentType !== undefined ? { contentType: response.ContentType } : {}) };
    } catch (error) {
      await owned.close();
      if (options.signal?.aborted) throw new DOMException("Stored read aborted", "AbortError");
      throw error;
    }
  }

  private ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status !== 404 && status !== 400) throw error;
        try {
          await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        } catch (createError) {
          const createStatus = (createError as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode;
          if (createStatus !== 409) throw createError;
        }
      }
    })();
    return this.bucketReady;
  }
}

export function createObjectStorageFromEnv(): ObjectStorage {
  const endpoint = process.env.S3_ENDPOINT;
  if (!endpoint) {
    return new LocalObjectStorage(process.env.UPLOAD_STORAGE_DIR ?? "./runtime");
  }

  const bucket = process.env.S3_BUCKET;
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  if (!bucket || !accessKey || !secretKey) {
    throw new Error("S3_ENDPOINT requires S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY");
  }
  return new S3ObjectStorage(bucket, { endpoint, accessKey, secretKey, region: process.env.S3_REGION });
}
