import { supabase } from "./supabase";

const MAX_DIM = 2048;

/** iPhone photos arrive as HEIC/HEIF, which browsers (other than Safari) cannot
 *  decode. Detect by MIME or extension — Chrome often reports an empty type. */
export function isHeic(file: File): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

/** Anything we can turn into a JPEG for the canvas: real image MIME or HEIC. */
export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || isHeic(file);
}

/** HEIC → JPEG in the browser (libheif via wasm, loaded on first use). */
async function heicToJpeg(file: File): Promise<Blob> {
  // heic2any ships as CommonJS; depending on the bundler's interop the
  // callable lands on the module, on .default, or on .default.default.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import("heic2any");
  const heic2any =
    typeof mod === "function" ? mod
    : typeof mod.default === "function" ? mod.default
    : mod.default?.default;
  if (typeof heic2any !== "function") throw new Error("HEIC converter failed to load");
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
  return Array.isArray(out) ? out[0] : out;
}

async function downscale(file: File): Promise<Blob> {
  const source: Blob = isHeic(file) ? await heicToJpeg(file) : file;
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && source.type === "image/jpeg") return source;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.92));
}

const MEDIA_MAX_BYTES = 50 * 1024 * 1024;
const MEDIA_EXT: Record<string, string> = {
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg",
};

/** Video/audio reference uploads — stored as-is (no transcode), 50 MB cap. */
export async function uploadInputMedia(file: File): Promise<string> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user.id;
  if (!userId) throw new Error("not signed in");
  if (file.size > MEDIA_MAX_BYTES) throw new Error("file too large — 50 MB max");
  const ext = MEDIA_EXT[file.type] ?? file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from("generation-inputs")
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  return supabase.storage.from("generation-inputs").getPublicUrl(path).data.publicUrl;
}

export async function uploadInputImage(file: File): Promise<string> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user.id;
  if (!userId) throw new Error("not signed in");
  const blob = await downscale(file);
  const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage
    .from("generation-inputs")
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return supabase.storage.from("generation-inputs").getPublicUrl(path).data.publicUrl;
}
