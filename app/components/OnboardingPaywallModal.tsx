/**
 * OnboardingPaywallModal - Subscription paywall shown after onboarding
 *
 * Shows Yearly + Weekly plans in a card layout matching the reference design.
 * Dark slate bg, card container, "+" prefix benefits, detailed plan cards.
 * __DEV__ builds use mock data; prod/preview builds connect to RevenueCat.
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../lib/i18n/format';
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
} from 'react-native';
import { Image } from 'expo-image';
import Purchases, { PurchasesPackage } from 'react-native-purchases';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Lock, X, RotateCcw } from 'lucide-react-native';
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Static requires — bundled at build time, loaded instantly
const HERO_IMAGES = [
  require('../../assets/onboarding/gallery/dior-editorial.jpg'),
  require('../../assets/onboarding/gallery/soft-studio-portrait.jpg'),
  require('../../assets/onboarding/gallery/tokyo-payphone.jpg'),
];

const BENEFIT_KEYS = [
  'paywall.benefits.prompts',
  'paywall.benefits.likeness',
  'paywall.benefits.savePrompts',
  'paywall.benefits.noWatermark',
  'paywall.benefits.prioritySpeed',
  'paywall.benefits.weekly',
];

interface OnboardingPaywallModalProps {
  visible: boolean;
  onClose: () => void;
  onPurchaseComplete?: () => void;
}

interface MockPackage {
  identifier: string;
  product: {
    identifier: string;
    priceString: string;
    price: number;
    currencyCode: string;
  };
  packageType: string;
}

const MOCK_YEARLY: MockPackage = {
  identifier: '$rc_annual',
  product: { identifier: 'yearly_25000', priceString: '$23.99', price: 23.99, currencyCode: 'USD' },
  packageType: 'ANNUAL',
};

const MOCK_WEEKLY: MockPackage = {
  identifier: '$rc_weekly',
  product: { identifier: 'weekly_500', priceString: '$3.99', price: 3.99, currencyCode: 'USD' },
  packageType: 'WEEKLY',
};

type PackageType = PurchasesPackage | MockPackage;

export default function OnboardingPaywallModal({
  visible,
  onClose,
  onPurchaseComplete,
}: OnboardingPaywallModalProps) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [yearlyPkg, setYearlyPkg] = useState<PackageType | null>(null);
  const [weeklyPkg, setWeeklyPkg] = useState<PackageType | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<'yearly' | 'weekly'>('yearly');
  const [isMock, setIsMock] = useState(false);

  useEffect(() => {
    if (visible) {
      loadOfferings();
    }
  }, [visible]);

  const loadMock = () => {
    console.log('📦 Onboarding paywall: using dev mock');
    setYearlyPkg(MOCK_YEARLY);
    setWeeklyPkg(MOCK_WEEKLY);
    setIsMock(true);
  };

  const loadOfferings = async () => {
    try {
      setLoading(true);
      setError(null);
      setIsMock(false);
      setSelectedPlan('yearly');

      const offerings = await Purchases.getOfferings();
      console.log('📦 RC offerings keys:', Object.keys(offerings.all));
      console.log('📦 RC current offering:', offerings.current?.identifier);
      const offering = offerings.all['ofrng5d4192a7e8'] || offerings.current;

      if (!offering || offering.availablePackages.length === 0) {
        console.warn('📦 No offering found. Available:', Object.keys(offerings.all));
        if (__DEV__) {
          loadMock();
          setLoading(false);
          return;
        }
        setError(t('paywall.loadError'));
        setLoading(false);
        return;
      }

      const packages = offering.availablePackages;
      console.log('📦 Onboarding paywall packages:', packages.map(p => ({
        id: p.identifier,
        type: p.packageType,
        price: p.product.priceString,
      })));

      const annual = packages.find(
        p => p.packageType === 'ANNUAL' || p.identifier === '$rc_annual'
      );
      const weekly = packages.find(
        p => p.packageType === 'WEEKLY' || p.identifier === '$rc_weekly'
      );

      setYearlyPkg(annual || null);
      setWeeklyPkg(weekly || null);

      // Auto-select the first available plan
      if (annual) {
        setSelectedPlan('yearly');
      } else if (weekly) {
        setSelectedPlan('weekly');
      }

      if (!annual && !weekly) {
        console.warn('📦 No yearly/weekly packages found in offering:', offering.identifier);
        if (__DEV__) loadMock();
        else setError(t('paywall.noPlans'));
      }
    } catch (err) {
      console.error('Failed to load offerings:', err);
      if (__DEV__) {
        loadMock();
      } else {
        setError(t('paywall.loadFailed'));
      }
    } finally {
      setLoading(false);
    }
  };

  const getSelectedPackage = (): PackageType | null => {
    return selectedPlan === 'yearly' ? yearlyPkg : weeklyPkg;
  };

  const handlePurchase = async () => {
    const pkg = getSelectedPackage();
    if (!pkg) return;

    if (isMock) {
      Alert.alert(
        'Dev Mode',
        `This would purchase "${pkg.product.identifier}" for ${pkg.product.priceString}.`,
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      setPurchasing(true);
      await Purchases.purchasePackage(pkg as PurchasesPackage);
      console.log('Purchase completed:', pkg.product.identifier);
      // Close immediately to prevent flash: RevenueCat listener fires instantly
      // after purchase, flipping isPremium=true in PaywallContext, which would
      // swap to HybridPaywallModal while visible is still true.
      onClose();
      await new Promise(resolve => setTimeout(resolve, 1500));
      onPurchaseComplete?.();
    } catch (err: any) {
      if (err.userCancelled) {
        console.log('User cancelled purchase');
        return;
      }
      console.error('Purchase failed:', err);
      Alert.alert(t('paywall.purchaseFailedTitle'), t('paywall.tryAgain'));
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    if (isMock) {
      Alert.alert('Dev Mode', 'Restore is not available in dev mode.', [{ text: 'OK' }]);
      return;
    }

    try {
      setRestoring(true);
      const customerInfo = await Purchases.restorePurchases();
      const hasActive = Object.keys(customerInfo.entitlements.active).length > 0;

      if (hasActive) {
        Alert.alert(t('paywall.restoredTitle'), t('paywall.restoredMsg'), [
          { text: t('common.ok'), onPress: () => { onPurchaseComplete?.(); onClose(); } },
        ]);
      } else {
        Alert.alert(t('paywall.noPurchasesTitle'), t('paywall.noPurchasesMsg'));
      }
    } catch (err) {
      console.error('Restore failed:', err);
      Alert.alert(t('paywall.restoreFailedTitle'), t('paywall.tryAgain'));
    } finally {
      setRestoring(false);
    }
  };

  const getSavePercentage = (): number | null => {
    if (!yearlyPkg || !weeklyPkg) return null;
    const weeklyAnnualized = weeklyPkg.product.price * 52;
    const yearlyPrice = yearlyPkg.product.price;
    if (weeklyAnnualized <= 0) return null;
    return Math.round(((weeklyAnnualized - yearlyPrice) / weeklyAnnualized) * 100);
  };

  const getWeeklyBreakdown = (pkg: PackageType): string => {
    const price = pkg.product.price;
    const weeklyPrice = price / 52;
    const currencyCode = pkg.product.currencyCode || 'USD';
    try {
      return formatNumber(weeklyPrice, {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch {
      return `$${weeklyPrice.toFixed(2)}`;
    }
  };

  const getCtaText = (): string => {
    const pkg = getSelectedPackage();
    if (!pkg) return t('paywall.ctaContinue');
    if (selectedPlan === 'yearly') {
      return t('paywall.ctaPerYear', { price: pkg.product.priceString });
    }
    return t('paywall.ctaPerWeek', { price: pkg.product.priceString });
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={[styles.outerContainer, { paddingTop: insets.top }]}>
        {/* Close button */}
        <TouchableOpacity onPress={onClose} style={[styles.closeButton, { top: insets.top + 8 }]}>
          <X size={22} color="#6b7280" />
        </TouchableOpacity>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 180 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        >
            {/* Hero Images */}
            <View style={styles.heroSection}>
              <View style={styles.imageStack}>
                {HERO_IMAGES.map((src, i) => (
                  <Image
                    key={i}
                    source={src}
                    style={[
                      styles.heroImage,
                      {
                        left: i * 56,
                        zIndex: 3 - i,
                        transform: [{ rotate: `${(i - 1) * 6}deg` }],
                      },
                    ]}
                    contentFit="cover"
                    priority="high"
                    cachePolicy="memory-disk"
                  />
                ))}
                <View style={styles.lockOverlay}>
                  <View style={styles.lockCircle}>
                    <Lock size={18} color="#fff" />
                  </View>
                </View>
              </View>
            </View>

            {/* Title */}
            <Text style={styles.title}>{t('paywall.unlockTitle')}</Text>
            <Text style={styles.subtitle}>{t('paywall.unlockSubtitle')}</Text>

            {/* Benefits */}
            <View style={styles.benefitsList}>
              {BENEFIT_KEYS.map((key, i) => (
                <View key={i} style={styles.benefitRow}>
                  <Text style={styles.benefitPlus}>+</Text>
                  <Text style={styles.benefitText}>{t(key)}</Text>
                </View>
              ))}
            </View>

            {/* Plan Cards */}
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#fbbf24" />
              </View>
            ) : error ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity onPress={loadOfferings} style={styles.retryButton}>
                  <Text style={styles.retryText}>{t('common.retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.plansSection}>
                {/* Yearly */}
                {yearlyPkg && (
                  <TouchableOpacity
                    style={[
                      styles.planCard,
                      selectedPlan === 'yearly' && styles.planCardSelected,
                    ]}
                    onPress={() => setSelectedPlan('yearly')}
                    activeOpacity={0.8}
                  >
                    <View style={styles.planRow}>
                      <View style={styles.planLeft}>
                        <View style={styles.planTitleRow}>
                          <View style={[
                            styles.radio,
                            selectedPlan === 'yearly' && styles.radioSelected,
                          ]}>
                            {selectedPlan === 'yearly' && <View style={styles.radioInner} />}
                          </View>
                          <Text style={styles.planName}>{t('paywall.yearly')}</Text>
                          {(() => {
                            const pct = getSavePercentage();
                            return pct && pct > 0 ? (
                              <View style={styles.saveBadge}>
                                <Text style={styles.saveBadgeText}>{t('paywall.save', { pct })}</Text>
                              </View>
                            ) : null;
                          })()}
                        </View>
                        <Text style={styles.planSubPrice}>{getWeeklyBreakdown(yearlyPkg)}{t('paywall.perWeekShort')}</Text>
                        <Text style={styles.planCoins}>{t('paywall.coinsPerYear')}</Text>
                      </View>
                      <View style={styles.planRight}>
                        <View style={styles.planPriceBlock}>
                          <Text style={[
                            styles.planBigPrice,
                            selectedPlan === 'yearly' && styles.planBigPriceActive,
                          ]}>
                            {yearlyPkg.product.priceString}
                          </Text>
                          <Text style={styles.planPricePeriod}>{t('paywall.perYearShort')}</Text>
                        </View>
                        <Text style={styles.planImages}>{t('paywall.imagesApprox', { n: '5,000' })}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                )}

                {/* Weekly */}
                {weeklyPkg && (
                  <TouchableOpacity
                    style={[
                      styles.planCard,
                      selectedPlan === 'weekly' && styles.planCardSelected,
                    ]}
                    onPress={() => setSelectedPlan('weekly')}
                    activeOpacity={0.8}
                  >
                    <View style={styles.planRow}>
                      <View style={styles.planLeft}>
                        <View style={styles.planTitleRow}>
                          <View style={[
                            styles.radio,
                            selectedPlan === 'weekly' && styles.radioSelected,
                          ]}>
                            {selectedPlan === 'weekly' && <View style={styles.radioInner} />}
                          </View>
                          <Text style={styles.planName}>{t('paywall.weekly')}</Text>
                        </View>
                        <Text style={styles.planSubPrice}>{t('paywall.billedWeekly')}</Text>
                        <Text style={styles.planCoins}>{t('paywall.weeklyCoins')}</Text>
                      </View>
                      <View style={styles.planRight}>
                        <View style={styles.planPriceBlock}>
                          <Text style={[
                            styles.planBigPrice,
                            selectedPlan === 'weekly' && styles.planBigPriceActive,
                          ]}>
                            {weeklyPkg.product.priceString}
                          </Text>
                          <Text style={styles.planPricePeriod}>{t('paywall.perWeekShort')}</Text>
                        </View>
                        <Text style={styles.planImages}>{t('paywall.imagesApprox', { n: '80' })}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            )}
        </ScrollView>

        {/* Fixed Bottom */}
        <LinearGradient
          colors={['transparent', '#0a0a0a', '#0a0a0a']}
          style={[styles.bottomFixed, { paddingBottom: Math.max(insets.bottom, 20) }]}
        >
          <TouchableOpacity
            style={[
              styles.ctaButton,
              (purchasing || loading || (!yearlyPkg && !weeklyPkg)) && styles.ctaButtonDisabled,
            ]}
            onPress={handlePurchase}
            disabled={purchasing || loading || (!yearlyPkg && !weeklyPkg)}
            activeOpacity={0.8}
          >
            {purchasing ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.ctaButtonText}>{getCtaText()}</Text>
            )}
          </TouchableOpacity>

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
                  <RotateCcw size={12} color="#6b7280" />
                  <Text style={styles.footerLinkText}>{t('paywall.restore')}</Text>
                </>
              )}
            </TouchableOpacity>
            <Text style={styles.footerDot}>&bull;</Text>
            <TouchableOpacity
              style={styles.footerLinkButton}
              onPress={() => Linking.openURL('https://funky-calliandra-0c0.notion.site/TERMS-OF-USE-EULA-Aya-Photo-Lab-2b77de5fc1c9806689c0d6ba6569f8f5')}
            >
              <Text style={styles.footerLinkText}>{t('paywall.terms')}</Text>
            </TouchableOpacity>
            <Text style={styles.footerDot}>&bull;</Text>
            <TouchableOpacity
              style={styles.footerLinkButton}
              onPress={() => Linking.openURL('https://funky-calliandra-0c0.notion.site/PRIVACY-POLICY-Aya-Photo-Lab-2b77de5fc1c980c1b582fe72cdbc5d8d')}
            >
              <Text style={styles.footerLinkText}>{t('paywall.privacy')}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.disclaimer}>{t('paywall.autoRenew')}</Text>
        </LinearGradient>
      </View>
    </Modal>
  );
}

