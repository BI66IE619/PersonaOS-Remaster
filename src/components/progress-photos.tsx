"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fileToResizedImage } from "@/lib/image";
import {
  deletePhoto,
  listPhotos,
  newPhotoId,
  putPhoto,
  type PhotoRecord,
} from "@/lib/photo-db";
import { downloadPhoto, listRemotePhotos, removeRemotePhoto, uploadPhoto } from "@/lib/photo-storage";
import { monthLabel } from "@/lib/dates";

type Row = PhotoRecord & { url: string };

function stamp(takenAt: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(takenAt));
}

function shortStamp(takenAt: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(takenAt));
}

function kb(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Progress photos.
 *
 * The bucket is the account's copy; IndexedDB is this device's cache. A load
 * reconciles the two: anything local but not sent is uploaded, anything sent but
 * gone from the bucket was deleted on another device and is dropped, and anything
 * in the bucket but not here is downloaded. So "sync" is not a separate step — it
 * is what reading the gallery does, and the gallery still paints from the cache
 * when the network is down.
 */
export function ProgressPhotos({ date, userId }: { date: string; userId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /* Object URLs outlive the component unless revoked, and a year of photos
     leaks a few MB per session otherwise. */
  const urlsRef = useRef<string[]>([]);

  const revokeAll = useCallback(() => {
    for (const u of urlsRef.current) URL.revokeObjectURL(u);
    urlsRef.current = [];
  }, []);

  const paint = useCallback(
    async (all: PhotoRecord[]) => {
      revokeAll();
      const next = all.map((p) => {
        const url = URL.createObjectURL(p.blob);
        urlsRef.current.push(url);
        return { ...p, url };
      });
      setRows(next);
    },
    [revokeAll],
  );

  /**
   * Reconcile local cache with the bucket, then paint.
   *
   * Every step is best-effort: a device that is offline (or signed out of
   * storage) still shows what it already has rather than an empty gallery, and
   * photographs taken offline are uploaded on the next successful load.
   */
  const refresh = useCallback(async () => {
    const local = await listPhotos();

    let remote: Awaited<ReturnType<typeof listRemotePhotos>> | null = null;
    try {
      remote = await listRemotePhotos(userId);
    } catch {
      /* Offline or storage unavailable: keep the cache. No error shown — the
         gallery is still correct for this device. */
      await paint(local);
      return;
    }

    const remoteById = new Map(remote.map((r) => [r.id, r]));
    const localById = new Map(local.map((l) => [l.id, l]));

    /* Upload anything taken here but not yet in the bucket. */
    for (const rec of local) {
      if (rec.path || remoteById.has(rec.id)) continue;
      try {
        const path = await uploadPhoto(userId, rec, rec.blob);
        await putPhoto({ ...rec, path });
      } catch {
        /* Left without a path, so the next load tries again. */
      }
    }

    /* Drop anything the bucket no longer has, which means another device deleted
       it. Un-uploaded local photos are kept — they were never in the bucket to
       begin with. */
    for (const rec of local) {
      if (rec.path && !remoteById.has(rec.id)) await deletePhoto(rec.id);
    }

    /* Pull anything the bucket has that this device does not. */
    for (const r of remote) {
      if (localById.has(r.id)) continue;
      try {
        const blob = await downloadPhoto(r.path);
        await putPhoto({
          id: r.id,
          date: r.date,
          takenAt: r.takenAt,
          blob,
          width: 0,
          height: 0,
          path: r.path,
        });
      } catch {
        /* Skipped this time; the next load tries again. */
      }
    }

    await paint(await listPhotos());
  }, [paint, userId]);

  useEffect(() => {
    void refresh().catch(() => setError("Could not load photos."));
    return revokeAll;
  }, [refresh, revokeAll]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        const { blob, width, height } = await fileToResizedImage(file);
        const record: PhotoRecord = {
          id: newPhotoId(),
          date,
          takenAt: Date.now(),
          blob,
          width,
          height,
        };
        /* Saved locally first, so a failed upload still leaves the photo on this
           device and the next load sends it. */
        await putPhoto(record);
        try {
          const path = await uploadPhoto(userId, record, blob);
          await putPhoto({ ...record, path });
        } catch {
          setError("Saved here. It will upload when you are back online.");
        }
      }
      await refresh();
    } catch {
      setError("Could not read that image.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (id: string) => {
    const rec = rows.find((r) => r.id === id);
    if (rec?.path) {
      try {
        await removeRemotePhoto(rec.path);
      } catch {
        /* Stop rather than delete locally. If the object is still in the bucket,
           removing only the local copy would look gone and then come back on the
           next load, when the reconciliation downloads it again. */
        setError("Could not delete that photo. Check your connection and try again.");
        return;
      }
    }
    await deletePhoto(id);
    setPicked((p) => p.filter((x) => x !== id));
    await refresh();
  };

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));

  /* Newest month first, months in chronological order within. */
  const months = [...rows.reduce((m, r) => m.set(r.date.slice(0, 7), true), new Map<string, boolean>())]
    .map(([key]) => key)
    .sort()
    .reverse();

  const compare = picked.map((id) => rows.find((r) => r.id === id)).filter(Boolean) as Row[];
  const totalBytes = rows.reduce((n, r) => n + r.blob.size, 0);

  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="label-xs">Progress photos</span>
        <div className="flex items-center gap-3">
          {rows.length ? (
            <span className="num text-[10px] text-ink-3">
              {rows.length} · {kb(totalBytes)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="rounded-lg border border-hairline-strong bg-raised px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-inset disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add photo"}
          </button>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => void onFiles(e.target.files)}
        className="hidden"
      />

      <p className="mt-2 text-xs text-ink-3">
        One a month is plenty. Tap two to compare.
      </p>

      {error ? (
        <p className="mt-3 text-xs text-[var(--color-mid)]">{error}</p>
      ) : null}

      {compare.length === 2 ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {compare.map((r, i) => (
            <figure key={r.id} className="m-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={r.url}
                alt={`Progress photo ${i + 1}, taken ${stamp(r.takenAt)}`}
                className="aspect-[3/4] w-full rounded-lg border border-hairline object-cover"
              />
              <figcaption className="num mt-1.5 text-center text-[10px] text-ink-3">
                {stamp(r.takenAt)}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-4 text-xs text-ink-3">
          Nothing here yet. Add a photo and it will show up here with its date.
        </p>
      ) : (
        <div className="mt-5 space-y-5">
          {months.map((month) => (
            <div key={month}>
              <div className="mb-2 text-[10px] tracking-wide text-ink-3">
                {monthLabel(month)}
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {rows
                  .filter((r) => r.date.startsWith(month))
                  .map((r) => {
                    const index = picked.indexOf(r.id);
                    return (
                      <div key={r.id} className="relative">
                        <button
                          type="button"
                          onClick={() => toggle(r.id)}
                          aria-pressed={index !== -1}
                          aria-label={`Select photo from ${stamp(r.takenAt)}`}
                          className="block w-full overflow-hidden rounded-lg border transition-all"
                          style={{
                            borderColor:
                              index === -1
                                ? "var(--color-hairline)"
                                : "var(--color-accent)",
                            boxShadow:
                              index === -1 ? "none" : "0 0 0 1px var(--color-accent), 0 0 18px -4px var(--color-accent)",
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={r.url}
                            alt={`Progress photo taken ${stamp(r.takenAt)}`}
                            className="aspect-[3/4] w-full object-cover"
                          />
                        </button>
                        {index !== -1 ? (
                          <span className="num absolute top-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-accent)] text-[10px] font-semibold text-[var(--color-base)]">
                            {index + 1}
                          </span>
                        ) : null}
                        <div className="mt-1 flex items-center justify-between gap-1">
                          <span className="num text-[10px] text-ink-3">
                            {shortStamp(r.takenAt)}
                          </span>
                          <button
                            type="button"
                            onClick={() => void remove(r.id)}
                            aria-label={`Delete photo from ${shortStamp(r.takenAt)}`}
                            className="rounded px-1 text-[10px] text-ink-3 transition-colors hover:text-[var(--color-low)]"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
