/** One control from a model's `param_schema` (same shape the mobile app renders). */
export type ParamField = {
  type: "select" | "boolean" | "number" | "slider" | "text";
  label?: string;
  description?: string;
  default?: unknown;
  options?: (string | number)[];
  min?: number;
  max?: number;
  step?: number;
  /** Only "hasImages" is used today: hide unless the model takes reference images. */
  showWhen?: string;
};

export type ParamSchema = Record<string, ParamField>;

/** Per-second cents keyed by the model's own resolution values; audio_off_rates
 *  overrides when audio/generate_audio is false. Mirrors model_pricing.rate_table. */
export type RateTable = {
  rates?: Record<string, number>;
  audio_off_rates?: Record<string, number>;
};

export type CloudModel = {
  slug: string;
  name: string;
  description: string | null;
  category: "image" | "video";
  tags: string[] | null;
  icon_url: string | null;
  coin_cost: number | null;
  price_per_second_cents: number | string | null;
  rate_table: RateTable | null;
  provider: "fal" | "magnific" | "replicate" | "cloudflare" | "pika";
  reference_images_min: number | null;
  reference_images_max: number | null;
  supports_prompt: boolean | null;
  image_parameter_name: string | null;
  is_new: boolean | null;
  is_featured: boolean | null;
  param_schema?: ParamSchema | null;
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
  /** "video" nodes play their result instead of showing it as an image. */
  category?: "image" | "video";
  provider: "fal" | "magnific" | "replicate" | "cloudflare" | "pika";
  costCoins: number | null;
  /** Pricing inputs for the live cost estimate; absent on nodes saved earlier. */
  perSecondCents?: number | null;
  rateTable?: RateTable | null;
  supportsPrompt: boolean;
  maxRefImages: number;
  imageParamName: string | null;
  status: RunStatus;
  images: string[]; // result URLs
  errorMessage?: string;
  jobId?: string;
  /**
   * `aspect`/`numImages` are the legacy controls, used for models with no
   * param_schema. `custom` holds schema-driven values keyed by the model's own
   * parameter names and is sent to the provider as-is.
   */
  params: { aspect?: string; numImages?: number; custom?: Record<string, unknown> };
  paramSchema?: ParamSchema | null;
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
