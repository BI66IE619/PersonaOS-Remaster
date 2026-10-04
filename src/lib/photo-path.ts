/**
 * The name a progress photo is stored under, and the reverse.
 *
 * The object name carries everything the gallery needs — the instant, the day,
 * and the id — so there is no metadata table to keep in step with the files. The
 * separator is a double underscore because the day is itself full of hyphens; a
 * single dash would make the three parts impossible to split apart again.
 *
 * Pure and free of the Storage client, so the encoding can be tested on its own.
 */
export const PHOTO_SEP = "__";

export type RemotePhoto = {
  id: string;
  /** Local day the photo belongs to. */
  date: string;
  takenAt: number;
  /** Full object path, for download and delete. */
  path: string;
};

const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** "1700000000000__2026-10-02__<id>.jpg" */
export function photoObjectName(p: { takenAt: number; date: string; id: string }): string {
  return `${p.takenAt}${PHOTO_SEP}${p.date}${PHOTO_SEP}${p.id}.jpg`;
}

/** The reverse, or null when the object is not one of ours. `folder` is the
 *  user's directory, prepended to build the path used for download and delete. */
export function parsePhotoObjectName(name: string, folder: string): RemotePhoto | null {
  if (!name.endsWith(".jpg")) return null;
  const parts = name.slice(0, -4).split(PHOTO_SEP);
  if (parts.length !== 3) return null;
  const [takenAtRaw, date, id] = parts;
  const takenAt = Number(takenAtRaw);
  if (!Number.isFinite(takenAt) || !isDay(date) || !id) return null;
  return { id, date, takenAt, path: `${folder}/${name}` };
}
