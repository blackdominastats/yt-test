-- 021_supabase_storage.sql
-- Create the private Supabase Storage bucket used by the app and encoder.
-- Supabase's S3 access keys are server-only and bypass Storage RLS. Never put
-- them in browser code or NEXT_PUBLIC_ environment variables.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sloptube-videos',
  'sloptube-videos',
  false,
  52428800,
  array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Keep the database guard in step with the 50 MB Free-plan upload limit.
create or replace function public.create_upload(title text, bytes bigint, mime text)
returns table (video_id uuid, source_key text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  me_profile public.profiles;
  my_channel uuid;
  clean_title text := trim(both from coalesce(create_upload.title, ''));
  ext text := public.video_extension_for(create_upload.mime);
  recent int;
  new_id uuid := gen_random_uuid();
  new_key text;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not public.upload_flag_on(me) then
    raise exception 'upload_off' using errcode = 'P0001';
  end if;

  select * into me_profile from public.profiles p where p.id = me;
  if me_profile.id is null or not me_profile.onboarded or me_profile.birthdate is null then
    raise exception 'not_onboarded' using errcode = 'P0001';
  end if;
  if public.age_on(me_profile.birthdate) < 13 then
    raise exception 'too_young' using errcode = 'P0001';
  end if;

  select c.id into my_channel from public.channels c where c.owner_id = me;
  if my_channel is null then
    raise exception 'no_channel' using errcode = 'P0001';
  end if;

  if char_length(clean_title) not between 1 and 100 then
    raise exception 'title_invalid' using errcode = 'P0001';
  end if;
  if create_upload.bytes is null or create_upload.bytes < 1 then
    raise exception 'file_empty' using errcode = 'P0001';
  end if;
  if create_upload.bytes > 52428800 then
    raise exception 'file_too_big' using errcode = 'P0001';
  end if;
  if ext is null then
    raise exception 'bad_type' using errcode = 'P0001';
  end if;

  -- One upload start at a time per person, so the daily count cannot be raced.
  perform pg_advisory_xact_lock(hashtextextended('create_upload:' || me::text, 0));
  select count(*) into recent
    from public.videos v
   where v.owner_id = me
     and v.created_at > now() - interval '24 hours';
  if recent >= 10 then
    raise exception 'daily_limit' using errcode = 'P0001';
  end if;

  new_key := 'uploads/' || me::text || '/' || new_id::text || '/source.' || ext;
  insert into public.videos (id, channel_id, owner_id, title, source_key, source_bytes, source_mime)
  values (new_id, my_channel, me, clean_title, new_key, create_upload.bytes, create_upload.mime);

  return query select new_id, new_key;
end;
$$;

revoke execute on function public.create_upload(text, bigint, text) from public, anon;
grant execute on function public.create_upload(text, bigint, text) to authenticated;
