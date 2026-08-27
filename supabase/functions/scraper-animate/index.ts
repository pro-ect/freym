// scraper-animate: admin tool that animates a starred post's photo into a
// short video via fal (MiniMax H3 Max image-to-video) for the freym.app hero.
//
// Two-phase, orchestrated by the caller:
//   POST { image_id }              → submit to fal, store video_request_id
//   POST { image_id, check: true } → poll fal; on completion download the clip,
//                                    store it in scraper-images/hero-videos/,
//                                    set sc_images.video_path, return done
//
// Guarded by x-admin-key (SCRAPER_ADMIN_KEY, same key scraper-star uses).
// Secrets: FAL_KEY, SCRAPER_ADMIN_KEY.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const STORAGE_BASE = `${SUPABASE_URL}/storage/v1/object/public/scraper-images/`;

const FAL_ENDPOINT = "minimax/h3-max/image-to-video";
const FAL_QUEUE_BASE = "https://queue.fal.run/minimax/h3-max"; // status/result URLs drop the function suffix

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const adminKey = Deno.env.get("SCRAPER_ADMIN_KEY");
  if (!adminKey || req.headers.get("x-admin-key") !== adminKey) return json({ error: "unauthorized" }, 401);
  const falKey = Deno.env.get("FAL_KEY");
  if (!falKey) return json({ error: "FAL_KEY not configured" }, 500);

  const body = await req.json().catch(() => ({}));
  const imageId = body?.image_id;
  if (typeof imageId !== "string" || !imageId) return json({ error: "image_id required" }, 400);

  const { data: image, error: imgErr } = await supabase
    .from("sc_images")
    .select("id, url, stored_path, video_path, video_request_id")
    .eq("id", imageId)
    .single();
  if (imgErr || !image) return json({ error: "image not found" }, 404);

  if (image.video_path) {
    return json({ status: "done", video_url: STORAGE_BASE + image.video_path, cached: true });
  }

  // Prefer the mirrored copy — provider CDN URLs expire and block hotlinks.
  const imageUrl = image.stored_path ? STORAGE_BASE + image.stored_path : image.url;

  if (!body?.check) {
    const prompt = typeof body?.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : "animate this photo";
    const res = await fetch(`https://queue.fal.run/${FAL_ENDPOINT}`, {
      method: "POST",
      headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, image_url: imageUrl }),
    });
    const submitted = await res.json().catch(() => ({}));
    if (!res.ok || !submitted.request_id) {
      return json({ error: "fal submit failed", status_code: res.status, detail: submitted }, 502);
    }
    await supabase.from("sc_images").update({ video_request_id: submitted.request_id }).eq("id", imageId);
    return json({ status: "submitted", request_id: submitted.request_id });
  }

  // check mode
  if (!image.video_request_id) return json({ error: "not submitted yet" }, 409);
  const statusRes = await fetch(`${FAL_QUEUE_BASE}/requests/${image.video_request_id}/status`, {
    headers: { Authorization: `Key ${falKey}` },
  });
  const status = await statusRes.json().catch(() => ({}));
  if (status.status !== "COMPLETED") {
    return json({ status: status.status ?? "unknown", detail: status.error ?? null });
  }

  const resultRes = await fetch(`${FAL_QUEUE_BASE}/requests/${image.video_request_id}`, {
    headers: { Authorization: `Key ${falKey}` },
  });
  const result = await resultRes.json().catch(() => ({}));
  const videoUrl = result?.video?.url;
  if (!videoUrl) return json({ error: "no video in fal result", detail: result }, 502);

  const dl = await fetch(videoUrl);
  if (!dl.ok) return json({ error: `video download failed (${dl.status})` }, 502);
  const bytes = new Uint8Array(await dl.arrayBuffer());
  const path = `hero-videos/${imageId}.mp4`;
  const { error: upErr } = await supabase.storage
    .from("scraper-images")
    .upload(path, bytes, { contentType: "video/mp4", upsert: true });
  if (upErr) return json({ error: `storage upload failed: ${upErr.message}` }, 500);

  await supabase.from("sc_images").update({ video_path: path }).eq("id", imageId);
  return json({ status: "done", video_url: STORAGE_BASE + path, bytes: bytes.length });
});
