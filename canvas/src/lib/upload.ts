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
