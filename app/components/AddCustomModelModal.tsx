import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Keyboard,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useTranslation } from 'react-i18next';
import { X, Download, Check, ChevronDown } from 'lucide-react-native';
import {
  fetchModelSchema,
  getClassifiedParameters,
  autoDetectFieldMapping,
} from '../../lib/replicate/schema';
import { createCustomModel, checkModelExists } from '../../lib/customModels';
import type {
  ReplicateSchema,
  ClassifiedParameter,
  FieldMapping,
  OptimizationSettings,
  PricingInfo,
} from '../../lib/customModels/types';

interface AddCustomModelModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'input' | 'fetching' | 'configure' | 'saving';

export default function AddCustomModelModal({
  visible,
  onClose,
  onSuccess,
}: AddCustomModelModalProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('input');
  const [url, setUrl] = useState('');

  // Fetched data
  const [schema, setSchema] = useState<ReplicateSchema | null>(null);
  const [modelInfo, setModelInfo] = useState<{
    name: string;
    description: string;
    owner: string;
    versionHash: string;
  } | null>(null);
  const [parameters, setParameters] = useState<ClassifiedParameter[]>([]);

  // Configuration
  const [modelName, setModelName] = useState('');
  const [modelDescription, setModelDescription] = useState('');
  const [fieldMapping, setFieldMapping] = useState<FieldMapping>({});
  const [coinCost, setCoinCost] = useState('100');

  const handleClose = () => {
    // Reset state
    setStep('input');
    setUrl('');
    setSchema(null);
    setModelInfo(null);
    setParameters([]);
    setModelName('');
    setModelDescription('');
    setFieldMapping({});
    setCoinCost('100');
    onClose();
  };

  const handleFetchSchema = async () => {
    if (!url.trim()) {
      Alert.alert(t('common.error'), t('addModel.enterUrlError'));
      return;
    }

    console.log('🔍 Fetching model schema for:', url.trim());
    setStep('fetching');

    try {
      console.log('📡 Calling Replicate API...');
      const result = await fetchModelSchema(url.trim());
      console.log('✅ Schema fetched successfully:', {
        name: result.modelInfo.name,
        version: result.modelInfo.versionHash,
        paramCount: Object.keys(result.schema.input?.properties || {}).length,
      });

      // Check if model already exists
      const replicateModel = url.includes('replicate.com')
        ? url.match(/replicate\.com\/([^\/]+\/[^\/\?]+)/)?.[1] || url
        : url;

      console.log('🔎 Checking if model exists:', replicateModel);
      const exists = await checkModelExists(replicateModel);
      if (exists) {
        console.log('⚠️ Model already exists in database');
        Alert.alert(t('addModel.alreadyAddedTitle'), t('addModel.alreadyAddedMessage'));
        setStep('input');
        return;
      }
      console.log('✅ Model is new, proceeding...');

      setSchema(result.schema);
      setModelInfo(result.modelInfo);

      console.log('🏷️ Classifying parameters...');
      const classified = getClassifiedParameters(result.schema);
      setParameters(classified);
      console.log('✅ Found parameters:', classified.map(p => `${p.name} (${p.parameterType})`));

      console.log('🗺️ Auto-detecting field mapping...');
      const autoMapping = autoDetectFieldMapping(result.schema);
      setFieldMapping(autoMapping);
      console.log('✅ Field mapping:', autoMapping);

      setModelName(result.modelInfo.name || 'Custom Model');
      setModelDescription(result.modelInfo.description || '');

      console.log('✅ Moving to configure step');
      setStep('configure');
    } catch (error: any) {
      console.error('❌ Failed to fetch schema:', error);
      Alert.alert(t('common.error'), error.message || t('addModel.fetchFailed'));
      setStep('input');
    }
  };

  const handleSave = async () => {
    if (!schema || !modelInfo) return;

    if (!modelName.trim()) {
      Alert.alert(t('common.error'), t('addModel.enterModelNameError'));
      return;
    }

    console.log('💾 Saving custom model...');
    setStep('saving');

    try {
      const replicateModel = url.includes('replicate.com')
        ? url.match(/replicate\.com\/([^\/]+\/[^\/\?]+)/)?.[1] || url
        : url;

      const optimizationSettings: OptimizationSettings = {
        maxSizeKB: 700,
        maxWidth: 2048,
        format: 'jpg',
      };

      const pricing: PricingInfo = {
        coinsPerGeneration: parseInt(coinCost) || 100,
        fetchedFromApi: false,
      };

      console.log('📝 Model data:', {
        replicate_model: replicateModel,
        name: modelName,
        version_hash: modelInfo.versionHash,
        pricing: pricing.coinsPerGeneration,
        parameters: Object.keys(schema.input?.properties || {}).length,
      });

      console.log('💾 Writing to database...');
      const savedModel = await createCustomModel({
        replicate_model: replicateModel,
        version_hash: modelInfo.versionHash,
        name: modelName,
        description: modelDescription,
        schema,
        field_mapping: fieldMapping,
        optimization_settings: optimizationSettings,
        pricing,
      });

      console.log('✅ Model saved successfully:', savedModel.id);
      handleClose();
      onSuccess();
    } catch (error: any) {
      console.error('❌ Failed to save model:', error);
      Alert.alert(t('common.error'), error.message || t('addModel.saveFailed'));
      setStep('configure');
    }
  };

  const renderInputStep = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>{t('addModel.addReplicateModelTitle')}</Text>
      <Text style={styles.stepDescription}>
        {t('addModel.pasteUrlDescription')}
      </Text>

      <TextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        placeholder={t('addModel.urlPlaceholder')}
        placeholderTextColor="rgba(255, 255, 255, 0.4)"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={styles.exampleContainer}>
        <Text style={styles.exampleTitle}>{t('addModel.examplesTitle')}</Text>
        <Text style={styles.exampleText}>• stability-ai/sdxl</Text>
        <Text style={styles.exampleText}>• https://replicate.com/owner/model</Text>
        <Text style={styles.exampleText}>{t('addModel.exampleVersionHash')}</Text>
      </View>

      <Pressable style={styles.primaryButton} onPress={handleFetchSchema}>
        <Download size={18} color="#000" strokeWidth={2} />
        <Text style={styles.primaryButtonText}>{t('addModel.fetchModelSchema')}</Text>
      </Pressable>
    </View>
  );

  const renderFetchingStep = () => (
    <View style={styles.stepContainer}>
      <ActivityIndicator size="large" color="#fff" />
      <Text style={styles.loadingText}>{t('addModel.fetchingSchema')}</Text>
    </View>
  );

  const renderConfigureStep = () => (
    <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.stepTitle}>{t('addModel.configureModelTitle')}</Text>

      {/* Model Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('addModel.modelInformation')}</Text>
        <TextInput
          style={styles.input}
          value={modelName}
          onChangeText={setModelName}
          placeholder={t('addModel.modelNamePlaceholder')}
          placeholderTextColor="rgba(255, 255, 255, 0.4)"
        />
        <TextInput
          style={[styles.input, styles.textArea]}
          value={modelDescription}
          onChangeText={setModelDescription}
          placeholder={t('addModel.descriptionPlaceholder')}
          placeholderTextColor="rgba(255, 255, 255, 0.4)"
          multiline
          numberOfLines={3}
        />
      </View>

      {/* Parameters Preview */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('addModel.detectedParameters')}</Text>
        <Text style={styles.sectionDescription}>
          {t('addModel.parametersFound', { n: parameters.length })}
        </Text>

        {parameters.slice(0, 5).map((param, index) => (
          <View key={index} style={styles.parameterItem}>
            <Text style={styles.parameterName}>{param.name}</Text>
            <Text style={styles.parameterType}>{param.parameterType}</Text>
          </View>
        ))}

        {parameters.length > 5 && (
          <Text style={styles.moreText}>{t('addModel.moreParameters', { n: parameters.length - 5 })}</Text>
        )}
      </View>

      {/* Field Mapping */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('addModel.fieldMapping')}</Text>
        <Text style={styles.sectionDescription}>
          {t('addModel.fieldMappingDescription')}
        </Text>

        {fieldMapping.promptField && (
          <View style={styles.mappingItem}>
            <Text style={styles.mappingLabel}>{t('addModel.promptFieldLabel')}</Text>
            <Text style={styles.mappingValue}>{fieldMapping.promptField}</Text>
          </View>
        )}

        {fieldMapping.imageField1 && (
          <View style={styles.mappingItem}>
            <Text style={styles.mappingLabel}>{t('addModel.imageField1Label')}</Text>
            <Text style={styles.mappingValue}>{fieldMapping.imageField1}</Text>
          </View>
        )}

        {fieldMapping.imageField2 && (
          <View style={styles.mappingItem}>
            <Text style={styles.mappingLabel}>{t('addModel.imageField2Label')}</Text>
            <Text style={styles.mappingValue}>{fieldMapping.imageField2}</Text>
          </View>
        )}
      </View>

      {/* Pricing */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('addModel.pricing')}</Text>
        <View style={styles.pricingContainer}>
          <Text style={styles.pricingLabel}>{t('addModel.coinsPerGeneration')}</Text>
          <TextInput
            style={styles.pricingInput}
            value={coinCost}
            onChangeText={setCoinCost}
            keyboardType="number-pad"
            placeholder="100"
            placeholderTextColor="rgba(255, 255, 255, 0.4)"
          />
        </View>
      </View>

      <Pressable style={styles.primaryButton} onPress={handleSave}>
        <Check size={18} color="#000" strokeWidth={2} />
        <Text style={styles.primaryButtonText}>{t('addModel.saveModel')}</Text>
      </Pressable>
    </ScrollView>
  );

  const renderSavingStep = () => (
    <View style={styles.stepContainer}>
      <ActivityIndicator size="large" color="#fff" />
      <Text style={styles.loadingText}>{t('addModel.savingModel')}</Text>
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <BlurView intensity={40} tint="dark" style={styles.overlay}>
        <View style={styles.darkOverlay} />

        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            {/* Header */}
            <View style={styles.header}>
              <Pressable style={styles.closeButton} onPress={() => Keyboard.dismiss()}>
                <ChevronDown size={24} color="#fff" strokeWidth={2} />
              </Pressable>
              <Pressable style={styles.closeButton} onPress={handleClose}>
                <X size={24} color="#fff" strokeWidth={2} />
              </Pressable>
            </View>

            {/* Content based on step */}
            {step === 'input' && renderInputStep()}
            {step === 'fetching' && renderFetchingStep()}
            {step === 'configure' && renderConfigureStep()}
            {step === 'saving' && renderSavingStep()}
          </View>
        </View>
      </BlurView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 500,
    maxHeight: '80%',
    backgroundColor: 'rgba(20, 20, 20, 0.95)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  stepContainer: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 300,
  },
  stepTitle: {
    fontSize: 24,
    fontFamily: 'Manrope-Bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  stepDescription: {
    fontSize: 15,
    fontFamily: 'Manrope-Regular',
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    marginBottom: 24,
  },
  input: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    fontFamily: 'Manrope-Regular',
    color: '#fff',
    marginBottom: 16,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  exampleContainer: {
    width: '100%',
    marginBottom: 24,
  },
  exampleTitle: {
    fontSize: 13,
    fontFamily: 'Manrope-SemiBold',
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 8,
  },
  exampleText: {
    fontSize: 13,
    fontFamily: 'Manrope-Regular',
    color: 'rgba(255, 255, 255, 0.5)',
    marginBottom: 4,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 24,
  },
  primaryButtonText: {
    fontSize: 16,
    fontFamily: 'Manrope-SemiBold',
    color: '#000',
  },
  loadingText: {
    fontSize: 15,
    fontFamily: 'Manrope-Regular',
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 16,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 17,
    fontFamily: 'Manrope-SemiBold',
    color: '#fff',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    fontFamily: 'Manrope-Regular',
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 12,
  },
  parameterItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  parameterName: {
    fontSize: 14,
    fontFamily: 'Manrope-Regular',
    color: '#fff',
  },
  parameterType: {
    fontSize: 12,
    fontFamily: 'Manrope-SemiBold',
    color: 'rgba(255, 255, 255, 0.6)',
    textTransform: 'uppercase',
  },
  moreText: {
    fontSize: 13,
    fontFamily: 'Manrope-Regular',
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
    marginTop: 4,
  },
  mappingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  mappingLabel: {
    fontSize: 14,
    fontFamily: 'Manrope-Regular',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  mappingValue: {
    fontSize: 14,
    fontFamily: 'Manrope-SemiBold',
    color: '#fff',
  },
  pricingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pricingLabel: {
    fontSize: 14,
    fontFamily: 'Manrope-Regular',
    color: '#fff',
  },
  pricingInput: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    fontFamily: 'Manrope-Regular',
    color: '#fff',
  },
});
