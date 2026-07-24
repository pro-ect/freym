import React, { useState, useRef } from 'react';
import {
  View,
  Modal,
  TouchableOpacity,
  Text,
  StyleSheet,
  Dimensions,
  Alert,
  Platform,
  Keyboard,
} from 'react-native';
import {
  Canvas,
  Path,
  Image as SkiaImage,
  Skia,
  useImage,
  PaintStyle,
} from '@shopify/react-native-skia';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import * as FileSystem from 'expo-file-system/legacy';
import { captureRef } from 'react-native-view-shot';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface DrawingPath {
  path: string;
  color: string;
  strokeWidth: number;
}

interface DrawingCanvasProps {
  visible: boolean;
  imageUri: string;
  onClose: () => void;
  onSave: (imageUri: string) => void;
}

const COLORS = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#FFFFFF', '#000000'];
const STROKE_WIDTHS = [2, 5, 10, 20];

export default function DrawingCanvas({ visible, imageUri, onClose, onSave }: DrawingCanvasProps) {
  const { t } = useTranslation();
  const [paths, setPaths] = useState<DrawingPath[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [selectedColor, setSelectedColor] = useState('#FF0000');
  const [selectedStrokeWidth, setSelectedStrokeWidth] = useState(5);
  const canvasRef = useRef<View>(null);

  const image = useImage(imageUri);

  const pan = Gesture.Pan()
    .onStart((event) => {
      const newPath = Skia.Path.Make();
      newPath.moveTo(event.x, event.y);
      setCurrentPath(newPath.toSVGString());
    })
    .onUpdate((event) => {
      const path = Skia.Path.MakeFromSVGString(currentPath);
      if (path) {
        path.lineTo(event.x, event.y);
        setCurrentPath(path.toSVGString());
      }
    })
    .onEnd(() => {
      if (currentPath) {
        setPaths([...paths, {
          path: currentPath,
          color: selectedColor,
          strokeWidth: selectedStrokeWidth,
        }]);
        setCurrentPath('');
      }
    });

  const handleUndo = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (paths.length > 0) {
      setPaths(paths.slice(0, -1));
    }
  };

  const handleClear = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      t('drawing.clearTitle'),
      t('drawing.clearMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('drawing.clear'),
          style: 'destructive',
          onPress: () => setPaths([]),
        },
      ]
    );
  };

  const handleSave = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Keyboard.dismiss(); // Hide keyboard when saving

    try {
      if (!canvasRef.current) {
        throw new Error('Canvas reference not found');
      }

      // Capture the canvas as an image
      const uri = await captureRef(canvasRef, {
        format: 'png',
        quality: 1,
      });

      onSave(uri);
      setPaths([]); // Clear the drawing after saving
    } catch (error) {
      console.error('Error saving drawing:', error);
      Alert.alert(t('common.error'), t('drawing.saveError'));
    }
  };

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Keyboard.dismiss(); // Hide keyboard when closing

    if (paths.length > 0) {
      Alert.alert(
        t('drawing.discardTitle'),
        t('drawing.discardMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('drawing.discard'),
            style: 'destructive',
            onPress: () => {
              setPaths([]);
              onClose();
            },
          },
        ]
      );
    } else {
      onClose();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} style={styles.headerButton}>
            <Text style={styles.headerButtonText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('drawing.title')}</Text>
          <TouchableOpacity onPress={handleSave} style={styles.headerButton}>
            <Text style={[styles.headerButtonText, styles.saveButton]}>{t('common.save')}</Text>
          </TouchableOpacity>
        </View>

        {/* Canvas */}
        <View style={styles.canvasContainer} ref={canvasRef} collapsable={false}>
          <GestureDetector gesture={pan}>
            <Canvas style={styles.canvas}>
              {/* Draw the original image */}
              {image && (
                <SkiaImage
                  image={image}
                  fit="contain"
                  x={0}
                  y={0}
                  width={SCREEN_WIDTH}
                  height={SCREEN_HEIGHT - 240}
                />
              )}

              {/* Draw all saved paths */}
              {paths.map((drawingPath, index) => (
                <Path
                  key={index}
                  path={drawingPath.path}
                  color={drawingPath.color}
                  style="stroke"
                  strokeWidth={drawingPath.strokeWidth}
                  strokeCap="round"
                  strokeJoin="round"
                />
              ))}

              {/* Draw current path being drawn */}
              {currentPath && (
                <Path
                  path={currentPath}
                  color={selectedColor}
                  style="stroke"
                  strokeWidth={selectedStrokeWidth}
                  strokeCap="round"
                  strokeJoin="round"
                />
              )}
            </Canvas>
          </GestureDetector>
        </View>

        {/* Tools */}
        <View style={styles.toolsContainer}>
          {/* Color Picker */}
          <View style={styles.toolSection}>
            <Text style={styles.toolLabel}>{t('drawing.color')}</Text>
            <View style={styles.colorRow}>
              {COLORS.map((color) => (
                <TouchableOpacity
                  key={color}
                  style={[
                    styles.colorButton,
                    { backgroundColor: color },
                    selectedColor === color && styles.selectedColorButton,
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedColor(color);
                  }}
                />
              ))}
            </View>
          </View>

          {/* Stroke Width */}
          <View style={styles.toolSection}>
            <Text style={styles.toolLabel}>{t('drawing.brushSize')}</Text>
            <View style={styles.strokeRow}>
              {STROKE_WIDTHS.map((width) => (
                <TouchableOpacity
                  key={width}
                  style={[
                    styles.strokeButton,
                    selectedStrokeWidth === width && styles.selectedStrokeButton,
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedStrokeWidth(width);
                  }}
                >
                  <View
                    style={[
                      styles.strokePreview,
                      {
                        width: width * 2,
                        height: width * 2,
                        borderRadius: width,
                      },
                    ]}
                  />
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Actions */}
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionButton, paths.length === 0 && styles.disabledButton]}
              onPress={handleUndo}
              disabled={paths.length === 0}
            >
              <Text style={styles.actionButtonText}>{t('drawing.undo')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, paths.length === 0 && styles.disabledButton]}
              onPress={handleClear}
              disabled={paths.length === 0}
            >
              <Text style={styles.actionButtonText}>{t('drawing.clear')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  headerButton: {
    padding: 8,
  },
  headerButtonText: {
    color: '#007AFF',
    fontSize: 16,
  },
  saveButton: {
    fontWeight: '600',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  canvasContainer: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  canvas: {
    flex: 1,
  },
  toolsContainer: {
    padding: 16,
    backgroundColor: '#1a1a1a',
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  toolSection: {
    marginBottom: 16,
  },
  toolLabel: {
    color: '#999',
    fontSize: 14,
    marginBottom: 8,
  },
  colorRow: {
    flexDirection: 'row',
    gap: 12,
  },
  colorButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selectedColorButton: {
    borderColor: '#fff',
    borderWidth: 3,
  },
  strokeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  strokeButton: {
    width: 50,
    height: 50,
    borderRadius: 8,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selectedStrokeButton: {
    borderColor: '#007AFF',
  },
  strokePreview: {
    backgroundColor: '#fff',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    backgroundColor: '#333',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  disabledButton: {
    opacity: 0.3,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