const HERO_W = 90;
const HERO_H = 120;

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  // Close
  closeButton: {
    position: 'absolute',
    right: 16,
    padding: 8,
    zIndex: 20,
  },
  // Hero
  heroSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  imageStack: {
    width: 200,
    height: HERO_H + 10,
    position: 'relative',
  },
  heroImage: {
    position: 'absolute',
    width: HERO_W,
    height: HERO_H,
    borderRadius: 12,
    top: 0,
  },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  lockCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  // Title
  title: {
    fontFamily: 'Manrope-Bold',
    fontSize: 24,
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'Manrope-Regular',
    fontSize: 15,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 24,
  },
  subtitleBold: {
    fontFamily: 'Manrope-Bold',
    color: '#d1d5db',
  },
  // Benefits
  benefitsList: {
    gap: 10,
    marginBottom: 24,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  benefitPlus: {
    fontFamily: 'Manrope-Medium',
    fontSize: 16,
    color: '#6b7280',
    width: 16,
    textAlign: 'center',
  },
  benefitText: {
    fontFamily: 'Manrope-SemiBold',
    fontSize: 15,
    color: '#e5e7eb',
  },
  // Plans
  plansSection: {
    gap: 12,
  },
  planCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#2a2a2a',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  planCardSelected: {
    borderColor: '#e5e7eb',
    backgroundColor: '#222',
  },
  planRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  planLeft: {
    flex: 1,
    gap: 2,
  },
  planTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  planRight: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#4b5563',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: '#e5e7eb',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#e5e7eb',
  },
  planName: {
    fontFamily: 'Manrope-Bold',
    fontSize: 17,
    color: '#fff',
  },
  saveBadge: {
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#3a3a3a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  saveBadgeText: {
    fontFamily: 'Manrope-Bold',
    fontSize: 11,
    color: '#e5e7eb',
    letterSpacing: 0.3,
  },
  planSubPrice: {
    fontFamily: 'Manrope-Regular',
    fontSize: 12,
    color: '#9ca3af',
    paddingLeft: 32,
  },
  planCoins: {
    fontFamily: 'Manrope-Regular',
    fontSize: 12,
    color: '#9ca3af',
    paddingLeft: 32,
  },
  planImages: {
    fontFamily: 'Manrope-Regular',
    fontSize: 12,
    color: '#9ca3af',
  },
  planPriceBlock: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  planBigPrice: {
    fontFamily: 'Manrope-Medium',
    fontSize: 24,
    color: '#6b7280',
  },
  planBigPriceActive: {
    color: '#e5e7eb',
  },
  planPricePeriod: {
    fontFamily: 'Manrope-Regular',
    fontSize: 14,
    color: '#6b7280',
    marginLeft: 2,
  },
  // Loading/Error
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  errorContainer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
  },
  retryText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'Manrope-SemiBold',
  },
  // Bottom fixed
  bottomFixed: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 32,
  },
  ctaButton: {
    backgroundColor: '#fff',
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaButtonDisabled: {
    opacity: 0.5,
  },
  ctaButtonText: {
    fontFamily: 'Manrope-Bold',
    color: '#000',
    fontSize: 17,
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
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  footerLinkText: {
    color: '#6b7280',
    fontSize: 12,
  },
  footerDot: {
    color: '#4b5563',
    fontSize: 12,
  },
  disclaimer: {
    fontSize: 11,
    color: '#4b5563',
    textAlign: 'center',
    marginTop: 4,
  },
});
