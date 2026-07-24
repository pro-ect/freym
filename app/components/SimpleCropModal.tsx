import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

interface SimpleCropModalProps {
  visible: boolean;
  imageUri: string;
  onClose: () => void;
  onCropComplete: (croppedUri: string) => void;
}

interface CropOption {
  name: string;
  description: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  crop: (width: number, height: number) => { originX: number; originY: number; width: number; height: number };
}

const CROP_OPTIONS: CropOption[] = [
  {
    name: 'Square',
    description: 'Center square crop',
    icon: 'crop-square',
    crop: (width, height) => {
      const size = Math.min(width, height);
      return {
        originX: (width - size) / 2,
        originY: (height - size) / 2,
        width: size,
        height: size,
      };
    },
  },
  {
    name: 'Portrait',
    description: '2:3 aspect ratio',
    icon: 'crop-portrait',
    crop: (width, height) => {
      const targetAspect = 2 / 3;
      const currentAspect = width / height;

      if (currentAspect > targetAspect) {
        // Image is wider, crop width
        const newWidth = height * targetAspect;
        return {
          originX: (width - newWidth) / 2,
          originY: 0,
          width: newWidth,
          height,
        };
      } else {
        // Image is taller, crop height
        const newHeight = width / targetAspect;
        return {
          originX: 0,
          originY: (height - newHeight) / 2,
          width,
          height: newHeight,
        };
      }
    },
  },
  {
    name: 'Landscape',
    description: '16:9 aspect ratio',
    icon: 'crop-landscape',
    crop: (width, height) => {
      const targetAspect = 16 / 9;
      const currentAspect = width / height;

      if (currentAspect > targetAspect) {
        // Image is wider, crop width
        const newWidth = height * targetAspect;
        return {
          originX: (width - newWidth) / 2,
          originY: 0,
          width: newWidth,
          height,
        };
      } else {
        // Image is taller, crop height
        const newHeight = width / targetAspect;
        return {
          originX: 0,
          originY: (height - newHeight) / 2,
          width,
          height: newHeight,
        };
      }
    },
  },
  {
    name: 'Custom',
    description: 'Crop 10% from edges',
    icon: 'crop-free',
    crop: (width, height) => {
      const margin = 0.1; // 10% margin
      return {
        originX: width * margin,
        originY: height * margin,
        width: width * (1 - 2 * margin),
        height: height * (1 - 2 * margin),
      };
    },
  },
];

export default function SimpleCropModal({
  visible,
  imageUri,
  onClose,
  onCropComplete,
}: SimpleCropModalProps) {
  const { t } = useTranslation();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleCrop = async (option: CropOption) => {
    try {
      setIsProcessing(true);

      // Check if the URI is a remote URL (starts with http/https)
      let localUri = imageUri;
      if (imageUri.startsWith('http://') || imageUri.startsWith('https://')) {
        console.log('Remote image detected, downloading first...');

        // Download the remote image to local storage
        const filename = `crop_temp_${Date.now()}.png`;
        const downloadPath = `${FileSystemLegacy.cacheDirectory}${filename}`;

        const downloadResult = await FileSystemLegacy.downloadAsync(imageUri, downloadPath);
        localUri = downloadResult.uri;

        console.log('Downloaded to:', localUri);
      }

      // Get image dimensions
      const imageInfo = await ImageManipulator.manipulateAsync(localUri, [], {});
      const { width, height } = imageInfo;

      // Calculate crop dimensions
      const cropArea = option.crop(width, height);

      // Perform the crop
      const result = await ImageManipulator.manipulateAsync(
        localUri,
        [
          {
            crop: {
              originX: Math.max(0, Math.round(cropArea.originX)),
              originY: Math.max(0, Math.round(cropArea.originY)),
              width: Math.round(cropArea.width),
              height: Math.round(cropArea.height),
            },
          },
        ],
        { compress: 1, format: ImageManipulator.SaveFormat.PNG }
      );

      setIsProcessing(false);
      onCropComplete(result.uri);
    } catch (error: any) {
      console.error('Error cropping image:', error);
      setIsProcessing(false);
      Alert.alert(t('crop.cropFailedTitle'), t('crop.cropFailedMessage'));
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton} disabled={isProcessing}>
            <MaterialIcons name="close" size={24} color="#9ca3af" />
          </TouchableOpacity>
          <Text style={styles.title}>{t('crop.title')}</Text>
          <View style={styles.closeButton} />
        </View>

        {/* Image Preview */}
        <View style={styles.imageContainer}>
          <Image
            source={{ uri: imageUri }}
            style={styles.image}
            resizeMode="contain"
          />
          {isProcessing && (
            <View style={styles.processingOverlay}>
              <ActivityIndicator size="large" color="#3b82f6" />
              <Text style={styles.processingText}>{t('crop.cropping')}</Text>
            </View>
          )}
        </View>

        {/* Crop Options */}
        <View style={styles.optionsContainer}>
          <Text style={styles.optionsLabel}>{t('crop.chooseStyle')}</Text>
          <View style={styles.optionButtons}>
            {CROP_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.name}
                style={styles.optionButton}
                onPress={() => handleCrop(option)}
                disabled={isProcessing}
              >
                <MaterialIcons name={option.icon} size={32} color="#3b82f6" />
                <Text style={styles.optionButtonText}>{t(`crop.option${option.name}Name`)}</Text>
                <Text style={styles.optionButtonDescription}>{t(`crop.option${option.name}Description`)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.infoBox}>
            <MaterialIcons name="info" size={16} color="#3b82f6" />
            <Text style={styles.infoText}>
              {t('crop.infoText')}
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  closeButton: {
    width: 40,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  imageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  processingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  processingText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  optionsContainer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  optionsLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 16,
  },
  optionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  optionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#1e293b',
    borderWidth: 2,
    borderColor: '#334155',
    gap: 4,
  },
  optionButtonText: {
    fontSize: 12,
    color: 'white',
    fontWeight: '600',
    marginTop: 4,
  },
  optionButtonDescription: {
    fontSize: 10,
    color: '#6b7280',
    textAlign: 'center',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  infoText: {
    flex: 1,
    color: '#93c5fd',
    fontSize: 12,
    lineHeight: 16,
  },
});
