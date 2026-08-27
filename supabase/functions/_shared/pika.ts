/**
 * Shared Pika API helpers for start-prediction-pika and pika-poll.
 *
 * The Pika developer API (https://api.dev.pika.art) has no webhooks — jobs are
 * submitted, then polled until terminal. Both the in-request background poller
 * (start-prediction-pika) and the cron sweeper (pika-poll) finalize jobs through
 * finalizePikaJob(), which is idempotent: only the caller that wins the
 * processing→terminal row transition touches the coin ledger.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const PIKA_API_BASE = "https://api.dev.pika.art";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function pikaApiKey(): string {
  const key = Deno.env.get("PIKA_API_KEY");
  if (!key) throw new Error("PIKA_API_KEY not configured");
  return key;
}

export type PikaJob = {
  id?: string;
  status?: string; // queued | running | completed | failed (poll until completed/failed)
  error?: { code?: string; message?: string };
  message?: string;
};

export async function getPikaJob(jobId: string): Promise<PikaJob> {
  const res = await fetch(`${PIKA_API_BASE}/v1/media/jobs/${jobId}`, {
    headers: { "X-API-Key": pikaApiKey() },
  });
  const json = (await res.json().catch(() => ({}))) as PikaJob;
  if (!res.ok) throw new Error(`Pika job status ${res.status}: ${json.message ?? "unknown"}`);
  return json;
}

export async function getPikaContentUrl(jobId: string): Promise<string | null> {
  const res = await fetch(`${PIKA_API_BASE}/v1/media/jobs/${jobId}/content`, {
    headers: { "X-API-Key": pikaApiKey() },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  return typeof json.url === "string" ? json.url : null;
}

const EXT_BY_TYPE: [string, string][] = [
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
  ["video/quicktime", "mov"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/png", "png"],
];

/**
 * Mirror a Pika result URL into the public generation-results bucket so it
 * survives past the provider's CDN expiry (same pattern as prediction-callback).
 * Falls back to the original URL on any failure — finalization must not block.
 */
export async function mirrorPikaResult(
  admin: SupabaseClient,
  resultUrl: string,
  userId: string,
  queueId: string,
  requestId: string,
): Promise<string> {
  try {
    const response = await fetch(resultUrl);
    if (!response.ok) {
      console.warn(`[${requestId}] mirror: fetch ${response.status}, keeping provider URL`);
      return resultUrl;
    }
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const ext = EXT_BY_TYPE.find(([t]) => contentType.includes(t))?.[1] ?? "mp4";
    const bytes = new Uint8Array(await response.arrayBuffer());
    const path = `${userId}/${queueId}.${ext}`;

    const { error } = await admin.storage
      .from("generation-results")
      .upload(path, bytes, { contentType, upsert: true });
    if (error) {
      console.warn(`[${requestId}] mirror: upload failed, keeping provider URL:`, error.message);
      return resultUrl;
    }
    const { data } = admin.storage.from("generation-results").getPublicUrl(path);
    console.log(`[${requestId}] mirrored result to ${path}`);
    return data.publicUrl;
  } catch (err) {
    console.warn(`[${requestId}] mirror: unexpected error, keeping provider URL:`, err);
    return resultUrl;
  }
}

export type QueueRow = {
  id: string;
  user_id: string;
  model: string;
  status: string;
  replicate_id: string | null; // holds the Pika job id (column reused, same as fal)
  reserve_transaction_id: string | null;
};

/**
 * Poll Pika once for a processing queue row and finalize it if terminal.
 * Returns the state after this attempt. Safe to call concurrently from the
 * background poller and the cron sweeper: the UPDATE is guarded on
 * status='processing' and coins are only settled by the winner.
 */
export async function finalizePikaJob(
  admin: SupabaseClient,
  row: QueueRow,
  requestId: string,
): Promise<"completed" | "failed" | "pending"> {
  if (!row.replicate_id) return "pending";

  let job: PikaJob;
  try {
    job = await getPikaJob(row.replicate_id);
  } catch (err) {
    console.warn(`[${requestId}] poll: status fetch failed for ${row.id}:`, err);
    return "pending";
  }

  if (job.status === "completed") {
    const providerUrl = await getPikaContentUrl(row.replicate_id);
    if (!providerUrl) {
      console.warn(`[${requestId}] poll: completed but no content URL yet for ${row.id}`);
      return "pending";
    }
    const finalUrl = await mirrorPikaResult(admin, providerUrl, row.user_id, row.id, requestId);

    const { data: updated, error } = await admin
      .from("generation_queue")
      .update({ status: "completed", result_url: finalUrl, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "processing")
      .select("id");
    if (error) {
      console.error(`[${requestId}] poll: completion update failed for ${row.id}:`, error.message);
      return "pending";
    }
    if (updated?.length && row.reserve_transaction_id) {
      const { error: deductError } = await admin.rpc("deduct_reserved_coins", {
        p_reserve_transaction_id: row.reserve_transaction_id,
        p_description: `Deduct for completed ${row.model} generation (queue: ${row.id})`,
      });
      if (deductError) console.error(`[${requestId}] poll: deduct failed for ${row.id}:`, deductError.message);
    }
    return "completed";
  }

  if (job.status === "failed") {
    const reason = job.error?.message ?? job.message ?? "Generation failed";
    const { data: updated, error } = await admin
      .from("generation_queue")
      .update({
        status: "failed",
        error_message: reason,
        coins_refunded: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "processing")
      .select("id");
    if (error) {
      console.error(`[${requestId}] poll: failure update failed for ${row.id}:`, error.message);
      return "pending";
    }
    if (updated?.length && row.reserve_transaction_id) {
      const { error: releaseError } = await admin.rpc("release_reserved_coins", {
        p_reserve_transaction_id: row.reserve_transaction_id,
        p_description: `Release - Pika generation failed: ${reason}`,
      });
      if (releaseError) console.error(`[${requestId}] poll: release failed for ${row.id}:`, releaseError.message);
    }
    return "failed";
  }

  return "pending";
}
