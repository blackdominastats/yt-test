import "server-only";

/** Supabase Storage S3 credentials are server-only and must never use NEXT_PUBLIC_. */
export const STORAGE_ENV = [
  "SUPABASE_S3_ENDPOINT",
  "SUPABASE_S3_REGION",
  "SUPABASE_S3_ACCESS_KEY_ID",
  "SUPABASE_S3_SECRET_ACCESS_KEY",
  "SUPABASE_S3_BUCKET",
] as const;

export type StorageConfig = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

/** Read at request time so the same deployment works with dashboard-managed settings. */
export function readStorageConfig(): StorageConfig | null {
  const env = process.env;
  const [endpoint, region, accessKeyId, secretAccessKey, bucket] = STORAGE_ENV.map((name) => env[name]?.trim());
  if (!endpoint || !region || !accessKeyId || !secretAccessKey || !bucket) return null;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && process.env.NODE_ENV !== "development") return null;
    if (!url.pathname.endsWith("/storage/v1/s3")) return null;
  } catch {
    return null;
  }
  return { endpoint, region, accessKeyId, secretAccessKey, bucket };
}
