/**
 * HybridPaywallModal - Coin packs paywall for premium users
 *
 * Shows coin pack options for users who already have a subscription
 * but need more coins. User selects a pack, then taps Continue to purchase.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Dimensions,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import Purchases, { PurchasesPackage } from 'react-native-purchases';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { logAFPurchase } from '../../lib/appsflyer';
import { useTranslation } from 'react-i18next';
import { X, RotateCcw, Infinity as InfinityIcon, Camera, Layers, Sparkles } from 'lucide-react-native';
// Mock packages for dev mode (when RevenueCat unavailable in Expo Go)
interface MockPackage {
  identifier: string;
  product: {
    identifier: string;
    priceString: string;
  };
  packageType: string;
}

const MOCK_PACKAGES: MockPackage[] = [
  {
    identifier: '$rc_monthly',
    product: { identifier: 'lab.monthly.2000', priceString: '$9.99' },
    packageType: 'MONTHLY',
  },
  {
    identifier: 'coins_500',
    product: { identifier: 'lab.coins.500', priceString: '$4.99' },
    packageType: 'CONSUMABLE',
  },
  {
    identifier: 'coins_2000',
    product: { identifier: 'lab.coins.2000', priceString: '$19.99' },
    packageType: 'CONSUMABLE',
  },
];

export const PREVIEW_MODE_KEY = 'paywall_preview_mode';

export const setPaywallPreviewMode = async (enabled: boolean) => {
  await AsyncStorage.setItem(PREVIEW_MODE_KEY, enabled ? 'true' : 'false');
};

export const getPaywallPreviewMode = async (): Promise<boolean> => {
  const value = await AsyncStorage.getItem(PREVIEW_MODE_KEY);
  return value === 'true';
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const ACCENT = '#FF2D95';
const ROUNDED_FONT = 'SFRounded-Medium';

interface HybridPaywallModalProps {
  visible: boolean;
  onClose: () => void;
  onPurchaseComplete?: () => void;
  trigger?: string;
}

const COIN_AMOUNTS: Record<string, number> = {
  // Lab app products
  'monthly_2000': 2000,
  'coins_500': 500,
  'coins_2000': 2000,
  // Legacy/consumer app products
  'lab.monthly.2000': 2000,
  'lab.coins.500': 500,
  'lab.coins.2000': 2000,
};

type PackageType = PurchasesPackage | MockPackage;

export default function HybridPaywallModal({
  visible,
  onClose,
  onPurchaseComplete,
  trigger = 'unknown',
}: HybridPaywallModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [coinPacks, setCoinPacks] = useState<PackageType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      loadOfferings();
    }
  }, [visible]);

  useEffect(() => {
    if (coinPacks.length > 0 && !selectedOption) {
      setSelectedOption(coinPacks[0].identifier);
    }
  }, [coinPacks]);

  const loadMockOfferings = () => {
    console.log('📦 Loading MOCK packages (preview mode)');
    setPreviewMode(true);

    const coins = MOCK_PACKAGES.filter(p => {
      const prodId = p.product.identifier.toLowerCase();
      return prodId.includes('coins') && !prodId.includes('monthly');
    });
    coins.sort((a, b) => {
      const aCoins = COIN_AMOUNTS[a.product.identifier] || 0;
      const bCoins = COIN_AMOUNTS[b.product.identifier] || 0;
      return aCoins - bCoins;
    });
    setCoinPacks(coins);
  };

  const loadOfferings = async () => {
    try {
      setLoading(true);
      setError(null);
      setPreviewMode(false);
      setSelectedOption(null);

      const offerings = await Purchases.getOfferings();
      console.log('📦 RevenueCat offerings:', {
        hasAll: !!offerings.all,
        allKeys: Object.keys(offerings.all || {}),
        hasCurrent: !!offerings.current,
        currentId: offerings.current?.identifier,
      });

      // Try specific offering ID first, then fall back to current
      const offering = offerings.all['ofrng5d4192a7e8'] || offerings.current;

      console.log('📦 Selected offering:', {
        id: offering?.identifier,
        packageCount: offering?.availablePackages?.length || 0,
      });

      if (!offering) {
        console.log('📦 No offering found');
        if (__DEV__) {
          console.log('📦 DEV mode: falling back to mock offerings');
          loadMockOfferings();
          setLoading(false);
          return;
        }
        const availableKeys = Object.keys(offerings.all || {});
        setError(`No offering found. Available: ${availableKeys.length > 0 ? availableKeys.join(', ') : 'none'}. Make sure offering is marked as "Current" in RevenueCat.`);
        setLoading(false);
        return;
      }

      if (offering.availablePackages.length === 0) {
        console.log('📦 Offering has no packages');
        if (__DEV__) {
          console.log('📦 DEV mode: falling back to mock offerings');
          loadMockOfferings();
          setLoading(false);
          return;
        }
        setError(`Offering "${offering.identifier}" has no packages. Add packages in RevenueCat dashboard.`);
        setLoading(false);
        return;
      }

      const packages = offering.availablePackages;
      console.log('📦 Available packages:', packages.map(p => ({
        id: p.identifier,
        product: p.product.identifier,
        price: p.product.priceString,
        type: p.packageType,
      })));

      // Find coin/consumable packages only
      const coins = packages.filter(p => {
        const prodId = p.product.identifier.toLowerCase();
        const pkgId = p.identifier.toLowerCase();
        return (prodId.includes('coins') || pkgId.includes('coins') ||
                p.packageType === 'CUSTOM') &&
               !prodId.includes('monthly') && !prodId.includes('subscription');
      });
      coins.sort((a, b) => {
        const aCoins = COIN_AMOUNTS[a.product.identifier] || 0;
        const bCoins = COIN_AMOUNTS[b.product.identifier] || 0;
        return aCoins - bCoins;
      });
      setCoinPacks(coins);

      // If no coin packs found, show all non-subscription packages
      if (coins.length === 0 && packages.length > 0) {
        console.log('📦 No coin packs found, showing all non-subscription packages');
        const nonSub = packages.filter(p =>
          p.packageType !== 'MONTHLY' && p.packageType !== 'ANNUAL' &&
          p.packageType !== 'WEEKLY'
        );
        setCoinPacks(nonSub.length > 0 ? nonSub : packages);
      }

    } catch (err) {
      console.error('Failed to load offerings:', err);
      if (__DEV__) {
        console.log('📦 DEV mode: falling back to mock offerings');
        loadMockOfferings();
      } else {
        setError(`Failed to load offerings: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const getSelectedPackage = (): PackageType | null => {
    if (!selectedOption) return null;
    return coinPacks.find(p => p.identifier === selectedOption) || null;
  };

  const handlePurchase = async () => {
    const pkg = getSelectedPackage();
    if (!pkg) return;

    if (previewMode) {
      Alert.alert(
        t('paywall.hybrid.previewModeTitle'),
        t('paywall.hybrid.previewPurchaseMsg', { product: pkg.product.identifier, price: pkg.product.priceString }),
        [{ text: t('common.ok') }]
      );
      return;
    }

    try {
      setPurchasing(true);
      const { customerInfo } = await Purchases.purchasePackage(pkg as PurchasesPackage);
      console.log('Purchase completed:', pkg.product.identifier);
      // Fire af_purchase for coin packs (consumables). Subscriptions are handled by
      // the false→true edge in SubscriptionContext; coin packs never hit that path,
      // so without this the purchase signal to Meta/AppsFlyer misses consumable revenue.
      logAFPurchase({
        revenue: pkg.product.price,
        currency: pkg.product.currencyCode,
        productId: pkg.product.identifier,
      });
      await new Promise(resolve => setTimeout(resolve, 1500));
      onPurchaseComplete?.();
      onClose();
    } catch (err: any) {
      if (err.userCancelled) {
        console.log('User cancelled purchase');
        return;
      }
      console.error('Purchase failed:', err);
      setError(t('paywall.hybrid.purchaseFailedError'));
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    if (previewMode) {
      Alert.alert(t('paywall.hybrid.previewModeTitle'), t('paywall.hybrid.restorePreviewMsg'), [{ text: t('common.ok') }]);
      return;
    }

    try {
      setRestoring(true);
      const customerInfo = await Purchases.restorePurchases();
      const hasActiveEntitlements = Object.keys(customerInfo.entitlements.active).length > 0;

      setError(null);

      if (hasActiveEntitlements) {
        console.log('Restore found active entitlements:', Object.keys(customerInfo.entitlements.active));
        Alert.alert(t('paywall.restoredTitle'), t('paywall.restoredMsg'), [
          {
            text: t('common.ok'),
            onPress: () => {
              onPurchaseComplete?.();
              onClose();
            }
          }
        ]);
      } else {
        Alert.alert(t('paywall.noPurchasesTitle'), t('paywall.noPurchasesMsg'));
      }
    } catch (err) {
      console.error('Restore failed:', err);
      setError(t('paywall.hybrid.restoreFailedError'));
    } finally {
      setRestoring(false);
    }
  };

  const getCoinAmount = (pkg: PackageType): number => {
    const prodId = pkg.product.identifier;
    if (COIN_AMOUNTS[prodId]) return COIN_AMOUNTS[prodId];
    const match = pkg.identifier.match(/coins[_.]?(\d+)/i) ||
                  pkg.product.identifier.match(/coins[_.]?(\d+)/i);
    if (match) return parseInt(match[1], 10);
    return 0;
  };

  const formatPrice = (pkg: PackageType) => pkg.product.priceString;

  // Value estimates: edits/effects ~20 coins, Copy Shot Basic = 100, Pro 4K = 250
  const getValueEstimates = () => {
    const pkg = getSelectedPackage();
    if (!pkg) return null;
    const coins = getCoinAmount(pkg);
    const edits = Math.floor(coins / 20);
    const basic = Math.floor(coins / 100);
    const pro = Math.floor(coins / 250);
    return { edits, basic, pro };
  };

  const getButtonText = (): string => {
    const pkg = getSelectedPackage();
    if (!pkg) return t('paywall.hybrid.selectOption');

    const coins = getCoinAmount(pkg);
    return t('paywall.hybrid.buyCoins', { coins: coins.toLocaleString(), price: formatPrice(pkg) });
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: (Platform.OS === 'android' ? insets.top : 0) + 60 }]}>
          <TouchableOpacity onPress={onClose} style={[styles.closeButton, { top: (Platform.OS === 'android' ? insets.top : 0) + 60 }]}>
            <X size={24} color="#6b7280" />
          </TouchableOpacity>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{t('paywall.hybrid.title')}</Text>
            {previewMode && <View style={styles.previewDot} />}
          </View>
          <Text style={styles.subtitle}>{t('paywall.hybrid.subtitle')}</Text>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={ACCENT} />
            <Text style={styles.loadingText}>{t('paywall.hybrid.loading')}</Text>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={loadOfferings} style={styles.retryButton}>
              <Text style={styles.retryText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <ScrollView
              style={styles.content}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
              {/* Coin packs */}
              {coinPacks.length > 0 && (
                <View style={styles.secondarySection}>
                  <Text style={styles.secondaryTitle}>{t('paywall.hybrid.selectCoinPack')}</Text>
                  <View style={styles.coinPacksRow}>
                    {coinPacks.map((pkg) => {
                      const coins = getCoinAmount(pkg);
                      const isSelected = selectedOption === pkg.identifier;
                      return (
                        <TouchableOpacity
                          key={pkg.identifier}
                          style={[
                            styles.coinPackPill,
                            isSelected && styles.coinPackPillSelected,
                          ]}
                          onPress={() => setSelectedOption(pkg.identifier)}
                          activeOpacity={0.8}
                        >
                          <Text style={[
                            styles.coinPackPillText,
                            isSelected && styles.coinPackPillTextSelected,
                          ]}>
                            {t('paywall.hybrid.coinsLabel', { coins: coins.toLocaleString() })}
                          </Text>
                          <Text style={[
                            styles.coinPackPillPrice,
                            isSelected && styles.coinPackPillPriceSelected,
                          ]}>
                            {formatPrice(pkg)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Value estimates */}
              {(() => {
                const vals = getValueEstimates();
                if (!vals) return null;
                return (
                  <View style={styles.valueSection}>
                    <View style={styles.valueRow}>
                      <Sparkles size={16} color={ACCENT} />
                      <Text style={styles.valueText}>
                        {t('paywall.hybrid.editsEstimate', { n: vals.edits })}
                      </Text>
                    </View>
                    <View style={styles.valueRow}>
                      <Camera size={16} color={ACCENT} />
                      <Text style={styles.valueText}>
                        {t('paywall.hybrid.basicShootsEstimate', { n: vals.basic })}
                      </Text>
                    </View>
                    <View style={styles.valueRow}>
                      <Layers size={16} color={ACCENT} />
                      <Text style={styles.valueText}>
                        {t('paywall.hybrid.proShootsEstimate', { n: vals.pro })}
                      </Text>
                    </View>
                  </View>
                );
              })()}

              {/* Never expire badge */}
              <View style={styles.neverExpireBadge}>
                <InfinityIcon size={14} color="#6b7280" />
                <Text style={styles.neverExpireText}>{t('paywall.hybrid.neverExpire')}</Text>
              </View>
            </ScrollView>

            {/* Fixed Bottom: CTA + Links */}
            <View style={styles.bottomFixed}>
              <TouchableOpacity
                style={[
                  styles.ctaButton,
                  (!selectedOption || purchasing) && styles.ctaButtonDisabled,
                ]}
                onPress={handlePurchase}
                disabled={!selectedOption || purchasing}
                activeOpacity={0.8}
              >
                {purchasing ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={styles.ctaButtonText}>{getButtonText()}</Text>
                )}
              </TouchableOpacity>

              {/* Footer Links - under button */}
              <View style={styles.footerLinks}>
                <TouchableOpacity
                  style={styles.footerLinkButton}
                  onPress={handleRestore}
                  disabled={restoring}
                >
                  {restoring ? (
                    <ActivityIndicator size="small" color="#6b7280" />
                  ) : (
                    <>
                      <RotateCcw size={14} color="#6b7280" />
                      <Text style={styles.footerLinkText}>{t('paywall.restore')}</Text>
                    </>
                  )}
                </TouchableOpacity>
                <Text style={styles.footerDivider}>•</Text>
                <TouchableOpacity
                  style={styles.footerLinkButton}
                  onPress={() => Linking.openURL('https://funky-calliandra-0c0.notion.site/TERMS-OF-USE-EULA-Aya-Photo-Lab-2b77de5fc1c9806689c0d6ba6569f8f5')}
                >
                  <Text style={styles.footerLinkText}>{t('paywall.terms')}</Text>
                </TouchableOpacity>
                <Text style={styles.footerDivider}>•</Text>
                <TouchableOpacity
                  style={styles.footerLinkButton}
                  onPress={() => Linking.openURL('https://funky-calliandra-0c0.notion.site/PRIVACY-POLICY-Aya-Photo-Lab-2b77de5fc1c980c1b582fe72cdbc5d8d')}
                >
                  <Text style={styles.footerLinkText}>{t('paywall.privacy')}</Text>
                </TouchableOpacity>
              </View>

            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 24,
    paddingBottom: 16,
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    padding: 8,
    zIndex: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontFamily: ROUNDED_FONT,
    fontSize: 72,
    fontWeight: '500',
    color: '#fff',
    letterSpacing: -2.88, // -4% of 72
  },
  previewDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ACCENT,
  },
  subtitle: {
    fontSize: 15,
    color: '#6b7280',
    marginTop: 6,
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#6b7280',
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#1a1a1a',
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  retryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  // Coin packs section
  secondarySection: {
    alignItems: 'center',
    paddingHorizontal: 0,
  },
  secondaryTitle: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 12,
  },
  coinPacksRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  coinPackPill: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
  },
  coinPackPillSelected: {
    borderColor: ACCENT,
    backgroundColor: 'rgba(255, 45, 149, 0.12)',
  },
  coinPackPillText: {
    fontFamily: ROUNDED_FONT,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 2,
  },
  coinPackPillTextSelected: {
    color: ACCENT,
  },
  coinPackPillPrice: {
    fontSize: 13,
    color: '#6b7280',
  },
  coinPackPillPriceSelected: {
    color: '#d1d5db',
  },
  // Value estimates
  valueSection: {
    marginTop: 28,
    gap: 14,
    paddingHorizontal: 4,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  valueText: {
    fontSize: 15,
    color: '#d1d5db',
    fontWeight: '500',
  },
  // Never expire badge
  neverExpireBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 24,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    alignSelf: 'center',
  },
  neverExpireText: {
    fontSize: 13,
    color: '#6b7280',
  },
  // Fixed bottom area
  bottomFixed: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    backgroundColor: '#111',
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  ctaButton: {
    backgroundColor: '#fff',
    paddingVertical: 18,
    borderRadius: 999,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaButtonDisabled: {
    opacity: 0.5,
  },
  ctaButtonText: {
    color: '#000',
    fontFamily: ROUNDED_FONT,
    fontSize: 17,
    fontWeight: '600',
  },
  // Footer links
  footerLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 14,
    gap: 8,
  },
  footerLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  footerLinkText: {
    color: '#6b7280',
    fontSize: 13,
  },
  footerDivider: {
    color: '#4b5563',
    fontSize: 13,
  },
});
