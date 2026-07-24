/**
 * Hook for photo safety moderation using Gemini 2.5 Flash vision.
 *
 * Single-image variant of useSelfieValidation, used on the Imagine tab to warn
 * the user BEFORE generation that the AI model may flag their uploaded photo
 * (nudity / suggestive content / minors).
 *
 * Fail-open design: any error results in risk_level "allow" (never blocks the user).
 */

import { useState, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { convertImageToBase64 } from '../../lib/replicate/client';

export type RiskLevel = 'allow' | 'review' | 'block';

export interface ModerationResult {
  risk_level: RiskLevel;
  categories: string[];
  confidence: number;
  flagged_regions: string | null;
  context: string;
  reason: string;
}

interface PhotoSafetyCheckReturn {
  checkPhoto: (uri: string) => Promise<ModerationResult>;
  result: ModerationResult | null;
  isChecking: boolean;
  clearResult: () => void;
}

const DEFAULT_ALLOW: ModerationResult = {
  risk_level: 'allow',
  categories: ['SAFE'],
  confidence: 0,
  flagged_regions: null,
  context: 'unknown',
  reason: '',
};

const CHECK_TIMEOUT_MS = 30_000; // 30s max

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[Photo Safety] Timed out after ${ms}ms, using fallback`);
      resolve(fallback);
    }, ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); console.warn('[Photo Safety] Promise rejected:', err); resolve(fallback); },
    );
  });
}

export function usePhotoSafetyCheck(): PhotoSafetyCheckReturn {
  const [result, setResult] = useState<ModerationResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  // Identifies the most recent check so a stale, slow response can't overwrite a newer one.
  const latestUriRef = useRef<string | null>(null);

  const clearResult = useCallback(() => {
    latestUriRef.current = null;
    setResult(null);
    setIsChecking(false);
  }, []);

  const moderateSingleImage = async (uri: string): Promise<ModerationResult> => {
    try {
      console.log(`[Photo Safety] Starting check for: ${uri.substring(0, 60)}...`);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.log('[Photo Safety] No session, defaulting to allow');
        return DEFAULT_ALLOW;
      }

      const base64Image = await convertImageToBase64(uri);
      console.log(`[Photo Safety] Base64 ready, length: ${base64Image.length}`);

      const startTime = Date.now();
      const { data, error } = await supabase.functions.invoke('moderate-photo', {
        body: { image: base64Image },
      });
      console.log(`[Photo Safety] Edge function responded in ${Date.now() - startTime}ms`);

      if (error) {
        console.warn('[Photo Safety] Edge function error, defaulting to allow:', error.message);
        return DEFAULT_ALLOW;
      }

      if (!data || !['allow', 'review', 'block'].includes(data.risk_level)) {
        console.warn('[Photo Safety] Invalid response, defaulting to allow:', JSON.stringify(data));
        return DEFAULT_ALLOW;
      }

      console.log(`[Photo Safety] Result: risk=${data.risk_level}, categories=${JSON.stringify(data.categories)}, reason="${data.reason}"`);
      if (data._raw) console.log(`[Photo Safety] RAW Gemini output: ${data._raw}`);
      if (data._parseError) console.warn(`[Photo Safety] PARSE ERROR: ${data._parseError}`);

      return data as ModerationResult;
    } catch (err: any) {
      console.warn('[Photo Safety] Error, defaulting to allow:', err.message);
      return DEFAULT_ALLOW;
    }
  };

  const checkPhoto = useCallback(async (uri: string): Promise<ModerationResult> => {
    latestUriRef.current = uri;
    setResult(null);
    setIsChecking(true);

    const moderation = await withTimeout(moderateSingleImage(uri), CHECK_TIMEOUT_MS, DEFAULT_ALLOW);

    // Ignore if a newer photo has been picked (or the result was cleared) since.
    if (latestUriRef.current !== uri) {
      console.log('[Photo Safety] Stale result discarded (photo changed)');
      return moderation;
    }

    setResult(moderation);
    setIsChecking(false);
    return moderation;
  }, []);

  return { checkPhoto, result, isChecking, clearResult };
}
