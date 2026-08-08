import { supabase } from "./supabase";
import { PARAM_MIRROR } from "./paramMirror";
import type { CloudModel, ParamSchema } from "../types";

/**
 * Controls the catalog advertises that the provider does not accept.
 * Seedream 5 Lite takes `image_size`; it has no `aspect_ratio` or
 * `enhance_prompt_mode`, and because its config carries no image_size default
 * start-prediction-fal never converts the ratio either — so both selects were
 * inert. The mirror supplies the real image_size control in their place.
 */
const DEAD_PARAMS: Record<string, string[]> = {
  "seedream-5-lite-fal": ["aspect_ratio", "enhance_prompt_mode"],
};

let cache: CloudModel[] | null = null;

export async function fetchModels(): Promise<CloudModel[]> {
  if (cache) return cache;
  // canvas_models view = models × active model_configs × active model_pricing,
  // providers limited to ones the start-prediction* functions accept — the
  // guaranteed-runnable catalog, with the true provider for routing.
  const { data, error } = await supabase
    .from("canvas_models")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;

  // param_schema (the model's own controls — creativity, quality, resolution…)
  // isn't on the canvas_models view, so pull it from `models` and merge by slug.
  const { data: schemas } = await supabase.from("models").select("slug, param_schema");
  const bySlug = new Map((schemas ?? []).map((s) => [s.slug, s.param_schema]));

  cache = (data ?? []).map((row) => {
    const m = row as CloudModel;
    const fromCatalog = (bySlug.get(m.slug) ?? {}) as ParamSchema;
    const dead = DEAD_PARAMS[m.slug] ?? [];
    const curated = Object.fromEntries(
      Object.entries(fromCatalog).filter(([key]) => !dead.includes(key)),
    );
    // Catalog first so its curated labels and size lists win, then everything
    // else the provider accepts.
    const merged = { ...curated, ...(PARAM_MIRROR[m.slug] ?? {}) };
    return { ...m, param_schema: Object.keys(merged).length ? merged : null };
  });
  return cache;
}

export function groupModels(models: CloudModel[]) {
  const textToImage = models.filter((m) => (m.reference_images_max ?? 0) === 0);
  const imageToImage = models.filter((m) => (m.reference_images_max ?? 0) > 0);
  return { textToImage, imageToImage };
}
