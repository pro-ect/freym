/**
 * Save a result to disk. Result URLs are cross-origin (Supabase storage,
 * provider CDNs), where a plain `<a download>` only navigates — so fetch the
 * bytes and hand the browser a blob. Falls back to opening the URL.
 */
export async function downloadFile(url: string, name?: string): Promise<void> {
  const fallback = () => {
    window.open(url, "_blank", "noopener");
  };
  try {
    const res = await fetch(url);
    if (!res.ok) return fallback();
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = name || fileNameFrom(url, blob.type);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  } catch {
    fallback();
  }
}

function fileNameFrom(url: string, mime: string): string {
  const last = url.split("?")[0].split("/").pop() || "";
  if (/\.[a-z0-9]{2,4}$/i.test(last)) return last;
  const ext = mime.startsWith("video/") ? "mp4" : mime.startsWith("audio/") ? "mp3" : mime.includes("png") ? "png" : "jpg";
  return `${last || "freym"}.${ext}`;
}
