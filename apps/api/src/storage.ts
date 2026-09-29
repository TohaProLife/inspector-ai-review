import { constants as fsConstants } from "node:fs";
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

export interface ObjectStorage {
  putFile(input: PutStoredFileInput): Promise<void>;
  getFile(key: string): Promise<{
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

  async getFile(key: string): Promise<{ body: Readable; size: number }> {
    const source = this.resolveKey(key);
    const metadata = await stat(source);
    if (!metadata.isFile()) throw new Error("Storage key does not reference a file");
    return { body: createReadStream(source), size: metadata.size };
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

  async getFile(key: string): Promise<{ body: Readable; size: number; contentType?: string }> {
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
