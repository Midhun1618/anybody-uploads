-- Run this in Supabase Dashboard -> SQL Editor.
-- Creates a PRIVATE bucket. Visitors can upload, but cannot list, read,
-- update, overwrite, or delete uploaded files.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'incoming-files',
  'incoming-files',
  false,
  26214400, -- 25 MB per file
  null      -- allow any file type
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 26214400,
  allowed_mime_types = null;

drop policy if exists "Anonymous visitors can upload incoming files"
on storage.objects;

create policy "Anonymous visitors can upload incoming files"
on storage.objects
for insert
to anon
with check (
  bucket_id = 'incoming-files'
  and (storage.foldername(name))[1] = 'uploads'
);

-- Intentionally do NOT create SELECT, UPDATE, or DELETE policies for anon.
-- You (the project owner) can inspect and manage files in the Supabase Dashboard.
