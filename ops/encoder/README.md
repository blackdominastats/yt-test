# Set up the encoder box

The encoder turns uploaded videos into something people can stream: HLS at
360p, 720p and 1080p (only the sizes the upload can fill), three thumbnails and
a hover preview sprite. It runs on its own server, separate from the website,
because encoding keeps every CPU core busy.

It takes about 15 minutes. You need:

- a [Hetzner Cloud](https://console.hetzner.cloud/) account
- the Supabase **secret key** (service role) from the
  [API keys page](https://supabase.com/dashboard/project/_/settings/api-keys)
- the private Supabase Storage bucket and S3 credentials (see [Uploads (Supabase Storage)](../../docs/features.md#uploads-supabase-storage) in the feature docs)
- migration `supabase/migrations/006_processing.sql` applied (see step 6)

How it works once it is set up: the worker asks the database for a job every
5 seconds. When someone finishes an upload it downloads the file from Supabase Storage,
encodes it, uploads the result to `hls/<video id>/` in the same bucket and marks
the video ready. One video at a time. When you push `main` to `release` and the
worker code changed, GitHub builds a new image and the box switches to it within
5 minutes, but never in the middle of an encode.

---

## 1. Create the server

1. Open the [Hetzner Cloud console](https://console.hetzner.cloud/) and pick your project.
2. Click **Add Server**.
3. Location: the same as the website, for example **Helsinki**.
4. Image: **Ubuntu 24.04**.
5. Type: **CPX31** (4 shared vCPU, 8 GB memory, 160 GB disk). Shared vCPU is fine
   for this.
6. SSH key: add your public key. No key yet? Follow
   [GitHub's guide to creating an SSH key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent).
7. Click **Create & Buy now** and copy the server's **IPv4 address**.

The encoder only makes outgoing connections (to Supabase and R2), so it needs no
domain and no open ports besides SSH.

Hetzner docs: [Creating a server](https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server/)

**How fast is it?** On a CPX31 a 10 minute 1080p video takes roughly 10 to 15
minutes: about as long as the video itself, a bit more for busy footage. A 720p
video takes about half that. Jobs wait in line, so a busy day means a longer
wait, not errors. Every job stops after 2 hours, which is enough for videos up
to about 1.5 hours long at 1080p.

## 2. Log in to the server

Replace `YOUR_SERVER_IP` with the address from step 1:

```bash
ssh root@YOUR_SERVER_IP
```

Type `yes` if it asks about the fingerprint.

## 3. Create the settings file

```bash
mkdir -p /opt/sloptube-encoder
nano /opt/sloptube-encoder/.env
```

Paste this and fill in your values after each `=` (every setting is also
explained in [`worker/.env.example`](../../worker/.env.example)):

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_S3_ENDPOINT=
SUPABASE_S3_REGION=
SUPABASE_S3_ACCESS_KEY_ID=
SUPABASE_S3_SECRET_ACCESS_KEY=
SUPABASE_S3_BUCKET=sloptube-videos

# Optional:
# WORKER_NAME=encoder-1
# MEDIA_PUBLIC_URL=https://media.example.com
# SITE_URL=https://tube.example.com
```

Save with `Ctrl+O`, `Enter`, and leave with `Ctrl+X`.

Where each value comes from:

| Name | Where to find it |
| --- | --- |
| `SUPABASE_URL` | [API settings](https://supabase.com/dashboard/project/_/settings/api), **Project URL** |
| `SUPABASE_SERVICE_ROLE_KEY` | [API keys](https://supabase.com/dashboard/project/_/settings/api-keys), a **Secret key** (or the legacy `service_role` key) |
| `SUPABASE_S3_ENDPOINT` | The endpoint copied from **Storage > Configuration > S3**; use the direct storage hostname and keep the `/storage/v1/s3` path. |
| `SUPABASE_S3_REGION` | The region shown beside the endpoint in the S3 configuration page. |
| `SUPABASE_S3_ACCESS_KEY_ID`, `SUPABASE_S3_SECRET_ACCESS_KEY` | The project-level S3 access key pair generated in **Storage > Configuration > S3**. The secret is shown once. These credentials bypass Storage RLS and access all Storage buckets, so keep them only in the server environment. |
| `SUPABASE_S3_BUCKET` | `sloptube-videos`, the private bucket created by migration 021. |

**The secret key can read and change everything in the database.** It lives only
in this file on this box: never in the repository, never in a chat, and in the
website's `.env` only if you switch on Sign in with Yapin' (feature 16, see
[`docs/launch.md`](../../docs/launch.md#yapin)). If it ever leaks, roll it on the API keys page and paste the new
one here.

## 4. Run the installer

```bash
curl -fsSL https://raw.githubusercontent.com/myfilehero/sloptube/main/ops/encoder/install.sh -o install.sh
bash install.sh
```

It installs Docker, the `sloptube-encoder` service (starts on boot), log rotation
and a timer that checks for a new image every 5 minutes. Running it again is safe.

## 5. Let the box pull the image

The image is `ghcr.io/myfilehero/sloptube-encoder`. GitHub builds it the first
time `worker/` reaches the `release` branch. You can also start a build by hand:
**Actions > encoder > Run workflow** on the
[Actions page](https://github.com/myfilehero/sloptube/actions/workflows/encoder.yml).

Then make the package public so the box can pull it without a login:
[Your packages](https://github.com/myfilehero?tab=packages) >
**sloptube-encoder** > **Package settings** > **Change visibility** > **Public**.
GitHub docs: [Configuring a package's visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).

Within 5 minutes the box pulls it and starts the worker. To not wait, run:

```bash
sloptube-encoder-update && systemctl start sloptube-encoder
```

## 6. Switch processing on

1. Run `supabase/migrations/006_processing.sql` in the
   [SQL editor](https://supabase.com/dashboard/project/_/sql/new)
   (after 001 to 005).
2. In the [table editor](https://supabase.com/dashboard/project/_/editor),
   open `feature_flags` and set the `processing` row to `test` (with your user id
   in `users`) or `everyone`.

While the flag is `off` the worker takes no jobs. In `test` mode it only encodes
videos of the listed users. Uploads made before the flag was on wait in line and
start as soon as it is.

## 7. Watch the log

```bash
docker logs -f sloptube-encoder
```

One line per step, for example:

```
2026-11-04T10:00:00.000Z start worker=encoder-1 polling every 5s
2026-11-04T10:02:11.000Z claim job=1a2b3c4d video=5e6f7a8b attempt=1 worker=encoder-1 uploads/.../source.mp4
2026-11-04T10:02:11.200Z head job=1a2b3c4d video=5e6f7a8b source is 812.4 MB, size matches
2026-11-04T10:02:25.900Z download job=1a2b3c4d video=5e6f7a8b 812.4 MB in 14.7s
2026-11-04T10:02:26.100Z probe job=1a2b3c4d video=5e6f7a8b duration=600.0 size=1920x1080 audio=true renditions 360p(640x360) 720p(1280x720) 1080p(1920x1080)
2026-11-04T10:13:40.000Z encode job=1a2b3c4d video=5e6f7a8b 3 renditions in 674.0s
2026-11-04T10:13:44.000Z thumbnails job=1a2b3c4d video=5e6f7a8b 3 thumbnails and a 100 frame sprite in 4.0s
2026-11-04T10:14:02.000Z upload job=1a2b3c4d video=5e6f7a8b 456 files, 610.2 MB in 18.0s
2026-11-04T10:14:02.300Z done job=1a2b3c4d video=5e6f7a8b ready in 711.3s
```

Updates are logged in `/var/log/sloptube-encoder-update.log`.

Check that ffmpeg works on the box (encodes a 3 second test clip):

```bash
docker exec sloptube-encoder node --test test/
```

---

## What it makes

Everything for a video lives under `hls/<video id>/` in the bucket:

| File | What it is |
| --- | --- |
| `master.m3u8` | the HLS master playlist (`videos.hls_key`) |
| `360p/`, `720p/`, `1080p/` | `index.m3u8`, an `init` segment and 4 second `.m4s` segments |
| `thumb-1.webp`, `thumb-2.webp`, `thumb-3.webp` | frames at 10%, 50% and 90%, 1280 wide. The first is the default. |
| `sprite.webp`, `sprite.vtt` | the hover preview: one 160x90 frame every 5 s (at most 100), and the WebVTT that maps time to tile (`videos.preview_sprite_key`) |

- **Never upscaled.** A 720p upload gets 360p and 720p. Something between two
  sizes (like 1600x900) also gets one at its own size. Portrait videos count
  their short side, so a 1080x1920 phone video is 1080p.
- **H.264 and AAC**, keyframes every 4 seconds, `veryfast` x264 preset.
- **fMP4 segments, not MPEG-TS.** They have less overhead, play in hls.js and in
  Safari, and the same files can be served as DASH later without encoding again.

Custom thumbnails from the studio (feature 12) land in the same folder as
`custom-<random>.jpg`, `.png` or `.webp`. The website writes those, not the encoder.

## Emptying the trash in Supabase Storage

Videos deleted in the studio stay in the trash for 30 days. Then the daily
`purge_trash()` (migration 014, pg_cron) deletes the row and queues the video's
two folders, `hls/<video id>/` and `uploads/<owner id>/<video id>/`, in the
`storage_cleanup` table. Between encodes, every 10 minutes, the worker claims up
to 20 of them, deletes every object under each one and marks it `done` with the
count. A folder that fails is tried again later, up to 5 times; the reason is in
`storage_cleanup.error`. The worker only ever deletes under those two kinds of
prefix, and the table refuses anything else.

This needs the token's **Object Read & Write** permission, which also covers
deleting. Nothing to set up beyond migration 014.

## When something goes wrong

- A failed encode is tried again, up to 3 attempts. After that the video shows
  **Failed** in `/studio/videos` with the reason. The `encode_jobs` table in the
  [table editor](https://supabase.com/dashboard/project/_/editor)
  has the details.
- An upload whose size in Supabase Storage does not match what the browser said is refused
  right away, without retries.
- If the box crashes during an encode, the worker gives the job back when it
  starts again. A job stuck as `running` for more than 2 h 15 min is taken back
  by the next worker that asks.
- To try a failed video again, set its `status` back to `uploaded` in the
  `videos` table. A fresh job is queued.
- To stop the encoder: `systemctl stop sloptube-encoder`. A running job goes back
  in the queue.

## Files

- `Dockerfile`: the worker image (Node 22 and ffmpeg from Debian), built from `worker/`
- `docker-compose.yml`: the service, its work and state folders and log limits
- `install.sh`: the installer above
- `../../.github/workflows/encoder.yml`: tests the worker and builds the image on push to `release`
