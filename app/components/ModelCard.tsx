import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AIModel } from './ModelSelectionModal';

interface ModelCardProps {
  model: AIModel;
  isSelected: boolean;
  onSelect: (model: AIModel) => void;
}

export const ModelCard: React.FC<ModelCardProps> = ({ model, isSelected, onSelect }) => {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={() => onSelect(model)}
      style={[
        styles.modelCard,
        isSelected && styles.modelCardSelected
      ]}
    >
      {/* Model name and recommended badge */}
      <View style={styles.modelCardTitleRow}>
        <Text style={styles.modelCardTitle}>{model.name}</Text>
        {model.recommended && (
          <View style={styles.modelCardBadge}>
            <Text style={styles.modelCardBadgeText}>{t('modelCard.newBadge')}</Text>
          </View>
        )}
      </View>

      {/* Description */}
      <Text style={styles.modelCardDescription}>{model.description}</Text>

      {/* Selection indicator */}
      {isSelected && (
        <View style={styles.modelCardCheck}>
          <Text style={styles.checkText}>✓</Text>
        </View>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  modelCard: {
    position: 'relative',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  modelCardSelected: {
    borderColor: '#FFD700',
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
  },
  modelCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
    flexWrap: 'wrap',
  },
  modelCardTitle: {
    fontSize: 17,
    fontFamily: 'Manrope-SemiBold',
    color: '#ffffff',
    flex: 1,
  },
  modelCardBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(255, 215, 0, 0.2)',
    borderRadius: 4,
  },
  modelCardBadgeText: {
    color: '#FFD700',
    fontSize: 10,
    fontFamily: 'Manrope-Bold',
  },
  modelCardDescription: {
    fontSize: 12,
    fontFamily: 'Manrope-Regular',
    lineHeight: 16,
    color: '#999999',
    marginBottom: 0,
  },
  modelCardCheck: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFD700',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkText: {
    color: '#000000',
    fontSize: 12,
    fontFamily: 'Manrope-Bold',
  },
});
