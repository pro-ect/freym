export type CloudModel = {
  slug: string;
  name: string;
  description: string | null;
  category: "image" | "video";
  tags: string[] | null;
  icon_url: string | null;
  coin_cost: number | null;
  provider: "fal" | "magnific" | "replicate" | "cloudflare";
  reference_images_min: number | null;
  reference_images_max: number | null;
  supports_prompt: boolean | null;
  image_parameter_name: string | null;
  is_new: boolean | null;
  is_featured: boolean | null;
};

export type RunStatus = "idle" | "running" | "done" | "error";

export type PromptNodeData = {
  text: string;
};

export type PromptGenNodeData = {
  brief: string;
  count: number; // 1-10 prompts per run
  status: RunStatus;
  errorMessage?: string;
  /** Prompt nodes this generator owns — re-running rewrites them in place. */
  generatedIds: string[];
};

export type ImageNodeData = {
  url: string | null; // public URL in generation-inputs
  fileName?: string;
  uploading?: boolean;
};

export type ModelNodeData = {
  slug: string;
  modelName: string;
  provider: "fal" | "magnific" | "replicate" | "cloudflare";
  costCoins: number | null;
  supportsPrompt: boolean;
  maxRefImages: number;
  imageParamName: string | null;
  status: RunStatus;
  images: string[]; // result URLs
  errorMessage?: string;
  jobId?: string;
  params: { aspect?: string; numImages?: number };
};

export type ProjectRow = {
  id: string;
  name: string;
  nodes: unknown[];
  edges: unknown[];
  updated_at: string;
};

/** nigma-style child→parent channel: nodes dispatch patches, the canvas merges them. */
export function patchNodeData(id: string, data: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent("node-data-update", { detail: { id, data } }));
}
