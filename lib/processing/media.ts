import "server-only";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { readStorageConfig } from "@/lib/upload/env";
import { createStorageClient } from "@/lib/upload/r2";
import { defaultThumbnailKey } from "./status";

/** How long a signed thumbnail link works, in seconds. */
const THUMBNAIL_URL_TTL_S = 60 * 60;

/**
 * A short lived link to a video's default thumbnail in the private bucket,
 * for when the encoder had no MEDIA_PUBLIC_URL to put in thumbnail_url.
 * Signing happens locally, without a request to Supabase Storage. Null without Supabase Storage settings.
 */
export async function signedThumbnailUrl(videoId: string): Promise<string | null> {
  const storageConfig = readStorageConfig();
  if (!storageConfig) return null;
  try {
    return await getSignedUrl(
      createStorageClient(storageConfig),
      new GetObjectCommand({ Bucket: storageConfig.bucket, Key: defaultThumbnailKey(videoId) }),
      { expiresIn: THUMBNAIL_URL_TTL_S },
    );
  } catch {
    return null;
  }
}
