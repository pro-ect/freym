/**
 * Hook for selfie quality validation using Gemini 2.5 Flash vision
 *
 * Validates uploaded selfie photos for AI generation quality.
 * Fail-open design: any errors result in a pass (never blocks the user).
 *
 * Three statuses:
 * - "pass": photo is good
 * - "critical": photo is unusable, must be removed
 * - "important": photo has issues, user can keep or change
 */

import { useState, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { convertImageToBase64 } from '../../lib/replicate/client';

export interface ValidationResult {
  status: 'pass' | 'critical' | 'important';
  critical_issues: string[];
  important_issues: string[];
  face_detected: boolean;
  face_count: number;
  summary: string;
}

interface SelfieValidationState {
  validationResults: Map<number, ValidationResult>;
  isValidating: boolean;
  validatingIndices: Set<number>;
}

interface SelfieValidationReturn {
  validateImages: (uris: string[], startIndex: number) => Promise<void>;
  validationResults: Map<number, ValidationResult>;
  isValidating: boolean;
  validatingIndices: Set<number>;
  clearResults: () => void;
  removeResultAtIndex: (index: number, totalCount: number) => void;
  dismissResult: (index: number) => void;
}

const DEFAULT_PASS: ValidationResult = {
  status: 'pass',
  critical_issues: [],
  important_issues: [],
  face_detected: true,
  face_count: 1,
  summary: '',
};

const VALIDATION_TIMEOUT_MS = 30_000; // 30s max per image

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[Selfie Validation] Timed out after ${ms}ms, using fallback`);
      resolve(fallback);
    }, ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); console.warn('[Selfie Validation] Promise rejected:', err); resolve(fallback); },
    );
  });
}

export function useSelfieValidation(): SelfieValidationReturn {
  const [state, setState] = useState<SelfieValidationState>({
    validationResults: new Map(),
    isValidating: false,
    validatingIndices: new Set(),
  });
  const abortRef = useRef(false);

  const clearResults = useCallback(() => {
    abortRef.current = true;
    setState({
      validationResults: new Map(),
      isValidating: false,
      validatingIndices: new Set(),
    });
  }, []);

  const removeResultAtIndex = useCallback((removedIndex: number, totalCount: number) => {
    setState(prev => {
      const newResults = new Map<number, ValidationResult>();
      const newValidating = new Set<number>();

      for (let i = 0; i < totalCount; i++) {
        if (i === removedIndex) continue;
        const newIdx = i < removedIndex ? i : i - 1;
        const result = prev.validationResults.get(i);
        if (result) newResults.set(newIdx, result);
        if (prev.validatingIndices.has(i)) newValidating.add(newIdx);
      }

      return {
        validationResults: newResults,
        isValidating: newValidating.size > 0,
        validatingIndices: newValidating,
      };
    });
  }, []);

  const dismissResult = useCallback((index: number) => {
    setState(prev => {
      const newResults = new Map(prev.validationResults);
      newResults.delete(index);
      return { ...prev, validationResults: newResults };
    });
  }, []);

  const validateSingleImage = async (uri: string, index: number): Promise<ValidationResult> => {
    try {
      console.log(`[Selfie Validation] [${index}] Starting validation for: ${uri.substring(0, 60)}...`);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.log(`[Selfie Validation] [${index}] No session, defaulting to pass`);
        return DEFAULT_PASS;
      }

      console.log(`[Selfie Validation] [${index}] Converting to base64...`);
      const base64Image = await convertImageToBase64(uri);
      console.log(`[Selfie Validation] [${index}] Base64 ready, length: ${base64Image.length}`);

      console.log(`[Selfie Validation] [${index}] Calling edge function...`);
      const startTime = Date.now();
      const { data, error } = await supabase.functions.invoke('validate-selfie', {
        body: { image: base64Image },
      });
      const elapsed = Date.now() - startTime;
      console.log(`[Selfie Validation] [${index}] Edge function responded in ${elapsed}ms`);

      if (error) {
        console.warn(`[Selfie Validation] [${index}] Edge function error, defaulting to pass:`, error.message);
        return DEFAULT_PASS;
      }

      if (!data || !['pass', 'critical', 'important'].includes(data.status)) {
        console.warn(`[Selfie Validation] [${index}] Invalid response, defaulting to pass:`, JSON.stringify(data));
        return DEFAULT_PASS;
      }

      console.log(`[Selfie Validation] [${index}] Result: status=${data.status}, critical=${JSON.stringify(data.critical_issues)}, important=${JSON.stringify(data.important_issues)}, summary="${data.summary}"`);
      if (data.photo_description) {
        console.log(`[Selfie Validation] [${index}] PHOTO DESCRIPTION: ${data.photo_description}`);
      }
      if (data._raw) {
        console.log(`[Selfie Validation] [${index}] RAW Gemini output: ${data._raw}`);
      }
      if (data._parseError) {
        console.warn(`[Selfie Validation] [${index}] PARSE ERROR: ${data._parseError}`);
      }
      if (data._modelFields) {
        console.log(`[Selfie Validation] [${index}] MODEL INPUT FIELDS: ${JSON.stringify(data._modelFields)}`);
      }
      return data as ValidationResult;
    } catch (err: any) {
      console.warn(`[Selfie Validation] [${index}] Error, defaulting to pass:`, err.message);
      return DEFAULT_PASS;
    }
  };

  const validateImages = useCallback(async (uris: string[], startIndex: number) => {
    if (uris.length === 0) return;

    console.log(`[Selfie Validation] Starting validation for ${uris.length} images (startIndex: ${startIndex})`);
    abortRef.current = false;

    // Mark all as validating
    const indices = uris.map((_, i) => startIndex + i);
    setState(prev => ({
      ...prev,
      isValidating: true,
      validatingIndices: new Set([...prev.validatingIndices, ...indices]),
    }));

    // Run validations with per-image timeout and immediate result updates
    const promises = uris.map(async (uri, i) => {
      const index = startIndex + i;
      const result = await withTimeout(
        validateSingleImage(uri, index),
        VALIDATION_TIMEOUT_MS,
        DEFAULT_PASS,
      );

      if (abortRef.current) return;

      // Update state immediately when each image finishes (don't wait for others)
      setState(prev => {
        const newResults = new Map(prev.validationResults);
        const newValidating = new Set(prev.validatingIndices);
        newValidating.delete(index);
        newResults.set(index, result);
        return {
          validationResults: newResults,
          isValidating: newValidating.size > 0,
          validatingIndices: newValidating,
        };
      });

      return result;
    });

    const results = await Promise.allSettled(promises);
    if (abortRef.current) {
      console.log(`[Selfie Validation] Aborted, discarding results`);
      return;
    }

    const settled = results.filter((r) => r.status === 'fulfilled' && r.value) as PromiseFulfilledResult<ValidationResult>[];
    const passed = settled.filter((r) => r.value.status === 'pass').length;
    const critical = settled.filter((r) => r.value.status === 'critical').length;
    const important = settled.filter((r) => r.value.status === 'important').length;
    console.log(`[Selfie Validation] All done: ${passed} passed, ${critical} critical, ${important} important`);
  }, []);

  return {
    validateImages,
    validationResults: state.validationResults,
    isValidating: state.isValidating,
    validatingIndices: state.validatingIndices,
    clearResults,
    removeResultAtIndex,
    dismissResult,
  };
}
