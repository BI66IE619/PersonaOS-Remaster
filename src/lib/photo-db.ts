const DB_NAME = "personaos-media";
const STORE = "photos";
const VERSION = 1;

export type PhotoRecord = {
  id: string;
  /** Local day the photo belongs to. */
  date: string;
  takenAt: number;
  blob: Blob;
  width: number;
  height: number;
  /**
   * The object's path in Supabase Storage once it has been uploaded. Absent on
   * a photo taken offline and not yet sent, which is also the flag the gallery
   * uses to know it still owes an upload — there is no separate boolean to fall
   * out of step with the path.
   */
  path?: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("takenAt", "takenAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

export function putPhoto(record: PhotoRecord) {
  return run("readwrite", (s) => s.put(record));
}

export function deletePhoto(id: string) {
  return run("readwrite", (s) => s.delete(id));
}

/** Newest first. */
export async function listPhotos(): Promise<PhotoRecord[]> {
  const all = await run<PhotoRecord[]>("readonly", (s) => s.getAll());
  return all.sort((a, b) => b.takenAt - a.takenAt);
}

export function newPhotoId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `p${Date.now().toString(36)}`;
}
