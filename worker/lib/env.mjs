// The worker's settings, read from the environment (the box's env file).
import { hostname, tmpdir } from "node:os";
import { YAPIN_WEBHOOK_HOSTS } from "./yapin.mjs";

export const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_S3_ENDPOINT",
  "SUPABASE_S3_REGION",
  "SUPABASE_S3_ACCESS_KEY_ID",
  "SUPABASE_S3_SECRET_ACCESS_KEY",
  "SUPABASE_S3_BUCKET",
];

/**
 * Optional:
 *   WORKER_NAME       shown in encode_jobs.worker (default: the host name)
 *   WORK_DIR          where sources are downloaded and encoded (default: the system temp folder)
 *   STATE_DIR         where the busy marker for the update script lives (default: none)
 *   MEDIA_PUBLIC_URL  https base that serves the bucket's hls/ files, for thumbnail_url.
 *                     Without it thumbnail_url stays empty and the app signs a link.
 *   SITE_URL          this sloptube's address, like https://tube.example.com, for the
 *                     links in Yapin' announcements (feature 16). Without it none are posted.
 */
export function readConfig(env = process.env) {
  const get = (name) => env[name]?.trim() || "";
  const missing = REQUIRED_ENV.filter((name) => !get(name));
  const publicUrl = get("MEDIA_PUBLIC_URL").replace(/\/+$/, "");
  const siteUrl = get("SITE_URL").replace(/\/+$/, "");
  return {
    missing,
    supabaseUrl: get("SUPABASE_URL"),
    serviceRoleKey: get("SUPABASE_SERVICE_ROLE_KEY"),
    storage: {
      endpoint: get("SUPABASE_S3_ENDPOINT"),
      region: get("SUPABASE_S3_REGION"),
      accessKeyId: get("SUPABASE_S3_ACCESS_KEY_ID"),
      secretAccessKey: get("SUPABASE_S3_SECRET_ACCESS_KEY"),
    },
    bucket: get("SUPABASE_S3_BUCKET"),
    workerName: get("WORKER_NAME") || hostname(),
    workDir: get("WORK_DIR") || tmpdir(),
    stateDir: get("STATE_DIR") || null,
    mediaPublicUrl: /^https:\/\//.test(publicUrl) ? publicUrl : null,
    siteUrl: /^https?:\/\/[^/\s]+$/.test(siteUrl) ? siteUrl : null,
    yapinHosts: YAPIN_WEBHOOK_HOSTS,
  };
}
