/**
 * DynamicModelForm Component
 *
 * Renders form fields dynamically based on param_schema from cloud models.
 * Supports select, number, boolean, and text field types.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Switch,
  StyleSheet,
  PanResponder,
  GestureResponderEvent,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { ParamSchema, ParamSchemaField } from '@/lib/cloudModels';

interface DynamicModelFormProps {
  schema: ParamSchema;
  values: Record<string, any>;
  onChange: (key: string, value: any) => void;
  disabled?: boolean;
  // Special handling for certain fields
  referenceImagesCount?: number; // For match_input_image validation
}

/**
 * Select field renderer - horizontal scrollable options
 */
function SelectField({
  fieldKey,
  field,
  value,
  onChange,
  disabled,
  referenceImagesCount,
}: {
  fieldKey: string;
  field: ParamSchemaField;
  value: any;
  onChange: (value: any) => void;
  disabled?: boolean;
  referenceImagesCount?: number;
}) {
  const options = field.options || [];
  const currentValue = value ?? field.default;

  return (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>{field.label || formatLabel(fieldKey)}</Text>
      {field.description && (
        <Text style={styles.fieldDescription}>{field.description}</Text>
      )}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.selectScrollContent}
      >
        <View style={styles.selectButtons}>
          {options.map((option) => {
            const optionValue = option;
            const isSelected = currentValue === optionValue;

            // Special handling for match_input_image
            const isMatchInput = optionValue === 'match_input_image';
            const isDisabled = disabled || (isMatchInput && (referenceImagesCount || 0) === 0);

            // Display label
            const displayLabel = optionValue === null
              ? 'None'
              : optionValue === 'match_input_image'
                ? 'Match Input'
                : String(optionValue);

            return (
              <TouchableOpacity
                key={String(optionValue)}
                style={[
                  styles.selectButton,
                  isSelected && styles.selectButtonActive,
                  isDisabled && styles.selectButtonDisabled,
                ]}
                onPress={() => {
                  if (!isDisabled) {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onChange(optionValue);
                  }
                }}
                disabled={isDisabled}
              >
                <Text
                  style={[
                    styles.selectButtonText,
                    isSelected && styles.selectButtonTextActive,
                    isDisabled && styles.selectButtonTextDisabled,
                  ]}
                >
                  {displayLabel}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * Number field renderer - horizontal scrollable options or input
 */
function NumberField({
  fieldKey,
  field,
  value,
  onChange,
  disabled,
}: {
  fieldKey: string;
  field: ParamSchemaField;
  value: any;
  onChange: (value: any) => void;
  disabled?: boolean;
}) {
  const currentValue = value ?? field.default;
  const min = field.min ?? 1;
  const max = field.max ?? 10;

  // If range is small (<=10 options), show as buttons
  const range = max - min + 1;
  const showAsButtons = range <= 10;

  if (showAsButtons) {
    const options = Array.from({ length: range }, (_, i) => min + i);

    return (
      <View style={styles.fieldContainer}>
        <Text style={styles.fieldLabel}>{field.label || formatLabel(fieldKey)}</Text>
        {field.description && (
          <Text style={styles.fieldDescription}>{field.description}</Text>
        )}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.selectScrollContent}
        >
          <View style={styles.selectButtons}>
            {options.map((num) => {
              const isSelected = currentValue === num;
              return (
                <TouchableOpacity
                  key={num}
                  style={[
                    styles.selectButton,
                    isSelected && styles.selectButtonActive,
                    disabled && styles.selectButtonDisabled,
                  ]}
                  onPress={() => {
                    if (!disabled) {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      onChange(num);
                    }
                  }}
                  disabled={disabled}
                >
                  <Text
                    style={[
                      styles.selectButtonText,
                      isSelected && styles.selectButtonTextActive,
                      disabled && styles.selectButtonTextDisabled,
                    ]}
                  >
                    {num}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </View>
    );
  }

  // For larger ranges, show input field
  return (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>{field.label || formatLabel(fieldKey)}</Text>
      {field.description && (
        <Text style={styles.fieldDescription}>{field.description}</Text>
      )}
      <TextInput
        style={[styles.numberInput, disabled && styles.inputDisabled]}
        value={String(currentValue)}
        onChangeText={(text) => {
          const num = parseInt(text, 10);
          if (!isNaN(num) && num >= min && num <= max) {
            onChange(num);
          }
        }}
        keyboardType="number-pad"
        editable={!disabled}
        placeholder={`${min}-${max}`}
        placeholderTextColor="#6b7280"
      />
    </View>
  );
}

/**
 * Slider field renderer - draggable thumb on a track. JS-only (PanResponder),
 * no native dependency. Snaps to `step` (default 1).
 */
function SliderField({
  fieldKey,
  field,
  value,
  onChange,
  disabled,
}: {
  fieldKey: string;
  field: ParamSchemaField;
  value: any;
  onChange: (value: any) => void;
  disabled?: boolean;
}) {
  const min = typeof field.min === 'number' ? field.min : 0;
  const max = typeof field.max === 'number' ? field.max : 100;
  const step = typeof field.step === 'number' && field.step > 0 ? field.step : 1;
  const fallback = typeof field.default === 'number' ? field.default : min;
  const currentValue: number = typeof value === 'number' ? value : fallback;

  const [trackWidth, setTrackWidth] = useState(0);
  const trackPageXRef = useRef(0);
  const trackRef = useRef<View>(null);
  const lastEmittedRef = useRef<number>(currentValue);

  const measureTrack = useCallback(() => {
    trackRef.current?.measure((_x, _y, w, _h, pageX) => {
      trackPageXRef.current = pageX;
      if (w !== trackWidth) setTrackWidth(w);
    });
  }, [trackWidth]);

  const posToValue = useCallback(
    (pos: number) => {
      if (trackWidth <= 0) return currentValue;
      const clamped = Math.max(0, Math.min(trackWidth, pos));
      const ratio = clamped / trackWidth;
      const raw = min + ratio * (max - min);
      const stepped = Math.round(raw / step) * step;
      return Math.max(min, Math.min(max, stepped));
    },
    [trackWidth, min, max, step, currentValue]
  );

  const handleAt = useCallback(
    (e: GestureResponderEvent) => {
      const x = e.nativeEvent.pageX - trackPageXRef.current;
      const next = posToValue(x);
      if (next !== lastEmittedRef.current) {
        lastEmittedRef.current = next;
        Haptics.selectionAsync();
        onChange(next);
      }
    },
    [posToValue, onChange]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          measureTrack();
          handleAt(e);
        },
        onPanResponderMove: handleAt,
      }),
    [disabled, handleAt, measureTrack]
  );

  const ratio = max === min ? 0 : (currentValue - min) / (max - min);
  const thumbLeft = Math.max(0, Math.min(trackWidth, ratio * trackWidth));

  return (
    <View style={styles.fieldContainer}>
      <View style={styles.sliderHeader}>
        <Text style={styles.fieldLabel}>{field.label || formatLabel(fieldKey)}</Text>
        <Text style={styles.sliderValue}>{currentValue}</Text>
      </View>
      {field.description && (
        <Text style={styles.fieldDescription}>{field.description}</Text>
      )}
      <View
        ref={trackRef}
        onLayout={measureTrack}
        style={[styles.sliderTrack, disabled && styles.sliderTrackDisabled]}
        {...panResponder.panHandlers}
      >
        <View style={styles.sliderRail} />
        <View style={[styles.sliderFill, { width: thumbLeft }]} />
        <View style={[styles.sliderThumb, { left: thumbLeft - 11 }]} />
      </View>
      <View style={styles.sliderMinMax}>
        <Text style={styles.sliderMinMaxText}>{min}</Text>
        <Text style={styles.sliderMinMaxText}>{max}</Text>
      </View>
    </View>
  );
}

/**
 * Boolean field renderer - toggle switch
 */
function BooleanField({
  fieldKey,
  field,
  value,
  onChange,
  disabled,
}: {
  fieldKey: string;
  field: ParamSchemaField;
  value: any;
  onChange: (value: any) => void;
  disabled?: boolean;
}) {
  const currentValue = value ?? field.default ?? false;

  return (
    <View style={styles.fieldContainer}>
      <View style={styles.booleanRow}>
        <View style={styles.booleanTextContainer}>
          <Text style={styles.fieldLabel}>{field.label || formatLabel(fieldKey)}</Text>
          {field.description && (
            <Text style={styles.fieldDescription}>{field.description}</Text>
          )}
        </View>
        <Switch
          value={currentValue}
          onValueChange={(newValue) => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onChange(newValue);
          }}
          disabled={disabled}
          trackColor={{ false: 'rgba(255, 255, 255, 0.12)', true: 'rgba(244, 213, 141, 0.3)' }}
          thumbColor={currentValue ? '#F4D58D' : '#9ca3af'}
        />
      </View>
    </View>
  );
}

/**
 * Text field renderer - text input
 */
function TextField({
  fieldKey,
  field,
  value,
  onChange,
  disabled,
}: {
  fieldKey: string;
  field: ParamSchemaField;
  value: any;
  onChange: (value: any) => void;
  disabled?: boolean;
}) {
  const currentValue = value ?? field.default ?? '';

  return (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>{field.label || formatLabel(fieldKey)}</Text>
      {field.description && (
        <Text style={styles.fieldDescription}>{field.description}</Text>
      )}
      <TextInput
        style={[styles.textInput, disabled && styles.inputDisabled]}
        value={String(currentValue)}
        onChangeText={onChange}
        editable={!disabled}
        placeholder={`Enter ${formatLabel(fieldKey).toLowerCase()}`}
        placeholderTextColor="#6b7280"
      />
    </View>
  );
}

/**
 * Format field key to readable label
 * e.g., "aspect_ratio" -> "Aspect Ratio"
 */
function formatLabel(key: string): string {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Main DynamicModelForm component
 */
export default function DynamicModelForm({
  schema,
  values,
  onChange,
  disabled = false,
  referenceImagesCount = 0,
}: DynamicModelFormProps) {
  const handleChange = useCallback(
    (key: string, value: any) => {
      onChange(key, value);
    },
    [onChange]
  );

  if (!schema || Object.keys(schema).length === 0) {
    return null;
  }

  // Fields to hide from users (internal/safety settings)
  const hiddenFields = ['safety', 'safety_filter', 'safety_filter_level', 'safety_tolerance'];

  return (
    <View style={styles.container}>
      {Object.entries(schema).map(([fieldKey, field]) => {
        // Skip hidden fields (safety-related parameters)
        if (hiddenFields.some(hidden => fieldKey.toLowerCase().includes(hidden))) {
          return null;
        }

        const value = values[fieldKey];

        switch (field.type) {
          case 'select':
            return (
              <SelectField
                key={fieldKey}
                fieldKey={fieldKey}
                field={field}
                value={value}
                onChange={(v) => handleChange(fieldKey, v)}
                disabled={disabled}
                referenceImagesCount={referenceImagesCount}
              />
            );

          case 'number':
            return (
              <NumberField
                key={fieldKey}
                fieldKey={fieldKey}
                field={field}
                value={value}
                onChange={(v) => handleChange(fieldKey, v)}
                disabled={disabled}
              />
            );

          case 'slider':
            return (
              <SliderField
                key={fieldKey}
                fieldKey={fieldKey}
                field={field}
                value={value}
                onChange={(v) => handleChange(fieldKey, v)}
                disabled={disabled}
              />
            );

          case 'boolean':
            return (
              <BooleanField
                key={fieldKey}
                fieldKey={fieldKey}
                field={field}
                value={value}
                onChange={(v) => handleChange(fieldKey, v)}
                disabled={disabled}
              />
            );

          case 'text':
            return (
              <TextField
                key={fieldKey}
                fieldKey={fieldKey}
                field={field}
                value={value}
                onChange={(v) => handleChange(fieldKey, v)}
                disabled={disabled}
              />
            );

          default:
            return null;
        }
      })}
    </View>
  );
}

/**
 * Get default values from schema
 */
export function getDefaultValuesFromSchema(schema: ParamSchema): Record<string, any> {
  const defaults: Record<string, any> = {};

  for (const [key, field] of Object.entries(schema)) {
    if (field.default !== undefined) {
      defaults[key] = field.default;
    }
  }

  return defaults;
}

const styles = StyleSheet.create({
  container: {
    // No gap - use border separators instead
  },
  fieldContainer: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  fieldLabel: {
    fontSize: 15,
    color: '#fff',
    marginBottom: 4,
  },
  fieldDescription: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 8,
  },
  selectScrollContent: {
    // No padding needed
  },
  selectButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  selectButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#333',
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectButtonActive: {
    backgroundColor: '#F4D58D',
  },
  selectButtonDisabled: {
    opacity: 0.4,
  },
  selectButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#9ca3af',
  },
  selectButtonTextActive: {
    color: '#111',
  },
  selectButtonTextDisabled: {
    color: '#4b5563',
  },
  numberInput: {
    backgroundColor: '#222',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 15,
    marginTop: 8,
  },
  textInput: {
    backgroundColor: '#222',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 15,
    marginTop: 8,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  booleanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  booleanTextContainer: {
    flex: 1,
    marginRight: 12,
  },
  sliderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sliderValue: {
    fontSize: 15,
    color: '#F4D58D',
    fontVariant: ['tabular-nums'],
    minWidth: 36,
    textAlign: 'right',
  },
  sliderTrack: {
    height: 28,
    marginTop: 12,
    marginBottom: 4,
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  sliderTrackDisabled: {
    opacity: 0.4,
  },
  sliderRail: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 12,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    top: 12,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#F4D58D',
  },
  sliderThumb: {
    position: 'absolute',
    top: 3,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#F4D58D',
    borderWidth: 2,
    borderColor: '#111',
  },
  sliderMinMax: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  sliderMinMaxText: {
    fontSize: 11,
    color: '#6b7280',
  },
});
