/**
 * pika-poll — cron backstop for Pika generations.
 *
 * start-prediction-pika polls its own job in a background task, but that task
 * dies with the function instance (~400s wall clock) and on crashes. This
 * sweeper finalizes whatever is left:
 * - 'processing' rows on pika models → poll Pika, complete/fail + settle coins
 *   (finalizePikaJob is idempotent, so racing the background poller is safe);
 * - 'processing' rows older than 2h → force-fail + release coins;
 * - 'pending' pika rows older than 15min with no Pika job id → the submit
 *   crashed mid-flight → fail + release coins.
 *
 * Invoked by pg_cron via pg_net every 2 minutes, and directly with
 * { job_id } to target one row. Deployed with --no-verify-jwt (pg_net cannot
 * sign a user JWT); guarded by the x-poll-secret header instead.
 *
 * Secrets: PIKA_API_KEY, PIKA_POLL_SECRET.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, finalizePikaJob, type QueueRow } from "../_shared/pika.ts";

const SWEEP_LIMIT = 20;

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secret = Deno.env.get("PIKA_POLL_SECRET");
  const given = req.headers.get("x-poll-secret") ?? new URL(req.url).searchParams.get("secret");
  if (!secret || given !== secret) return json({ success: false, error: { code: "AUTH_UNAUTHORIZED" } }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const targetJobId: string | undefined = body?.job_id;

    const { data: pikaConfigs, error: configsError } = await admin
      .from("model_configs")
      .select("model_id")
      .eq("provider", "pika");
    if (configsError) return json({ success: false, error: { code: "DB_QUERY_FAILED", details: configsError.message } }, 500);
    const pikaModels = (pikaConfigs ?? []).map((c) => c.model_id);
    if (!pikaModels.length) return json({ success: true, swept: 0, note: "no pika models configured" });

    let query = admin
      .from("generation_queue")
      .select("id, user_id, model, status, replicate_id, reserve_transaction_id, created_at")
      .in("model", pikaModels)
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: true })
      .limit(SWEEP_LIMIT);
    if (targetJobId) query = query.eq("id", targetJobId);

    const { data: rows, error: rowsError } = await query;
    if (rowsError) return json({ success: false, error: { code: "DB_QUERY_FAILED", details: rowsError.message } }, 500);

    const counts = { completed: 0, failed: 0, pending: 0, reaped: 0 };
    const now = Date.now();

    for (const row of rows ?? []) {
      const ageMs = now - new Date(row.created_at).getTime();

      const reap = async (reason: string) => {
        const { data: updated } = await admin
          .from("generation_queue")
          .update({ status: "failed", error_message: reason, coins_refunded: true })
          .eq("id", row.id)
          .in("status", ["pending", "processing"])
          .select("id");
        if (updated?.length && row.reserve_transaction_id) {
          await admin.rpc("release_reserved_coins", {
            p_reserve_transaction_id: row.reserve_transaction_id,
            p_description: `Release - ${reason} (queue: ${row.id})`,
          });
        }
        counts.reaped++;
      };

      if (row.status === "pending") {
        // Submit never finished. Give the in-flight request 15min, then refund.
        if (!row.replicate_id && ageMs > 15 * 60 * 1000) await reap("Generation never started");
        else counts.pending++;
        continue;
      }

      if (ageMs > 2 * 60 * 60 * 1000) {
        await reap("Generation timed out");
        continue;
      }

      const state = await finalizePikaJob(admin, row as QueueRow, requestId);
      counts[state]++;
    }

    console.log(`[${requestId}] sweep:`, counts);
    return json({ success: true, swept: rows?.length ?? 0, ...counts });
  } catch (err) {
    console.error(`[${requestId}] sweep error:`, err);
    return json({ success: false, error: { code: "INTERNAL_SERVER_ERROR", details: err instanceof Error ? err.message : undefined } }, 500);
  }
});
