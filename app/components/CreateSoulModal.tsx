import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  Alert,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { X, Plus, Check, ImagePlus, Trash2, AlertTriangle, Camera, Sun, Smile, User } from 'lucide-react-native';
import { Soul, useSouls } from '../../contexts/SoulsContext';
import { queueManager } from '../../lib/queue/queueManager';
import { convertImageToBase64 } from '../../lib/replicate/client';
import { useSelfieValidation } from '../hooks/useSelfieValidation';
import { ensureAIConsent } from '../../lib/ai/aiConsent';
import { ensureAssetsLocal } from '../../lib/picker/pickWithProcessing';

const MAX_SOUL_IMAGES = 9;
const ICON_SIZE = 20;
const ICON_COLOR = '#9ca3af';

// Curated "good selfie" examples shown in the empty state to guide quality.
const SELFIE_EXAMPLES = [
  require('../../assets/selfie-example-1.jpg'),
  require('../../assets/selfie-example-2.jpg'),
  require('../../assets/selfie-example-3.jpg'),
];

interface CreateSoulModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (name: string, imageUris: string[]) => Promise<string>;
  editingSoul?: Soul | null;
}

interface ImageProcessingStatus {
  uri: string;
  isProcessing: boolean;
  predictionId?: string;
  originalUri: string;
}

