import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { X, ImagePlus, Check, Pin } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { CloudModel, invalidateModelsCache } from '../../lib/cloudModels';
import { ActiveModelCategory, fetchAllActiveModelCategories } from '../../lib/models/homeQueries';

const ROUNDED_FONT = 'SFRounded-Medium';

interface Props {
  visible: boolean;
  model: CloudModel | null;
  categories?: ActiveModelCategory[]; // optional seed; modal refetches all active categories on open
  onClose: () => void;
  onSaved: () => void; // parent should refresh
}

export default function AdminModelEditModal({ visible, model, categories: seedCategories, onClose, onSaved }: Props) {
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [isPinned, setIsPinned] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<ActiveModelCategory[]>(seedCategories ?? []);

  useEffect(() => {
    if (!model) return;
    setName(model.name);
    setHeroImageUrl(model.heroImageUrl);
    setSelectedCategories(model.categorySlugs);
    setIsPinned(model.isPinned);
  }, [model]);

  // Refetch the full list of active categories every time the modal opens,
  // so newly created categories (including empty ones) are assignable here.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      const all = await fetchAllActiveModelCategories();
      if (!cancelled) setCategories(all);
    })();
    return () => { cancelled = true; };
  }, [visible]);

  const toggleCategory = (slug: string) => {
    setSelectedCategories((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  };

  const pickHeroImage = async () => {
    if (!model) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to pick a hero image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];

    setUploading(true);
    try {
      // Read the file as a binary array for Supabase upload.
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

      const ext = (asset.fileName?.split('.').pop() || 'jpg').toLowerCase();
      const path = `${model.slug}/${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`;
      const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

      const { error: upErr } = await supabase.storage
        .from('model-hero-images')
        .upload(path, bytes, { contentType, upsert: true });
      if (upErr) throw upErr;

      const { data } = supabase.storage.from('model-hero-images').getPublicUrl(path);
      // Bust expo-image's cache by adding a fresh query param on the URL we save.
      setHeroImageUrl(`${data.publicUrl}?v=${Date.now()}`);
    } catch (err: any) {
      console.error('[AdminModelEdit] upload failed:', err);
      Alert.alert('Upload failed', err?.message ?? 'Could not upload image.');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!model) return;
    if (!name.trim()) {
      Alert.alert('Name required', 'Model name cannot be empty.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('models')
        .update({
          name: name.trim(),
          hero_image_url: heroImageUrl,
          category_slugs: selectedCategories,
          is_pinned: isPinned,
        })
        .eq('id', model.id);
      if (error) throw error;

      await invalidateModelsCache();
      onSaved();
      onClose();
    } catch (err: any) {
      console.error('[AdminModelEdit] save failed:', err);
      Alert.alert('Save failed', err?.message ?? 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };

  if (!model) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: 14 }]}>
          <TouchableOpacity onPress={onClose} hitSlop={8} style={styles.headerBtn}>
            <X size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit model</Text>
          <TouchableOpacity onPress={save} hitSlop={8} style={styles.headerBtn} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Check size={22} color="#fff" />}
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero image preview */}
          <Pressable onPress={pickHeroImage} style={styles.heroPreview} disabled={uploading}>
            {heroImageUrl ? (
              <Image source={{ uri: heroImageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.heroEmpty]}>
                <ImagePlus size={32} color="#666" />
                <Text style={styles.heroEmptyText}>Tap to choose a hero image</Text>
              </View>
            )}
            {uploading ? (
              <View style={[StyleSheet.absoluteFill, styles.heroUploading]}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.heroUploadingText}>Uploading…</Text>
              </View>
            ) : (
              <View style={styles.heroChangeBtn}>
                <ImagePlus size={16} color="#000" />
                <Text style={styles.heroChangeText}>{heroImageUrl ? 'Replace' : 'Choose photo'}</Text>
              </View>
            )}
          </Pressable>

          {/* Name */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              style={styles.input}
              placeholder="Model name"
              placeholderTextColor="#666"
              autoCapitalize="words"
            />
          </View>

          {/* Slug — read-only, just informational */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Slug</Text>
            <Text style={styles.slugText}>{model.slug}</Text>
          </View>

          {/* Categories */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Categories</Text>
            <View style={styles.chipRow}>
              {categories.map((cat) => {
                const active = selectedCategories.includes(cat.slug);
                return (
                  <Pressable
                    key={cat.slug}
                    onPress={() => toggleCategory(cat.slug)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{cat.title}</Text>
                  </Pressable>
                );
              })}
            </View>
            {selectedCategories.length === 0 ? (
              <Text style={styles.helperText}>Pick at least one category so the model appears on Home.</Text>
            ) : null}
          </View>

          {/* Pin */}
          <View style={styles.fieldGroup}>
            <Pressable onPress={() => setIsPinned((p) => !p)} style={styles.pinRow}>
              <View style={styles.pinRowLeft}>
                <Pin size={18} color={isPinned ? '#000' : '#bbb'} fill={isPinned ? '#000' : 'transparent'} />
                <View style={{ marginLeft: 12 }}>
                  <Text style={styles.pinTitle}>Pin to top of category</Text>
                  <Text style={styles.pinSubtitle}>
                    Pinned models always appear first. Others sort by most-recently updated.
                  </Text>
                </View>
              </View>
              <View style={[styles.toggle, isPinned && styles.toggleOn]}>
                <View style={[styles.toggleKnob, isPinned && styles.toggleKnobOn]} />
              </View>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#fff', fontFamily: ROUNDED_FONT, fontSize: 17, fontWeight: '500' },

  heroPreview: {
    margin: 16,
    height: 320,
    borderRadius: 24,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: '#0d0d0d',
  },
  heroEmpty: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  heroEmptyText: { color: '#888', fontFamily: ROUNDED_FONT, fontSize: 14 },
  heroUploading: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  heroUploadingText: { color: '#fff', fontFamily: ROUNDED_FONT, fontSize: 14 },
  heroChangeBtn: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  heroChangeText: { color: '#000', fontFamily: ROUNDED_FONT, fontSize: 14, fontWeight: '500' },

  fieldGroup: { paddingHorizontal: 16, paddingBottom: 18 },
  fieldLabel: {
    color: '#999',
    fontFamily: ROUNDED_FONT,
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  input: {
    color: '#fff',
    fontFamily: ROUNDED_FONT,
    fontSize: 17,
    fontWeight: '400',
    backgroundColor: '#0f0f0f',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderCurve: 'continuous',
  },
  slugText: {
    color: '#666',
    fontFamily: 'Menlo',
    fontSize: 14,
  },

  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderCurve: 'continuous',
    backgroundColor: '#1a1a1a',
  },
  chipActive: { backgroundColor: '#fff' },
  chipText: { color: '#bbb', fontFamily: ROUNDED_FONT, fontSize: 13, fontWeight: '500' },
  chipTextActive: { color: '#000' },

  helperText: { color: '#888', fontSize: 12, marginTop: 8 },

  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    borderCurve: 'continuous',
  },
  pinRowLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingRight: 12 },
  pinTitle: { color: '#fff', fontFamily: ROUNDED_FONT, fontSize: 15, fontWeight: '500' },
  pinSubtitle: { color: '#888', fontSize: 12, marginTop: 2, lineHeight: 16 },
  toggle: {
    width: 42,
    height: 26,
    borderRadius: 999,
    backgroundColor: '#2a2a2a',
    padding: 2,
    justifyContent: 'center',
  },
  toggleOn: { backgroundColor: '#fff' },
  toggleKnob: {
    width: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: '#666',
  },
  toggleKnobOn: { backgroundColor: '#000', transform: [{ translateX: 16 }] },
});
