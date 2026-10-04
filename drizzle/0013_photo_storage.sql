-- Progress photos live in Supabase Storage, not in a table.
--
-- The bucket is the source of truth: listing a user's folder from any device is
-- the photo set, so there is no metadata table, no cursor and no tombstone to
-- reconcile. Removing an object removes it everywhere. The device keeps a copy in
-- IndexedDB only as a cache, so the gallery still paints offline.
--
-- One object per photo, named "{takenAt}__{YYYY-MM-DD}__{id}.jpg" inside a folder
-- named for the user. The name carries the date and the instant, so a listing is
-- self-describing and nothing else has to be stored.
--
-- Access is by folder: a signed-in user may read and write only under a folder
-- whose name is their own id. That is the same rule the tables use, enforced this
-- time by Storage's own RLS on storage.objects rather than by lib/dal.ts.

insert into storage.buckets (id, name, public)
values ('progress-photos', 'progress-photos', false)
on conflict (id) do nothing;

-- Re-runnable, so a replay after a partial apply is a no-op.
drop policy if exists "progress_photos_select_own" on storage.objects;
create policy "progress_photos_select_own" on storage.objects
	for select to authenticated
	using (
		bucket_id = 'progress-photos'
		and (storage.foldername(name))[1] = auth.uid()::text
	);

drop policy if exists "progress_photos_insert_own" on storage.objects;
create policy "progress_photos_insert_own" on storage.objects
	for insert to authenticated
	with check (
		bucket_id = 'progress-photos'
		and (storage.foldername(name))[1] = auth.uid()::text
	);

drop policy if exists "progress_photos_update_own" on storage.objects;
create policy "progress_photos_update_own" on storage.objects
	for update to authenticated
	using (
		bucket_id = 'progress-photos'
		and (storage.foldername(name))[1] = auth.uid()::text
	)
	with check (
		bucket_id = 'progress-photos'
		and (storage.foldername(name))[1] = auth.uid()::text
	);

drop policy if exists "progress_photos_delete_own" on storage.objects;
create policy "progress_photos_delete_own" on storage.objects
	for delete to authenticated
	using (
		bucket_id = 'progress-photos'
		and (storage.foldername(name))[1] = auth.uid()::text
	);