export default function CreateSoulModal({
  visible,
  onClose,
  onSave,
  editingSoul,
}: CreateSoulModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { updateSoul, deleteSoul } = useSouls();
  const [name, setName] = useState('');
  const [imageUris, setImageUris] = useState<string[]>([]);
  const [processingStatus, setProcessingStatus] = useState<Map<number, ImageProcessingStatus>>(new Map());
  const [pickerProcessingCount, setPickerProcessingCount] = useState(0);
  const savedSoulIdRef = useRef<string | null>(null); // Use ref to persist across re-renders
  const [isSaving, setIsSaving] = useState(false);
  const {
    validateImages,
    validationResults,
    isValidating,
    validatingIndices,
    clearResults: clearValidationResults,
    removeResultAtIndex,
    dismissResult,
  } = useSelfieValidation();

  // Initialize with editing soul data
  useEffect(() => {
    if (visible) {
      setIsSaving(false); // Reset saving state when modal opens
      if (editingSoul) {
        console.log(`📝 Opening modal to edit soul: ${editingSoul.name}`);
        setName(editingSoul.name);
        setImageUris(editingSoul.imageUris);
        savedSoulIdRef.current = editingSoul.id; // Already editing, so save updates to this soul
      } else {
        console.log(`📝 Opening modal to create new soul`);
        setName('Me');
        setImageUris([]);
        savedSoulIdRef.current = null; // New soul, ID will be set after save
        setProcessingStatus(new Map());
        clearValidationResults();
      }
    }
  }, [editingSoul, visible]);

  const ingestNewImages = (newImages: string[]) => {
    const currentLength = imageUris.length;
    const combinedImages = [...imageUris, ...newImages].slice(0, MAX_SOUL_IMAGES);
    setImageUris(combinedImages);

    newImages.forEach((uri, index) => {
      processImageBackgroundRemoval(uri, currentLength + index);
    });

    console.log(`[CreateSoul] Firing selfie validation for ${newImages.length} new images starting at index ${currentLength}`);
    validateImages(newImages, currentLength);
  };

  const pickFromLibrary = async () => {
    if (!(await ensureAIConsent())) return;
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert(t('souls.permissionRequired'), t('souls.allowPhotoLibrary'));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 1,
      selectionLimit: MAX_SOUL_IMAGES - imageUris.length,
    });

    if (!result.canceled && result.assets) {
      const uris = result.assets.map((a) => a.uri);
      setPickerProcessingCount(uris.length);
      try {
        await ensureAssetsLocal(uris);
      } finally {
        setPickerProcessingCount(0);
      }
      ingestNewImages(uris);
    }
  };

  const takePhotoWithCamera = async () => {
    if (!(await ensureAIConsent())) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('souls.permissionRequired'), t('souls.allowCameraSelfie'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    setPickerProcessingCount(1);
    try {
      await ensureAssetsLocal([uri]);
    } finally {
      setPickerProcessingCount(0);
    }
    ingestNewImages([uri]);
  };

  const pickImages = () => {
    if (imageUris.length >= MAX_SOUL_IMAGES) {
      Alert.alert(
        t('souls.limitReached'),
        t('souls.limitReachedMessage', { n: MAX_SOUL_IMAGES })
      );
      return;
    }
    Alert.alert(
      t('souls.addSelfie'),
      undefined,
      [
        { text: t('souls.takePhoto'), onPress: takePhotoWithCamera },
        { text: t('souls.chooseFromLibrary'), onPress: pickFromLibrary },
        { text: t('common.cancel'), style: 'cancel' },
      ],
    );
  };

  const processImageBackgroundRemoval = async (uri: string, index: number) => {
    try {
      console.log(`🎨 Starting background removal for image ${index}`);
      console.log(`📷 Original URI: ${uri.substring(0, 50)}...`);

      // Mark as processing
      setProcessingStatus(prev => {
        const updated = new Map(prev);
        updated.set(index, {
          uri,
          isProcessing: true,
          originalUri: uri,
        });
        return updated;
      });

      // Convert image to base64 for cloud queue
      const base64Image = await convertImageToBase64(uri);

      // Start background removal via cloud queue.
      // Use the free `background-remover` model (matches LabOnboardingModal) so
      // soul-creation preprocessing never charges coins — guests have a 0
      // balance and the paid `background-remover-fal` returned 402.
      const response = await queueManager.startPrediction({
        model: 'background-remover',
        prompt: 'Background removal',
        parameters: {
          image: base64Image,
        },
      });

      const jobId = response.job_id;
      console.log(`🔮 Job ID for image ${index}: ${jobId}`);

      // Update with job ID
      setProcessingStatus(prev => {
        const updated = new Map(prev);
        const current = updated.get(index);
        if (current) {
          updated.set(index, { ...current, predictionId: jobId });
        }
        return updated;
      });

      // Subscribe to job updates and wait for completion
      const outputUrl = await new Promise<string>((resolve, reject) => {
        const unsubscribe = queueManager.subscribe((jobs) => {
          const job = jobs.find(j => j.id === jobId);
          if (!job) return;

          if (job.status === 'completed' && job.resultUrl) {
            unsubscribe();
            resolve(job.resultUrl);
          } else if (job.status === 'failed') {
            unsubscribe();
            reject(new Error(job.errorMessage || 'Background removal failed'));
          }
        });

        // Timeout after 2 minutes
        setTimeout(() => {
          unsubscribe();
          reject(new Error('Background removal timed out'));
        }, 120000);
      });

      console.log(`✅ Background removal completed for image ${index}`);
      console.log(`🌐 Output URL: ${outputUrl.substring(0, 50)}...`);

      // FIXED: Use functional update to avoid stale closure
      setImageUris(prevUris => {
        console.log(`📊 Before update - Array length: ${prevUris.length}, Index: ${index}`);
        console.log(`📊 Current URIs:`, prevUris.map((u, i) => `${i}: ${u.substring(0, 30)}...`));

        const updatedUris = [...prevUris];
        if (index < updatedUris.length) {
          updatedUris[index] = outputUrl;
          console.log(`✏️ Updated image at index ${index} with processed URL`);
        } else {
          console.warn(`⚠️ Index ${index} out of bounds (array length: ${updatedUris.length})`);
        }

        console.log(`📊 After update - Array length: ${updatedUris.length}`);
        return updatedUris;
      });

      // If we're editing an existing soul, also update it in the context
      // Do this AFTER state update to avoid React warning
      setTimeout(() => {
        const soulId = savedSoulIdRef.current;
        console.log(`🔍 Checking if we should update soul. Soul ID: ${soulId}`);
        if (soulId) {
          // Get the latest imageUris to update the soul
          setImageUris(latestUris => {
            console.log(`💾 Updating soul ${soulId} with ${latestUris.length} images`);
            console.log(`💾 Images:`, latestUris.map((u, i) => `${i}: ${u.substring(0, 50)}...`));
            updateSoul(soulId, { imageUris: latestUris });
            return latestUris; // Don't modify, just read
          });
        } else {
          console.warn(`⚠️ No soul ID to update - background removal result won't be saved`);
        }
      }, 100);

      // Mark as complete
      setProcessingStatus(prev => {
        const updated = new Map(prev);
        updated.set(index, {
          uri: outputUrl,
          isProcessing: false,
          originalUri: uri,
        });
        return updated;
      });

      console.log(`Background removal completed for image ${index}`);
    } catch (error: any) {
      console.error(`Error processing image ${index}:`, error);

      // Mark as failed but keep the original image — silent fallback,
      // user is never notified that BG removal failed.
      setProcessingStatus(prev => {
        const updated = new Map(prev);
        updated.set(index, {
          uri,
          isProcessing: false,
          originalUri: uri,
        });
        return updated;
      });
    }
  };

  const removeImage = (index: number) => {
    const totalCount = imageUris.length;
    setImageUris(imageUris.filter((_, i) => i !== index));

    // Clear validation result for removed image and reindex
    removeResultAtIndex(index, totalCount);

    // Clear processing status for removed image and reindex remaining images
    setProcessingStatus(prev => {
      const updated = new Map<number, ImageProcessingStatus>();
      let newIndex = 0;

      for (let i = 0; i < imageUris.length; i++) {
        if (i !== index) {
          const status = prev.get(i);
          if (status) {
            updated.set(newIndex, status);
          }
          newIndex++;
        }
      }

      return updated;
    });
  };

  const handleSave = async () => {
    // Prevent multiple saves
    if (isSaving) {
      console.log(`⚠️ Already saving, ignoring duplicate click`);
      return;
    }

    console.log(`💾 SAVE BUTTON CLICKED`);
    console.log(`📝 Soul name: ${name}`);
    console.log(`📸 Number of images: ${imageUris.length}`);
    console.log(`📸 Image URIs:`, imageUris.map((u, i) => `${i}: ${u.substring(0, 50)}...`));

    if (!name.trim()) {
      Alert.alert(t('souls.nameRequired'), t('souls.nameRequiredMessage'));
      return;
    }

    if (imageUris.length === 0) {
      Alert.alert(t('souls.imagesRequired'), t('souls.imagesRequiredMessage'));
      return;
    }

    try {
      setIsSaving(true);
      console.log(`✅ Saving soul with ${imageUris.length} images`);
      const soulId = await onSave(name.trim(), imageUris);

      // Store the soul ID so background removal can continue updating it
      savedSoulIdRef.current = soulId;
      console.log(`✅ Soul saved with ID: ${soulId}`);
      console.log(`🔄 Background removal will continue updating this soul`);
      console.log(`📌 Ref persisted for background updates`);

      console.log(`🚪 Closing modal`);
      onClose();
    } catch (error) {
      console.error(`❌ Failed to save soul:`, error);
      Alert.alert(t('souls.saveFailed'), t('souls.saveFailedMessage'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    console.log(`❌ Cancelled - clearing state`);
    setName('');
    setImageUris([]);
    setProcessingStatus(new Map());
    clearValidationResults();
    savedSoulIdRef.current = null;
    setIsSaving(false);
    onClose();
  };

  // Count failed validations
  const criticalCount = Array.from(validationResults.values()).filter(r => r.status === 'critical').length;
  const importantCount = Array.from(validationResults.values()).filter(r => r.status === 'important').length;
  const failedValidationCount = criticalCount + importantCount;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: Platform.OS === 'android' ? insets.top + 16 : 16 }]}>
          <TouchableOpacity onPress={handleCancel} style={styles.headerButton}>
            <X size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>
            {editingSoul ? t('souls.editSoul') : t('souls.createSoul')}
          </Text>
          <TouchableOpacity
            onPress={handleSave}
            style={styles.headerButton}
            disabled={!name.trim() || imageUris.length === 0 || isSaving}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={[
                styles.saveText,
                (!name.trim() || imageUris.length === 0) && styles.saveTextDisabled
              ]}>{t('common.save')}</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Name Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('souls.name')}</Text>
            <View style={styles.card}>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  placeholder={t('souls.enterSoulName')}
                  placeholderTextColor="#6b7280"
                  value={name}
                  onChangeText={setName}
                  maxLength={50}
                />
                <Text style={styles.charCount}>{name.length}/50</Text>
              </View>
            </View>
          </View>

          {/* Friendly guidance with good-selfie examples — empty state only.
              Teaches what a good selfie looks like before the user picks. */}
          {imageUris.length === 0 && pickerProcessingCount === 0 ? (
            <View style={styles.guideBlock}>
              <Text style={styles.guideHeadline}>{t('souls.examplesHeadline')}</Text>
              <View style={styles.examplesRow}>
                {SELFIE_EXAMPLES.map((src, i) => (
                  <View key={i} style={styles.exampleCard}>
                    <Image source={src} style={styles.exampleImg} contentFit="cover" />
                    <View style={styles.exampleCheck}>
                      <Check size={11} color="#fff" strokeWidth={3} />
                    </View>
                  </View>
                ))}
              </View>
              <View style={styles.tips}>
                <View style={styles.tipRow}>
                  <Sun size={16} color="#4ade80" strokeWidth={2.2} />
                  <Text style={styles.tipText}>{t('souls.tipLight')}</Text>
                </View>
                <View style={styles.tipRow}>
                  <Smile size={16} color="#4ade80" strokeWidth={2.2} />
                  <Text style={styles.tipText}>{t('souls.tipFace')}</Text>
                </View>
                <View style={styles.tipRow}>
                  <User size={16} color="#4ade80" strokeWidth={2.2} />
                  <Text style={styles.tipText}>{t('souls.tipAlone')}</Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.headlineWrap}>
              <Text style={styles.headline}>{t('souls.uploadClearSelfies')}</Text>
            </View>
          )}

          {/* Two visible upload entry points */}
          <View style={styles.uploadButtonsRow}>
            <TouchableOpacity
              style={[styles.uploadButton, imageUris.length >= MAX_SOUL_IMAGES && styles.uploadButtonDisabled]}
              onPress={takePhotoWithCamera}
              disabled={imageUris.length >= MAX_SOUL_IMAGES}
              activeOpacity={0.85}
            >
              <Camera size={20} color="#000" strokeWidth={2} />
              <Text style={styles.uploadButtonText}>{t('souls.takePhoto')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.uploadButton, imageUris.length >= MAX_SOUL_IMAGES && styles.uploadButtonDisabled]}
              onPress={pickFromLibrary}
              disabled={imageUris.length >= MAX_SOUL_IMAGES}
              activeOpacity={0.85}
            >
              <ImagePlus size={20} color="#000" strokeWidth={2} />
              <Text style={styles.uploadButtonText}>{t('souls.choose')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.oneTimeHint}>{t('souls.oneTimeHint')}</Text>

          {/* Images Section — shown once user has added photos OR while picker assets are loading */}
          {(imageUris.length > 0 || pickerProcessingCount > 0) && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('souls.selfies')}</Text>
              <Text style={styles.sectionSubtitle}>{imageUris.length}/{MAX_SOUL_IMAGES}</Text>
            </View>

            <View style={styles.card}>
              {isValidating && (
                <View style={styles.validatingBanner}>
                  <ActivityIndicator size="small" color="#f59e0b" />
                  <Text style={styles.validatingBannerText}>{t('souls.checkingPhotoQuality')}</Text>
                </View>
              )}
              {!isValidating && criticalCount > 0 && (
                <View style={styles.criticalBanner}>
                  <AlertTriangle size={14} color="#ef4444" />
                  <Text style={styles.criticalBannerText}>
                    {t('souls.criticalPhotosBanner', { n: criticalCount })}
                  </Text>
                </View>
              )}
              {!isValidating && importantCount > 0 && (
                <View style={styles.warningBanner}>
                  <AlertTriangle size={14} color="#f59e0b" />
                  <Text style={styles.warningBannerText}>
                    {t('souls.importantPhotosBanner', { n: importantCount })}
                  </Text>
                </View>
              )}

              <View style={styles.imageGridWrapper}>
                <View style={styles.imageGrid}>
                  {imageUris.map((uri, index) => {
                      const status = processingStatus.get(index);
                      const isProcessing = status?.isProcessing ?? false;
                      const validation = validationResults.get(index);
                      const isCheckingQuality = validatingIndices.has(index);
                      const isCritical = validation?.status === 'critical';
                      const isImportant = validation?.status === 'important';

                      return (
                        <View key={index} style={[
                          styles.imageContainer,
                          isCritical && styles.imageContainerCritical,
                          isImportant && styles.imageContainerWarning,
                        ]}>
                          <Image
                            source={{ uri }}
                            style={styles.soulImage}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                            priority="normal"
                            transition={{ duration: 200 }}
                          />
                          {isCheckingQuality && !isProcessing && (
                            <View style={styles.validatingBadge}>
                              <ActivityIndicator size={10} color="#f59e0b" />
                            </View>
                          )}
                          {isCritical && (
                            <TouchableOpacity
                              style={styles.criticalBadge}
                              onPress={() => Alert.alert(
                                t('souls.photoCantBeUsed'),
                                validation.summary || t('souls.photoNotSuitable'),
                                [{ text: t('common.ok') }],
                              )}
                              activeOpacity={0.7}
                              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            >
                              <AlertTriangle size={14} color="#fff" />
                            </TouchableOpacity>
                          )}
                          {isImportant && (
                            <TouchableOpacity
                              style={styles.warningBadge}
                              onPress={() => Alert.alert(
                                t('souls.photoQuality'),
                                (validation.summary || t('souls.photoWillWork')) + '\n\n' + t('souls.photoQualitySuffix'),
                                [
                                  { text: t('souls.keep'), style: 'cancel', onPress: () => dismissResult(index) },
                                  { text: t('souls.change'), onPress: () => removeImage(index) },
                                ],
                              )}
                              activeOpacity={0.7}
                              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            >
                              <AlertTriangle size={14} color="#fff" />
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity
                            style={styles.removeButton}
                            onPress={() => removeImage(index)}
                            disabled={isProcessing}
                          >
                            <Trash2 size={12} color="#fff" />
                          </TouchableOpacity>
                          {!isProcessing && status && !isCritical && !isImportant && (
                            <View style={styles.processedBadge}>
                              <Check size={12} color="#10b981" />
                            </View>
                          )}
                        </View>
                      );
                    })}

                  {/* Picker processing placeholders — shown while iCloud assets load */}
                  {Array.from({ length: pickerProcessingCount }).map((_, i) => (
                    <View key={`picker-pending-${i}`} style={[styles.imageContainer, styles.pickerPendingTile]}>
                      <ActivityIndicator size="small" color="#fff" />
                      <Text style={styles.pickerPendingText}>{t('souls.processing')}</Text>
                    </View>
                  ))}

                  {/* Add more button */}
                  {imageUris.length + pickerProcessingCount < MAX_SOUL_IMAGES && pickerProcessingCount === 0 && (
                    <TouchableOpacity style={styles.addImageButton} onPress={pickImages}>
                      <Plus size={24} color="#6b7280" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>
          </View>
          )}

          <View style={styles.footer} />
        </ScrollView>

        {/* Fixed Save Button */}
        <View style={styles.bigSaveFooter}>
          {editingSoul ? (
            <TouchableOpacity
              style={styles.deleteSoulButton}
              onPress={() => {
                Alert.alert(
                  t('souls.deleteSoulConfirm'),
                  t('souls.deleteSoulMessage', { name: editingSoul.name }),
                  [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                      text: t('common.delete'),
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          await deleteSoul(editingSoul.id);
                          onClose();
                        } catch (e: any) {
                          console.error('[CreateSoul] delete failed:', e);
                          Alert.alert(t('souls.deleteFailed'), e?.message ?? t('souls.couldNotDeleteSoul'));
                        }
                      },
                    },
                  ],
                );
              }}
              activeOpacity={0.85}
              disabled={isSaving}
            >
              <Text style={styles.deleteSoulText}>{t('souls.deleteSoul')}</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={[
              styles.bigSaveButton,
              (!name.trim() || imageUris.length === 0 || isSaving) && styles.bigSaveButtonDisabled,
            ]}
            onPress={handleSave}
            disabled={!name.trim() || imageUris.length === 0 || isSaving}
            activeOpacity={0.85}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Text style={[
                styles.bigSaveButtonText,
                (!name.trim() || imageUris.length === 0) && styles.bigSaveButtonTextDisabled,
              ]}>
                {editingSoul ? t('souls.saveSoul') : t('souls.createSoul')}
              </Text>
            )}
          </TouchableOpacity>
        </View>
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
    width: 50,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontFamily: 'SFRounded-Medium',
    fontWeight: '500',
  },
  saveText: {
    color: '#fff',
    fontSize: 17,
    fontFamily: 'SFRounded-Medium',
    fontWeight: '500',
  },
  saveTextDisabled: {
    opacity: 0.4,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
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
  },
  sectionTitle: {
    color: '#9ca3af',
    fontSize: 14,
    fontFamily: 'SFRounded-Medium',
    fontWeight: '500',
    marginBottom: 8,
    marginLeft: 4,
  },
  headlineWrap: {
    alignSelf: 'center',
    width: '70%',
    paddingVertical: 24,
    alignItems: 'center',
  },
  headline: {
    color: '#fff',
    fontSize: 22,
    fontFamily: 'SFRounded-Medium',
    fontWeight: '500',
    lineHeight: 28,
    textAlign: 'center',
  },
  headlineHint: {
    color: '#9ca3af',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 10,
  },
  guideBlock: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 24,
  },
  guideHeadline: {
    color: '#fff',
    fontSize: 22,
    fontFamily: 'SFRounded-Medium',
    fontWeight: '500',
    lineHeight: 28,
    textAlign: 'center',
    marginBottom: 18,
    paddingHorizontal: 24,
  },
  examplesRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  exampleCard: {
    width: (Dimensions.get('window').width - 32 - 20) / 3,
    aspectRatio: 3 / 4,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    borderWidth: 2,
    borderColor: 'rgba(74,222,128,0.5)',
  },
  exampleImg: {
    width: '100%',
    height: '100%',
  },
  exampleCheck: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#4ade80',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tips: {
    alignSelf: 'stretch',
    gap: 9,
    paddingHorizontal: 12,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tipText: {
    color: '#d1d5db',
    fontSize: 14.5,
    fontFamily: 'SFRounded-Medium',
    fontWeight: '500',
    flexShrink: 1,
  },
  uploadButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  uploadButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#ffffff',
  },
  uploadButtonDisabled: {
    opacity: 0.35,
  },
  uploadButtonText: {
    color: '#000',
    fontSize: 17,
    fontFamily: 'SFRounded-Medium',
    fontWeight: '500',
  },
  oneTimeHint: {
    color: '#6b7280',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 14,
    marginBottom: 24,
  },
  sectionSubtitle: {
    color: '#6b7280',
    fontSize: 13,
    marginBottom: 8,
    marginRight: 4,
  },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    overflow: 'hidden',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
  },
  charCount: {
    color: '#6b7280',
    fontSize: 12,
  },
  validatingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(245, 158, 11, 0.2)',
  },
  validatingBannerText: {
    color: '#f59e0b',
    fontSize: 13,
  },
  criticalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(239, 68, 68, 0.2)',
  },
  criticalBannerText: {
    color: '#ef4444',
    fontSize: 13,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(245, 158, 11, 0.2)',
  },
  warningBannerText: {
    color: '#f59e0b',
    fontSize: 13,
  },
  imageGridWrapper: {
    padding: 12,
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  imageContainer: {
    position: 'relative',
    width: (Dimensions.get('window').width - 32 - 24 - 16) / 3,
    aspectRatio: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  imageContainerWarning: {
    borderWidth: 2,
    borderColor: '#f59e0b',
  },
  imageContainerCritical: {
    borderWidth: 2,
    borderColor: '#ef4444',
  },
  soulImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#222',
  },
  removeButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerPendingTile: {
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderStyle: 'dashed',
  },
  pickerPendingText: {
    color: '#9ca3af',
    fontSize: 11,
    fontFamily: 'SFRounded-Medium',
    fontWeight: '500',
  },
  processedBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  validatingBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  criticalBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: '#ef4444',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  warningBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: '#f59e0b',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addImageButton: {
    width: (Dimensions.get('window').width - 32 - 24 - 16) / 3,
    aspectRatio: 1,
    borderRadius: 8,
    backgroundColor: '#222',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
    borderStyle: 'dashed',
  },
  emptyImagePicker: {
    padding: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyText: {
    color: '#fff',
    fontSize: 18,
    fontFamily: 'SFRounded-Medium',
    fontWeight: '500',
    marginTop: 12,
  },
  emptySubtext: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
  },
  bigSaveFooter: {
    position: 'absolute',
    bottom: 32,
    left: 0,
    right: 0,
    padding: 16,
  },
  bigSaveButton: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 999,
    borderCurve: 'continuous',
    paddingVertical: 18,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteSoulButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginBottom: 6,
  },
  deleteSoulText: {
    color: '#ef4444',
    fontSize: 15,
    fontFamily: 'SFRounded-Medium',
    fontWeight: '500',
  },
  bigSaveButtonDisabled: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  bigSaveButtonText: {
    fontSize: 19,
    fontFamily: 'SFRounded-Medium',
    fontWeight: '500',
    color: '#000',
    textAlign: 'center',
  },
  bigSaveButtonTextDisabled: {
    color: 'rgba(255,255,255,0.55)',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
  },
  infoText: {
    flex: 1,
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 18,
  },
  footer: {
    height: 120,
  },
});
