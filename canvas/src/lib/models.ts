import { supabase } from "./supabase";
import type { CloudModel } from "../types";

let cache: CloudModel[] | null = null;

export async function fetchModels(): Promise<CloudModel[]> {
  if (cache) return cache;
  const { data, error } = await supabase
    .from("models")
    .select(
      "slug, name, description, category, tags, icon_url, cost_coins, reference_images_min, reference_images_max, supports_prompt, image_parameter_name, is_new, is_featured",
    )
    .eq("is_active", true)
    .eq("category", "image")
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
