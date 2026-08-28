/**
 * start-prediction-pika — canvas run entrypoint for provider 'pika'
 * (the Pika developer API, https://api.dev.pika.art).
 *
 * Mirrors the start-prediction-fal contract the canvas already speaks:
 *   POST { model, prompt, parameters, metadata } with a user JWT
 *   → { success: true, data: { job_id } }, job settles via generation_queue.
 *
 * Differences from the fal pipeline:
 * - Pika has no webhooks. This function submits, then keeps polling in a
 *   background task (EdgeRuntime.waitUntil) until the job is terminal; the
 *   pika-poll cron sweeper is the backstop for jobs that outlive this instance.
 * - Pricing is fully data-driven from model_pricing (coin_cost or
 *   price_per_second_cents × duration) — no per-model code branches.
 * - Results are mirrored into the generation-results bucket at completion, so
 *   canvas projects keep working after Pika's CDN URLs expire.
 *
 * Deploy (from this repo): standard JWT verification ON (default).
 * Secrets: PIKA_API_KEY.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PIKA_API_BASE, corsHeaders, finalizePikaJob, pikaApiKey, type QueueRow } from "../_shared/pika.ts";

const COINS_PER_CENT = 5; // 500 coins = $1, same constant as start-prediction-fal

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ ...body, timestamp: new Date().toISOString() }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, code: string, message: string, details?: string): Response {
  return jsonResponse({ success: false, error: { code, message, details } }, status);
}

/**
 * Billable seconds for per-second-priced models. Pika 2.5 uses duration_s,
 * the aggregated vendor models (Veo, Wan, MiniMax, Seedance) use duration,
 * and Pikaframes bills transition_duration_s per keyframe transition.
 */
