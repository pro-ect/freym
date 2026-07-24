import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Loader } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { LibraryImageStatus } from '../../lib/library/libraryStateManager';
import { getEstimatedSeconds } from '../../lib/generation/modelEstimates';

type Variant = 'card' | 'modal';

interface ProcessingOverlayProps {
  status: LibraryImageStatus;
  createdAt?: number;
  modelId?: string | null;
  /** Per-item ETA override (e.g. Copy Shot v2 high-quality jobs stamp
   *  metadata.etaSeconds = 180). Wins over the per-model estimate. */
  etaSeconds?: number | null;
  /** Actual generation start (metadata.startedAt). When present, the elapsed
   *  counter measures from here instead of createdAt — so a job adopted into
   *  the library mid-flight (e.g. onboarding "skip") keeps counting from when
   *  it really started, not from when the tile appeared. */
  startedAt?: number | null;
  variant?: Variant;
}

function RotatingLoader({ size, color }: { size: number; color: string }) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(withTiming(360, { duration: 1000 }), -1, false);
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Loader size={size} color={color} strokeWidth={2} />
    </Animated.View>
  );
}

function copyForStatus(status: LibraryImageStatus): { title: string; subtitle: string | null } {
  switch (status) {
    case 'uploading':
      return { title: 'Uploading images', subtitle: 'Keep the app open' };
    case 'pending':
    case 'waiting':
      return { title: 'Queued', subtitle: "You can leave — we'll finish in the background" };
    case 'downloading':
    case 'saving':
      return { title: 'Saving to library', subtitle: 'Keep the app open' };
    case 'processing':
    default:
      return { title: 'Generating', subtitle: "You can leave — we'll finish in the background" };
  }
}

export function ProcessingOverlay({
  status,
  createdAt,
  modelId,
  etaSeconds,
  startedAt,
  variant = 'card',
}: ProcessingOverlayProps) {
  const isCard = variant === 'card';
  const opacity = useSharedValue(0.7);
  const [elapsed, setElapsed] = useState(0);
  // Prefer the real generation start; fall back to when the tile was created.
  const startBaseline =
    typeof startedAt === 'number' && startedAt > 0 ? startedAt : createdAt;

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1000 }),
        withTiming(0.5, { duration: 1000 })
      ),
      -1,
      true
    );
  }, []);

  // Tick elapsed seconds while generating. Only the 'processing' phase shows
  // the counter / progress bar — the other phases are short enough that an
  // ETA would be noise.
  useEffect(() => {
    if (status !== 'processing' || !startBaseline) return;
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startBaseline) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status, startBaseline]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const estimate = (typeof etaSeconds === 'number' && etaSeconds > 0)
    ? etaSeconds
    : getEstimatedSeconds(modelId);
  const showCounter = status === 'processing' && !!startBaseline;
  const overEstimate = showCounter && elapsed >= estimate;
  // Cap fake progress at 95% — the bar idles there until completion.
  const fillRatio = showCounter
    ? Math.min(0.95, elapsed / Math.max(estimate, 1))
    : 0;

  const baseCopy = copyForStatus(status);
  const title = overEstimate ? 'Almost done…' : baseCopy.title;
  const subtitle = overEstimate ? null : baseCopy.subtitle;

  return (
    <Animated.View
      style={[
        styles.overlayBase,
        isCard ? styles.overlayCard : styles.overlayModal,
        animatedStyle,
      ]}
    >
      <RotatingLoader size={isCard ? 28 : 48} color="#fff" />

      <Text style={isCard ? styles.titleCard : styles.titleModal} numberOfLines={1}>
        {title}
      </Text>

      {showCounter && !overEstimate && (
        <Text style={isCard ? styles.counterCard : styles.counterModal}>
          {elapsed}s / ~{estimate}s
        </Text>
      )}

      {showCounter && (
        <View style={[styles.barTrack, isCard ? styles.barTrackCard : styles.barTrackModal]}>
          <View style={[styles.barFill, { width: `${Math.round(fillRatio * 100)}%` }]} />
        </View>
      )}

      {subtitle && (
        <Text
          style={isCard ? styles.subtitleCard : styles.subtitleModal}
          numberOfLines={isCard ? 2 : 3}
        >
          {subtitle}
        </Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlayBase: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    gap: 6,
    paddingHorizontal: 8,
  },
  overlayModal: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    gap: 12,
    paddingHorizontal: 32,
  },
  titleCard: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  titleModal: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  counterCard: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  counterModal: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  barTrack: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 999,
    overflow: 'hidden',
  },
  barTrackCard: {
    width: '70%',
    height: 3,
    marginTop: 2,
  },
  barTrackModal: {
    width: '60%',
    height: 4,
    marginTop: 2,
  },
  barFill: {
    height: '100%',
    backgroundColor: '#FFD700',
    borderRadius: 999,
  },
  subtitleCard: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 2,
  },
  subtitleModal: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
});
