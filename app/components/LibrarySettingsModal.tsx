import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Switch,
  ScrollView,
  TextInput,
  Linking,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import {
  X,
  Eye,
  EyeOff,
  Key,
  User,
  HardDrive,
  Trash2,
  RefreshCw,
  ExternalLink,
  LogOut,
  Wand2,
  ImagePlus,
  Video,
  Library,
  FlaskConical,
  Asterisk,
  Plus,
  Crown,
  RotateCcw,
  Sparkles,
  Shield,
  Copy,
  Users,
  BookOpen,
  Play,
  Home,
  ArrowUp,
  ArrowDown,
  Folder,
  Pencil,
  Globe,
  MessageCircleHeart,
} from 'lucide-react-native';
import { logFBEvent } from '../../lib/facebook';
import * as Clipboard from 'expo-clipboard';
import { clearImageCache, getCacheSize } from '../../lib/utils/imageDownloader';
import { logOutRevenueCat } from '../../lib/revenuecat';
import { ensureAnonymousSession } from '../../lib/auth/ensureGuestSession';
import { getStableDeviceId } from '../../lib/auth/deviceId';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSettings } from '../../contexts/SettingsContext';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SUPPORTED_LANGUAGES, LANGUAGE_NAMES } from '../../lib/i18n';
import { supabase } from '../../lib/supabase';

// Persisted after sign-out so a logged-out user (e.g. one who hit "Restore" and
// sees premium back but 0 coins) is told WHICH account holds their coins.
const PREV_ACCOUNT_HINT_KEY = 'previousAccountHint';
import { useLibrary } from '../../contexts/LibraryContext';
import { useBalance } from '../../contexts/BalanceContext';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { useAuth } from '../../contexts/AuthModalContext';
import { useSouls } from '../../contexts/SoulsContext';
import { getRecipes, removeDuplicateRecipes } from '../../lib/recipes/recipeQueries';
import type { Recipe } from '../../lib/recipes/types';
import CreateSoulModal from './CreateSoulModal';
import FounderMessageModal from './FounderMessageModal';
import MyRecipesModal from './MyRecipesModal';
import AdminModelCategoriesEditor from './AdminModelCategoriesEditor';
import { invalidateModelsCache, preloadModelsCache } from '../../lib/cloudModels';
import { router } from 'expo-router';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { usePaywall } from '../../contexts/PaywallContext';
import { getPaywallPreviewMode, setPaywallPreviewMode } from './HybridPaywallModal';
import {
  getHardPaywallAdminOverride,
  setHardPaywallAdminOverride,
} from '../../lib/hardPaywallFlow/config';
import { clearHomeCache } from '../../lib/recipes/homeCache';

interface LibrarySettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

const ICON_SIZE = 20;
const ICON_COLOR = '#9ca3af';

