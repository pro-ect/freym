/**
 * RemoteImage
 *
 * Thin wrapper around expo-image's <Image> that retries failed remote loads
 * a few times with backoff. expo-image on its own does NOT retry a failed
 * download — on a slow/flaky connection an image that fails once stays blank
 * until the component remounts. This wrapper remounts the underlying Image
 * (via a changing `key`) up to MAX_RETRIES times so transient failures recover
 * on their own.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Image, ImageProps } from 'expo-image';

const MAX_RETRIES = 3;
const BACKOFF_MS = [1000, 2000, 4000];

export default function RemoteImage(props: ImageProps) {
  const { onError, ...rest } = props;
  const [attempt, setAttempt] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset the retry counter whenever the source changes (e.g. recycled cell).
  const sourceKey = JSON.stringify(rest.source ?? null);
  useEffect(() => {
    setAttempt(0);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [sourceKey]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <Image
      {...rest}
      key={attempt}
      onError={(e) => {
        onError?.(e);
        if (attempt < MAX_RETRIES) {
          const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
          timerRef.current = setTimeout(() => setAttempt((a) => a + 1), delay);
        }
      }}
    />
  );
}
