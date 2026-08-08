import { supabase } from "./supabase";
import type { CloudModel } from "../types";

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
  cache = (data ?? []) as CloudModel[];
  return cache;
}

export function groupModels(models: CloudModel[]) {
  const textToImage = models.filter((m) => (m.reference_images_max ?? 0) === 0);
  const imageToImage = models.filter((m) => (m.reference_images_max ?? 0) > 0);
  return { textToImage, imageToImage };
}
