import { supabase, SUPABASE_URL } from "./supabase";
import { patchNodeData } from "../types";

// job id → model node id. Runs are resolved back onto nodes via node-data-update.
const jobToNode = new Map<string, string>();
let channelStarted = false;
let pollTimer: number | null = null;

type QueueRow = {
  id: string;
  status: string;
  result_url: string | null;
  result_urls: string[] | null;
  error_message: string | null;
};

function settle(row: QueueRow) {
  const nodeId = jobToNode.get(row.id);
  if (!nodeId) return;
  if (row.status === "completed") {
    const images = (row.result_urls?.length ? row.result_urls : [row.result_url]).filter(
      Boolean,
    ) as string[];
    jobToNode.delete(row.id);
    patchNodeData(nodeId, { status: "done", images, errorMessage: undefined });
  } else if (row.status === "failed") {
    jobToNode.delete(row.id);
    patchNodeData(nodeId, { status: "error", errorMessage: row.error_message ?? "generation failed" });
  }
  if (jobToNode.size === 0 && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollPending() {
  const ids = [...jobToNode.keys()];
  if (!ids.length) return;
  const { data } = await supabase
    .from("generation_queue")
    .select("id, status, result_url, result_urls, error_message")
    .in("id", ids);
  for (const row of data ?? []) settle(row as QueueRow);
}

async function ensureWatcher() {
  if (!channelStarted) {
    channelStarted = true;
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (uid) {
      supabase
        .channel("gen-queue")
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "generation_queue", filter: `user_id=eq.${uid}` },
          (payload) => settle(payload.new as QueueRow),
        )
        .subscribe();
    }
  }
  if (!pollTimer) pollTimer = window.setInterval(pollPending, 6000);
}

function endpointFor(slug: string): string {
  if (slug.endsWith("-fal") || slug.endsWith("-phota")) return "start-prediction-fal";
  if (slug.endsWith("-cf")) return "start-prediction-cloudflare";
  return "start-prediction";
}

export async function startRun(opts: {
  nodeId: string;
  slug: string;
  prompt: string;
  imageUrls: string[];
  imageParamName: string | null;
  aspect?: string;
  numImages?: number;
}): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("not signed in");

  const parameters: Record<string, unknown> = {};
  if (opts.aspect && opts.aspect !== "default") parameters.image_size = opts.aspect;
  if (opts.numImages && opts.numImages > 1) parameters.num_images = opts.numImages;
  if (opts.imageUrls.length) parameters[opts.imageParamName || "image_urls"] = opts.imageUrls;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/${endpointFor(opts.slug)}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model: opts.slug,
      prompt: opts.prompt,
      parameters,
      metadata: { source: "freym-canvas" },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const code = json?.error?.code ?? res.status;
    const msg = json?.error?.message ?? "request failed";
    throw new Error(`${code}: ${msg}`);
  }
  const jobId: string | undefined = json?.data?.job_id;
  if (!jobId) throw new Error("no job id in response");
  jobToNode.set(jobId, opts.nodeId);
  patchNodeData(opts.nodeId, { status: "running", jobId, errorMessage: undefined });
  await ensureWatcher();
}
