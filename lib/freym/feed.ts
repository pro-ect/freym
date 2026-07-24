/**
 * freym feed — prompts scraped from Threads/X creators by the scraper-run
 * edge function (same Supabase project). Read via the public scraper-feed
 * function, which prefers storage-mirrored image URLs over source CDNs.
 */
import { supabase } from '../supabase';

export interface FreymImage {
  url: string;
  width: number | null;
  height: number | null;
  position: number | null;
}

export interface FreymCreator {
  id: string;
  handle: string;
  full_name: string | null;
  profile_pic_url: string | null;
  follower_count: number | null;
}

export interface FreymFeedItem {
  id: string;
  url: string | null;          // original post URL
  caption: string | null;
  taken_at: string | null;
  like_count: number | null;
  has_prompt: boolean;
  prompt_text: string | null;
  model_name: string | null;
  style_tags: string[] | null;
  creator: FreymCreator | null;
  images: FreymImage[];        // sorted by position; at least one
}

interface RawPost {
  id: string;
  creator_id: string;
  url: string | null;
  caption: string | null;
  taken_at: string | null;
  like_count: number | null;
  has_prompt: boolean | null;
  prompt_text: string | null;
  model_name: string | null;
  style_tags: string[] | null;
  sc_images: FreymImage[] | null;
}

export async function fetchFreymFeed(): Promise<FreymFeedItem[]> {
  const { data, error } = await supabase.functions.invoke('scraper-feed');
  if (error) throw error;

  const creators = new Map<string, FreymCreator>(
    ((data?.creators ?? []) as FreymCreator[]).map((c) => [c.id, c]),
  );

  return ((data?.posts ?? []) as RawPost[])
    .filter((p) => (p.sc_images?.length ?? 0) > 0)
    .map((p) => ({
      id: p.id,
      url: p.url,
      caption: p.caption,
      taken_at: p.taken_at,
      like_count: p.like_count,
      has_prompt: !!p.has_prompt,
      prompt_text: p.prompt_text,
      model_name: p.model_name,
      style_tags: p.style_tags,
      creator: creators.get(p.creator_id) ?? null,
      images: [...(p.sc_images ?? [])].sort(
        (a, b) => (a.position ?? 0) - (b.position ?? 0),
      ),
    }));
}
