/**
 * Aya Agent — in-app conversational Photo Studio.
 *
 * MVP mirror of the Telegram `tg-photo` bot: the user sends a photo + a request,
 * the managed Claude "Photo Studio" agent (via the `agent-chat` edge function)
 * replies with a question, numbered SUGGESTions, or a GENERATE plan. The agent
 * only PLANS — when the user taps a plan we confirm the coin cost
 * (CoinConfirmSheet) and run it through the normal generate() pipeline, so the
 * result lands in the Library with full status tracking and coins are charged
 * exactly like any other job. The chat shows a live result bubble that mirrors
 * the Library item's status.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Keyboard,
} from 'react-native';
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { ArrowUp, ImageUp, Sparkles, X, Check, AlertCircle, SquarePen, ChevronLeft, ChevronDown } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { ZoomIn, useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, withDelay, Easing } from 'react-native-reanimated';

import { compressImageForRecipe } from '@/lib/recipes/imageCompression';
import { ensureAIConsent } from '@/lib/ai/aiConsent';
import { supabase } from '@/lib/supabase';
import { useGeneration } from '@/app/hooks/useGeneration';
import { useLibrary } from '@/contexts/LibraryContext';
import { useSettings } from '@/contexts/SettingsContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { usePaywall } from '@/contexts/PaywallContext';
import { useBalance } from '@/contexts/BalanceContext';
import { isProcessingStatus, type LibraryImage } from '@/lib/library/libraryStateManager';
import { ProcessingOverlay } from '@/app/components/ProcessingOverlay';
import ImageDetailsModal from '@/app/components/ImageDetailsModal';
import CoinConfirmSheet, { AgentPlan } from '@/app/components/CoinConfirmSheet';
import GrantCoinsPopup from '@/app/components/GrantCoinsPopup';

const ROUNDED_FONT = 'SFRounded-Medium';

type Plan = AgentPlan & { n?: number; recommended?: boolean; kind?: 'effect' | 'edit' };
type Msg =
  | { id: string; role: 'user'; text?: string; imageUri?: string }
  | { id: string; role: 'agent'; kind: 'text'; text: string }
  | { id: string; role: 'agent'; kind: 'suggest'; text: string; options: Plan[] }
  | { id: string; role: 'agent'; kind: 'generate'; text: string; plans: Plan[] }
  | {
      id: string; role: 'agent'; kind: 'result'; summary: string;
      inputUri?: string;            // shown immediately under the loader
      pending?: boolean;            // true before generate() returns (the "analyzing" phase)
      libraryId?: string; jobId?: string;
      // terminal state cached onto the message so re-opening the chat renders the
      // finished image instantly instead of falling back to a loader.
      finalStatus?: 'completed' | 'failed';
      resultUri?: string; error?: string; durationSec?: number;
    };

type ResultMsg = Extract<Msg, { kind: 'result' }>;

let _seq = 0;
const uid = () => `m${Date.now()}_${_seq++}`;

// Per-user persisted transcript. The Anthropic session (the agent's memory) is
// kept server-side and reused across opens; this stores the visible chat so the
// UI matches that memory instead of resetting to a blank greeting.
const STORAGE_PREFIX = '@aya_agent_chat:';
// Usage counters live under a SEPARATE key so "New chat" can't reset the limits.
const USAGE_PREFIX = '@aya_agent_usage:';
const FREE_PHOTO_LIMIT = 3;   // photos a free user can analyze
const FREE_TEXT_LIMIT = 20;   // text-only messages a free user can send
const GREETING_TEXT =
  "Upload a photo and I'll suggest the best edits for you ✨";
const GREETING: Msg = { id: 'greeting', role: 'agent', kind: 'text', text: GREETING_TEXT };

// Empty-state mascot: a quick 2-spin burst (~0.4s) then a 4.5s pause, looping.
// 2 full turns end at the same orientation, so the instant reset is seamless.
function PersonaAvatar() {
  const rot = useSharedValue(0);
  useEffect(() => {
    rot.value = withRepeat(
      withSequence(
        withTiming(2, { duration: 400, easing: Easing.linear }),
        withDelay(4500, withTiming(0, { duration: 0 })),
      ),
      -1,
      false,
    );
  }, []);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value * 360}deg` }] }));
  return <Animated.Image source={require('../assets/agent-persona.png')} style={[styles.persona, style]} />;
}

export default function AgentScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { generate } = useGeneration();
  const { deleteImage } = useLibrary();
  const { subscriptionStatus } = useSubscription();
  const { hasCustomKey } = useBalance();
  const { showPaywall } = usePaywall();
  const { useDirectAgentModel } = useSettings();
  const unlimited = subscriptionStatus.isSubscribed || hasCustomKey;

  const [photosUsed, setPhotosUsed] = useState(0);
  const [textsUsed, setTextsUsed] = useState(0);
  const usageKeyRef = useRef<string | null>(null);

  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState('');
  const [attachedUri, setAttachedUri] = useState<string | null>(null); // compressed, pending send
  const [sending, setSending] = useState(false);
  const [pendingHasPhoto, setPendingHasPhoto] = useState(false); // drives the waiting-bubble copy
  // The most recent photo sent — every plan runs against this.
  const [workingPhotoUri, setWorkingPhotoUri] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ visible: boolean; plan: Plan | null }>({ visible: false, plan: null });
  const [viewerImage, setViewerImage] = useState<LibraryImage | null>(null); // full-screen result viewer
  const [kbVisible, setKbVisible] = useState(false);
  const [grant, setGrant] = useState<{ visible: boolean; amount: number }>({ visible: false, amount: 0 });
  const params = useLocalSearchParams<{ previewGrant?: string; attachUrl?: string; attachNonce?: string }>();

  // Admin preview: open /agent?previewGrant=1 (from Settings) to see the popup.
  useEffect(() => {
    if (params.previewGrant) setGrant({ visible: true, amount: 40 });
  }, [params.previewGrant]);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, () => setKbVisible(true));
    const h = Keyboard.addListener(hideEvt, () => setKbVisible(false));
    return () => { s.remove(); h.remove(); };
  }, []);

  const scrollRef = useRef<ScrollView>(null);
  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);
  useEffect(scrollToEnd, [messages, sending, scrollToEnd]);

  const append = useCallback((m: Msg) => setMessages((prev) => [...prev, m]), []);
  const updateMsg = useCallback((id: string, patch: Partial<ResultMsg>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? ({ ...m, ...patch } as Msg) : m)));
  }, []);

  // ---- transcript persistence (per user) ----
  const storageKeyRef = useRef<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const id = user?.id ?? 'anon';
      const key = STORAGE_PREFIX + id;
      storageKeyRef.current = key;
      usageKeyRef.current = USAGE_PREFIX + id;
      try {
        const raw = await AsyncStorage.getItem(key);
        if (alive && raw) {
          const saved = JSON.parse(raw);
          if (Array.isArray(saved?.messages) && saved.messages.length) setMessages(saved.messages);
          if (saved?.workingPhotoUri) setWorkingPhotoUri(saved.workingPhotoUri);
        }
        const usageRaw = await AsyncStorage.getItem(usageKeyRef.current);
        if (alive && usageRaw) {
          const u = JSON.parse(usageRaw);
          if (typeof u?.photosUsed === 'number') setPhotosUsed(u.photosUsed);
          if (typeof u?.textsUsed === 'number') setTextsUsed(u.textsUsed);
        }
      } catch { /* ignore corrupt cache */ }
      if (alive) setHydrated(true);
    })();
    return () => { alive = false; };
  }, []);

  // Persist on change (only after we've loaded, so we don't clobber saved state).
  useEffect(() => {
    if (!hydrated || !storageKeyRef.current) return;
    AsyncStorage.setItem(storageKeyRef.current, JSON.stringify({ messages, workingPhotoUri })).catch(() => {});
  }, [messages, workingPhotoUri, hydrated]);

  // Persist usage counters separately (survives New chat).
  useEffect(() => {
    if (!hydrated || !usageKeyRef.current) return;
    AsyncStorage.setItem(usageKeyRef.current, JSON.stringify({ photosUsed, textsUsed })).catch(() => {});
  }, [photosUsed, textsUsed, hydrated]);

  // Clear the transcript AND reset the server-side agent session.
  const newChat = useCallback(async () => {
    setMessages([GREETING]);
    setWorkingPhotoUri(null);
    setInput('');
    setAttachedUri(null);
    if (storageKeyRef.current) AsyncStorage.removeItem(storageKeyRef.current).catch(() => {});
    try { await supabase.functions.invoke('agent-chat', { body: { reset: true } }); } catch { /* best effort */ }
  }, []);

  // Pre-attach a photo passed in via route params (e.g. "Improve with agent" from
  // the Library detail page). Remote result URLs are downloaded + compressed to a
  // local file so send()'s base64 read works.
  const attachHandledRef = useRef<string | null>(null);
  useEffect(() => {
    const url = typeof params.attachUrl === 'string' ? params.attachUrl : undefined;
    const nonce = (typeof params.attachNonce === 'string' && params.attachNonce) || url;
    if (!url || !nonce || attachHandledRef.current === nonce) return;
    attachHandledRef.current = nonce;
    (async () => {
      try {
        let localUri = url;
        if (/^https?:/i.test(url)) {
          const dest = `${FileSystem.cacheDirectory}agent-attach-${nonce}.jpg`;
          const dl = await FileSystem.downloadAsync(url, dest);
          localUri = dl.uri;
        }
        try {
          const compressed = await compressImageForRecipe(localUri);
          setAttachedUri(compressed.uri);
        } catch {
          setAttachedUri(localUri);
        }
      } catch {
        // ignore — the user can still attach manually
      }
    })();
  }, [params.attachUrl, params.attachNonce]);

  const pickImage = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('agent.permissionTitle'), t('agent.permissionMsg'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets?.[0]) return;
    try {
      const compressed = await compressImageForRecipe(result.assets[0].uri);
      setAttachedUri(compressed.uri);
    } catch {
      setAttachedUri(result.assets[0].uri); // fall back to the raw pick
    }
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if ((!text && !attachedUri) || sending) return;

    const photoForTurn = attachedUri;
    const hasPhoto = !!photoForTurn;

    // Free-user limits: 3 analyzed photos, 20 text messages → paywall.
    if (!unlimited) {
      if (hasPhoto && photosUsed >= FREE_PHOTO_LIMIT) {
        append({ id: uid(), role: 'agent', kind: 'text', text: t('agent.photoLimit') });
        showPaywall('agent_photo_limit');
        return;
      }
      if (!hasPhoto && textsUsed >= FREE_TEXT_LIMIT) {
        append({ id: uid(), role: 'agent', kind: 'text', text: t('agent.messageLimit') });
        showPaywall('agent_text_limit');
        return;
      }
    }

    append({ id: uid(), role: 'user', text: text || undefined, imageUri: photoForTurn || undefined });
    setInput('');
    setAttachedUri(null);

    let images: { base64: string; mediaType: string }[] = [];
    if (photoForTurn) {
      setWorkingPhotoUri(photoForTurn);
      try {
        const tRead = Date.now();
        const base64 = await FileSystem.readAsStringAsync(photoForTurn, { encoding: FileSystem.EncodingType.Base64 });
        images = [{ base64, mediaType: 'image/jpeg' }];
        console.log(`[agent-timing] client.base64Read ${Date.now() - tRead}ms (${Math.round(base64.length / 1024)}KB)`);
      } catch {
        append({ id: uid(), role: 'agent', kind: 'text', text: t('agent.photoReadError') });
        return;
      }
    }

    setPendingHasPhoto(images.length > 0);
    setSending(true);
    const tRoundtrip = Date.now();
    console.log(`[agent-timing] client.send hasPhoto=${images.length > 0} msg=${text.length}chars`);
    try {
      const { data, error } = await supabase.functions.invoke('agent-chat', {
        body: { message: text, images, directModel: useDirectAgentModel },
      });
      const rtt = Date.now() - tRoundtrip;
      const tm = data?.timing;
      if (tm) {
        // Server-side split: session setup + Gemini describe + Claude agent. The
        // gap between totalMs and rtt is network/transfer of the base64 payload.
        console.log(`[agent-timing] server total=${tm.totalMs}ms | session=${tm.sessionMs}ms describe=${tm.describeMs}ms agent=${tm.agentMs}ms path=${tm.path || 'managed'}${tm.fellBack ? ` (fellBack=${tm.fellBack} → image base64-inlined)` : ''}`);
        console.log(`[agent-timing] client.roundtrip ${rtt}ms → ${error ? 'error' : (data?.type || 'unknown')} (network+transfer ≈ ${rtt - tm.totalMs}ms)`);
      } else {
        console.log(`[agent-timing] client.roundtrip ${rtt}ms → ${error ? 'error' : (data?.type || 'unknown')}`);
      }
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.type === 'suggest' && Array.isArray(data.options) && data.options.length) {
        append({ id: uid(), role: 'agent', kind: 'suggest', text: data.text || t('agent.suggestIntro'), options: data.options });
      } else if (data?.type === 'generate' && Array.isArray(data.plans) && data.plans.length) {
        append({ id: uid(), role: 'agent', kind: 'generate', text: data.text || t('agent.generateIntro'), plans: data.plans });
      } else {
        append({ id: uid(), role: 'agent', kind: 'text', text: data?.text || t('agent.noReply') });
      }
      // First-open geo coin grant landed → celebrate.
      if (typeof data?.granted === 'number' && data.granted > 0) {
        setGrant({ visible: true, amount: data.granted });
      }
      // Count the turn against the free quota (only on a successful reply).
      if (!unlimited) {
        if (hasPhoto) setPhotosUsed((n) => n + 1);
        else setTextsUsed((n) => n + 1);
      }
    } catch (e: any) {
      append({ id: uid(), role: 'agent', kind: 'text', text: `⚠️ ${e?.message || t('agent.genericError')}` });
    } finally {
      setSending(false);
    }
  }, [input, attachedUri, sending, append, unlimited, photosUsed, textsUsed, showPaywall, useDirectAgentModel]);

  // The latest completed result becomes a candidate base for follow-up edits, so
  // "make it warmer" iterates on the edited photo — not the untouched original.
  // We stop scanning at the most recent NEW-photo upload: any result before it
  // belongs to a *different* photo, so it must not be offered as a base. This is
  // what makes the base picker (latest result vs original) appear only while
  // iterating on the same photo, and disappear when the user brings a new one.
  const lastResultUri = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'user' && m.imageUri) return null; // new photo → no prior result base
      if (m.role === 'agent' && m.kind === 'result' && m.finalStatus === 'completed' && m.resultUri) return m.resultUri;
    }
    return null;
  }, [messages]);

  // Bases offered in the confirm sheet (first = default). Latest result on top.
  const bases = useMemo(() => {
    const arr: { label: string; uri: string }[] = [];
    if (lastResultUri && lastResultUri !== workingPhotoUri) arr.push({ label: t('agent.baseResult'), uri: lastResultUri });
    if (workingPhotoUri) arr.push({ label: t('agent.baseOriginal'), uri: workingPhotoUri });
    return arr;
  }, [lastResultUri, workingPhotoUri, t]);

  const openConfirm = useCallback((plan: Plan) => {
    if (!workingPhotoUri && !lastResultUri) {
      Alert.alert(t('agent.needPhotoTitle'), t('agent.needPhotoMsg'));
      return;
    }
    setConfirm({ visible: true, plan });
  }, [workingPhotoUri, lastResultUri, t]);

  const runPlan = useCallback(async (plan: AgentPlan, baseUri?: string) => {
    setConfirm({ visible: false, plan: null });
    const photo = baseUri || lastResultUri || workingPhotoUri;
    if (!photo) return;

    // The agent sends the user's photo off-device to Fal.ai inside generate(),
    // so it must gate on the AI data-sharing consent just like every other
    // upload surface (imagine/editor/video/create). Onboarding only pre-records
    // consent when the selfie step runs; with that step remotely disabled this
    // is the surface that would otherwise send a face photo before any consent
    // window is shown. No-ops once consent is stored.
    if (!(await ensureAIConsent())) return;

    // Show the result bubble (with an "analyzing" loader) IMMEDIATELY — don't wait
    // for the upload/queue round-trip inside generate().
    const msgId = uid();
    append({ id: msgId, role: 'agent', kind: 'result', summary: plan.summary, inputUri: photo, pending: true });

    const res = await generate({
      prompt: plan.prompt || '',
      model: plan.model,
      modelName: plan.modelName,
      originalImageUri: photo,
      inputImages: [photo],
      metadata: { source: 'agent' },
      showStartNotification: false,
      showCompletionNotification: false,
    });

    if (res?.libraryId) {
      updateMsg(msgId, { libraryId: res.libraryId, jobId: res.jobId, pending: false });
    } else {
      // null → generate() already surfaced the paywall / an alert. Mark the bubble.
      updateMsg(msgId, { pending: false, finalStatus: 'failed', error: t('agent.startError') });
    }
  }, [workingPhotoUri, lastResultUri, generate, append, updateMsg, t]);

  // Floating blur + gradient-fade header (matches Inspire/Library).
  const headerHeight = insets.top + 8 + 44 + 12;
  // Before the user's first message, show the centered mascot + greeting.
  const isEmpty = !messages.some((m) => m.role === 'user');

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false, contentStyle: { backgroundColor: '#000' } }} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
       <View style={styles.flex}>
        {isEmpty ? (
          <View style={[styles.emptyState, { paddingTop: headerHeight }]}>
            <PersonaAvatar />
            <Text style={styles.emptyText}>{t('agent.greeting')}</Text>
            <Pressable style={styles.emptyAddBtn} onPress={attachedUri ? send : pickImage}>
              <Text style={styles.emptyAddText}>{attachedUri ? t('agent.send') : t('agent.addPhoto')}</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={[styles.scrollContent, { paddingTop: headerHeight + 6, paddingBottom: insets.bottom + 80 + (attachedUri ? 104 : 0) + (kbVisible ? 44 : 0) }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {messages.map((m) => (
              <MessageRow key={m.id} msg={m} onPickPlan={openConfirm} onResolve={updateMsg} onOpenImage={setViewerImage} />
            ))}
            {sending ? (
              pendingHasPhoto ? (
                <AnalyzingProgress />
              ) : (
                <View style={[styles.bubble, styles.agentBubble, styles.typingBubble]}>
                  <ActivityIndicator size="small" color="#bbb" />
                  <TypingLine photo={false} />
                </View>
              )
            ) : null}
          </ScrollView>
        )}

        {/* Composer — floats over the chat; gradient fades messages under it */}
        <View style={[styles.composer, { paddingBottom: insets.bottom + 10 }]}>
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.92)', '#000', '#000']}
            locations={[0, 0.32, 0.6, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />

          {/* hide-keyboard — floats above the input, right side */}
          {kbVisible ? (
            <Pressable style={styles.kbDismiss} onPress={() => Keyboard.dismiss()} hitSlop={8}>
              <ChevronDown size={18} color="#fff" />
            </Pressable>
          ) : null}

          {/* attached photo, tilted, above the input */}
          {attachedUri ? (
            <Animated.View entering={ZoomIn.duration(450)} style={styles.attachWrap}>
              <View style={styles.attachTilt}>
                <Image source={{ uri: attachedUri }} style={styles.attachThumb} contentFit="cover" />
                <Pressable style={styles.attachRemove} onPress={() => setAttachedUri(null)} hitSlop={8}>
                  <X size={14} color="#fff" />
                </Pressable>
              </View>
            </Animated.View>
          ) : null}

          <View style={styles.inputRow}>
            <Pressable
              style={[styles.iconBtn, attachedUri ? styles.iconBtnDisabled : null]}
              onPress={pickImage}
              disabled={!!attachedUri}
              hitSlop={8}
            >
              <ImageUp size={24} color="#fff" />
            </Pressable>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder={t('agent.placeholder')}
              placeholderTextColor="#8a8a8e"
              multiline
              onSubmitEditing={send}
            />
            <Pressable
              style={[styles.sendBtn, (!input.trim() && !attachedUri) || sending ? styles.sendBtnDisabled : null]}
              onPress={send}
              disabled={(!input.trim() && !attachedUri) || sending}
              hitSlop={8}
            >
              <ArrowUp size={22} color="#000" />
            </Pressable>
          </View>
        </View>
       </View>
      </KeyboardAvoidingView>

      {/* Floating blur + gradient-fade header (matches Inspire/Library). */}
      <View pointerEvents="box-none" style={[styles.headerOverlay, { height: headerHeight }]}>
        <MaskedView
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          maskElement={
            <LinearGradient
              colors={['rgba(0,0,0,1)', 'rgba(0,0,0,0)']}
              locations={[0.55, 1]}
              style={StyleSheet.absoluteFill}
            />
          }
        >
          <BlurView tint="systemChromeMaterialDark" intensity={70} style={StyleSheet.absoluteFill} />
        </MaskedView>
        <View style={[styles.headerRow, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
            <ChevronLeft size={28} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>{t('agent.title')}</Text>
          <Pressable onPress={newChat} hitSlop={10} style={styles.headerBtn}>
            <SquarePen size={22} color="#fff" />
          </Pressable>
        </View>
      </View>

      <CoinConfirmSheet
        visible={confirm.visible}
        plan={confirm.plan}
        bases={bases}
        onCancel={() => setConfirm({ visible: false, plan: null })}
        onConfirm={(plan, _cost, baseUri) => runPlan(plan, baseUri)}
      />

      <GrantCoinsPopup
        visible={grant.visible}
        amount={grant.amount}
        onClose={() => setGrant({ visible: false, amount: 0 })}
      />

      {/* Full-screen result viewer — same component the Library uses on tap. */}
      <ImageDetailsModal
        image={viewerImage}
        images={viewerImage ? [viewerImage] : []}
        initialIndex={0}
        onClose={() => setViewerImage(null)}
        onDelete={(id) => { deleteImage(id); setViewerImage(null); }}
      />
    </View>
  );
}

// ---------- message rendering ----------

function MessageRow({
  msg,
  onPickPlan,
  onResolve,
  onOpenImage,
}: {
  msg: Msg;
  onPickPlan: (p: Plan) => void;
  onResolve: (id: string, patch: Partial<ResultMsg>) => void;
  onOpenImage: (img: LibraryImage) => void;
}) {
  const { t } = useTranslation();
  if (msg.role === 'user') {
    return (
      <View style={[styles.bubble, styles.userBubble]}>
        {msg.imageUri ? <Image source={{ uri: msg.imageUri }} style={styles.userImage} contentFit="cover" /> : null}
        {msg.text ? <Text style={styles.userText}>{msg.text}</Text> : null}
      </View>
    );
  }

  if (msg.kind === 'result') {
    return <ResultBubble msg={msg} onResolve={onResolve} onOpenImage={onOpenImage} />;
  }

  // SUGGEST → compact multi-select (no model shown). Renders wider than a bubble.
  if (msg.kind === 'suggest') {
    return (
      <View style={styles.suggestWrap}>
        {msg.text ? (
          <View style={[styles.bubble, styles.agentBubble]}>
            <Text style={styles.agentText}>{msg.text}</Text>
          </View>
        ) : null}
        <SuggestionCard options={msg.options} onPickPlan={onPickPlan} />
      </View>
    );
  }

  return (
    <View style={[styles.bubble, styles.agentBubble]}>
      {msg.kind === 'text' ? <Text style={styles.agentText}>{msg.id === 'greeting' ? t('agent.greeting') : msg.text}</Text> : null}

      {msg.kind === 'generate' ? (
        <>
          {msg.text ? <Text style={styles.agentText}>{msg.text}</Text> : null}
          <View style={styles.plansWrap}>
            {msg.plans.map((p, i) => (
              <PlanChip key={`${i}-${p.model}`} plan={p} onPress={() => onPickPlan(p)} />
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

// Friendly names per model (model itself stays hidden from the user).
const CLIENT_MODEL_NAMES: Record<string, string> = {
  'nano-banana-2-fal': 'Nano Banana 2',
  'nano-banana-pro-2k-fal': 'Nano Banana Pro 2K',
  'seedream-4.5-fal': 'Seedream 4.5',
  'gpt-image-2-fal': 'GPT Image 2',
  'flux-2-max-fal': 'Flux 2 Max',
};

// Merge the selected effects into ONE generation on a preferred model.
// (Mirrors tg-photo's applySuggestions: same model if they agree, else default
// to Nano Banana 2; multiple edits become a single combined prompt.)
function mergePlans(selected: Plan[]): AgentPlan {
  const models = [...new Set(selected.map((o) => o.model))];
  const model = models.length === 1 ? models[0] : 'nano-banana-2-fal';
  const modelName = CLIENT_MODEL_NAMES[model] || selected[0]?.modelName || model;
  const summary = selected.map((o) => o.summary).join(' + ');
  if (selected.length === 1) {
    return { model, modelName, prompt: selected[0].prompt, summary: selected[0].summary };
  }

  // Lead with the LOOK/effect so it isn't diluted at the end of a long prompt,
  // then the technical edits. (A buried "golden hour" clause gets under-applied;
  // stating it first + emphasizing it keeps the look clearly visible.)
  const effects = selected.filter((o) => o.kind === 'effect');
  const edits = selected.filter((o) => o.kind !== 'effect');
  const editSteps = edits.map((o, i) => `${i + 1}) ${o.prompt}`).join(' ');

  let prompt: string;
  if (effects.length) {
    const look = effects.map((o) => o.prompt).join(' ');
    prompt =
      `The overall LOOK described here is the most important part of this edit and MUST be clearly and ` +
      `strongly visible in the final image — it sets the final lighting, color grade and mood: ${look} ` +
      (edits.length
        ? `In the SAME single pass, also apply these secondary adjustments, but they must sit UNDERNEATH ` +
          `the look above and must NOT neutralize, brighten away or wash out its lighting, warmth, color or ` +
          `shadows. Keep the same person and identity, the same background and location, and the same ` +
          `composition and framing: ${editSteps} If any adjustment conflicts with the look, the look wins. `
        : '') +
      `Blend everything into one cohesive, natural, photorealistic result where the look above is unmistakably present.`;
  } else {
    prompt =
      `Apply ALL of these edits together to the photo in a single pass, keeping the same person and identity, ` +
      `the same background and location, and the same composition and framing: ${editSteps} ` +
      `Blend them into one cohesive, natural, photorealistic result.`;
  }
  return { model, modelName, prompt, summary };
}

function SuggestionCard({ options, onPickPlan }: { options: Plan[]; onPickPlan: (p: AgentPlan) => void }) {
  const { t } = useTranslation();
  // Pre-select the bundle the agent flagged as combining well together, and
  // always start with (at least) one effect on so a look is applied by default.
  const [selected, setSelected] = useState<Set<number>>(() => {
    const set = new Set(options.filter((o) => o.recommended).map((o) => o.n!));
    const hasEffect = options.some((o) => o.kind === 'effect' && set.has(o.n!));
    if (!hasEffect) {
      const firstEffect = options.find((o) => o.kind === 'effect');
      if (firstEffect) set.add(firstEffect.n!);
    }
    return set;
  });
  const allOn = options.length > 0 && selected.size === options.length;
  const toggle = (n: number) =>
    setSelected((prev) => {
      const s = new Set(prev);
      s.has(n) ? s.delete(n) : s.add(n);
      return s;
    });
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(options.map((o) => o.n!)));
  const chosen = options.filter((o) => selected.has(o.n!));

  // Briefly block the button after a press so it can't be double-fired.
  const [cooling, setCooling] = useState(false);
  const handleGenerate = () => {
    if (cooling || chosen.length === 0) return;
    setCooling(true);
    onPickPlan(mergePlans(chosen));
    setTimeout(() => setCooling(false), 4000);
  };

  return (
    <View style={styles.suggestCard}>
      <Pressable style={styles.selectAllRow} onPress={toggleAll} hitSlop={6}>
        <Text style={styles.selectAllText}>{allOn ? t('agent.clearAll') : t('agent.selectAll')}</Text>
      </Pressable>

      {options.map((o) => {
        const on = selected.has(o.n!);
        return (
          <Pressable key={o.n} style={styles.effectRow} onPress={() => toggle(o.n!)}>
            <View style={[styles.checkbox, on && styles.checkboxOn]}>
              {on ? <Check size={14} color="#000" strokeWidth={3} /> : null}
            </View>
            <Text style={styles.effectText} numberOfLines={2}>{o.summary}</Text>
          </Pressable>
        );
      })}

      <Pressable
        style={[styles.genBtn, (chosen.length === 0 || cooling) && styles.genBtnDisabled]}
        disabled={chosen.length === 0 || cooling}
        onPress={handleGenerate}
      >
        <Text style={styles.genBtnText}>
          {cooling ? t('agent.generating') : chosen.length ? t('agent.generateCount', { count: chosen.length }) : t('agent.selectEffects')}
        </Text>
      </Pressable>
    </View>
  );
}

function PlanChip({ plan, onPress }: { plan: Plan; onPress: () => void }) {
  const { t } = useTranslation();
  const [cooling, setCooling] = useState(false);
  const handlePress = () => {
    if (cooling) return;
    setCooling(true);
    onPress();
    setTimeout(() => setCooling(false), 4000);
  };
  return (
    <Pressable style={styles.planChip} onPress={handlePress} disabled={cooling}>
      <View style={styles.planChipMain}>
        <Sparkles size={15} color="#FF2D87" />
        <Text style={[styles.planSummary, styles.flex]} numberOfLines={2}>{plan.summary}</Text>
      </View>
      <View style={[styles.planGo, cooling && styles.genBtnDisabled]}>
        <Text style={styles.planGoText}>{cooling ? t('agent.generating') : t('agent.generate')}</Text>
      </View>
    </Pressable>
  );
}

// Rotating status copy. Analysis lines play in the "thinking" bubble while we wait
// for the agent to read the photo and propose edits; the start lines play in the
// result bubble while we upload + queue the chosen generation.
function useRotatingLine(lines: string[], intervalMs = 1600): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    if (lines.length < 2) return;
    const id = setInterval(() => setI((v) => (v + 1) % lines.length), intervalMs);
    return () => clearInterval(id);
  }, [lines, intervalMs]);
  return lines[i] ?? lines[0];
}

// Photo analysis is a managed-agent turn that realistically runs ~40-45s (Sonnet 5
// thinks hard). Rather than hide that, append a live countdown to the rotating copy
// so the wait feels intentional and the user expects a result. Counts down from the
// estimate and holds at 1s if the agent takes longer; the real suggestions replace
// this bubble when they land.
const ANALYZE_ESTIMATE_S = 45;
function AnalyzingProgress() {
  const { t } = useTranslation();
  const lines = useMemo(
    () => [t('agent.analyzing1'), t('agent.analyzing2'), t('agent.analyzing3'), t('agent.analyzing4'), t('agent.analyzing5')],
    [t],
  );
  const line = useRotatingLine(lines, 4800);
  const [remaining, setRemaining] = useState(ANALYZE_ESTIMATE_S);
  useEffect(() => {
    const id = setInterval(() => setRemaining((s) => (s > 1 ? s - 1 : s)), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={[styles.bubble, styles.agentBubble, styles.typingBubble]}>
      <ActivityIndicator size="small" color="#bbb" />
      <Text style={styles.typingText}>{line} · {remaining}s</Text>
    </View>
  );
}

// Full-bleed loader for the result image area (upload/queue start phase).
function LoaderOverlay() {
  const { t } = useTranslation();
  const lines = useMemo(() => [t('agent.starting1'), t('agent.starting2'), t('agent.starting3')], [t]);
  const line = useRotatingLine(lines);
  return (
    <View style={[StyleSheet.absoluteFill, styles.analyzeOverlay]}>
      <ActivityIndicator color="#fff" />
      <Text style={styles.analyzeText}>{line}</Text>
    </View>
  );
}

// The waiting bubble's text — rotates through the analysis copy when a photo is
// being processed, otherwise a simple "Thinking…".
function TypingLine({ photo }: { photo: boolean }) {
  const { t } = useTranslation();
  const lines = useMemo(
    () => (photo
      ? [t('agent.analyzing1'), t('agent.analyzing2'), t('agent.analyzing3'), t('agent.analyzing4'), t('agent.analyzing5')]
      : [t('agent.thinking')]),
    [t, photo],
  );
  const line = useRotatingLine(lines);
  return <Text style={styles.typingText}>{line}</Text>;
}

// Mirrors a Library item's live status inside the chat — the immediate "analyzing"
// phase, then the same ProcessingOverlay (loader + elapsed timer) the Library tile
// uses, then the finished image. The terminal state is cached back onto the message
// so re-opening the chat shows the ready photo instantly (no loader).
function ResultBubble({
  msg,
  onResolve,
  onOpenImage,
}: {
  msg: ResultMsg;
  onResolve: (id: string, patch: Partial<ResultMsg>) => void;
  onOpenImage: (img: LibraryImage) => void;
}) {
  const { t } = useTranslation();
  const { images } = useLibrary();
  // Match on the stable queueJobId first — libraryId is a temp id that
  // libraryStateManager remaps to the real id once persisted. We always resolve
  // (even after caching) so tapping can open the real Library item full-screen.
  const item = useMemo(
    () =>
      images.find(
        (i) =>
          (msg.jobId && (i.queueJobId === msg.jobId || i.metadata?.queueJobId === msg.jobId)) ||
          (msg.libraryId && i.id === msg.libraryId),
      ),
    [images, msg.libraryId, msg.jobId],
  );

  // Once the tracked item reaches a terminal state, cache it onto the message so
  // future renders (incl. after re-opening the chat) don't fall back to a loader.
  useEffect(() => {
    if (msg.finalStatus || !item) return;
    if (item.status === 'completed') {
      const createdAt = item.metadata?.startedAt ?? item.createdAt;
      const durationSec =
        item.completedAt && createdAt ? Math.max(1, Math.round((item.completedAt - createdAt) / 1000)) : undefined;
      onResolve(msg.id, {
        finalStatus: 'completed',
        resultUri: item.transformedImageUrl || item.originalImageUri || undefined,
        durationSec,
      });
    } else if (item.status === 'failed') {
      onResolve(msg.id, { finalStatus: 'failed', error: item.error || undefined });
    }
  }, [item?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve display state: cached terminal → live item → "analyzing" placeholder.
  const analyzing = !msg.finalStatus && msg.pending;
  const liveStatus = item?.status;
  const done = msg.finalStatus === 'completed' || liveStatus === 'completed';
  const failed = msg.finalStatus === 'failed' || liveStatus === 'failed';
  const processing = !analyzing && !done && !failed && !!liveStatus && isProcessingStatus(liveStatus);
  const uri = msg.resultUri || item?.transformedImageUrl || item?.originalImageUri || msg.inputUri || null;
  const createdAt = item?.metadata?.startedAt ?? item?.createdAt;
  const durationSec = msg.durationSec ?? null;

  // Tap a finished result → open it full-screen in the chat (same viewer the
  // Library uses), instead of navigating away to the Library tab.
  const openViewer = () => {
    if (!done) return;
    if (item) { onOpenImage(item); return; }
    if (msg.resultUri) {
      onOpenImage({
        id: msg.libraryId || msg.id,
        originalImageUri: msg.inputUri || '',
        transformedImageUrl: msg.resultUri,
        prompt: '',
        model: '',
        status: 'completed',
        createdAt: Date.now(),
        metadata: {},
        isFavorite: false,
        favoriteSyncStatus: 'none',
      } as LibraryImage);
    }
  };

  return (
    <Pressable
      style={[styles.bubble, styles.agentBubble, styles.resultBubble]}
      onPress={openViewer}
    >
      <View style={styles.resultImageWrap}>
        {uri ? <Image source={{ uri }} style={styles.resultImage} contentFit="cover" /> : null}
        {analyzing ? <LoaderOverlay /> : null}
        {processing ? (
          <ProcessingOverlay status={liveStatus!} createdAt={createdAt} modelId={item?.modelId} variant="card" />
        ) : null}
        {failed ? (
          <View style={[StyleSheet.absoluteFill, styles.resultPlaceholder]}>
            <AlertCircle size={28} color="#ff6b6b" />
          </View>
        ) : null}
        {!uri && !analyzing && !processing && !failed ? (
          <View style={[StyleSheet.absoluteFill, styles.resultPlaceholder]}>
            <Text style={styles.resultOpen}>{t('agent.openInLibrary')}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.resultFooter}>
        {done ? <Check size={14} color="#46d17f" /> : failed ? <AlertCircle size={14} color="#ff6b6b" /> : <ActivityIndicator size="small" color="#bbb" />}
        <Text style={styles.resultLabel} numberOfLines={1}>
          {failed
            ? (msg.error || t('agent.failed'))
            : done
              ? (durationSec ? `${msg.summary} · ${durationSec}s` : msg.summary)
              : msg.summary}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  flex: { flex: 1 },
  scrollContent: { padding: 14, paddingBottom: 24, gap: 12 },

  // Floating blur header (mirrors ScreenWithBlurredTitle on the tabs).
  headerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden', zIndex: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 12 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: '#fff', fontFamily: ROUNDED_FONT, fontSize: 18, fontWeight: '600' },

  // Empty-state mascot + greeting (sits a little above center via paddingBottom).
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 170, gap: 12 },
  persona: { width: 150, height: 150 },
  emptyText: { color: '#f2f2f4', fontFamily: ROUNDED_FONT, fontSize: 25, lineHeight: 32, textAlign: 'center' },
  emptyAddBtn: { marginTop: 4, backgroundColor: '#fff', paddingHorizontal: 26, paddingVertical: 14, borderRadius: 999, borderCurve: 'continuous' },
  emptyAddText: { color: '#000', fontFamily: ROUNDED_FONT, fontSize: 16, fontWeight: '600' },

  bubble: { maxWidth: '86%', borderRadius: 20, borderCurve: 'continuous', paddingHorizontal: 14, paddingVertical: 11 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#FF2D87', gap: 8 },
  userText: { color: '#fff', fontSize: 18, lineHeight: 23 },
  userImage: { width: 180, height: 180, borderRadius: 12, borderCurve: 'continuous' },
  agentBubble: { alignSelf: 'flex-start', backgroundColor: '#1c1c1e' },
  agentText: { color: '#eee', fontSize: 18, lineHeight: 24 },

  typingBubble: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typingText: { color: '#bbb', fontSize: 16 },

  plansWrap: { marginTop: 10, gap: 8 },
  planChip: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 16, borderCurve: 'continuous', padding: 12, gap: 10 },
  planChipMain: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  planSummary: { color: '#fff', fontSize: 16, fontWeight: '600', lineHeight: 22 },
  planGo: { alignSelf: 'flex-start', backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
  planGoText: { color: '#000', fontSize: 15, fontWeight: '600', fontFamily: ROUNDED_FONT },

  // Compact multi-select suggestions
  suggestWrap: { alignSelf: 'stretch', gap: 8 },
  suggestCard: { alignSelf: 'stretch', backgroundColor: '#1c1c1e', borderRadius: 20, borderCurve: 'continuous', padding: 8, paddingTop: 4 },
  selectAllRow: { alignSelf: 'flex-end', paddingHorizontal: 10, paddingVertical: 8 },
  selectAllText: { color: '#FF2D87', fontSize: 15, fontWeight: '600', fontFamily: ROUNDED_FONT },
  effectRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 10, borderRadius: 12 },
  checkbox: { width: 22, height: 22, borderRadius: 7, borderCurve: 'continuous', borderWidth: 2, borderColor: '#5a5a5e', alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: '#fff', borderColor: '#fff' },
  effectText: { color: '#fff', fontSize: 18, lineHeight: 23, flex: 1 },
  genBtn: { marginTop: 8, backgroundColor: '#fff', borderRadius: 14, borderCurve: 'continuous', paddingVertical: 14, alignItems: 'center' },
  genBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.18)' },
  genBtnText: { color: '#000', fontSize: 18, fontWeight: '600', fontFamily: ROUNDED_FONT },

  resultBubble: { padding: 8, gap: 8 },
  resultImageWrap: { width: 220, height: 220, borderRadius: 14, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: '#0a0a0a' },
  resultImage: { width: '100%', height: '100%' },
  resultPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  resultOpen: { color: '#8e8e93', fontSize: 14, fontWeight: '600' },
  analyzeOverlay: { backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 12 },
  analyzeText: { color: '#fff', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  resultFooter: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, paddingBottom: 2 },
  resultLabel: { color: '#ccc', fontSize: 14, flex: 1 },

  composer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: 40 },
  kbDismiss: { alignSelf: 'flex-end', width: 36, height: 36, borderRadius: 18, borderCurve: 'continuous', backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center', marginBottom: 8, marginRight: 2 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  iconBtnDisabled: { opacity: 0.3 },
  input: {
    flex: 1, minHeight: 44, maxHeight: 120, color: '#fff', fontSize: 16, lineHeight: 20,
    paddingTop: 11, paddingBottom: 11, paddingHorizontal: 16,
    backgroundColor: '#2a2a2e', borderRadius: 22, borderCurve: 'continuous',
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, borderCurve: 'continuous', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
  // Attached photo: above the input, tilted, animates in.
  attachWrap: { marginBottom: 12, marginLeft: 8, alignSelf: 'flex-start' },
  attachTilt: { transform: [{ rotate: '-6deg' }] },
  attachThumb: { width: 84, height: 84, borderRadius: 16, borderCurve: 'continuous' },
  attachRemove: { position: 'absolute', top: -6, right: -6, backgroundColor: '#333', borderRadius: 999, padding: 3 },
});
