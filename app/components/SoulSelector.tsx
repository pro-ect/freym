import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  StyleSheet,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSouls } from '../../contexts/SoulsContext';

interface SoulSelectorProps {
  onSelectSoul: (soulId: string, imageUris: string[], soulName: string) => boolean; // Returns true if successfully added
  onDeselectSoul: (soulId: string) => void;
  maxImages: number;
  currentImageCount: number;
  onAddNewSoul?: () => void; // Callback to open create soul modal
  onLongPressSoul?: (soulId: string) => void; // Long-press opens an edit flow
  variant?: 'compact' | 'large'; // 'large' renders recipe-page-style 60x60 avatars
}

export default function SoulSelector({
  onSelectSoul,
  onDeselectSoul,
  maxImages,
  currentImageCount,
  onAddNewSoul,
  onLongPressSoul,
  variant = 'compact',
}: SoulSelectorProps) {
  const { t } = useTranslation();
  const isLarge = variant === 'large';
  const { souls } = useSouls();
  const [selectedSoulIds, setSelectedSoulIds] = useState<Set<string>>(new Set());

  const handleSelectSoul = (soulId: string, soulName: string, imageUris: string[]) => {
    // Check if adding this soul would exceed the limit
    const newTotal = currentImageCount + imageUris.length;
    if (newTotal > maxImages) {
      Alert.alert(
        t('soulSelector.imageLimitExceededTitle'),
        t('soulSelector.imageLimitExceededMessage', {
          soulName,
          maxImages,
          currentImageCount,
        })
      );
      return;
    }

    // Try to add the soul's images
    const success = onSelectSoul(soulId, imageUris, soulName);

    if (success) {
      // Mark this soul as selected
      setSelectedSoulIds(prev => new Set([...prev, soulId]));
    }
  };

  const handleDeselectSoul = (soulId: string) => {
    // Remove the soul from selected set
    setSelectedSoulIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(soulId);
      return newSet;
    });

    // Call the parent's deselect callback to remove the images
    onDeselectSoul(soulId);
  };

  // Reset selection when soul list changes or component unmounts
  React.useEffect(() => {
    // If current image count becomes 0, reset selected souls
    if (currentImageCount === 0) {
      setSelectedSoulIds(new Set());
    }
  }, [currentImageCount]);

  if (souls.length === 0) {
    if (!onAddNewSoul) return null;

    return (
      <View style={styles.container}>
        <TouchableOpacity
          style={styles.emptyStateCard}
          onPress={onAddNewSoul}
          activeOpacity={0.85}
        >
          <View style={styles.emptyStateIcon}>
            <MaterialIcons name="person-add-alt-1" size={18} color="#F4D58D" />
          </View>
          <View style={styles.emptyStateTextContainer}>
            <Text style={styles.emptyStateTitle}>{t('soulSelector.createFirstSoul')}</Text>
            <Text style={styles.emptyStateSubtitle}>
              {t('soulSelector.createFirstSoulSubtitle')}
            </Text>
          </View>
          <MaterialIcons name="chevron-right" size={20} color="#F4D58D" />
        </TouchableOpacity>
      </View>
    );
  }

  if (isLarge) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={largeStyles.row}
      >
        {souls.map((soul) => {
          const isSelected = selectedSoulIds.has(soul.id);
          return (
            <TouchableOpacity
              key={soul.id}
              style={largeStyles.card}
              onPress={() => {
                if (isSelected) handleDeselectSoul(soul.id);
                else handleSelectSoul(soul.id, soul.name, soul.imageUris);
              }}
              onLongPress={onLongPressSoul ? () => onLongPressSoul(soul.id) : undefined}
              delayLongPress={400}
              activeOpacity={0.7}
            >
              <Image
                source={{ uri: soul.imageUris[0] }}
                style={[largeStyles.image, isSelected && largeStyles.imageSelected]}
              />
              <Text
                style={[largeStyles.name, isSelected && largeStyles.nameSelected]}
                numberOfLines={1}
              >
                {soul.name}
              </Text>
              {isSelected ? (
                <View style={largeStyles.checkmark}>
                  <MaterialIcons name="check-circle" size={20} color="#F4D58D" />
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
        {onAddNewSoul ? (
          <TouchableOpacity
            style={largeStyles.card}
            onPress={onAddNewSoul}
            activeOpacity={0.7}
          >
            <View style={largeStyles.addButton}>
              <MaterialIcons name="add" size={28} color="#F4D58D" />
            </View>
            <Text style={largeStyles.name} numberOfLines={1}>{t('soulSelector.new')}</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.soulRow}>
        <Text style={styles.useSoulLabel}>{t('soulSelector.useSoul')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollView}>
          {souls.map(soul => {
            const isSelected = selectedSoulIds.has(soul.id);

            return (
              <TouchableOpacity
                key={soul.id}
                style={styles.soulItem}
                onPress={() => {
                  if (isSelected) {
                    handleDeselectSoul(soul.id);
                  } else {
                    handleSelectSoul(soul.id, soul.name, soul.imageUris);
                  }
                }}
                activeOpacity={0.7}
              >
                {/* Single Preview Image */}
                <Image
                  source={{ uri: soul.imageUris[0] }}
                  style={styles.soulImage}
                />

                {/* Soul Name with dot indicator */}
                <View style={styles.soulNameRow}>
                  <Text
                    style={styles.soulName}
                    numberOfLines={1}
                  >
                    {soul.name}
                  </Text>
                  {isSelected && <View style={styles.selectedDot} />}
                </View>
              </TouchableOpacity>
            );
          })}

          {/* Add New Soul Card */}
          {onAddNewSoul && (
            <TouchableOpacity
              style={styles.addSoulItem}
              onPress={onAddNewSoul}
              activeOpacity={0.7}
            >
              <View style={styles.addSoulIcon}>
                <MaterialIcons name="add" size={20} color="#F4D58D" />
              </View>
              <Text style={styles.addSoulText}>{t('soulSelector.newSoul')}</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  soulRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  useSoulLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6b7280',
    marginRight: 12,
  },
  scrollView: {
    flexDirection: 'row',
    flex: 1,
  },
  soulItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#333',
    gap: 8,
  },
  soulImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  soulNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  soulName: {
    fontSize: 13,
    fontWeight: '500',
    color: '#fff',
    maxWidth: 100,
  },
  selectedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F4D58D',
  },
  emptyStateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(244, 213, 141, 0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 213, 141, 0.2)',
    borderStyle: 'dashed',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  emptyStateIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(244, 213, 141, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateTextContainer: {
    flex: 1,
    gap: 2,
  },
  emptyStateTitle: {
    color: '#F4D58D',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyStateSubtitle: {
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 16,
  },
  addSoulItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(244, 213, 141, 0.1)',
    gap: 6,
  },
  addSoulIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(244, 213, 141, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addSoulText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#F4D58D',
  },
});

const largeStyles = StyleSheet.create({
  row: {
    paddingVertical: 4,
    gap: 14,
    paddingRight: 20,
  },
  card: {
    alignItems: 'center',
    width: 92,
    position: 'relative',
  },
  image: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#222',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  imageSelected: { borderColor: '#F4D58D' },
  name: {
    fontSize: 13,
    fontFamily: 'Manrope-Medium',
    color: '#9ca3af',
    marginTop: 8,
    textAlign: 'center',
  },
  nameSelected: { color: '#F4D58D' },
  checkmark: {
    position: 'absolute',
    top: 2,
    right: 6,
    backgroundColor: '#000',
    borderRadius: 12,
  },
  addButton: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(244, 213, 141, 0.12)',
    borderWidth: 2,
    borderColor: 'rgba(244, 213, 141, 0.4)',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
