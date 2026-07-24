/**
 * Inspire tab — admin-only, hidden by default.
 *
 * Layout follows the recipe page: hero cover at top, bold rounded title,
 * numbered steps for inputs, horizontal Soul row, sticky pill Generate
 * button at the bottom. Two parallel Fal jobs run gpt-image-2 at 2160x3840,
 * each producing a 2x2 grid of slightly different angles/poses. Admin
 * preset (prompt, model, image size, grid size) is editable from a small
 * floating control; persists to Supabase `inspire_presets`.
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Pressable,
  FlatList,
  Modal,
  KeyboardAvoidingView,
  Platform,
  InteractionManager,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons } from '@expo/vector-icons';
import { ArrowRight, ImagePlus, Camera, Plus, X, Settings2, Upload, Zap, Settings as SettingsIcon } from 'lucide-react-native';

import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import * as FileSystemLegacy from 'expo-file-system/legacy';

import { useSettings } from '../../contexts/SettingsContext';
import { useSouls } from '../../contexts/SoulsContext';
import { usePaywall } from '../../contexts/PaywallContext';
import { useAuth } from '../../contexts/AuthModalContext';
import { useBalance } from '../../contexts/BalanceContext';
import GenerationsChip from '../components/GenerationsChip';
import GlassPill from '../components/GlassPill';
import LibrarySettingsModal from '../components/LibrarySettingsModal';
import ScreenWithBlurredTitle from '../components/ScreenWithBlurredTitle';
import ElasticHero from '../components/ElasticHero';
import Animated, { useSharedValue, useAnimatedScrollHandler } from 'react-native-reanimated';
import CreateSoulModal from '../components/CreateSoulModal';
import { useInspireGeneration } from '../hooks/useInspireGeneration';
import { usePhotoSafetyCheck } from '../hooks/usePhotoSafetyCheck';
import {
  resolvePinterestImage,
  PinterestResolveError,
} from '../../lib/inspire/pinterestResolver';
import { fetchInspireFeed, type InspireFeedItem } from '../../lib/inspire/feed';
import {
  getInspirePreset,
  saveInspirePreset,
  saveInspirePresetLocal,
  clearInspirePresetLocal,
  hasLocalOverride,
  DEFAULT_INSPIRE_PRESET,
  type InspirePreset,
} from '../../lib/inspire/preset';
import { ensureAIConsent } from '../../lib/ai/aiConsent';
import { imagineHasRefPhoto } from '../../lib/inspire/refPhotoFlag';
import { getAppConfigString } from '../../lib/remoteConfig';
import { ensureAssetsLocal } from '../../lib/picker/pickWithProcessing';
import { showAlert, showConfirm } from '../../lib/utils/webAlert';

const ROUNDED_FONT = 'SFRounded-Medium';
// Last soul the user selected on this tab — restored on next launch.
const LAST_SOUL_KEY = 'imagine_last_soul_id';
// Persisted photo-count choice. Once the user toggles the switcher we remember
// it and it wins over the remote `copyshot_default_photo_mode` default.
const LAST_PHOTO_MODE_KEY = 'imagine_last_photo_mode';
// Generic share-UI mockup — no third-party brand marks (App Review).
const COVER_PHOTO = require('../../assets/imagine-hero.png');
// Flat total cost per Imagine run, by pipeline_version. Both versions fire
// ONE job per run. Enforced at the edge functions (v1:
// start-prediction-fal-copyshot, 100 when inspireJobCount === 1 — old 2-job
// builds keep 50/job; v2: start-prediction-fal-copyshot-v2, flat 250) via
// metadata.fromImagine.
const TOTAL_COINS_V1 = 100;
const TOTAL_COINS_V2 = 250;
// "1 photo" mode — single 768x1024 high image (same recipe as onboarding),
// flat 100 coins enforced via metadata.copyshotSingle in copyshot-v2.
const TOTAL_COINS_SINGLE = 100;

// Native iOS tab bar height; matches the offset used in app/(tabs)/home.tsx.
const NATIVE_TAB_BAR_HEIGHT = 49;

// Cheap URL sniff for auto-fetch debounce. Server still validates.
const URL_RE = /^https?:\/\/\S+$/i;

export default function InspireTab() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    pinterestUrl?: string;
    clipboardImage?: string;
    referenceImageUrl?: string;
    localImageUri?: string;
    nonce?: string;
    skipSafety?: string; // '1' when the image is a pre-vetted in-app asset (e.g. the Inspire hero cover)
  }>();
  const { isAdmin, showDirectModel } = useSettings();
  // All on-tab admin UI (Edit preset + OpenAI-direct switcher) is gated on
  // this Settings toggle. Off → users and admins see a clean tab.
  const showAdminUI = isAdmin && showDirectModel;
  const { souls, addSoul, updateSoul } = useSouls();
  const { balanceInfo, hasCustomKey } = useBalance();
  const imagineScrollY = useSharedValue(0);
  const imagineScrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => { imagineScrollY.value = e.contentOffset.y; },
  });
  const { showPaywall } = usePaywall();
  const { requireSession } = useAuth();
  const { execute, state: executionState } = useInspireGeneration();
  // Reference-photo safety pre-check (Copy Shot only): when the user adds a new
  // reference photo, moderate it in the background so a "may be flagged" verdict
  // is ready by the time they tap Generate. Fail-open — never blocks.
  const { checkPhoto, result: safetyResult, isChecking: isCheckingPhoto, clearResult: clearSafetyResult } = usePhotoSafetyCheck();

  const [photo1Uri, setPhoto1Uri] = useState<string | null>(null);
  // User-facing photo-count switcher: '1 photo' (single 768x1024 high, 100
  // coins — onboarding recipe) or '4 photos' (v2 grid, 250 coins). The initial
  // default is server-controlled via app_config key `copyshot_default_photo_mode`
  // ("single" | "quad") so we can flip 1-vs-4-gens without a release; the
  // hardcoded fallback below is what ships if the config is missing.
  // The legacy Basic (v1) tier is no longer user-selectable;
  // start-prediction-fal-copyshot keeps serving old prod builds.
  const [photoMode, setPhotoMode] = useState<'single' | 'quad'>('single');
  // Resolve the initial photo mode once on mount. Precedence:
  //   1. the user's own saved choice (they picked it — honor it forever)
  //   2. the remote `copyshot_default_photo_mode` default
  //   3. the hardcoded 'single' fallback above
  // `photoModeTouchedRef` guards against a slow async read clobbering a live
  // toggle the user makes before resolution finishes.
  const photoModeTouchedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await AsyncStorage.getItem(LAST_PHOTO_MODE_KEY).catch(() => null);
      if (cancelled || photoModeTouchedRef.current) return;
      if (saved === 'single' || saved === 'quad') {
        setPhotoMode(saved);
        return;
      }
      const mode = await getAppConfigString(
        'copyshot_default_photo_mode',
        'single',
        ['single', 'quad'],
      ).catch(() => 'single');
      if (cancelled || photoModeTouchedRef.current) return;
      setPhotoMode(mode as 'single' | 'quad');
    })();
    return () => { cancelled = true; };
  }, []);
  const [photoUrl, setPhotoUrl] = useState('');
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [isPickerProcessing, setIsPickerProcessing] = useState(false);
  // Inspire-feed carousel — tap a curated photo to use it as the reference
  // (removes the "I need to go find a photo" dead-end). Curated = trusted, so
  // the safety pre-check is skipped, like the hero-banner reference.
  const [feedItems, setFeedItems] = useState<InspireFeedItem[]>([]);
  // A photo whose safety check we skip — a pre-vetted in-app asset (Inspire hero).
  const trustedUriRef = useRef<string | null>(null);
  // Monotonic token: a slow reference-image download must not overwrite a newer
  // pick (two quick Inspire taps can finish out of order).
  const refImageTokenRef = useRef(0);
  // Local file that is just a downloaded copy of a photo already safety-checked
  // under its remote URL — swapping to it must not re-fire the moderation call.
  const checkedCopyRef = useRef<string | null>(null);

  // Run the safety pre-check whenever a new reference photo is set (any source:
  // picker, paste, Pinterest). Clears the verdict when the photo is removed.
  // Trusted in-app assets (hero cover) skip the check — already vetted.
  useEffect(() => {
    if (photo1Uri && photo1Uri === trustedUriRef.current) {
      clearSafetyResult();
    } else if (photo1Uri && photo1Uri === checkedCopyRef.current) {
      // Downloaded copy of the image we already checked — keep the verdict.
    } else if (photo1Uri) {
      checkPhoto(photo1Uri).catch(() => {});
    } else {
      clearSafetyResult();
    }
  }, [photo1Uri]);

  // Mirror the attached-photo state for the app-level clipboard watcher so a
  // link/image sitting in the buffer never clobbers a photo the user chose.
  useEffect(() => {
    imagineHasRefPhoto.current = !!photo1Uri;
  }, [photo1Uri]);

  const [selectedSoulId, setSelectedSoulId] = useState<string | null>(null);
  const [showCreateSoul, setShowCreateSoul] = useState(false);
  const [editingSoulData, setEditingSoulData] = useState<any>(null);

  const [preset, setPreset] = useState<InspirePreset>(DEFAULT_INSPIRE_PRESET);
  const [draftPreset, setDraftPreset] = useState<InspirePreset>(DEFAULT_INSPIRE_PRESET);
  const [showAdmin, setShowAdmin] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);

  // ── Admin-only (TEMPORARY) OpenAI-direct test switcher ──────────────────
  // Lets admins bypass Fal and hit OpenAI's Images API directly with a chosen
  // moderation level (Fal can't pass `moderation` through). Regular users
  // never see this and always use the Fal path. Remove once testing is done.
  const [adminUseDirect, setAdminUseDirect] = useState(false);
  const [adminModel, setAdminModel] = useState('gpt-image-2');
  const [adminModeration, setAdminModeration] = useState<'auto' | 'low'>('low');
  const [adminQuality, setAdminQuality] = useState('medium');
  // Fal function override: null = follow the preset's pipeline_version,
  // 1 = legacy start-prediction-fal-copyshot (2 jobs · 100), 2 = the v2 fork
  // (1 job · high · 250). Device-local test knob, never persisted.
  const [adminPipeline, setAdminPipeline] = useState<1 | 2 | null>(null);
  const [localOverrideActive, setLocalOverrideActive] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Load preset on mount
  useEffect(() => {
    getInspirePreset()
      .then((p) => {
        setPreset(p);
        setDraftPreset(p);
      })
      .catch(() => {
        setPreset(DEFAULT_INSPIRE_PRESET);
        setDraftPreset(DEFAULT_INSPIRE_PRESET);
      });
    hasLocalOverride().then(setLocalOverrideActive);
  }, []);

  // Auto-select a soul: on first load restore the last one the user picked
  // (if it still exists); afterwards fall back to the first in the row.
  const restoredSoulRef = useRef(false);
  useEffect(() => {
    if (souls.length === 0 || selectedSoulId) return;
    if (restoredSoulRef.current) {
      setSelectedSoulId(souls[0].id);
      return;
    }
    restoredSoulRef.current = true;
    AsyncStorage.getItem(LAST_SOUL_KEY)
      .then((saved) => {
        setSelectedSoulId(saved && souls.some((s) => s.id === saved) ? saved : souls[0].id);
      })
      .catch(() => setSelectedSoulId(souls[0].id));
  }, [souls, selectedSoulId]);

  // Remember the chosen soul across app restarts.
  useEffect(() => {
    if (selectedSoulId) {
      AsyncStorage.setItem(LAST_SOUL_KEY, selectedSoulId).catch(() => {});
    }
  }, [selectedSoulId]);

  // Pre-fill from clipboard payload routed in by useClipboardInspireWatcher.
  // The `nonce` param ensures the effect re-runs even if the user re-pastes
  // the same value during this session.
  //
  // Clipboard payloads (pinterestUrl / clipboardImage) only fill an EMPTY
  // photo slot — a photo the user already attached is never clobbered by
  // whatever happens to sit in the buffer. The watcher gates on this too
  // (imagineHasRefPhoto); the checks here are the belt to its suspenders.
  // Deliberate picks (referenceImageUrl from an Inspire tap, localImageUri
  // from the share extension) DO replace the current photo.
  useEffect(() => {
    if (params.pinterestUrl && !photo1Uri) {
      setPhotoUrl(params.pinterestUrl);
    }
    if (params.clipboardImage && !photo1Uri) {
      (async () => {
        try {
          const data = params.clipboardImage!;
          // expo-clipboard returns either a data: URI or raw base64.
          const base64 = data.startsWith('data:') ? data.split(',')[1] : data;
          const path = `${FileSystemLegacy.cacheDirectory}inspire_paste_${Date.now()}.jpg`;
          await FileSystemLegacy.writeAsStringAsync(path, base64, {
            encoding: FileSystemLegacy.EncodingType.Base64,
          });
          setPhotoUrl('');
          setPhoto1Uri(path);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (err) {
          console.warn('[Inspire] could not write pasted image to cache:', err);
        }
      })();
    }
    if (params.referenceImageUrl) {
      const url = params.referenceImageUrl;
      const token = ++refImageTokenRef.current;
      if (Platform.OS === 'web') {
        (async () => {
          try {
            // No filesystem in the browser — FileSystemLegacy.downloadAsync /
            // cacheDirectory are unavailable, so the old path threw and the
            // photo never attached. Pull the remote image into a same-origin
            // blob: URL (exactly what the web file picker yields) so it flows
            // through the existing upload/optimize path without tainting the
            // canvas.
            const res = await fetch(url);
            const blobUrl = URL.createObjectURL(await res.blob());
            if (refImageTokenRef.current !== token) return; // user picked a newer photo
            if (params.skipSafety === '1') trustedUriRef.current = blobUrl;
            setPhotoUrl('');
            setPhoto1Uri(blobUrl);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch (err) {
            console.warn('[Inspire] could not load referenceImageUrl:', err);
          }
        })();
      } else {
        // Show the remote image immediately — expo-image renders https URIs and
        // has usually already cached it from the Inspire grid. Waiting on
        // downloadAsync here is what made the photo appear seconds late (or
        // seem to never arrive on slow networks). Any previously attached
        // photo is replaced right away.
        if (params.skipSafety === '1') trustedUriRef.current = url;
        setPhotoUrl('');
        setPhoto1Uri(url);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // Then pull it into the cache in the background and swap to the local
        // file so the generation upload path works from disk. Guarded by the
        // token so a slow download can't clobber a newer pick.
        (async () => {
          try {
            const ext = url.split('.').pop()?.split('?')[0] || 'jpg';
            const path = `${FileSystemLegacy.cacheDirectory}inspire_ref_${Date.now()}.${ext}`;
            const dl = await FileSystemLegacy.downloadAsync(url, path);
            if (refImageTokenRef.current !== token) return;
            if (trustedUriRef.current === url) trustedUriRef.current = dl.uri;
            checkedCopyRef.current = dl.uri;
            setPhoto1Uri((cur) => (cur === url ? dl.uri : cur));
          } catch (err) {
            // Keep the remote URL — convertImageToBase64 and the storage
            // uploader both download remote URIs themselves as a fallback.
            console.warn('[Inspire] background download of referenceImageUrl failed:', err);
          }
        })();
      }
    }
    if (params.localImageUri) {
      // A local file routed in from the iOS Share Extension / Android SEND
      // intent (see ShareIntentGate in app/_layout.tsx). Copy it into the cache
      // directory so it has a stable, app-readable file:// URI — the share
      // payload may live in the App Group container, outside our sandbox.
      (async () => {
        try {
          const src = params.localImageUri!;
          const uri = src.startsWith('file://') ? src : `file://${src}`;
          const ext = uri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
          const safeExt = /^(jpe?g|png|webp|heic|gif)$/.test(ext) ? ext : 'jpg';
          const dest = `${FileSystemLegacy.cacheDirectory}inspire_share_${Date.now()}.${safeExt}`;
          await FileSystemLegacy.copyAsync({ from: uri, to: dest });
          setPhotoUrl('');
          setPhoto1Uri(dest);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (err) {
          console.warn('[Inspire] could not load localImageUri:', err);
          // Fall back to using the raw path directly if the copy failed.
          setPhotoUrl('');
          setPhoto1Uri(params.localImageUri!);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.pinterestUrl, params.clipboardImage, params.referenceImageUrl, params.localImageUri, params.nonce]);

  // Auto-fetch when a URL appears in the field (paste or finish-typing).
  // Debounced 500ms so we don't fire mid-typing.
  useEffect(() => {
    if (!photoUrl || isFetchingUrl || photo1Uri) return;
    if (!URL_RE.test(photoUrl.trim())) return;
    const timer = setTimeout(() => {
      handleFetchUrl();
    }, 500);
    return () => clearTimeout(timer);
    // handleFetchUrl is intentionally omitted — it's the freshest closure on
    // each render and including it would re-arm the timer every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoUrl, isFetchingUrl, photo1Uri]);

  const handleFetchUrl = useCallback(async () => {
    if (!photoUrl.trim() || isFetchingUrl) return;
    if (!(await ensureAIConsent())) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsFetchingUrl(true);
    try {
      const localUri = await resolvePinterestImage(photoUrl.trim());
      setPhoto1Uri(localUri);
      setPhotoUrl('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      const message =
        err instanceof PinterestResolveError ? err.message : t('imagine.fetchLinkError');
      showAlert(t('imagine.fetchFailedTitle'), message);
      // Clear the URL so the auto-fetch effect can't refire on the same
      // broken link (it watches isFetchingUrl, which flips false here).
      setPhotoUrl('');
    } finally {
      setIsFetchingUrl(false);
    }
  }, [photoUrl, isFetchingUrl]);

  // Load the Inspire feed once for the reference-photo carousel.
  useEffect(() => {
    let cancelled = false;
    fetchInspireFeed(20)
      .then((items) => { if (!cancelled) setFeedItems(items); })
      .catch((err) => console.warn('[Inspire] carousel feed fetch failed:', err));
    return () => { cancelled = true; };
  }, []);

  // Tap a carousel photo → use it as the reference. Mirrors the
  // referenceImageUrl deep-link path: show the remote URL instantly (expo-image
  // has usually cached it from the carousel), then swap to a local cache file
  // in the background so the generation upload works from disk. Curated feed
  // photos are trusted, so the safety pre-check is skipped.
  const selectReferenceFromFeed = useCallback(async (item: InspireFeedItem) => {
    if (!(await ensureAIConsent())) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const url = item.image_url;
    const token = ++refImageTokenRef.current;
    if (Platform.OS === 'web') {
      try {
        const res = await fetch(url);
        const blobUrl = URL.createObjectURL(await res.blob());
        if (refImageTokenRef.current !== token) return;
        trustedUriRef.current = blobUrl;
        setPhotoUrl('');
        setPhoto1Uri(blobUrl);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (err) {
        console.warn('[Inspire] could not load carousel photo:', err);
      }
      return;
    }
    trustedUriRef.current = url;
    setPhotoUrl('');
    setPhoto1Uri(url);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      const ext = url.split('.').pop()?.split('?')[0] || 'jpg';
      const path = `${FileSystemLegacy.cacheDirectory}inspire_ref_${Date.now()}.${ext}`;
      const dl = await FileSystemLegacy.downloadAsync(url, path);
      if (refImageTokenRef.current !== token) return;
      if (trustedUriRef.current === url) trustedUriRef.current = dl.uri;
      checkedCopyRef.current = dl.uri;
      setPhoto1Uri((cur) => (cur === url ? dl.uri : cur));
    } catch (err) {
      console.warn('[Inspire] background download of carousel photo failed:', err);
    }
  }, []);

  const pickFromLibrary = useCallback(async () => {
    if (!(await ensureAIConsent())) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showAlert(t('imagine.permissionRequiredTitle'), t('imagine.photoLibraryPermissionMessage'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setIsPickerProcessing(true);
      try {
        await ensureAssetsLocal([uri]);
      } finally {
        setIsPickerProcessing(false);
      }
      setPhoto1Uri(uri);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  const takeWithCamera = useCallback(async () => {
    if (!(await ensureAIConsent())) return;
    // No quick-camera flow in the browser — the file input can still offer
    // the device camera on mobile web.
    if (Platform.OS === 'web') {
      await pickFromLibrary();
      return;
    }
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      showAlert(t('imagine.permissionRequiredTitle'), t('imagine.cameraPermissionMessage'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setIsPickerProcessing(true);
      try {
        await ensureAssetsLocal([uri]);
      } finally {
        setIsPickerProcessing(false);
      }
      setPhoto1Uri(uri);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    // Immediate tactile feedback so the tap feels acknowledged, before any
    // async work (auth check, RPC, paywall) gets a chance to delay.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    requireSession();
    if (!photo1Uri) {
      showAlert(t('imagine.pickPhotoTitle'), t('imagine.pickPhotoMessage'));
      return;
    }
    if (!selectedSoulId) {
      showAlert(t('imagine.pickSoulTitle'), t('imagine.pickSoulMessage'));
      return;
    }

    // Belt-check: every picker path already gates on this, but a stale
    // selection (e.g. recipe deep-link) could populate photo1Uri without
    // having shown the consent prompt. Cheap if already accepted.
    if (!(await ensureAIConsent())) return;

    // Coin precheck — BYOK users skip. The edge function still does the
    // authoritative deduction against `model_pricing`; this is just a fast
    // client-side bounce to the paywall when the user has 0 coins.
    if (!balanceInfo.hasFalKey && !balanceInfo.hasReplicateKey && balanceInfo.rawValue <= 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      showPaywall('insufficient_coins');
      return;
    }

    // Snapshot inputs so the deferred call doesn't see a stale closure if state
    // changes between tap and the post-interaction tick.
    const photo = photo1Uri;
    const soul = selectedSoulId;

    const runEnqueue = () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Mirror the recipe flow (app/recipe/[id].tsx:308) — defer the heavy enqueue
      // work (preset fetch + image uploads × 2 jobs) until after the Alert renders.
      // execute() owns its own error Alert, so a failed enqueue still surfaces.
      InteractionManager.runAfterInteractions(() => {
        execute({
          photo1Uri: photo,
          soulId: soul,
          // Photo-count choice from the on-tab switcher ('4 photos' default).
          // Both run the v2 pipeline; single mode branches inside execute().
          // The admin Function override wins over single mode.
          pipelineVersion: 2,
          singlePhoto: photoMode === 'single' && !(showAdminUI && adminPipeline),
          // Admin-only OpenAI-direct overrides; undefined unless the admin
          // switcher is actually shown (Settings → Show direct model).
          admin: showAdminUI
            ? {
                useOpenAiDirect: adminUseDirect,
                openaiModel: adminModel,
                moderation: adminModeration,
                quality: adminQuality,
                pipelineVersion: adminPipeline ?? undefined,
              }
            : undefined,
        });
      });
      showConfirm(
        t('imagine.generationStartedTitle'),
        t('imagine.generationStartedMessage'),
        { confirmText: t('imagine.goToLibrary'), cancelText: t('imagine.stay') },
      ).then((go) => {
        if (go) router.push('/(tabs)/library');
      });
    };

    // The reference-photo risk is shown inline under the photo the moment it's
    // added (same as selfie checks), so generation isn't gated here — if the photo
    // gets rejected the user already saw the warning and gets a friendly error.
    runEnqueue();
  }, [requireSession, photo1Uri, selectedSoulId, balanceInfo, showPaywall, execute, showAdminUI, adminUseDirect, adminModel, adminModeration, adminQuality, adminPipeline, photoMode]);

  const handleSavePresetRemote = useCallback(async () => {
    setSavingPreset(true);
    try {
      await saveInspirePreset(draftPreset);
      setPreset(draftPreset);
      setLocalOverrideActive(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved to Supabase', 'Applies to all users on their next generation.');
      setShowAdmin(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('Save to Supabase failed', message);
    } finally {
      setSavingPreset(false);
    }
  }, [draftPreset]);

  const handleSavePresetLocal = useCallback(async () => {
    setSavingPreset(true);
    try {
      await saveInspirePresetLocal(draftPreset);
      setPreset(draftPreset);
      setLocalOverrideActive(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved on this device', 'Your local override is now used for generations on this device until you load from Supabase.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('Save local failed', message);
    } finally {
      setSavingPreset(false);
    }
  }, [draftPreset]);

  const handleLoadFromSupabase = useCallback(async () => {
    setSavingPreset(true);
    try {
      await clearInspirePresetLocal();
      const fresh = await getInspirePreset({ forceRefresh: true, skipLocalOverride: true });
      setPreset(fresh);
      setDraftPreset(fresh);
      setLocalOverrideActive(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('Load failed', message);
    } finally {
      setSavingPreset(false);
    }
  }, []);

  const selectedSoul = souls.find((s) => s.id === selectedSoulId);
  const canGenerate = !!photo1Uri && !!selectedSoulId && !executionState.isExecuting;
  // Flat coin cost for an Imagine run — enforced server-side via
  // metadata.fromImagine (grid) / metadata.copyshotSingle (1 photo). Keep in
  // sync with the TOTAL_COINS_* constants and the edge function overrides.
  // The admin Function switch (Fal v1/v2) overrides the user's on-tab choice.
  const isSingleMode = photoMode === 'single' && !(showAdminUI && adminPipeline);
  const generationCost = isSingleMode
    ? TOTAL_COINS_SINGLE
    : (showAdminUI && adminPipeline === 1)
      ? TOTAL_COINS_V1
      : TOTAL_COINS_V2;
  // Photos delivered per Generate press.
  const photoCount = isSingleMode ? 1 : 4;
  const buttonLabel = executionState.isExecuting
    ? t('imagine.starting')
    : !photo1Uri
    ? t('imagine.pickPhotoToContinue')
    : !selectedSoulId
    ? t('imagine.chooseSoulToApply')
    : photoCount === 1
    ? t('imagine.generateSinglePhoto')
    : t('imagine.generatePhotos', { count: photoCount });

  return (
    <>
    <ScreenWithBlurredTitle
      title=""
      rightControls={
        <>
          <GenerationsChip onPress={() => showPaywall('chip_tap')} />
          <GlassPill square onPress={() => setShowSettings(true)}>
            <SettingsIcon size={18} color="#fff" />
          </GlassPill>
        </>
      }
    >
    {(headerHeight) => (
      <>
      <Animated.ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        onScroll={imagineScrollHandler}
        scrollEventThrottle={16}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: headerHeight, paddingBottom: insets.bottom + NATIVE_TAB_BAR_HEIGHT + 100 },
        ]}
      >
        <View style={styles.coverWrap}>
          <ElasticHero
            source={COVER_PHOTO}
            scrollY={imagineScrollY}
            size={182}
          />
        </View>

        {/* Title — centered */}
        <Text style={styles.title}>{t('imagine.title')}</Text>

        {/* Photo-count switcher under the title — default (1 vs 4 photos) is
            server-controlled via app_config `copyshot_default_photo_mode`. */}
        <View style={styles.pipeSwitcher}>
          {([
            { mode: 'single' as const, label: t('imagine.modeSingle') },
            { mode: 'quad' as const, label: t('imagine.modeQuad') },
          ]).map((opt) => {
            const active = photoMode === opt.mode;
            return (
              <TouchableOpacity
                key={opt.mode}
                style={[styles.pipeSegment, active && styles.pipeSegmentActive]}
                onPress={() => {
                  Haptics.selectionAsync();
                  photoModeTouchedRef.current = true;
                  setPhotoMode(opt.mode);
                  AsyncStorage.setItem(LAST_PHOTO_MODE_KEY, opt.mode).catch(() => {});
                }}
              >
                <Text style={[styles.pipeSegmentText, active && styles.pipeSegmentTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Admin: floating settings icon — gated on the "Show direct model"
            Settings toggle so the tab stays clean when it's off. */}
        {showAdminUI && (
          <TouchableOpacity
            style={styles.adminFab}
            onPress={() => {
              setDraftPreset(preset);
              setShowAdmin(true);
            }}
            hitSlop={10}
          >
            <Settings2 size={16} color="#FF2D95" />
            <Text style={styles.adminFabText}>Edit preset</Text>
          </TouchableOpacity>
        )}

        {/* Admin: TEMPORARY OpenAI-direct test switcher. Hidden from users
            and gated behind the "Show direct model" Settings toggle. */}
        {showAdminUI && (
          <View style={styles.adminSwitcher}>
            <View style={styles.adminSwitcherRow}>
              <Text style={styles.adminSwitcherLabel}>Provider</Text>
              <View style={styles.segmented}>
                {(['Fal', 'Direct'] as const).map((opt) => {
                  const active = (opt === 'Direct') === adminUseDirect;
                  return (
                    <TouchableOpacity
                      key={opt}
                      style={[styles.segment, active && styles.segmentActive]}
                      onPress={() => setAdminUseDirect(opt === 'Direct')}
                    >
                      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {!adminUseDirect && (
              <View style={styles.adminSwitcherRow}>
                <Text style={styles.adminSwitcherLabel}>Function</Text>
                <View style={styles.segmented}>
                  {([
                    { value: 1, label: 'v1 · 100' },
                    { value: 2, label: 'v2 · 250 high' },
                  ] as const).map((opt) => {
                    const active = (adminPipeline ?? preset.pipeline_version) === opt.value;
                    return (
                      <TouchableOpacity
                        key={opt.value}
                        style={[styles.segment, active && styles.segmentActive]}
                        onPress={() => setAdminPipeline(opt.value)}
                      >
                        <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {adminUseDirect && (
              <>
                <View style={styles.adminSwitcherRow}>
                  <Text style={styles.adminSwitcherLabel}>Model</Text>
                  <View style={styles.segmented}>
                    {(['gpt-image-2', 'gpt-image-2-2026-04-21'] as const).map((opt) => {
                      const active = adminModel === opt;
                      return (
                        <TouchableOpacity
                          key={opt}
                          style={[styles.segment, active && styles.segmentActive]}
                          onPress={() => setAdminModel(opt)}
                        >
                          <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>
                            {opt === 'gpt-image-2' ? 'gpt-image-2' : 'dated'}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.adminSwitcherRow}>
                  <Text style={styles.adminSwitcherLabel}>Moderation</Text>
                  <View style={styles.segmented}>
                    {(['auto', 'low'] as const).map((opt) => {
                      const active = adminModeration === opt;
                      return (
                        <TouchableOpacity
                          key={opt}
                          style={[styles.segment, active && styles.segmentActive]}
                          onPress={() => setAdminModeration(opt)}
                        >
                          <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.adminSwitcherRow}>
                  <Text style={styles.adminSwitcherLabel}>Quality</Text>
                  <View style={styles.segmented}>
                    {(['low', 'medium', 'high'] as const).map((opt) => {
                      const active = adminQuality === opt;
                      return (
                        <TouchableOpacity
                          key={opt}
                          style={[styles.segment, active && styles.segmentActive]}
                          onPress={() => setAdminQuality(opt)}
                        >
                          <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </>
            )}
          </View>
        )}

        {/* Step 1 */}
        <View style={styles.step}>
          <View style={styles.stepHeader}>
            <View style={styles.stepNumberCircle}>
              <Text style={styles.stepNumberCircleText}>1</Text>
            </View>
            <Text style={styles.stepTitle}>{t('imagine.step1Title', { brand: 'Copy Shot' })}</Text>
          </View>

          {photo1Uri ? (
            <>
              <View style={styles.previewRow}>
                <View style={styles.previewWrap}>
                  <Image source={{ uri: photo1Uri }} style={styles.preview} contentFit="cover" />
                  <TouchableOpacity
                    style={styles.removeBtn}
                    onPress={() => setPhoto1Uri(null)}
                    hitSlop={8}
                  >
                    <X size={14} color="#fff" />
                  </TouchableOpacity>
                  {/* Checking loader sits right on the photo (same as selfie checks) */}
                  {isCheckingPhoto && (
                    <View style={styles.photoCheckingOverlay}>
                      <ActivityIndicator size="small" color="#fff" />
                      <Text style={styles.photoCheckingText}>{t('imagine.checking')}</Text>
                    </View>
                  )}
                </View>

                {/* Safety verdict — one short sentence in the empty space right of the photo. */}
                {!isCheckingPhoto && safetyResult ? (
                  <View style={styles.safetyVerdict}>
                    <View
                      style={[
                        styles.safetyVerdictDot,
                        {
                          backgroundColor:
                            safetyResult.risk_level === 'block'
                              ? '#f87171'
                              : safetyResult.risk_level === 'review'
                                ? '#fbbf24'
                                : '#4ade80',
                        },
                      ]}
                    />
                    <Text style={styles.safetyVerdictTitle}>
                      {safetyResult.risk_level === 'block'
                        ? t('imagine.safetyVerdictBlock')
                        : safetyResult.risk_level === 'review'
                          ? t('imagine.safetyVerdictReview')
                          : t('imagine.safetyVerdictSafe')}
                    </Text>
                  </View>
                ) : null}
              </View>
            </>
          ) : isPickerProcessing ? (
            <View style={styles.processingTile}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.processingTileText}>{t('imagine.processing')}</Text>
            </View>
          ) : (
            <>
              {/* One line: paste-link input + gallery button */}
              <View style={styles.pickRow}>
                <View style={styles.urlPill}>
                  <TextInput
                    style={styles.urlInput}
                    placeholder={t('imagine.urlPlaceholder')}
                    placeholderTextColor="#666"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    value={photoUrl}
                    onChangeText={setPhotoUrl}
                    editable={!isFetchingUrl}
                    onSubmitEditing={handleFetchUrl}
                    returnKeyType="go"
                  />
                  {photoUrl.trim() ? (
                    <TouchableOpacity
                      style={styles.urlIconBtn}
                      onPress={handleFetchUrl}
                      disabled={isFetchingUrl}
                    >
                      {isFetchingUrl ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <ArrowRight size={16} color="#fff" />
                      )}
                    </TouchableOpacity>
                  ) : null}
                </View>
                <Pressable
                  style={styles.pickBtn}
                  onPress={pickFromLibrary}
                  onLongPress={takeWithCamera}
                >
                  <ImagePlus size={18} color="#fff" />
                  <Text style={styles.pickBtnText}>{t('imagine.addPhoto')}</Text>
                </Pressable>
              </View>

              {/* Trending-photos carousel — tap to start right away */}
              {feedItems.length > 0 && (
                <>
                  <Text style={styles.carouselCaption}>{t('imagine.orTrending')}</Text>
                  <FlatList
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    data={feedItems}
                    keyExtractor={(it) => it.id}
                    contentContainerStyle={styles.carouselContent}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={styles.feedThumb}
                        activeOpacity={0.85}
                        onPress={() => selectReferenceFromFeed(item)}
                      >
                        <Image
                          source={{ uri: item.thumbnail_url ?? item.image_url }}
                          style={styles.feedThumbImg}
                          contentFit="cover"
                          transition={120}
                        />
                      </TouchableOpacity>
                    )}
                  />
                </>
              )}
            </>
          )}
        </View>

        {/* Step 2 */}
        <View style={styles.step}>
          <View style={styles.stepHeader}>
            <View style={styles.stepNumberCircle}>
              <Text style={styles.stepNumberCircleText}>2</Text>
            </View>
            <Text style={styles.stepTitle}>{t('imagine.step2Title')}</Text>
          </View>

          {souls.length === 0 ? (
            <TouchableOpacity
              style={styles.createSoulInline}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowCreateSoul(true);
              }}
            >
              <Plus size={20} color="#000" />
              <Text style={styles.createSoulInlineText}>{t('imagine.createFirstSoul')}</Text>
            </TouchableOpacity>
          ) : (
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={[...([...souls].reverse()), { id: '__add__' } as any]}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.soulList}
              renderItem={({ item }) => {
                if (item.id === '__add__') {
                  return (
                    <TouchableOpacity
                      style={styles.soulCard}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setShowCreateSoul(true);
                      }}
                    >
                      <View style={styles.addSoulButton}>
                        <Plus size={24} color="#666" />
                      </View>
                      <Text style={styles.soulName}>{t('imagine.add')}</Text>
                    </TouchableOpacity>
                  );
                }
                const isSelected = selectedSoulId === item.id;
                return (
                  <TouchableOpacity
                    style={styles.soulCard}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSelectedSoulId(isSelected ? null : item.id);
                    }}
                    onLongPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      setEditingSoulData(item);
                      setShowCreateSoul(true);
                    }}
                  >
                    {item.imageUris?.length > 0 ? (
                      <Image
                        source={{ uri: item.imageUris[0] }}
                        style={[styles.soulImage, isSelected && styles.soulImageSelected]}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={[styles.soulImage, styles.soulImagePlaceholder, isSelected && styles.soulImageSelected]}>
                        <MaterialIcons name="person" size={24} color="#666" />
                      </View>
                    )}
                    <Text style={[styles.soulName, isSelected && styles.soulNameSelected]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {isSelected && (
                      <View style={styles.soulCheckmark}>
                        <MaterialIcons name="check-circle" size={16} color="#FF2D95" />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>

      </Animated.ScrollView>

      {/* Sticky Generate area — black fade masks content behind the button.
          The button sits flush above the native tab bar (insets.bottom + 49). */}
      <View
        pointerEvents="box-none"
        style={[
          styles.footerWrap,
          { bottom: insets.bottom + NATIVE_TAB_BAR_HEIGHT },
        ]}
      >
        <LinearGradient
          colors={['rgba(0,0,0,0)', '#000']}
          locations={[0, 0.6]}
          style={styles.footerFade}
          pointerEvents="none"
        />
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.generateButton, !canGenerate && styles.generateButtonDisabled]}
            onPress={handleGenerate}
            disabled={!canGenerate}
            activeOpacity={0.85}
          >
            <Text
              style={[
                styles.generateButtonText,
                !canGenerate && styles.generateButtonTextDisabled,
              ]}
            >
              {buttonLabel}
            </Text>
            {!hasCustomKey && canGenerate && generationCost > 0 && (
              <View style={styles.generateCostInline}>
                <Zap size={15} color="#FF2D95" strokeWidth={2.5} fill="#FF2D95" />
                <Text style={styles.generateCostText}>{generationCost}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Soul create/edit modal */}
      <CreateSoulModal
        visible={showCreateSoul}
        onClose={() => {
          setShowCreateSoul(false);
          setEditingSoulData(null);
        }}
        editingSoul={editingSoulData}
        onSave={async (name, imageUris) => {
          if (editingSoulData) {
            await updateSoul(editingSoulData.id, { name, imageUris });
            setEditingSoulData(null);
            return editingSoulData.id;
          }
          const soulId = await addSoul({ name, imageUris });
          setSelectedSoulId(soulId);
          return soulId;
        }}
      />

      {/* Admin preset editor modal */}
      <Modal
        visible={showAdmin}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAdmin(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.adminModalBackdrop}
        >
          <Pressable style={styles.adminModalBackdropPress} onPress={() => setShowAdmin(false)} />
          <View style={styles.adminSheet}>
            <View style={styles.adminSheetHeader}>
              <Text style={styles.adminSheetTitle}>Edit preset</Text>
              <View style={styles.adminHeaderRight}>
                {localOverrideActive && (
                  <View style={styles.localPill}>
                    <Text style={styles.localPillText}>Local override</Text>
                  </View>
                )}
                <TouchableOpacity onPress={() => setShowAdmin(false)} hitSlop={10}>
                  <X size={20} color="#999" />
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.adminHelpText}>
              {localOverrideActive
                ? 'Local override active — only this device uses this preset. Load from Supabase to drop it.'
                : 'Save locally to test on this device, or save to Supabase to publish to all users.'}
            </Text>
            <ScrollView style={styles.adminScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.adminLabel}>Prompt</Text>
              <TextInput
                style={styles.promptInput}
                value={draftPreset.prompt}
                onChangeText={(t) => setDraftPreset({ ...draftPreset, prompt: t })}
                multiline
                placeholderTextColor="#666"
              />

              <Text style={styles.adminLabel}>2×2 addendum (appended only when grid is 2×2)</Text>
              <TextInput
                style={styles.promptInput}
                value={draftPreset.grid_addendum}
                onChangeText={(t) => setDraftPreset({ ...draftPreset, grid_addendum: t })}
                multiline
                placeholderTextColor="#666"
              />

              <Text style={styles.adminLabel}>Model ID</Text>
              <TextInput
                style={styles.smallInput}
                value={draftPreset.model_id}
                onChangeText={(t) => setDraftPreset({ ...draftPreset, model_id: t })}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.adminLabel}>Image size (WxH)</Text>
              <TextInput
                style={styles.smallInput}
                value={draftPreset.image_size}
                onChangeText={(t) => setDraftPreset({ ...draftPreset, image_size: t })}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.adminLabel}>Mode</Text>
              <View style={styles.gridSizeRow}>
                {([
                  { value: 1, label: 'Regular' },
                  { value: 2, label: '2×2' },
                ] as const).map((opt) => (
                  <Pressable
                    key={opt.value}
                    style={[styles.gridChip, draftPreset.grid_size === opt.value && styles.gridChipActive]}
                    onPress={() => setDraftPreset({ ...draftPreset, grid_size: opt.value })}
                  >
                    <Text style={[styles.gridChipText, draftPreset.grid_size === opt.value && styles.gridChipTextActive]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.adminLabel}>Pipeline</Text>
              <View style={styles.gridSizeRow}>
                {([
                  { value: 1, label: 'v1 · 2 jobs · 100' },
                  { value: 2, label: 'v2 · 1 job · high · 250' },
                ] as const).map((opt) => (
                  <Pressable
                    key={opt.value}
                    style={[styles.gridChip, draftPreset.pipeline_version === opt.value && styles.gridChipActive]}
                    onPress={() => setDraftPreset({ ...draftPreset, pipeline_version: opt.value })}
                  >
                    <Text style={[styles.gridChipText, draftPreset.pipeline_version === opt.value && styles.gridChipTextActive]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <View style={styles.adminButtonRow}>
              <TouchableOpacity
                style={[styles.adminBtnSecondary, savingPreset && styles.adminSaveBtnDisabled]}
                onPress={handleSavePresetLocal}
                disabled={savingPreset}
              >
                <Text style={styles.adminBtnSecondaryText}>Save locally</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.adminBtnSecondary, savingPreset && styles.adminSaveBtnDisabled]}
                onPress={handleLoadFromSupabase}
                disabled={savingPreset}
              >
                <Text style={styles.adminBtnSecondaryText}>Load from Supabase</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.adminSaveBtn, savingPreset && styles.adminSaveBtnDisabled]}
              onPress={handleSavePresetRemote}
              disabled={savingPreset}
            >
              {savingPreset ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Text style={styles.adminSaveBtnText}>Save to Supabase</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      </>
    )}
    </ScreenWithBlurredTitle>
    <LibrarySettingsModal
      visible={showSettings}
      onClose={() => setShowSettings(false)}
    />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 0,
    paddingBottom: 20,
  },
  topChipRow: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 10,
    flexDirection: 'row',
  },

  // Cover — tilted horizontal photo card with upload bubble
  coverWrap: {
    alignItems: 'center',
    height: 182,
    marginTop: -48,
    marginBottom: -17,
  },
  // Title — matches Inspire .lead style
  title: {
    color: '#fff',
    fontFamily: 'SFRounded-Medium',
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.5,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  pipeSwitcher: {
    flexDirection: 'row',
    alignSelf: 'center',
    gap: 4,
    padding: 4,
    borderRadius: 999,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginTop: 2,
    marginBottom: 24,
  },
  pipeSegment: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  pipeSegmentActive: {
    backgroundColor: '#FF2D95',
  },
  pipeSegmentText: {
    fontFamily: ROUNDED_FONT,
    fontSize: 13,
    color: 'rgba(255,255,255,0.65)',
  },
  pipeSegmentTextActive: {
    color: '#fff',
    fontWeight: '600',
  },

  // Admin floating button (subtle)
  adminFab: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.3)',
    backgroundColor: 'rgba(255,215,0,0.05)',
    marginBottom: 28,
  },
  adminFabText: {
    fontFamily: ROUNDED_FONT,
    fontSize: 12,
    color: '#FF2D95',
  },

  // Admin OpenAI-direct switcher (temporary)
  adminSwitcher: {
    alignSelf: 'center',
    width: '88%',
    gap: 8,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,45,149,0.25)',
    backgroundColor: 'rgba(255,45,149,0.05)',
    marginBottom: 28,
  },
  adminSwitcherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  adminSwitcherLabel: {
    fontFamily: ROUNDED_FONT,
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    width: 78,
  },
  segmented: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
    padding: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 8,
  },
  segmentActive: {
    backgroundColor: '#FF2D95',
  },
  segmentText: {
    fontFamily: ROUNDED_FONT,
    fontSize: 11,
    color: 'rgba(255,255,255,0.65)',
  },
  segmentTextActive: {
    color: '#fff',
  },

  // Step
  step: {
    paddingHorizontal: 20,
    marginBottom: 28,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  stepNumberCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberCircleText: {
    fontFamily: ROUNDED_FONT,
    fontSize: 16,
    fontWeight: '500',
    color: '#fff',
  },
  stepNumberPlain: {
    fontFamily: ROUNDED_FONT,
    fontSize: 22,
    fontWeight: '500',
    color: '#fff',
    width: 32,
    textAlign: 'center',
  },
  stepTitle: {
    flex: 1,
    fontFamily: ROUNDED_FONT,
    fontSize: 18,
    fontWeight: '500',
    color: '#fff',
    lineHeight: 22,
    letterSpacing: -0.2,
  },

  // One-line pick row: link input pill + gallery button
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 56,
    paddingHorizontal: 18,
    borderRadius: 28,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  pickBtnText: {
    fontFamily: ROUNDED_FONT,
    fontSize: 15,
    color: '#fff',
  },
  // URL pill
  urlPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 999,
    borderCurve: 'continuous',
    paddingLeft: 20,
    paddingRight: 6,
    height: 56,
  },
  // Trending carousel
  carouselCaption: {
    fontFamily: ROUNDED_FONT,
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 16,
    marginBottom: 10,
    marginLeft: 4,
  },
  carouselContent: {
    gap: 8,
    paddingRight: 4,
  },
  feedThumb: {
    width: 94,
    height: 126,
    borderRadius: 16,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  feedThumbImg: {
    width: '100%',
    height: '100%',
  },
  urlInput: {
    flex: 1,
    fontFamily: ROUNDED_FONT,
    fontSize: 16,
    color: '#fff',
  },
  urlIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  urlIconBtnDisabled: {
    opacity: 0.4,
  },

  // Pick pill
  pickPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 999,
    borderCurve: 'continuous',
    paddingLeft: 20,
    paddingRight: 6,
    height: 56,
  },
  pickPillText: {
    fontFamily: ROUNDED_FONT,
    fontSize: 16,
    color: '#fff',
    opacity: 0.85,
  },
  pickPillIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Preview (after photo picked)
  previewRow: {
    flexDirection: 'row',
  },
  safetyVerdict: {
    flex: 1,
    marginLeft: 16,
    marginRight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  safetyVerdictDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 1,
  },
  safetyVerdictTitle: {
    fontFamily: ROUNDED_FONT,
    fontSize: 14,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.9)',
    flexShrink: 1,
  },
  photoCheckingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 120,
    height: 160,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  photoCheckingText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  previewWrap: {
    position: 'relative',
  },
  preview: {
    width: 120,
    height: 160,
    borderRadius: 16,
    backgroundColor: '#1a1a1a',
  },
  removeBtn: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  processingTile: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 16,
    padding: 24,
  },
  processingTileText: {
    fontFamily: ROUNDED_FONT,
    color: '#fff',
    fontSize: 14,
  },

  // Soul list
  soulList: {
    gap: 12,
    paddingRight: 20,
  },
  soulCard: {
    alignItems: 'center',
    width: 72,
    position: 'relative',
  },
  soulImage: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#222',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  soulImageSelected: {
    borderColor: '#FF2D95',
  },
  soulImagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  soulName: {
    fontFamily: ROUNDED_FONT,
    fontSize: 12,
    color: '#999',
    marginTop: 6,
    textAlign: 'center',
  },
  soulNameSelected: {
    color: '#FF2D95',
  },
  soulCheckmark: {
    position: 'absolute',
    top: 0,
    right: 4,
    backgroundColor: '#000',
    borderRadius: 10,
  },
  addSoulButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },

  createSoulInline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 999,
    borderCurve: 'continuous',
    paddingVertical: 16,
    paddingHorizontal: 28,
  },
  createSoulInlineText: {
    fontFamily: ROUNDED_FONT,
    fontSize: 16,
    fontWeight: '500',
    color: '#000',
  },

  // Sticky footer — absolute container sits flush above the native tab bar.
  // The gradient under the button fades the scrolling content to solid black
  // so the button never visually mixes with content below it.
  footerWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingTop: 32,
  },
  footerFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  generateButton: {
    backgroundColor: '#fff',
    borderRadius: 999,
    borderCurve: 'continuous',
    paddingVertical: 18,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  generateCostInline: {
    position: 'absolute',
    right: 20,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  generateCostText: {
    color: '#000',
    fontFamily: ROUNDED_FONT,
    fontSize: 16,
    fontWeight: '600',
  },
  generateButtonDisabled: {
    backgroundColor: '#1a1a1a',
  },
  generateButtonText: {
    fontFamily: ROUNDED_FONT,
    fontSize: 19,
    fontWeight: '500',
    color: '#000',
    textAlign: 'center',
  },
  generateButtonTextDisabled: {
    color: '#666',
  },

  // Admin sheet
  adminModalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  adminModalBackdropPress: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  adminSheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 32,
    maxHeight: '85%',
  },
  adminSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  adminSheetTitle: {
    fontFamily: ROUNDED_FONT,
    fontSize: 20,
    fontWeight: '500',
    color: '#fff',
  },
  adminHelpText: {
    fontFamily: ROUNDED_FONT,
    fontSize: 12,
    color: '#FF2D95',
    marginBottom: 12,
    lineHeight: 16,
  },
  adminScroll: {
    maxHeight: 500,
  },
  adminLabel: {
    fontFamily: ROUNDED_FONT,
    fontSize: 12,
    color: '#888',
    marginTop: 12,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  promptInput: {
    fontFamily: ROUNDED_FONT,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 13,
    minHeight: 160,
    textAlignVertical: 'top',
    lineHeight: 18,
  },
  smallInput: {
    fontFamily: ROUNDED_FONT,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 14,
  },
  gridSizeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  gridChip: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#222',
  },
  gridChipActive: {
    backgroundColor: '#FF2D95',
    borderColor: '#FF2D95',
  },
  gridChipText: {
    fontFamily: ROUNDED_FONT,
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  gridChipTextActive: {
    color: '#000',
  },
  adminSaveBtn: {
    marginTop: 12,
    backgroundColor: '#FF2D95',
    paddingVertical: 16,
    borderRadius: 999,
    borderCurve: 'continuous',
    alignItems: 'center',
  },
  adminSaveBtnDisabled: {
    opacity: 0.5,
  },
  adminSaveBtnText: {
    fontFamily: ROUNDED_FONT,
    color: '#000',
    fontSize: 16,
    fontWeight: '500',
  },
  adminButtonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  adminBtnSecondary: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#222',
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
  },
  adminBtnSecondaryText: {
    fontFamily: ROUNDED_FONT,
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
  adminHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  localPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 45, 149, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 45, 149, 0.4)',
  },
  localPillText: {
    fontFamily: ROUNDED_FONT,
    color: '#FF2D95',
    fontSize: 11,
    fontWeight: '500',
  },
});