function billableSeconds(parameters: Record<string, unknown>): number {
  for (const key of ["duration_s", "duration"]) {
    const v = Number(parameters[key]);
    if (Number.isFinite(v) && v > 0) return v;
  }
  const transition = Number(parameters.transition_duration_s);
  const images = parameters.images;
  if (Number.isFinite(transition) && transition > 0 && Array.isArray(images) && images.length >= 2) {
    return transition * (images.length - 1);
  }
  return 5;
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => null);
    const model = body?.model;
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    const parameters: Record<string, unknown> = body?.parameters && typeof body.parameters === "object" ? { ...body.parameters } : {};
    const metadata = body?.metadata && typeof body.metadata === "object" ? body.metadata : {};

    if (!model || typeof model !== "string") {
      return errorResponse(400, "VALIDATION_MISSING_REQUIRED_FIELD", "model is required");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse(401, "AUTH_UNAUTHORIZED", "Authentication required", "Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return errorResponse(401, "AUTH_UNAUTHORIZED", "Authentication required", userError?.message);
    console.log(`[${requestId}] user ${user.id} → ${model}`);

    // Model config + pricing straight from the shared tables (service role).
    const [{ data: config, error: configError }, { data: pricing, error: pricingError }] = await Promise.all([
      admin.from("model_configs").select("*").eq("model_id", model).single(),
      admin.from("model_pricing").select("*").eq("model_id", model).single(),
    ]);
    if (configError || !config || pricingError || !pricing) {
      return errorResponse(404, "MODEL_CONFIG_NOT_FOUND", "Configuration not found for model", configError?.message ?? pricingError?.message);
    }
    if (!config.is_active || !pricing.is_active) {
      return errorResponse(409, "MODEL_NOT_ACTIVE", "Model is not currently active");
    }
    if (config.provider !== "pika") {
      return errorResponse(400, "INVALID_PROVIDER", "This endpoint only supports Pika models", `Model provider is: ${config.provider}`);
    }

    // Build the Pika input. The canvas always sends reference images as an
    // array keyed by image_parameter_name; single-image operations take a bare
    // URL string, so unwrap when the config allows at most one reference.
    const input: Record<string, unknown> = { ...(config.default_parameters ?? {}), ...parameters };
    delete input.image_size; // canvas legacy aspect control — not a Pika field
    delete input.num_images;
    const imgParam = config.image_parameter_name as string | null;
    if (imgParam && Array.isArray(input[imgParam]) && (config.max_reference_images ?? 1) <= 1) {
      input[imgParam] = (input[imgParam] as unknown[])[0];
    }
    if (config.requires_reference_images && imgParam && input[imgParam] == null) {
      return errorResponse(400, "VALIDATION_MISSING_REQUIRED_FIELD", "This model needs a reference image", `Missing ${imgParam}`);
    }
    if (prompt && input.prompt === undefined) input.prompt = prompt;
    for (const key of Object.keys(input)) if (input[key] == null) delete input[key];

    // Data-driven price: per-second models multiply out the billable duration.
    const perSecondCents = Number(pricing.price_per_second_cents) || 0;
    const coinsCost = perSecondCents > 0
      ? Math.ceil(perSecondCents * billableSeconds(input) * COINS_PER_CENT)
      : (pricing.coin_cost ?? 0);
    console.log(`[${requestId}] coins: ${coinsCost}`);

    // Queue entry is created as the user, same as start-prediction-fal.
    const { data: queueEntry, error: queueError } = await userClient
      .from("generation_queue")
      .insert({
        user_id: user.id,
        model,
        parameters: { prompt, ...parameters, _meta: { app: "freym", source: metadata?.source ?? "freym-canvas" } },
        status: "pending",
        coins_cost: coinsCost,
      })
      .select()
      .single();
    if (queueError || !queueEntry) {
      return errorResponse(500, "DB_QUERY_FAILED", "Failed to create queue entry", queueError?.message);
    }

    // Reserve coins (skipped only for free models, matching the fal function).
    let reserveTransactionId: string | null = null;
    if (coinsCost > 0) {
      const { data: reserveResult, error: reserveError } = await userClient.rpc("reserve_coins", {
        p_user_id: user.id,
        p_generation_queue_id: queueEntry.id,
        p_amount: coinsCost,
        p_description: `Reserve for ${model} generation (queue: ${queueEntry.id})`,
      });
      if (reserveError) {
        await admin.from("generation_queue")
          .update({ status: "failed", error_message: reserveError.message || "Failed to reserve coins" })
          .eq("id", queueEntry.id);
        if (reserveError.message?.includes("Insufficient coins")) {
          return errorResponse(402, "COINS_INSUFFICIENT_BALANCE", "Insufficient coin balance", reserveError.message);
        }
        return errorResponse(500, "COINS_RESERVATION_FAILED", "Failed to reserve coins", reserveError.message);
      }
      reserveTransactionId = reserveResult as string;
      await admin.from("generation_queue")
        .update({ reserve_transaction_id: reserveTransactionId })
        .eq("id", queueEntry.id);
    }

    const failAndRelease = async (message: string) => {
      await admin.from("generation_queue")
        .update({ status: "failed", error_message: message, coins_refunded: reserveTransactionId != null })
        .eq("id", queueEntry.id);
      if (reserveTransactionId) {
        await admin.rpc("release_reserved_coins", {
          p_reserve_transaction_id: reserveTransactionId,
          p_description: `Release - Pika submit failed: ${message}`,
        });
      }
    };

    // Submit to Pika. model_configs.replicate_version holds the operation path
    // (e.g. "pika/pika-2.5/image-to-video"), same convention fal uses.
    let job: { id?: string; status?: string; error?: { code?: string; message?: string }; message?: string };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      const submitRes = await fetch(`${PIKA_API_BASE}/v1/media/${config.replicate_version}`, {
        method: "POST",
        headers: {
          "X-API-Key": pikaApiKey(),
          "Content-Type": "application/json",
          "Idempotency-Key": queueEntry.id,
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      job = await submitRes.json().catch(() => ({}));

      if (!submitRes.ok || !job.id) {
        const code = job.error?.code ?? "";
        const detail = job.error?.message ?? job.message ?? `HTTP ${submitRes.status}`;
        console.error(`[${requestId}] Pika submit rejected:`, submitRes.status, detail);
        if (code === "insufficient_balance" || code === "cycle_limit_exceeded") {
          // Our Pika account is out of funds — not the user's coins.
          await failAndRelease("Generation service is temporarily unavailable. Your coins were not charged.");
          return errorResponse(503, "PROVIDER_BALANCE_EXHAUSTED", "Generation service temporarily unavailable", detail);
        }
        if (submitRes.status === 429) {
          await failAndRelease("The service is busy right now. Your coins were not charged — please retry.");
          return errorResponse(429, "PROVIDER_RATE_LIMITED", "Service busy, please retry", detail);
        }
        if (submitRes.status === 422) {
          await failAndRelease("Invalid model settings. Your coins were not charged.");
          return errorResponse(422, "VALIDATION_INVALID_INPUT", "Invalid parameters for this model", detail);
        }
        await failAndRelease("Could not start the generation. Your coins were not charged.");
        return errorResponse(502, "PROVIDER_SUBMIT_FAILED", "Failed to start generation", detail);
      }
    } catch (submitErr) {
      const detail = submitErr instanceof Error ? submitErr.message : "submit error";
      await failAndRelease("Could not reach the generation service. Your coins were not charged.");
      return errorResponse(502, "PROVIDER_SUBMIT_FAILED", "Failed to start generation", detail);
    }

    await admin.from("generation_queue")
      .update({ replicate_id: job.id, status: "processing" })
      .eq("id", queueEntry.id);
    console.log(`[${requestId}] submitted: pika job ${job.id} for queue ${queueEntry.id}`);

    // Poll in the background until terminal (or this instance's wall clock ends
    // — then the pika-poll cron sweeper finishes the job).
    const rowSnapshot: QueueRow = {
      id: queueEntry.id,
      user_id: user.id,
      model,
      status: "processing",
      replicate_id: job.id ?? null,
      reserve_transaction_id: reserveTransactionId,
    };
    EdgeRuntime.waitUntil((async () => {
      for (let i = 0; i < 66; i++) { // ~330s of 5s ticks, under the 400s wall limit
        await new Promise((r) => setTimeout(r, 5000));
        try {
          const state = await finalizePikaJob(admin, rowSnapshot, requestId);
          if (state !== "pending") return;
        } catch (pollErr) {
          console.warn(`[${requestId}] background poll error:`, pollErr);
        }
      }
      console.log(`[${requestId}] background poll window ended; cron sweeper takes over`);
    })());

    return jsonResponse({
      success: true,
      data: { job_id: queueEntry.id, status: "processing", coins_reserved: coinsCost },
      requestId,
    });
  } catch (err) {
    console.error(`[${requestId}] unexpected error:`, err);
    return errorResponse(500, "INTERNAL_SERVER_ERROR", "Internal server error", err instanceof Error ? err.message : undefined);
  }
});
