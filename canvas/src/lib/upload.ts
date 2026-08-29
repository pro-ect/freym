import { supabase } from "./supabase";

const MAX_DIM = 2048;

async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.type === "image/jpeg") return file;
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
