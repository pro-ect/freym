import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import { deletePublicRecipe } from '../../lib/recipes/supabaseRecipes';
import type { PublicRecipe } from '../../lib/recipes/supabaseRecipes';
import LibrarySettingsModal from '../components/LibrarySettingsModal';
import CoinBalance from '../components/CoinBalance';
import RecipesSwipeDeck from '../components/RecipesSwipeDeck';
import { useSettings } from '../../contexts/SettingsContext';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { useRecipes } from '../../contexts/RecipesContext';
import { useReplicateBalance } from '../hooks/useReplicateBalance';

const ROUNDED_FONT = 'SFRounded-Medium';

export default function RecipesTab() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isAdmin } = useSettings();
  const balanceInfo = useReplicateBalance();
  const { subscriptionStatus } = useSubscription();

  const {
    recipes: communityRecipes,
    isLoading,
    loadRecipes,
    removeRecipe,
  } = useRecipes();

  const [showSettings, setShowSettings] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadRecipes();
    }, [loadRecipes])
  );

  const headerHeight = insets.top + 8 + 44 + 12;

  const handleViewRecipe = useCallback((recipe: PublicRecipe) => {
    router.push(`/recipe/${recipe.id}`);
  }, []);

  const handleDeleteRecipe = useCallback((recipe: PublicRecipe) => {
    if (!isAdmin) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      t('recipesTab.deleteRecipeTitle'),
      t('recipesTab.deleteRecipeMessage', { name: recipe.recipe_data.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePublicRecipe(recipe.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              removeRecipe(recipe.id);
            } catch (error) {
              console.error('Error deleting recipe:', error);
              Alert.alert(t('common.error'), t('recipesTab.deleteFailed'));
            }
          },
        },
      ]
    );
  }, [isAdmin, removeRecipe]);

  return (
    <View style={styles.container}>
      {isLoading && communityRecipes.length === 0 ? (
        <View style={[styles.loadingContainer, { paddingTop: headerHeight }]}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.loadingText}>{t('recipesTab.loadingRecipes')}</Text>
        </View>
      ) : communityRecipes.length === 0 ? (
        <View style={[styles.emptyContainer, { paddingTop: headerHeight }]}>
          <MaterialIcons name="menu-book" size={64} color="#444" />
          <Text style={styles.emptyText}>{t('recipesTab.emptyTitle')}</Text>
          <Text style={styles.emptySubtext}>
            {t('recipesTab.emptySubtext')}
          </Text>
        </View>
      ) : (
        <RecipesSwipeDeck
          recipes={communityRecipes}
          topInset={headerHeight}
          bottomInset={insets.bottom + 90}
          onPressRecipe={handleViewRecipe}
          onLongPressRecipe={isAdmin ? handleDeleteRecipe : undefined}
        />
      )}

      {/* Header with blur */}
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
          <BlurView
            tint="systemChromeMaterialDark"
            intensity={70}
            style={StyleSheet.absoluteFill}
          />
        </MaskedView>

        <View style={[styles.headerRow, { paddingTop: insets.top + 8 }]}>
          <Text style={styles.headerTitle}>{t('recipesTab.title')}</Text>
          <View style={styles.headerRight}>
            <CoinBalance
              balance={balanceInfo.isLoading ? null : balanceInfo.displayText}
              onPress={() => setShowSettings(true)}
              iconType="asterisk"
              isPremium={subscriptionStatus.isSubscribed}
            />
          </View>
        </View>
      </View>

      <LibrarySettingsModal
        visible={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    color: '#fff',
    fontFamily: ROUNDED_FONT,
    fontSize: 22,
    fontWeight: '500',
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#999',
    fontSize: 14,
    fontFamily: 'Manrope-Regular',
    marginTop: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyText: {
    fontSize: 20,
    fontFamily: 'Manrope-SemiBold',
    color: '#fff',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    fontFamily: 'Manrope-Regular',
    color: '#999',
    textAlign: 'center',
    lineHeight: 20,
  },
});