export default function LibrarySettingsModal({ visible, onClose }: LibrarySettingsModalProps) {
  const [cacheSize, setCacheSize] = useState<number>(0);
  const [clearing, setClearing] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string>('');
  // Which account the user's coins are on, shown when logged out.
  const [accountHint, setAccountHint] = useState<{ email: string; coins: number } | null>(null);
  const [userId, setUserId] = useState<string>('');
  const [deviceId, setDeviceId] = useState<string>('');
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const {
    pendingVisibleTabs,
    hasPendingTabChanges,
    setTabVisibility,
    isAdmin,
    apiProvider,
    setApiProvider,
    forceLibraryEmptyState,
    setForceLibraryEmptyState,
    showDirectModel,
    setShowDirectModel,
    useDirectAgentModel,
    setUseDirectAgentModel,
    appLanguage,
    setAppLanguage,
  } = useSettings();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [showFounderMessage, setShowFounderMessage] = useState(false);
  const hasShownRestartAlertRef = useRef(false);

  const handleTabToggle = useCallback((tabName: Parameters<typeof setTabVisibility>[0], value: boolean) => {
    setTabVisibility(tabName, value);
    if (!hasShownRestartAlertRef.current) {
      hasShownRestartAlertRef.current = true;
      Alert.alert(
        t('settings.restartRequired'),
        t('settings.restartRequiredTabsMessage'),
        [{ text: t('common.ok') }]
      );
    }
  }, [setTabVisibility]);
  const { cleanupStuckJobs } = useLibrary();
  const { refresh: refreshBalance, hasCustomKey: hasUserKey, balanceInfo } = useBalance();
  const {
    subscriptionStatus,
    restorePurchases,
  } = useSubscription();
  const { showPaywall: showCustomPaywall } = usePaywall();
  const { showAuthModal, isAuthenticated } = useAuth();
  const { souls, addSoul, updateSoul, deleteSoul } = useSouls();
  const { resetOnboarding, hasCompletedOnboarding, showOnboarding } = useOnboarding();
  const [isRestoring, setIsRestoring] = useState(false);

  // Souls modal state
  const [soulModalVisible, setSoulModalVisible] = useState(false);
  const [editingSoul, setEditingSoul] = useState<typeof souls[0] | null>(null);

  // Recipes state
  const [localRecipes, setLocalRecipes] = useState<Recipe[]>([]);
  const [showRecipesModal, setShowRecipesModal] = useState(false);
  const [isCleaningRecipes, setIsCleaningRecipes] = useState(false);

  // Paywall preview mode (admin only)
  const [paywallPreviewEnabled, setPaywallPreviewEnabled] = useState(false);

  // Hard paywall onboarding local override (admin only, dev-build iteration)
  const [hardPaywallOnbEnabled, setHardPaywallOnbEnabled] = useState(false);

  // Admin: categories list for reordering / editing / creating
  type AdminCategory = { slug: string; title: string; subtitle: string | null; sort_order: number };
  const [adminCategories, setAdminCategories] = useState<AdminCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [reorderingSlug, setReorderingSlug] = useState<string | null>(null);

  // Edit-existing state
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSubtitle, setEditSubtitle] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Create-new state
  const [showCreateCategoryForm, setShowCreateCategoryForm] = useState(false);
  const [newCatSlug, setNewCatSlug] = useState('');
  const [newCatTitle, setNewCatTitle] = useState('');
  const [newCatSubtitle, setNewCatSubtitle] = useState('');
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);

  const loadAdminCategories = useCallback(async () => {
    setCategoriesLoading(true);
    const { data, error } = await supabase
      .from('recipe_categories')
      .select('slug, title, subtitle, sort_order')
      .order('sort_order', { ascending: true });
    if (error) {
      console.warn('[Settings] load categories failed:', error.message);
      setAdminCategories([]);
    } else {
      setAdminCategories((data ?? []) as AdminCategory[]);
    }
    setCategoriesLoading(false);
  }, []);

  const swapCategoryWithNeighbor = useCallback(async (index: number, direction: 'up' | 'down') => {
    const target = adminCategories[index];
    const neighbor = adminCategories[direction === 'up' ? index - 1 : index + 1];
    if (!target || !neighbor) return;

    setReorderingSlug(target.slug);

    // Optimistic local swap.
    const next = [...adminCategories];
    next[index] = { ...neighbor, sort_order: target.sort_order };
    next[direction === 'up' ? index - 1 : index + 1] = { ...target, sort_order: neighbor.sort_order };
    setAdminCategories(next);

    // Two-row swap in Supabase. Use a temporary out-of-range value to dodge the
    // unique-ish sort_order ordering across the brief moment both rows would
    // share a value (no UNIQUE constraint, but cleaner).
    const TEMP = -1;
    const targetOriginal = target.sort_order;
    const neighborOriginal = neighbor.sort_order;

    try {
      const r1 = await supabase.from('recipe_categories').update({ sort_order: TEMP }).eq('slug', target.slug);
      if (r1.error) throw r1.error;
      const r2 = await supabase.from('recipe_categories').update({ sort_order: targetOriginal }).eq('slug', neighbor.slug);
      if (r2.error) throw r2.error;
      const r3 = await supabase.from('recipe_categories').update({ sort_order: neighborOriginal }).eq('slug', target.slug);
      if (r3.error) throw r3.error;

      await clearHomeCache();
    } catch (e: any) {
      console.warn('[Settings] reorder failed:', e?.message ?? e);
      Alert.alert('Reorder failed', e?.message ?? 'Could not save new order. Reverting.');
      await loadAdminCategories();
    } finally {
      setReorderingSlug(null);
    }
  }, [adminCategories, loadAdminCategories]);

  const startEditCategory = useCallback((cat: AdminCategory) => {
    setShowCreateCategoryForm(false);
    setEditingSlug(cat.slug);
    setEditTitle(cat.title);
    setEditSubtitle(cat.subtitle ?? '');
  }, []);

  const cancelEditCategory = useCallback(() => {
    setEditingSlug(null);
    setEditTitle('');
    setEditSubtitle('');
  }, []);

  const saveEditCategory = useCallback(async () => {
    if (!editingSlug) return;
    const title = editTitle.trim();
    if (!title) {
      Alert.alert('Title required', 'Category title cannot be empty.');
      return;
    }
    const subtitle = editSubtitle.trim();
    setIsSavingEdit(true);
    try {
      const { error } = await supabase
        .from('recipe_categories')
        .update({ title, subtitle: subtitle.length > 0 ? subtitle : null })
        .eq('slug', editingSlug);
      if (error) throw error;
      await clearHomeCache();
      await loadAdminCategories();
      cancelEditCategory();
    } catch (e: any) {
      console.warn('[Settings] edit category failed:', e?.message ?? e);
      Alert.alert('Save failed', e?.message ?? 'Could not save changes.');
    } finally {
      setIsSavingEdit(false);
    }
  }, [editingSlug, editTitle, editSubtitle, loadAdminCategories, cancelEditCategory]);

  const openCreateCategoryForm = useCallback(() => {
    cancelEditCategory();
    setNewCatSlug('');
    setNewCatTitle('');
    setNewCatSubtitle('');
    setShowCreateCategoryForm(true);
  }, [cancelEditCategory]);

  const cancelCreateCategory = useCallback(() => {
    setShowCreateCategoryForm(false);
    setNewCatSlug('');
    setNewCatTitle('');
    setNewCatSubtitle('');
  }, []);

  const createCategory = useCallback(async () => {
    const slug = newCatSlug.trim().toLowerCase();
    const title = newCatTitle.trim();
    if (!slug || !title) {
      Alert.alert('Missing fields', 'Slug and title are required.');
      return;
    }
    if (!/^[a-z0-9_]+$/.test(slug)) {
      Alert.alert('Invalid slug', 'Slug may only contain lowercase letters, digits, and underscores.');
      return;
    }
    if (adminCategories.some((c) => c.slug.toLowerCase() === slug)) {
      Alert.alert('Slug already exists', 'Pick a different slug.');
      return;
    }
    const subtitle = newCatSubtitle.trim();
    const maxOrder = adminCategories.reduce((m, c) => Math.max(m, c.sort_order ?? 0), 0);
    setIsCreatingCategory(true);
    try {
      const { error } = await supabase
        .from('recipe_categories')
        .insert({
          slug,
          title,
          subtitle: subtitle.length > 0 ? subtitle : null,
          sort_order: maxOrder + 10,
        });
      if (error) throw error;
      await clearHomeCache();
      await loadAdminCategories();
      cancelCreateCategory();
    } catch (e: any) {
      console.warn('[Settings] create category failed:', e?.message ?? e);
      Alert.alert('Create failed', e?.message ?? 'Could not create category.');
    } finally {
      setIsCreatingCategory(false);
    }
  }, [newCatSlug, newCatTitle, newCatSubtitle, adminCategories, loadAdminCategories, cancelCreateCategory]);

  // Hidden onboarding trigger — 7 taps on cache size
  const cacheTapCountRef = useRef(0);
  const cacheTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCacheTap = useCallback(() => {
    cacheTapCountRef.current += 1;
    if (cacheTapTimerRef.current) clearTimeout(cacheTapTimerRef.current);
    cacheTapTimerRef.current = setTimeout(() => { cacheTapCountRef.current = 0; }, 2000);
    if (cacheTapCountRef.current >= 7) {
      cacheTapCountRef.current = 0;
      onClose();
      setTimeout(() => showOnboarding(), 300);
    }
  }, [onClose, showOnboarding]);

  // Load cache size, user info, recipes, and paywall preview state when modal opens
  useEffect(() => {
    if (visible) {
      loadCacheSize();
      loadUserInfo();
      loadLocalRecipes();
      // Load paywall preview mode state
      getPaywallPreviewMode().then(setPaywallPreviewEnabled);
      // Load hard-paywall onboarding local override state
      getHardPaywallAdminOverride().then(setHardPaywallOnbEnabled);
      if (isAdmin) loadAdminCategories();
    }
  }, [visible, isAdmin, loadAdminCategories]);

  // Keep the "your coins are on <account>" hint in sync with auth state.
  // Signed in → clear it; signed out → load the last saved account.
  useEffect(() => {
    if (isAuthenticated) {
      AsyncStorage.removeItem(PREV_ACCOUNT_HINT_KEY).catch(() => {});
      setAccountHint(null);
      return;
    }
    AsyncStorage.getItem(PREV_ACCOUNT_HINT_KEY)
      .then((raw) => {
        if (raw) setAccountHint(JSON.parse(raw));
      })
      .catch(() => {});
  }, [isAuthenticated, visible]);

  const loadLocalRecipes = async () => {
    try {
      const recipes = await getRecipes();
      setLocalRecipes(recipes);
    } catch (error) {
      console.error('Error loading recipes:', error);
    }
  };

  // Listen for auth state changes (e.g., after Apple Sign In)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
        await new Promise(resolve => setTimeout(resolve, 500));
        loadUserInfo();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const loadCacheSize = async () => {
    try {
      setLoading(true);
      const size = await getCacheSize();
      setCacheSize(size);
    } catch (error) {
      console.error('Error loading cache size:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadUserInfo = async () => {
    setIsLoadingUser(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setUserEmail(user?.email || 'Not available');
      setUserId(user?.id || 'Not available');
      // Admin-only readout: the stable device id we recover the guest account from.
      setDeviceId((await getStableDeviceId()) || 'Not available');
    } catch (error) {
      console.error('Error loading user info:', error);
      setUserEmail('Error loading');
      setUserId('Error loading');
      setDeviceId('Error loading');
    } finally {
      setIsLoadingUser(false);
    }
  };

  const handleClearCache = () => {
    Alert.alert(
      t('settings.clearCache'),
      t('settings.clearCacheMessage', { n: cacheSize.toFixed(1) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.clear'),
          style: 'destructive',
          onPress: async () => {
            try {
              setClearing(true);
              await clearImageCache();
              await loadCacheSize();
              Alert.alert(t('settings.done'), t('settings.cacheCleared'));
            } catch (error: any) {
              Alert.alert(t('common.error'), error.message);
            } finally {
              setClearing(false);
            }
          },
        },
      ]
    );
  };

  const handleCleanupJobs = () => {
    Alert.alert(
      t('settings.cleanupJobs'),
      t('settings.cleanupJobsMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.cleanup'),
          style: 'destructive',
          onPress: async () => {
            try {
              setCleaning(true);
              const result = await cleanupStuckJobs();
              Alert.alert(t('settings.done'), t('settings.cleanupJobsResult', { completed: result.completed, failed: result.failed }));
            } catch (error: any) {
              Alert.alert(t('common.error'), error.message);
            } finally {
              setCleaning(false);
            }
          },
        },
      ]
    );
  };

  const handleSignOut = () => {
    Alert.alert(
      t('settings.signOut'),
      t('settings.signOutConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.signOut'),
          style: 'destructive',
          onPress: async () => {
            try {
              // Remember which account holds the coins so we can tell the user
              // where to sign back in (coins are unreachable while logged out).
              if (userEmail && userEmail.includes('@') && balanceInfo.rawValue > 0) {
                await AsyncStorage.setItem(
                  PREV_ACCOUNT_HINT_KEY,
                  JSON.stringify({ email: userEmail, coins: balanceInfo.rawValue }),
                ).catch(() => {});
              }
              // Sign out of Supabase FIRST, then immediately recover the
              // device-stable guest session. RevenueCat is deliberately NOT
              // logged out here: Purchases.logOut() mints an $RCAnonymousID and
              // the receipt sync instantly TRANSFERs the subscription onto that
              // unmapped anon customer (zeroing this account's subscription
              // coins with no way to restore them — the alias-merge on the next
              // sign-in fires no webhook). Instead the SIGNED_IN listener in
              // SubscriptionContext logs RC straight into the recovered guest
              // UUID — a mapped UUID→UUID hop the webhook + transfer_back
              // restore path handle cleanly.
              await supabase.auth.signOut();
              const guestSession = await ensureAnonymousSession();
              if (!guestSession) {
                // No guest session recoverable — fall back to a plain RC
                // logout so RC doesn't stay pinned to the signed-out account.
                await logOutRevenueCat();
              }
              onClose();
            } catch (error: any) {
              Alert.alert(t('common.error'), error.message);
            }
          },
        },
      ]
    );
  };

  // Soul handlers
  const handleSaveSoul = async (name: string, imageUris: string[]) => {
    if (editingSoul) {
      await updateSoul(editingSoul.id, { name, imageUris });
      return editingSoul.id;
    } else {
      return await addSoul({ name, imageUris });
    }
  };

  const handleDeleteSoul = (soulId: string, soulName: string) => {
    Alert.alert(
      t('settings.deleteSoul'),
      t('settings.deleteSoulConfirm', { name: soulName }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            await deleteSoul(soulId);
          },
        },
      ]
    );
  };

  const handleEditSoul = (soul: typeof souls[0]) => {
    setEditingSoul(soul);
    setSoulModalVisible(true);
  };

  const handleCreateSoul = () => {
    setEditingSoul(null);
    setSoulModalVisible(true);
  };

  const SettingRow = ({
    icon,
    label,
    value,
    onToggle,
  }: {
    icon: React.ReactNode;
    label: string;
    value: boolean;
    onToggle: (val: boolean) => void;
  }) => (
    <View style={styles.settingRow}>
      <View style={styles.settingLeft}>
        {icon}
        <Text style={styles.settingLabel}>{label}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: '#374151', true: '#FFD700' }}
        thumbColor="#fff"
        ios_backgroundColor="#374151"
      />
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: Platform.OS === 'android' ? insets.top + 16 : 16 }]}>
          <TouchableOpacity onPress={onClose} style={styles.headerButton}>
            <X size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>{t('common.settings')}</Text>
          <View style={styles.headerButton} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Premium Block — shown to everyone, including guests (registration
              is optional; guests can buy coins/premium and restore). */}
          {(
            <View style={styles.balanceBlock}>
              {/* Coin Balance Display */}
              <View style={styles.coinBalanceDisplay}>
                <Text style={styles.coinBalanceNumber}>{balanceInfo.displayText || balanceInfo.rawValue}</Text>
                <Text style={styles.coinBalanceLabel}>{t('settings.coins')}</Text>
              </View>

              {/* Subscription Status */}
              {subscriptionStatus.isSubscribed && (() => {
                const isInTrial = subscriptionStatus.periodType === 'TRIAL'
                  || subscriptionStatus.periodType === 'INTRO';
                const dateLabel = isInTrial
                  ? (subscriptionStatus.willRenew ? t('settings.firstCharge') : t('settings.trialEnds'))
                  : (subscriptionStatus.willRenew ? t('settings.renews') : t('settings.expires'));
                return (
                <View style={styles.subscriptionStatusBlock}>
                  <View style={styles.subscriptionBadge}>
                    <Crown size={14} color="#FFD700" />
                    <Text style={styles.subscriptionBadgeText}>
                      {isInTrial ? t('settings.proTrial') : t('settings.pro')}
                    </Text>
                    <Text style={styles.subscriptionBadgeSeparator}>·</Text>
                    <Text style={styles.subscriptionBadgeDetail}>
                      {dateLabel}{' '}
                      {subscriptionStatus.expirationDate ? subscriptionStatus.expirationDate.toLocaleDateString() : t('settings.soon')}
                    </Text>
                    {subscriptionStatus.productIdentifier && (() => {
                      const coinMap: Record<string, number> = {
                        'lab.monthly.2000': 2000, 'monthly_2000': 2000,
                        'lab.monthly.500': 500, 'weekly_500': 500,
                        'yearly_25000': 25000,
                        'creators_weekly_600': 600,
                        'creators_monthly_3000': 2000,
                        'creators_yearly_36000': 36000,
                      };
                      const coins = coinMap[subscriptionStatus.productIdentifier];
                      return coins ? (
                        <>
                          <Text style={styles.subscriptionBadgeSeparator}>·</Text>
                          <Text style={styles.subscriptionBadgeDetail}>{t('settings.coinsCount', { n: coins })}</Text>
                        </>
                      ) : null;
                    })()}
                  </View>
                </View>
                );
              })()}

              <TouchableOpacity
                style={styles.buyButton}
                onPress={() => {
                  onClose();
                  setTimeout(() => showCustomPaywall('settings'), 300);
                }}
              >
                <Plus size={18} color="#111" />
                <Text style={styles.buyButtonText}>
                  {subscriptionStatus.isSubscribed ? t('settings.buyMoreCoins') : t('settings.getProBuyCoins')}
                </Text>
              </TouchableOpacity>

              {/* Restore Purchases */}
              <TouchableOpacity
                style={styles.restoreButton}
                onPress={async () => {
                  setIsRestoring(true);
                  try {
                    const restored = await restorePurchases();
                    if (restored) {
                      refreshBalance();
                      if (!isAuthenticated && accountHint) {
                        // Premium restores from the device Apple ID, but coins
                        // live on the account — tell them where to sign in.
                        Alert.alert(
                          t('settings.premiumRestored'),
                          t('settings.premiumRestoredMessage', { email: accountHint.email, coins: accountHint.coins }),
                        );
                      } else {
                        Alert.alert(t('settings.restored'), t('settings.purchasesRestored'));
                      }
                    } else {
                      Alert.alert(t('settings.noPurchases'), t('settings.noPurchasesFound'));
                    }
                  } catch (error) {
                    Alert.alert(t('common.error'), t('settings.restoreFailed'));
                  } finally {
                    setIsRestoring(false);
                  }
                }}
                disabled={isRestoring}
              >
                {isRestoring ? (
                  <ActivityIndicator size="small" color="#6b7280" />
                ) : (
                  <>
                    <RotateCcw size={14} color="#6b7280" />
                    <Text style={styles.restoreButtonText}>{t('settings.restorePurchases')}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Account Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('settings.account')}</Text>
            <View style={styles.card}>
              {isAuthenticated ? (
                <>
                  <TouchableOpacity
                    style={styles.infoRow}
                    onPress={async () => {
                      if (userEmail && userEmail !== 'Not available' && userEmail !== 'Error loading') {
                        await Clipboard.setStringAsync(userEmail);
                        Alert.alert(t('settings.copied'), t('settings.emailCopied'));
                      }
                    }}
                    activeOpacity={0.7}
                  >
                    <User size={ICON_SIZE} color={ICON_COLOR} />
                    <View style={styles.infoContent}>
                      <Text style={styles.infoLabel}>{t('settings.email')}</Text>
                      {isLoadingUser ? (
                        <ActivityIndicator size="small" color="#6b7280" />
                      ) : (
                        <Text style={styles.infoValue} numberOfLines={1}>{userEmail}</Text>
                      )}
                    </View>
                    <Copy size={16} color="#6b7280" />
                  </TouchableOpacity>

                </>
              ) : (
                <View style={styles.signInContainer}>
                  {/* Sign-in is iOS-only (Apple). Android relies on the stable
                      device guest identity, so hide the sign-in CTA there. */}
                  {Platform.OS !== 'android' && (
                    <>
                      {accountHint ? (
                        <Text style={styles.signInText}>
                          {t('settings.coinsOnAccount', { coins: accountHint.coins, email: accountHint.email })}
                        </Text>
                      ) : (
                        <Text style={styles.signInText}>
                          {t('settings.signInToGenerate')}
                        </Text>
                      )}
                      <TouchableOpacity
                        style={styles.signInButton}
                        onPress={() => {
                          onClose();
                          setTimeout(() => showAuthModal(), 300);
                        }}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.signInButtonText}>{t('settings.getStarted')}</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {/* Guest ID — the Supabase user id (profiles.id) support needs to credit coins */}
                  <TouchableOpacity
                    style={styles.infoRow}
                    onPress={async () => {
                      if (userId && userId !== 'Not available' && userId !== 'Error loading') {
                        await Clipboard.setStringAsync(userId);
                        Alert.alert(t('settings.copied'), t('settings.userIdCopied'));
                      }
                    }}
                    activeOpacity={0.7}
                  >
                    <User size={ICON_SIZE} color={ICON_COLOR} />
                    <View style={styles.infoContent}>
                      <Text style={styles.infoLabel}>{t('settings.userId')}</Text>
                      {isLoadingUser ? (
                        <ActivityIndicator size="small" color="#6b7280" />
                      ) : (
                        <Text style={styles.infoValue} numberOfLines={1}>{userId}</Text>
                      )}
                    </View>
                    <Copy size={16} color="#6b7280" />
                  </TouchableOpacity>
                </View>
              )}

              {/* Admin-only: show User ID + the stable Device ID side by side so we
                  can verify the device ↔ guest-account (<deviceId>@guest.local)
                  mapping live. Hardcoded labels — admin debug UI, not localized. */}
              {isAdmin && (
                <>
                  <TouchableOpacity
                    style={styles.infoRow}
                    onPress={async () => {
                      if (userId && userId !== 'Not available' && userId !== 'Error loading') {
                        await Clipboard.setStringAsync(userId);
                        Alert.alert(t('settings.copied'), 'User ID copied');
                      }
                    }}
                    activeOpacity={0.7}
                  >
                    <User size={ICON_SIZE} color={ICON_COLOR} />
                    <View style={styles.infoContent}>
                      <Text style={styles.infoLabel}>User ID (admin)</Text>
                      {isLoadingUser ? (
                        <ActivityIndicator size="small" color="#6b7280" />
                      ) : (
                        <Text style={styles.infoValue} numberOfLines={1}>{userId}</Text>
                      )}
                    </View>
                    <Copy size={16} color="#6b7280" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.infoRow}
                    onPress={async () => {
                      if (deviceId && deviceId !== 'Not available' && deviceId !== 'Error loading') {
                        await Clipboard.setStringAsync(deviceId);
                        Alert.alert(t('settings.copied'), 'Device ID copied');
                      }
                    }}
                    activeOpacity={0.7}
                  >
                    <User size={ICON_SIZE} color={ICON_COLOR} />
                    <View style={styles.infoContent}>
                      <Text style={styles.infoLabel}>Device ID (admin)</Text>
                      {isLoadingUser ? (
                        <ActivityIndicator size="small" color="#6b7280" />
                      ) : (
                        <Text style={styles.infoValue} numberOfLines={1}>{deviceId}</Text>
                      )}
                    </View>
                    <Copy size={16} color="#6b7280" />
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>

          {/* Message the founder */}
          <View style={styles.section}>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.founderRow}
                onPress={() => setShowFounderMessage(true)}
                activeOpacity={0.7}
              >
                <MessageCircleHeart size={ICON_SIZE} color="#f59e0b" />
                <View style={styles.infoContent}>
                  <Text style={styles.infoValue}>{t('settings.messageFounder')}</Text>
                  <Text style={styles.founderRowSubtext}>{t('settings.messageFounderSubtext')}</Text>
                </View>
                <Text style={{ color: '#6b7280', fontSize: 16 }}>›</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Language Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('settings.language')}</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.infoRow}
                onPress={() => setShowLangPicker((v) => !v)}
                activeOpacity={0.7}
              >
                <Globe size={ICON_SIZE} color={ICON_COLOR} />
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>{t('settings.language')}</Text>
                  <Text style={styles.infoValue} numberOfLines={1}>
                    {appLanguage
                      ? ((LANGUAGE_NAMES as Record<string, string>)[appLanguage] ?? appLanguage)
                      : t('settings.systemDefault')}
                  </Text>
                </View>
                <Text style={{ color: '#6b7280', fontSize: 14 }}>{showLangPicker ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {showLangPicker && (
                <>
                  <TouchableOpacity
                    style={styles.infoRow}
                    onPress={() => { setAppLanguage(null); setShowLangPicker(false); }}
                    activeOpacity={0.7}
                  >
                    <View style={styles.infoContent}>
                      <Text style={styles.infoValue}>{t('settings.systemDefault')}</Text>
                    </View>
                    {appLanguage === null && <Text style={{ color: '#22c55e', fontSize: 16 }}>✓</Text>}
                  </TouchableOpacity>
                  {SUPPORTED_LANGUAGES.map((lng) => (
                    <TouchableOpacity
                      key={lng}
                      style={styles.infoRow}
                      onPress={() => { setAppLanguage(lng); setShowLangPicker(false); }}
                      activeOpacity={0.7}
                    >
                      <View style={styles.infoContent}>
                        <Text style={styles.infoValue}>{LANGUAGE_NAMES[lng]}</Text>
                      </View>
                      {appLanguage === lng && <Text style={{ color: '#22c55e', fontSize: 16 }}>✓</Text>}
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </View>
          </View>

          {/* My Souls Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('settings.mySouls')}</Text>
            <View style={styles.card}>
              {souls.length === 0 ? (
                <View style={styles.emptySection}>
                  <Users size={32} color="#444" />
                  <Text style={styles.emptySectionText}>{t('settings.noSoulsYet')}</Text>
                  <Text style={styles.emptySectionSubtext}>
                    {t('settings.noSoulsSubtext')}
                  </Text>
                </View>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.soulsScrollContent}
                >
                  {souls.map((soul) => (
                    <TouchableOpacity
                      key={soul.id}
                      style={styles.soulCard}
                      onPress={() => handleEditSoul(soul)}
                      onLongPress={() => handleDeleteSoul(soul.id, soul.name)}
                    >
                      <Image
                        source={{ uri: soul.imageUris[0] }}
                        style={styles.soulImage}
                        contentFit="cover"
                      />
                      <Text style={styles.soulName} numberOfLines={1}>{soul.name}</Text>
                      <Text style={styles.soulImageCount}>
                        {soul.imageUris.length === 1
                          ? t('settings.imageCount', { n: soul.imageUris.length })
                          : t('settings.imageCount_plural', { n: soul.imageUris.length })}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              <TouchableOpacity
                style={styles.addItemRow}
                onPress={handleCreateSoul}
              >
                <Plus size={18} color="#3b82f6" />
                <Text style={styles.addItemText}>{t('settings.createNewSoul')}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* My Recipes Section - Admin Only */}
          {isAdmin && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Admin: Recipes</Text>
                {localRecipes.length > 0 && (
                  <Text style={styles.sectionCount}>{localRecipes.length}</Text>
                )}
              </View>
              <View style={styles.card}>
                {localRecipes.length === 0 ? (
                  <View style={styles.emptySection}>
                    <BookOpen size={32} color="#444" />
                    <Text style={styles.emptySectionText}>No recipes yet</Text>
                    <Text style={styles.emptySectionSubtext}>
                      Create recipes to build reusable generation workflows
                    </Text>
                    <TouchableOpacity
                      style={styles.addRecipeButton}
                      onPress={() => setShowRecipesModal(true)}
                    >
                      <Plus size={16} color="#fff" />
                      <Text style={styles.addRecipeButtonText}>Add Recipe</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.recipesScrollContent}
                  >
                    {localRecipes.slice(0, 5).map((recipe) => (
                      <TouchableOpacity
                        key={recipe.id}
                        style={styles.recipeCard}
                        onPress={() => {
                          onClose();
                          router.push(`/recipe/${recipe.id}`);
                        }}
                      >
                        <View style={styles.recipeCardImageContainer}>
                          {recipe.exampleResultUri ? (
                            <Image
                              key={`recipe-preview-${recipe.id}`}
                              source={{ uri: recipe.exampleResultUri }}
                              style={styles.recipeCardImage}
                              contentFit="cover"
                              cachePolicy="memory-disk"
                            />
                          ) : (
                            <View style={[styles.recipeCardImage, styles.recipeCardPlaceholder]}>
                              <FlaskConical size={24} color="#444" />
                            </View>
                          )}
                          {/* Steps badge */}
                          <View style={styles.recipeStepsBadge}>
                            <Text style={styles.recipeStepsBadgeText}>
                              {recipe.steps.length} {recipe.steps.length === 1 ? 'step' : 'steps'}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.recipeCardName} numberOfLines={2}>{recipe.name}</Text>
                      </TouchableOpacity>
                    ))}
                    {/* View All card if more than 5 recipes */}
                    {localRecipes.length > 5 && (
                      <TouchableOpacity
                        style={styles.viewAllCard}
                        onPress={() => setShowRecipesModal(true)}
                      >
                        <Text style={styles.viewAllCount}>+{localRecipes.length - 5}</Text>
                        <Text style={styles.viewAllText}>View All</Text>
                      </TouchableOpacity>
                    )}
                  </ScrollView>
                )}
                {localRecipes.length > 0 && (
                  <>
                    <TouchableOpacity
                      style={styles.addItemRow}
                      onPress={() => setShowRecipesModal(true)}
                    >
                      <FlaskConical size={18} color="#3b82f6" />
                      <Text style={styles.addItemText}>View All Recipes</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.addItemRow, { borderTopWidth: 1, borderTopColor: '#222' }]}
                      onPress={async () => {
                        Alert.alert(
                          'Cleanup Duplicate Recipes',
                          'This will remove duplicate recipes and keep only unique ones. Continue?',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'Cleanup',
                              style: 'destructive',
                              onPress: async () => {
                                setIsCleaningRecipes(true);
                                try {
                                  const result = await removeDuplicateRecipes();
                                  await loadLocalRecipes();
                                  Alert.alert(
                                    'Cleanup Complete',
                                    `Removed ${result.deleted} duplicate recipes. ${result.kept} recipes remaining.`
                                  );
                                } catch (error: any) {
                                  Alert.alert('Error', error.message || 'Failed to cleanup recipes');
                                } finally {
                                  setIsCleaningRecipes(false);
                                }
                              },
                            },
                          ]
                        );
                      }}
                      disabled={isCleaningRecipes}
                    >
                      {isCleaningRecipes ? (
                        <ActivityIndicator size="small" color="#ef4444" />
                      ) : (
                        <Trash2 size={18} color="#ef4444" />
                      )}
                      <Text style={[styles.addItemText, { color: '#ef4444' }]}>
                        {isCleaningRecipes ? 'Cleaning...' : 'Cleanup Duplicates'}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          )}

          {/* Visible Tabs Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('settings.visibleTabs')}</Text>
            {hasPendingTabChanges && (
              <Text style={styles.tabsPendingCaption}>
                {t('settings.restartToApply')}
              </Text>
            )}
            <View style={styles.card}>
              <SettingRow
                icon={<Home size={ICON_SIZE} color={ICON_COLOR} />}
                label={t('settings.tabHome')}
                value={pendingVisibleTabs.home}
                onToggle={(val) => handleTabToggle('home', val)}
              />
              <SettingRow
                icon={<FlaskConical size={ICON_SIZE} color={ICON_COLOR} />}
                label={t('settings.tabRecipes')}
                value={pendingVisibleTabs.recipes}
                onToggle={(val) => handleTabToggle('recipes', val)}
              />
              <SettingRow
                icon={<Wand2 size={ICON_SIZE} color={ICON_COLOR} />}
                label={t('settings.tabEditor')}
                value={pendingVisibleTabs.editor}
                onToggle={(val) => handleTabToggle('editor', val)}
              />
              {isAdmin && (
                <>
                  <SettingRow
                    icon={<ImagePlus size={ICON_SIZE} color={ICON_COLOR} />}
                    label="Studio"
                    value={pendingVisibleTabs.create}
                    onToggle={(val) => handleTabToggle('create', val)}
                  />
                  <SettingRow
                    icon={<Video size={ICON_SIZE} color={ICON_COLOR} />}
                    label="Video"
                    value={pendingVisibleTabs.video}
                    onToggle={(val) => handleTabToggle('video', val)}
                  />
                  <SettingRow
                    icon={<Sparkles size={ICON_SIZE} color={ICON_COLOR} />}
                    label="Inspire"
                    value={pendingVisibleTabs.inspire}
                    onToggle={(val) => handleTabToggle('inspire', val)}
                  />
                </>
              )}
              <SettingRow
                icon={<Library size={ICON_SIZE} color={ICON_COLOR} />}
                label={t('settings.tabLibrary')}
                value={pendingVisibleTabs.library}
                onToggle={(val) => handleTabToggle('library', val)}
              />
            </View>
          </View>

          {/* Admin: Copy Shot — gates the on-tab admin UI (Edit preset +
              OpenAI-direct model switcher). Off → no admin UI on the tab. */}
          {isAdmin && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Admin: Copy Shot</Text>
              <View style={styles.card}>
                <SettingRow
                  icon={<Sparkles size={ICON_SIZE} color={ICON_COLOR} />}
                  label="Show direct model"
                  value={showDirectModel}
                  onToggle={(val) => setShowDirectModel(val)}
                />
              </View>
            </View>
          )}

          {isAdmin && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Admin: Agent</Text>
              <View style={styles.card}>
                <SettingRow
                  icon={<Sparkles size={ICON_SIZE} color={ICON_COLOR} />}
                  label="Use direct model (fast)"
                  value={useDirectAgentModel}
                  onToggle={(val) => setUseDirectAgentModel(val)}
                />
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 }}
                  onPress={() => { onClose(); router.push({ pathname: '/agent', params: { previewGrant: '1' } } as any); }}
                >
                  <Sparkles size={ICON_SIZE} color={ICON_COLOR} />
                  <Text style={{ color: '#fff', fontSize: 16 }}>Preview agent grant popup</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Storage Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('settings.storage')}</Text>
            <View style={styles.card}>
              <TouchableOpacity activeOpacity={1} onPress={handleCacheTap}>
                <View style={styles.infoRow}>
                  <HardDrive size={ICON_SIZE} color={ICON_COLOR} />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>{t('settings.cache')}</Text>
                    {loading ? (
                      <ActivityIndicator size="small" color="#6b7280" />
                    ) : (
                      <Text style={styles.infoValue}>{cacheSize.toFixed(1)} MB</Text>
                    )}
                  </View>
                </View>
              </TouchableOpacity>

              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.button, styles.buttonDanger, (clearing || cacheSize === 0) && styles.buttonDisabled]}
                  onPress={handleClearCache}
                  disabled={clearing || cacheSize === 0}
                >
                  {clearing ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Trash2 size={16} color="#fff" />
                      <Text style={styles.buttonText}>{t('settings.clearCache')}</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, cleaning && styles.buttonDisabled]}
                  onPress={handleCleanupJobs}
                  disabled={cleaning}
                >
                  {cleaning ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <RefreshCw size={16} color="#fff" />
                      <Text style={styles.buttonText}>{t('settings.cleanupJobs')}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>


          {/* Admin API Provider Switcher - only visible to admins */}
          {isAdmin && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Admin: API Provider</Text>
              <View style={styles.card}>
                <View style={styles.variantInfo}>
                  <Key size={ICON_SIZE} color="#FFD700" />
                  <View style={styles.variantInfoText}>
                    <Text style={styles.variantLabel}>Current: {apiProvider === 'fal' ? 'Fal.ai' : 'Replicate'}</Text>
                    <Text style={styles.variantHint}>
                      {apiProvider === 'fal' ? 'Using Fal.ai for supported models' : 'Using Replicate API'}
                    </Text>
                  </View>
                </View>

                <View style={styles.variantButtons}>
                  <TouchableOpacity
                    style={[
                      styles.variantButton,
                      apiProvider === 'fal' && styles.apiProviderButtonActive,
                    ]}
                    onPress={() => setApiProvider('fal')}
                  >
                    <Text
                      style={[
                        styles.variantButtonText,
                        apiProvider === 'fal' && styles.apiProviderButtonTextActive,
                      ]}
                    >
                      Fal.ai
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.variantButton,
                      apiProvider === 'replicate' && styles.apiProviderButtonActive,
                    ]}
                    onPress={() => setApiProvider('replicate')}
                  >
                    <Text
                      style={[
                        styles.variantButtonText,
                        apiProvider === 'replicate' && styles.apiProviderButtonTextActive,
                      ]}
                    >
                      Replicate
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.variantNote}>
                  Fal models end with "-fal" suffix. Provider affects which endpoint is used.
                </Text>
              </View>
            </View>
          )}

          {/* Admin: Categories order */}
          {isAdmin && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Admin: Categories</Text>
              <View style={styles.card}>
                <View style={styles.variantInfo}>
                  <Folder size={ICON_SIZE} color="#FFD700" />
                  <View style={styles.variantInfoText}>
                    <Text style={styles.variantLabel}>Home category order</Text>
                    <Text style={styles.variantHint}>
                      Reorder the sections shown on the home tab. Empty categories are hidden automatically.
                    </Text>
                  </View>
                </View>

                {categoriesLoading && adminCategories.length === 0 ? (
                  <View style={{ padding: 16, alignItems: 'center' }}>
                    <ActivityIndicator color="#9ca3af" />
                  </View>
                ) : adminCategories.length === 0 ? (
                  <Text style={[styles.variantNote, { marginTop: 12 }]}>No categories found.</Text>
                ) : (
                  <View style={{ marginTop: 8 }}>
                    {adminCategories.map((cat, index) => {
                      const isFirst = index === 0;
                      const isLast = index === adminCategories.length - 1;
                      const busy = reorderingSlug === cat.slug;
                      const isEditing = editingSlug === cat.slug;

                      if (isEditing) {
                        return (
                          <View key={cat.slug} style={styles.categoryEditForm}>
                            <Text style={styles.categoryEditSlugLabel}>
                              Slug: <Text style={styles.categoryEditSlugValue}>{cat.slug}</Text>
                            </Text>
                            <Text style={styles.categoryEditSlugHint}>Slug cannot be changed.</Text>
                            <TextInput
                              style={styles.categoryEditInput}
                              value={editTitle}
                              onChangeText={setEditTitle}
                              placeholder="Title"
                              placeholderTextColor="#6b7280"
                              autoCapitalize="sentences"
                            />
                            <TextInput
                              style={styles.categoryEditInput}
                              value={editSubtitle}
                              onChangeText={setEditSubtitle}
                              placeholder="Subtitle (optional)"
                              placeholderTextColor="#6b7280"
                              autoCapitalize="sentences"
                            />
                            <View style={styles.categoryFormActions}>
                              <TouchableOpacity
                                style={[styles.button, isSavingEdit && styles.buttonDisabled]}
                                onPress={cancelEditCategory}
                                disabled={isSavingEdit}
                              >
                                <Text style={styles.buttonText}>Cancel</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.button,
                                  styles.buttonPrimary,
                                  (isSavingEdit || !editTitle.trim()) && styles.buttonDisabled,
                                ]}
                                onPress={saveEditCategory}
                                disabled={isSavingEdit || !editTitle.trim()}
                              >
                                {isSavingEdit ? (
                                  <ActivityIndicator size="small" color="#fff" />
                                ) : (
                                  <Text style={styles.buttonText}>Save</Text>
                                )}
                              </TouchableOpacity>
                            </View>
                          </View>
                        );
                      }

                      return (
                        <View key={cat.slug} style={styles.categoryRow}>
                          <Text style={styles.categoryRowTitle} numberOfLines={1}>{cat.title}</Text>
                          <View style={styles.categoryRowButtons}>
                            <TouchableOpacity
                              disabled={busy}
                              onPress={() => startEditCategory(cat)}
                              style={[styles.categoryArrowBtn, busy && styles.categoryArrowBtnDisabled]}
                              hitSlop={6}
                            >
                              <Pencil size={16} color={busy ? '#3f3f46' : '#fff'} />
                            </TouchableOpacity>
                            <TouchableOpacity
                              disabled={isFirst || busy}
                              onPress={() => swapCategoryWithNeighbor(index, 'up')}
                              style={[styles.categoryArrowBtn, (isFirst || busy) && styles.categoryArrowBtnDisabled]}
                              hitSlop={6}
                            >
                              <ArrowUp size={18} color={isFirst || busy ? '#3f3f46' : '#fff'} />
                            </TouchableOpacity>
                            <TouchableOpacity
                              disabled={isLast || busy}
                              onPress={() => swapCategoryWithNeighbor(index, 'down')}
                              style={[styles.categoryArrowBtn, (isLast || busy) && styles.categoryArrowBtnDisabled]}
                              hitSlop={6}
                            >
                              <ArrowDown size={18} color={isLast || busy ? '#3f3f46' : '#fff'} />
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}

                {showCreateCategoryForm ? (
                  <View style={styles.categoryEditForm}>
                    <TextInput
                      style={styles.categoryEditInput}
                      value={newCatSlug}
                      onChangeText={(t) => setNewCatSlug(t.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                      placeholder="Slug (e.g. portraits)"
                      placeholderTextColor="#6b7280"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <TextInput
                      style={styles.categoryEditInput}
                      value={newCatTitle}
                      onChangeText={setNewCatTitle}
                      placeholder="Title"
                      placeholderTextColor="#6b7280"
                      autoCapitalize="sentences"
                    />
                    <TextInput
                      style={styles.categoryEditInput}
                      value={newCatSubtitle}
                      onChangeText={setNewCatSubtitle}
                      placeholder="Subtitle (optional)"
                      placeholderTextColor="#6b7280"
                      autoCapitalize="sentences"
                    />
                    <View style={styles.categoryFormActions}>
                      <TouchableOpacity
                        style={[styles.button, isCreatingCategory && styles.buttonDisabled]}
                        onPress={cancelCreateCategory}
                        disabled={isCreatingCategory}
                      >
                        <Text style={styles.buttonText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.button,
                          styles.buttonPrimary,
                          (isCreatingCategory || !newCatSlug.trim() || !newCatTitle.trim()) && styles.buttonDisabled,
                        ]}
                        onPress={createCategory}
                        disabled={isCreatingCategory || !newCatSlug.trim() || !newCatTitle.trim()}
                      >
                        {isCreatingCategory ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.buttonText}>Create</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.button, { margin: 16 }]}
                    onPress={openCreateCategoryForm}
                  >
                    <Plus size={16} color="#fff" />
                    <Text style={styles.buttonText}>Add category</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* Admin: Model categories (Home tab) */}
          {isAdmin && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Admin: Model categories</Text>
              <View style={styles.card}>
                <AdminModelCategoriesEditor />
              </View>
            </View>
          )}

          {/* Admin: Clear models cache */}
          {isAdmin && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Admin: Models cache</Text>
              <View style={styles.card}>
                <Text style={styles.variantNote}>
                  Force-refresh the in-memory models cache. Use after editing models in Supabase to see changes immediately.
                </Text>
                <TouchableOpacity
                  style={[styles.button, { margin: 16 }]}
                  onPress={async () => {
                    try {
                      await invalidateModelsCache();
                      await preloadModelsCache();
                      Alert.alert('Done', 'Models cache cleared and reloaded.');
                    } catch (e: any) {
                      Alert.alert('Error', e?.message ?? 'Failed to clear cache');
                    }
                  }}
                >
                  <RefreshCw size={16} color="#fff" />
                  <Text style={styles.buttonText}>Clear models cache</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Admin: Check Empty State in Library */}
          {isAdmin && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Admin: Empty States</Text>
              <View style={styles.card}>
                <SettingRow
                  icon={<Library size={ICON_SIZE} color={ICON_COLOR} />}
                  label="Show Library Empty State"
                  value={forceLibraryEmptyState}
                  onToggle={setForceLibraryEmptyState}
                />
                <Text style={styles.variantNote}>
                  Force show empty state in Library tab for testing (without deleting posts)
                </Text>
              </View>
            </View>
          )}

          {/* Admin: Paywall Preview Mode */}
          {isAdmin && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Admin: Paywall Preview</Text>
              <View style={styles.card}>
                <SettingRow
                  icon={<Eye size={ICON_SIZE} color={ICON_COLOR} />}
                  label="Force Preview Mode"
                  value={paywallPreviewEnabled}
                  onToggle={async (enabled) => {
                    setPaywallPreviewEnabled(enabled);
                    await setPaywallPreviewMode(enabled);
                  }}
                />
                <Text style={styles.variantNote}>
                  Show mock paywall data for UI testing in dev builds.{'\n'}
                  When enabled, opens paywall with placeholder products.
                </Text>
                <TouchableOpacity
                  style={[styles.button, { margin: 16, marginBottom: 8 }]}
                  onPress={() => {
                    onClose();
                    setTimeout(() => showCustomPaywall('admin_test'), 300);
                  }}
                >
                  <Text style={styles.buttonText}>Test Paywall</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, { marginHorizontal: 16, marginBottom: 16 }]}
                  onPress={() => {
                    onClose();
                    setTimeout(() => showCustomPaywall('admin_test_onboarding'), 300);
                  }}
                >
                  <Text style={styles.buttonText}>Test Onboarding Paywall</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Admin: Reset Onboarding */}
          {isAdmin && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Admin: Onboarding</Text>
              <View style={styles.card}>
                <View style={styles.variantInfo}>
                  <Sparkles size={ICON_SIZE} color="#FFD700" />
                  <View style={styles.variantInfoText}>
                    <Text style={styles.variantLabel}>Lab Onboarding</Text>
                    <Text style={styles.variantHint}>
                      Status: {hasCompletedOnboarding ? 'Completed' : 'Not completed'}
                    </Text>
                  </View>
                </View>

                <SettingRow
                  icon={<Sparkles size={ICON_SIZE} color={ICON_COLOR} />}
                  label="Force hard paywall flow"
                  value={hardPaywallOnbEnabled}
                  onToggle={async (val) => {
                    setHardPaywallOnbEnabled(val);
                    await setHardPaywallAdminOverride(val);
                  }}
                />
                <Text style={styles.variantNote}>
                  On = choose photo → selfie → generation → hard paywall on THIS
                  device only. Tap Show Onboarding below to re-run. Real users are
                  unaffected (remote config stays off).
                </Text>

                <TouchableOpacity
                  style={[styles.button, { margin: 16, marginBottom: 8 }]}
                  onPress={() => {
                    onClose();
                    showOnboarding();
                  }}
                >
                  <Play size={16} color="#fff" />
                  <Text style={styles.buttonText}>Show Onboarding</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.button, { marginHorizontal: 16, marginBottom: 16 }]}
                  onPress={() => {
                    Alert.alert(
                      'Reset Onboarding',
                      'This will show the onboarding flow again on next app launch.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Reset',
                          onPress: async () => {
                            await resetOnboarding();
                            Alert.alert('Done', 'Onboarding will show on next launch');
                          },
                        },
                      ]
                    );
                  }}
                >
                  <RotateCcw size={16} color="#fff" />
                  <Text style={styles.buttonText}>Reset Onboarding</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Admin: Facebook Events Test */}
          {isAdmin && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Admin: Facebook Events</Text>
              <View style={styles.card}>
                <TouchableOpacity
                  style={[styles.button, { margin: 16, marginBottom: 8 }]}
                  onPress={() => {
                    logFBEvent('TestEvent', 1, { source: 'admin_settings' });
                    Alert.alert('Sent', 'TestEvent sent to Facebook');
                  }}
                >
                  <Play size={16} color="#fff" />
                  <Text style={styles.buttonText}>Send Test Event</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, { marginHorizontal: 16, marginBottom: 16 }]}
                  onPress={() => {
                    logFBEvent('fb_mobile_purchase', 9.99, { fb_currency: 'USD', fb_content_id: 'test_purchase' });
                    Alert.alert('Sent', 'Test purchase event sent to Facebook');
                  }}
                >
                  <Play size={16} color="#fff" />
                  <Text style={styles.buttonText}>Send Test Purchase Event</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Sign Out - at the bottom, only when authenticated */}
          {isAuthenticated && (
            <View style={styles.section}>
              <View style={styles.card}>
                <TouchableOpacity style={styles.signOutRow} onPress={handleSignOut}>
                  <LogOut size={18} color="#ef4444" />
                  <Text style={styles.signOutText}>{t('settings.signOut')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={styles.footer} />
        </ScrollView>
      </View>

      {/* Soul Creation/Edit Modal */}
      <CreateSoulModal
        visible={soulModalVisible}
        onClose={() => {
          setSoulModalVisible(false);
          setEditingSoul(null);
        }}
        onSave={handleSaveSoul}
        editingSoul={editingSoul}
      />

      {/* My Recipes Modal */}
      <MyRecipesModal
        visible={showRecipesModal}
        onClose={() => setShowRecipesModal(false)}
        recipes={localRecipes}
        onRecipesChange={loadLocalRecipes}
      />
      {/* Message the founder */}
      <FounderMessageModal
        visible={showFounderMessage}
        onClose={() => setShowFounderMessage(false)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  balanceBlock: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
    alignItems: 'center',
  },
  freeGenerationsBlock: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
    alignItems: 'center',
  },
  freeGenLabel: {
    color: '#9ca3af',
    fontSize: 14,
    marginBottom: 8,
  },
  freeGenNumber: {
    color: '#fff',
    fontSize: 72,
    fontWeight: '700',
    lineHeight: 80,
    marginBottom: 20,
  },
  freeGenHint: {
    color: '#6b7280',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 16,
  },
  balanceContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  balanceAmount: {
    color: '#FFD700',
    fontSize: 42,
    fontFamily: 'Manrope-Regular',
  },
  buyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fff',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    width: '100%',
  },
  buyButtonText: {
    color: '#111',
    fontSize: 16,
    fontWeight: '600',
  },
  balanceHint: {
    color: '#6b7280',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 16,
  },
  subscriptionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  subscriptionBadgeText: {
    color: '#FFD700',
    fontSize: 13,
    fontWeight: '600',
  },
  subscriptionBadgeSeparator: {
    color: 'rgba(255, 215, 0, 0.4)',
    fontSize: 13,
  },
  subscriptionBadgeDetail: {
    color: 'rgba(255, 215, 0, 0.7)',
    fontSize: 12,
  },
  coinBalanceDisplay: {
    alignItems: 'center',
    marginBottom: 16,
  },
  coinBalanceNumber: {
    color: '#fff',
    fontSize: 48,
    fontWeight: '400',
    fontFamily: 'Manrope-Regular',
  },
  coinBalanceLabel: {
    color: '#9ca3af',
    fontSize: 14,
    marginTop: -4,
  },
  subscriptionStatusBlock: {
    alignItems: 'center',
    marginBottom: 16,
  },
  restoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginTop: 8,
  },
  restoreButtonText: {
    color: '#6b7280',
    fontSize: 14,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    marginLeft: 4,
    marginRight: 4,
  },
  sectionTitle: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionCount: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '500',
  },
  tabsPendingCaption: {
    color: '#f59e0b',
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingLabel: {
    color: '#fff',
    fontSize: 15,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  statusText: {
    color: '#6b7280',
    fontSize: 15,
  },
  statusActive: {
    color: '#10b981',
  },
  howItWorksSection: {
    borderTopWidth: 1,
    borderTopColor: '#222',
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  securityCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  securityCardContent: {
    flex: 1,
  },
  securityCardTitle: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 3,
  },
  securityCardText: {
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 16,
  },
  howItWorksTitle: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 12,
  },
  howItWorksStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  howItWorksStepLast: {
    marginBottom: 8,
  },
  howItWorksNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#333',
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 22,
    overflow: 'hidden',
  },
  howItWorksText: {
    flex: 1,
    color: '#d1d5db',
    fontSize: 14,
    lineHeight: 20,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    paddingVertical: 8,
  },
  inputButton: {
    padding: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 16,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#333',
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonPrimary: {
    backgroundColor: '#374151',
  },
  buttonDanger: {
    backgroundColor: '#7f1d1d',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  linkText: {
    color: '#6b7280',
    fontSize: 14,
  },
  linkTextDanger: {
    color: '#ef4444',
    fontSize: 14,
  },
  linkTextPrimary: {
    color: '#3b82f6',
    fontSize: 14,
  },
  signInContainer: {
    padding: 16,
    alignItems: 'center',
  },
  signInText: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
  },
  signInButton: {
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 24,
    backgroundColor: '#fff',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signInButtonText: {
    color: '#111',
    fontSize: 16,
    fontWeight: '600',
  },
  addKeyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  addKeyText: {
    color: '#3b82f6',
    fontSize: 15,
    fontWeight: '500',
  },
  signOutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  signOutText: {
    color: '#ef4444',
    fontSize: 15,
    fontWeight: '500',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  founderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  founderRowSubtext: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    color: '#6b7280',
    fontSize: 12,
    marginBottom: 2,
  },
  infoValue: {
    color: '#fff',
    fontSize: 15,
  },
  footer: {
    height: 40,
  },
  // Admin variant switcher styles
  variantInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  variantInfoText: {
    flex: 1,
  },
  variantLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
  },
  variantHint: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },
  variantButtons: {
    flexDirection: 'row',
    gap: 8,
    padding: 16,
  },
  variantButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#333',
  },
  variantButtonActive: {
    backgroundColor: '#FFD700',
  },
  variantButtonText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '500',
  },
  variantButtonTextActive: {
    color: '#111',
  },
  resetVariantButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  resetVariantText: {
    color: '#6b7280',
    fontSize: 13,
  },
  variantNote: {
    color: '#6b7280',
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  // Admin category reorder row
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#262626',
  },
  categoryRowTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    paddingRight: 12,
  },
  categoryRowButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  categoryArrowBtn: {
    width: 36,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#1f1f1f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryArrowBtnDisabled: {
    opacity: 0.45,
  },
  categoryEditForm: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#262626',
    gap: 8,
  },
  categoryEditSlugLabel: {
    color: '#9ca3af',
    fontSize: 13,
  },
  categoryEditSlugValue: {
    color: '#fff',
    fontFamily: 'Menlo',
  },
  categoryEditSlugHint: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: -4,
    marginBottom: 4,
  },
  categoryEditInput: {
    backgroundColor: '#1f1f1f',
    color: '#fff',
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  categoryFormActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  // API Provider styles
  apiProviderButtonActive: {
    backgroundColor: '#FFD700',
  },
  apiProviderButtonTextActive: {
    color: '#111',
  },
  // Souls section styles
  emptySection: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  emptySectionText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    marginTop: 12,
  },
  emptySectionSubtext: {
    color: '#6b7280',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
  },
  addRecipeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#3b82f6',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 16,
  },
  addRecipeButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  soulsScrollContent: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 12,
  },
  soulCard: {
    width: 100,
    alignItems: 'center',
  },
  soulImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#222',
  },
  soulName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 8,
    textAlign: 'center',
    maxWidth: 90,
  },
  soulImageCount: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 2,
  },
  addItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  addItemText: {
    color: '#3b82f6',
    fontSize: 15,
    fontWeight: '500',
  },
  // Recipes section styles
  recipesScrollContent: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 12,
  },
  recipeCard: {
    width: 140,
  },
  recipeCardImageContainer: {
    position: 'relative',
    borderRadius: 10,
    overflow: 'hidden',
  },
  recipeCardImage: {
    width: 140,
    height: 100,
    backgroundColor: '#222',
  },
  recipeCardPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  recipeStepsBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  recipeStepsBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  recipeCardName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 8,
    lineHeight: 16,
  },
  viewAllCard: {
    width: 100,
    height: 100,
    borderRadius: 10,
    backgroundColor: '#222',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#333',
    borderStyle: 'dashed',
  },
  viewAllCount: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  viewAllText: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 4,
  },
});
