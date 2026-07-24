import Constants from 'expo-constants';
import { capturePH } from '../posthog';
import { supabase } from '../supabase';

export type ReportSurface = 'inspire' | 'recipe';

export interface ReportContentInput {
  surface: ReportSurface;
  contentId: string;
  imageUrl?: string | null;
  reasonText: string;
  recipeOwnerUserId?: string | null;
  recipeName?: string | null;
  inspireCreditName?: string | null;
}

export async function reportContent(input: ReportContentInput): Promise<void> {
  let reporterUserId: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    reporterUserId = data.user?.id ?? null;
  } catch {}

  const appVersion =
    (Constants.expoConfig?.version as string | undefined) ?? 'unknown';

  capturePH('content_reported', {
    surface: input.surface,
    content_type: input.surface === 'inspire' ? 'inspire_item' : 'recipe',
    content_id: input.contentId,
    image_url: input.imageUrl ?? null,
    recipe_owner_user_id: input.recipeOwnerUserId ?? null,
    recipe_name: input.recipeName ?? null,
    inspire_credit_name: input.inspireCreditName ?? null,
    reason_text: input.reasonText.trim().slice(0, 500),
    reporter_user_id: reporterUserId,
    app_version: appVersion,
  });
}
