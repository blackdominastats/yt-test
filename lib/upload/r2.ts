// Supabase Storage's S3-compatible API. Server-only: these credentials bypass
// Storage RLS and must never be exposed to the browser.
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { UploadStorage } from "./handlers.ts";
import type { StorageConfig } from "./env.ts";

export type StorageClientConfig = Pick<StorageConfig, "endpoint" | "region" | "accessKeyId" | "secretAccessKey">;

/** S3 client pointed at the project's Supabase Storage endpoint. */
export function createStorageClient(config: StorageClientConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/** Multipart upload operations on one private Supabase Storage bucket. */
export function createStorageAdapter(client: S3Client, bucket: string): UploadStorage {
  return {
    async createMultipart(key, mime) {
      const out = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: mime }));
      if (!out.UploadId) throw new Error("Supabase Storage did not return an upload id");
      return out.UploadId;
    },
    presignPart(key, uploadId, partNumber, expiresIn) {
      return getSignedUrl(client, new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }), { expiresIn });
    },
    async completeMultipart(key, uploadId, parts) {
      await client.send(new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
      }));
    },
    async abortMultipart(key, uploadId) {
      await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
    },
    async objectSize(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return typeof out.ContentLength === "number" ? out.ContentLength : null;
      } catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404 || (err as { name?: string }).name === "NotFound") return null;
        throw err;
      }
    },
  };
}
