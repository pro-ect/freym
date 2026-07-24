/**
 * CoinConfirmSheet — confirm-before-spend gate for the in-app Photo Agent.
 *
 * The normal generate() pipeline charges coins server-side without any client
 * confirmation (it only surfaces the paywall on a 402). The agent flow is the
 * one place we want an explicit "this will use N coins — generate?" step, so
 * every coin-spending action the agent proposes is confirmed here first.
 *
 * Cost is the live coin price for the model (getModelCoinCostAsync → Supabase
 * model_pricing); balance is the user's current coin balance from BalanceContext.
 */
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { BlurView } from 'expo-blur';
import { Zap, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { getModelCoinCostAsync } from '@/lib/pricing';
import { useBalance } from '@/contexts/BalanceContext';

const ROUNDED_FONT = 'SFRounded-Medium';

export type AgentPlan = {
  model: string;
  modelName: string;
  prompt: string;
  summary: string;
  noPrompt?: boolean;
};

export type ConfirmBase = { label: string; uri: string };

type Props = {
  visible: boolean;
  plan: AgentPlan | null;
  // When the chat has both an original photo and a generated result, the user
  // picks which to edit here (the "ask before generating" step). First = default.
  bases?: ConfirmBase[];
  onConfirm: (plan: AgentPlan, cost: number, baseUri?: string) => void;
  onCancel: () => void;
};

export default function CoinConfirmSheet({ visible, plan, bases = [], onConfirm, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { balanceInfo, hasCustomKey } = useBalance();
  const [cost, setCost] = useState<number | null>(null);
  const [baseIdx, setBaseIdx] = useState(0);

  useEffect(() => {
    let alive = true;
    if (visible && plan) {
      setBaseIdx(0); // default to the first base (latest result)
      setCost(null);
      getModelCoinCostAsync(plan.model).then((c) => { if (alive) setCost(c); }).catch(() => { if (alive) setCost(null); });
    }
    return () => { alive = false; };
  }, [visible, plan]);

  if (!plan) return null;

  const chosenBase = bases[baseIdx]?.uri;

  const hasInfinite = hasCustomKey; // BYOK users aren't charged coins
  const enough = hasInfinite || cost == null || balanceInfo.rawValue >= cost;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]} onPress={() => {}}>
          <BlurView tint="systemChromeMaterialDark" intensity={80} style={StyleSheet.absoluteFill} />
          <View style={styles.grabber} />

          <Pressable style={styles.close} onPress={onCancel} hitSlop={10}>
            <X size={20} color="#999" />
          </Pressable>

          <Text style={styles.title}>{plan.summary}</Text>

          {bases.length > 1 ? (
            <View style={styles.baseRow}>
              {bases.map((b, i) => (
                <Pressable
                  key={b.uri + i}
                  style={[styles.baseChip, i === baseIdx && styles.baseChipOn]}
                  onPress={() => setBaseIdx(i)}
                >
                  <Text style={[styles.baseText, i === baseIdx && styles.baseTextOn]}>{b.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={styles.costRow}>
            <View style={styles.costPill}>
              <Zap size={16} color="#FF2D87" fill="#FF2D87" />
              {cost == null ? (
                <ActivityIndicator size="small" color="#fff" style={{ marginLeft: 4 }} />
              ) : (
                <Text style={styles.costText}>{hasInfinite ? t('agent.freeWithKey') : t('agent.costCoins', { count: cost })}</Text>
              )}
            </View>
            {!hasInfinite ? (
              <Text style={styles.balance}>{t('agent.balance', { balance: balanceInfo.isLoading ? '…' : balanceInfo.rawValue })}</Text>
            ) : null}
          </View>

          {!enough ? (
            <Text style={styles.warn}>{t('agent.notEnough')}</Text>
          ) : null}

          <Pressable
            style={[styles.confirmBtn, cost == null && styles.confirmBtnDisabled]}
            disabled={cost == null}
            onPress={() => onConfirm(plan, cost ?? 0, chosenBase)}
          >
            <Text style={styles.confirmText}>
              {hasInfinite ? t('agent.generate') : t('agent.generateCost', { count: cost ?? 0 })}
            </Text>
          </Pressable>
          <Pressable style={styles.cancelBtn} onPress={onCancel}>
            <Text style={styles.cancelText}>{t('agent.cancel')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    overflow: 'hidden',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderCurve: 'continuous',
    paddingHorizontal: 22,
    paddingTop: 14,
    backgroundColor: 'rgba(20,20,22,0.6)',
  },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.25)', marginBottom: 18 },
  close: { position: 'absolute', top: 16, right: 16, zIndex: 2 },
  title: { color: '#fff', fontFamily: ROUNDED_FONT, fontSize: 22, fontWeight: '600', marginBottom: 6, paddingRight: 28 },
  model: { color: '#9a9a9e', fontSize: 14, marginBottom: 18 },
  baseRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  baseChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'transparent' },
  baseChipOn: { backgroundColor: 'rgba(255,45,135,0.18)', borderColor: '#FF2D87' },
  baseText: { color: '#9a9a9e', fontSize: 14, fontWeight: '600' },
  baseTextOn: { color: '#fff' },
  costRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  costPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999 },
  costText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  balance: { color: '#9a9a9e', fontSize: 14 },
  warn: { color: '#ffb04d', fontSize: 13, marginBottom: 16, marginTop: -8 },
  confirmBtn: { backgroundColor: '#fff', borderRadius: 999, borderCurve: 'continuous', paddingVertical: 16, alignItems: 'center', marginBottom: 10 },
  confirmBtnDisabled: { opacity: 0.5 },
  confirmText: { color: '#000', fontFamily: ROUNDED_FONT, fontSize: 17, fontWeight: '600' },
  cancelBtn: { paddingVertical: 12, alignItems: 'center' },
  cancelText: { color: '#9a9a9e', fontSize: 16 },
});
