export type CategorySlug =
  | 'trends'
  | 'artistic_effects'
  | 'social_headshots'
  | 'artistic_headshots'
  | 'pinterest_vibe'
  | 'black_and_white'
  | 'pet_and_you';

export interface CategoryDef {
  slug: CategorySlug;
  title: string;
  subtitle: string;
}

// @deprecated — categories now live in Supabase (`recipe_categories`). Kept only for the typed CategorySlug union.
export const CATEGORIES: CategoryDef[] = [
  { slug: 'trends', title: 'Trends', subtitle: 'What everyone is making right now' },
  { slug: 'artistic_effects', title: 'Artistic Effects', subtitle: 'Stylized transforms and overlays' },
  { slug: 'social_headshots', title: 'Headshots for your socials', subtitle: 'Clean, profile-ready' },
  { slug: 'artistic_headshots', title: 'Artistic Headshots', subtitle: 'Editorial, cinematic, moody' },
  { slug: 'pinterest_vibe', title: 'Pinterest vibe', subtitle: 'Y2K, candlelit, street-style' },
  { slug: 'black_and_white', title: 'Black & White Shoots', subtitle: 'Monochrome editorials' },
  { slug: 'pet_and_you', title: 'Your pet & you', subtitle: 'Together at last' },
];

export function getCategoryBySlug(slug: string): CategoryDef | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}
