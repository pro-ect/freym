/**
 * Resolve a Pinterest (or arbitrary) URL into a local image file URI.
 *
 * Fast path: if the URL already points at an image (`i.pinimg.com`, or any
 * URL ending in a common image extension), download it directly.
 *
 * Slow path: hit the `resolve-pinterest-image` edge function. The edge function
 * follows redirects (handles `pin.it` short URLs), fetches the HTML, and
 * extracts the `og:image` meta tag. JWT-protected + admin-only on the server.
 */

import { supabase } from '../supabase';
import { downloadImageToLocal } from '../recipes/imageCompression';

const DIRECT_IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic)(\?.*)?$/i;
const PIN_IMAGE_HOSTS = new Set(['i.pinimg.com', 'pinimg.com']);

function isDirectImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (PIN_IMAGE_HOSTS.has(u.hostname)) return true;
    return DIRECT_IMAGE_EXT.test(u.pathname);
  } catch {
    return false;
  }
}

export class PinterestResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PinterestResolveError';
  }
}

export async function resolvePinterestImage(rawUrl: string): Promise<string> {
  const url = rawUrl.trim();
  if (!url) throw new PinterestResolveError('Please paste a link.');

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PinterestResolveError("That doesn't look like a valid link.");
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PinterestResolveError('Only http(s) links are supported.');
  }

  if (isDirectImageUrl(url)) {
    return downloadImageToLocal(url);
  }

  const { data, error } = await supabase.functions.invoke<{ imageUrl: string }>(
    'resolve-pinterest-image',
    { body: { url } },
  );

  if (error) {
    throw new PinterestResolveError(
      "Couldn't fetch image from that link. Try copying the direct image URL instead.",
    );
  }
  if (!data?.imageUrl) {
    throw new PinterestResolveError(
      "Couldn't find an image at that link. Try pasting the direct image URL.",
    );
  }

  return downloadImageToLocal(data.imageUrl);
}
