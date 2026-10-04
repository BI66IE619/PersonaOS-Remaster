import { createClient } from "@/lib/supabase/client";
import { parsePhotoObjectName, photoObjectName, type RemotePhoto } from "@/lib/photo-path";

/**
 * Progress photos in Supabase Storage.
 *
 * The bucket is the source of truth, so there is no metadata table and no sync
 * cursor: listing a user's folder from any device returns the whole photo set.
 * Deleting the object deletes it everywhere. Each device keeps a copy in
 * IndexedDB only so the gallery paints without a round trip and still works
 * offline.
 *
 * The object name carries everything — see photo-path.ts for the encoding.
 *
 * Server-side folder rules live on storage.objects (see 0013_photo_storage.sql):
 * a signed-in user may only touch a folder named for their own id.
 */
const BUCKET = "progress-photos";

export type { RemotePhoto };

/** Every photo for the account, newest first. Throws on a storage error so the
 *  caller can tell "nothing there" from "could not ask". */
export async function listRemotePhotos(userId: string): Promise<RemotePhoto[]> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(userId, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (error) throw error;
  return (data ?? [])
    .flatMap((o): RemotePhoto[] => {
      const parsed = parsePhotoObjectName(o.name, userId);
      return parsed ? [parsed] : [];
    })
    .sort((a, b) => b.takenAt - a.takenAt);
}

/** Uploads one photo and returns its path. Upsert, so re-running a queued upload
 *  is idempotent rather than an error. */
export async function uploadPhoto(
  userId: string,
  photo: { takenAt: number; date: string; id: string },
  blob: Blob,
): Promise<string> {
  const path = `${userId}/${photoObjectName(photo)}`;
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
  return path;
}

export async function downloadPhoto(path: string): Promise<Blob> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw error;
  return data;
}

export async function removeRemotePhoto(path: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}
