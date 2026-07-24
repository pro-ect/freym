import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MoreVertical, Trash2, Edit3, Clock } from 'lucide-react-native';
import { deleteCustomModel } from '../../lib/customModels';
import type { CustomModel } from '../../lib/customModels/types';

interface CustomModelCardProps {
  model: CustomModel;
  onPress?: () => void;
  onEdit?: (model: CustomModel) => void;
  onDelete?: () => void;
}

export default function CustomModelCard({
  model,
  onPress,
  onEdit,
  onDelete,
}: CustomModelCardProps) {
  const { t } = useTranslation();
  const [showMenu, setShowMenu] = useState(false);

  const handleDelete = () => {
    setShowMenu(false);
    Alert.alert(
      t('customModel.deleteModelTitle'),
      t('customModel.deleteModelConfirm', { name: model.name }),
      [
        {
          text: t('common.cancel'),
          style: 'cancel',
        },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCustomModel(model.id);
              onDelete?.();
            } catch (error: any) {
              Alert.alert(t('common.error'), error.message || t('customModel.deleteFailed'));
            }
          },
        },
      ]
    );
  };

  const handleEdit = () => {
    setShowMenu(false);
    onEdit?.(model);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return t('customModel.today');
    if (diffDays === 1) return t('customModel.yesterday');
    if (diffDays < 7) return t('customModel.daysAgo', { n: diffDays });
    if (diffDays < 30) return t('customModel.weeksAgo', { n: Math.floor(diffDays / 7) });
    return date.toLocaleDateString();
  };

  return (
    <Pressable
      style={styles.card}
      onPress={onPress}
      onLongPress={() => setShowMenu(!showMenu)}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.modelName} numberOfLines={1}>
          {model.name}
        </Text>
        <Pressable
          style={styles.menuButton}
          onPress={() => setShowMenu(!showMenu)}
          hitSlop={8}
        >
          <MoreVertical size={20} color="rgba(255, 255, 255, 0.6)" strokeWidth={2} />
        </Pressable>
      </View>

      {/* Description */}
      {model.description && (
        <Text style={styles.description} numberOfLines={2}>
          {model.description}
        </Text>
      )}

      {/* Meta Info */}
      <View style={styles.metaContainer}>
        <Text style={styles.replicateModel} numberOfLines={1}>
          {model.replicate_model}
        </Text>
        {model.pricing && (
          <View style={styles.costBadge}>
            <Text style={styles.costText}>{model.pricing.coinsPerGeneration}</Text>
          </View>
        )}
      </View>

      {/* Stats */}
      <View style={styles.statsContainer}>
        {model.usage_count > 0 && (
          <Text style={styles.statText}>{t('customModel.usedTimes', { n: model.usage_count })}</Text>
        )}
        {model.last_used_at ? (
          <Text style={styles.statText}>{t('customModel.lastUsed', { date: formatDate(model.last_used_at) })}</Text>
        ) : (
          <Text style={styles.statText}>{t('customModel.neverUsed')}</Text>
        )}
      </View>

      {/* Action Menu */}
      {showMenu && (
        <View style={styles.menu}>
          <Pressable style={styles.menuItem} onPress={handleEdit}>
            <Edit3 size={18} color="#fff" strokeWidth={2} />
            <Text style={styles.menuItemText}>{t('common.edit')}</Text>
          </Pressable>
          <View style={styles.menuDivider} />
          <Pressable style={[styles.menuItem, styles.menuItemDanger]} onPress={handleDelete}>
            <Trash2 size={18} color="#FF3B30" strokeWidth={2} />
            <Text style={[styles.menuItemText, styles.menuItemTextDanger]}>{t('common.delete')}</Text>
          </Pressable>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    position: 'relative',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  modelName: {
    flex: 1,
    fontSize: 17,
    fontFamily: 'Manrope-SemiBold',
    color: '#fff',
    marginRight: 8,
  },
  menuButton: {
    padding: 4,
  },
  description: {
    fontSize: 14,
    fontFamily: 'Manrope-Regular',
    color: 'rgba(255, 255, 255, 0.7)',
    lineHeight: 20,
    marginBottom: 12,
  },
  metaContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  replicateModel: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Manrope-Regular',
    color: 'rgba(255, 255, 255, 0.5)',
    marginRight: 8,
  },
  costBadge: {
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.3)',
  },
  costText: {
    fontSize: 12,
    fontFamily: 'Manrope-SemiBold',
    color: '#FFD700',
  },
  statsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  statText: {
    fontSize: 12,
    fontFamily: 'Manrope-Regular',
    color: 'rgba(255, 255, 255, 0.4)',
  },
  menu: {
    position: 'absolute',
    top: 50,
    right: 16,
    backgroundColor: 'rgba(30, 30, 30, 0.98)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    minWidth: 140,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuItemDanger: {
    // No background change, just text color
  },
  menuItemText: {
    fontSize: 15,
    fontFamily: 'Manrope-Regular',
    color: '#fff',
  },
  menuItemTextDanger: {
    color: '#FF3B30',
  },
  menuDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
});
