export type ResizedImage = {
  blob: Blob;
  width: number;
  height: number;
};

/**
 * Phone cameras produce 3-5MB files. Re-encoding to a sane longest edge keeps a
 * year of monthly photos in the low hundreds of kilobytes each, which is the
 * difference between a usable history and running out of room.
 *
 * `imageOrientation: "from-image"` applies the EXIF rotation, otherwise portrait
 * shots come back sideways.
 */
export async function fileToResizedImage(
  file: File,
  maxDim = 1400,
  quality = 0.82,
): Promise<ResizedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new Error("image encode failed");

  return { blob, width, height };
}
