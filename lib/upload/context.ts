import "server-only";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { createClient } from "@/lib/supabase/server";
import { createUploadDb } from "./db";
import { readStorageConfig } from "./env";
import type { HandlerResult, UploadContext } from "./handlers";
import { createStorageAdapter, createStorageClient } from "./r2";

/** Supabase Storage S3 API, database session and signed-in user for upload routes. */
export async function uploadContext(): Promise<UploadContext> {
  const storageConfig = readStorageConfig();
  const supabase = await createClient();
  return {
    storage: storageConfig ? createStorageAdapter(createStorageClient(storageConfig), storageConfig.bucket) : null,
    db: supabase ? createUploadDb(supabase) : null,
    userId: async () => (await getCurrentUser())?.id ?? null,
    flagOn: (userId) => flagOn("upload", userId),
  };
}

export async function runUploadRoute(
  request: Request,
  handler: (body: unknown, ctx: UploadContext) => Promise<HandlerResult>,
): Promise<Response> {
  const body = await request.json().catch(() => null);
  const result = await handler(body, await uploadContext());
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
