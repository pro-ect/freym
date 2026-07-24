import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { ArrowUp, ArrowDown, Pencil, Plus, Trash2, Folder, Eye, EyeOff } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import { invalidateModelsCache } from '../../lib/cloudModels';

const ROUNDED_FONT = 'SFRounded-Medium';

type ModelCategory = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  sort_order: number;
  is_active: boolean;
};

interface Props {
  // Called whenever categories change so the caller can refresh the home tab.
  onChanged?: () => void;
}

export default function AdminModelCategoriesEditor({ onChanged }: Props) {
  const [categories, setCategories] = useState<ModelCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  // Edit-existing state
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSubtitle, setEditSubtitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Create-new state
  const [showCreate, setShowCreate] = useState(false);
  const [newSlug, setNewSlug] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newSubtitle, setNewSubtitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('model_categories')
      .select('id, slug, title, subtitle, sort_order, is_active')
      .order('sort_order', { ascending: true });
    if (error) {
      console.warn('[ModelCategories] load failed:', error.message);
      setCategories([]);
    } else {
      setCategories((data ?? []) as ModelCategory[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const notify = useCallback(async () => {
    await invalidateModelsCache();
    onChanged?.();
  }, [onChanged]);

  const swapWithNeighbor = useCallback(async (index: number, direction: 'up' | 'down') => {
    const target = categories[index];
    const neighbor = categories[direction === 'up' ? index - 1 : index + 1];
    if (!target || !neighbor) return;

    setBusySlug(target.slug);

    // Optimistic
    const next = [...categories];
    next[index] = { ...neighbor, sort_order: target.sort_order };
    next[direction === 'up' ? index - 1 : index + 1] = { ...target, sort_order: neighbor.sort_order };
    setCategories(next);

    const TEMP = -1;
    const targetOrig = target.sort_order;
    const neighborOrig = neighbor.sort_order;

    try {
      const r1 = await supabase.from('model_categories').update({ sort_order: TEMP }).eq('slug', target.slug);
      if (r1.error) throw r1.error;
      const r2 = await supabase.from('model_categories').update({ sort_order: targetOrig }).eq('slug', neighbor.slug);
      if (r2.error) throw r2.error;
      const r3 = await supabase.from('model_categories').update({ sort_order: neighborOrig }).eq('slug', target.slug);
      if (r3.error) throw r3.error;
      await notify();
    } catch (e: any) {
      console.warn('[ModelCategories] reorder failed:', e?.message ?? e);
      Alert.alert('Reorder failed', e?.message ?? 'Could not save new order.');
      await refresh();
    } finally {
      setBusySlug(null);
    }
  }, [categories, refresh, notify]);

  const startEdit = useCallback((cat: ModelCategory) => {
    setShowCreate(false);
    setEditingSlug(cat.slug);
    setEditTitle(cat.title);
    setEditSubtitle(cat.subtitle ?? '');
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingSlug(null);
    setEditTitle('');
    setEditSubtitle('');
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingSlug) return;
    const title = editTitle.trim();
    if (!title) {
      Alert.alert('Title required', 'Category title cannot be empty.');
      return;
    }
    const subtitle = editSubtitle.trim();
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('model_categories')
        .update({ title, subtitle: subtitle.length > 0 ? subtitle : null })
        .eq('slug', editingSlug);
      if (error) throw error;
      await notify();
      await refresh();
      cancelEdit();
    } catch (e: any) {
      console.warn('[ModelCategories] edit failed:', e?.message ?? e);
      Alert.alert('Save failed', e?.message ?? 'Could not save changes.');
    } finally {
      setIsSaving(false);
    }
  }, [editingSlug, editTitle, editSubtitle, refresh, cancelEdit, notify]);

  const toggleActive = useCallback(async (cat: ModelCategory) => {
    setBusySlug(cat.slug);
    try {
      const { error } = await supabase
        .from('model_categories')
        .update({ is_active: !cat.is_active })
        .eq('slug', cat.slug);
      if (error) throw error;
      await notify();
      await refresh();
    } catch (e: any) {
      console.warn('[ModelCategories] toggle active failed:', e?.message ?? e);
      Alert.alert('Failed', e?.message ?? 'Could not update visibility.');
    } finally {
      setBusySlug(null);
    }
  }, [refresh, notify]);

  const deleteCategory = useCallback((cat: ModelCategory) => {
    Alert.alert(
      'Delete category?',
      `Remove "${cat.title}" (${cat.slug}). Models that referenced it stay, but the strip is gone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusySlug(cat.slug);
            try {
              const { error } = await supabase
                .from('model_categories')
                .delete()
                .eq('slug', cat.slug);
              if (error) throw error;
              await notify();
              await refresh();
            } catch (e: any) {
              console.warn('[ModelCategories] delete failed:', e?.message ?? e);
              Alert.alert('Delete failed', e?.message ?? 'Could not delete category.');
            } finally {
              setBusySlug(null);
            }
          },
        },
      ],
    );
  }, [refresh, notify]);

  const openCreate = useCallback(() => {
    cancelEdit();
    setNewSlug('');
    setNewTitle('');
    setNewSubtitle('');
    setShowCreate(true);
  }, [cancelEdit]);

  const cancelCreate = useCallback(() => {
    setShowCreate(false);
    setNewSlug('');
    setNewTitle('');
    setNewSubtitle('');
  }, []);

  const createCategory = useCallback(async () => {
    const slug = newSlug.trim().toLowerCase();
    const title = newTitle.trim();
    if (!slug || !title) {
      Alert.alert('Missing fields', 'Slug and title are required.');
      return;
    }
    if (!/^[a-z0-9_]+$/.test(slug)) {
      Alert.alert('Invalid slug', 'Slug may only contain lowercase letters, digits, and underscores.');
      return;
    }
    if (categories.some((c) => c.slug.toLowerCase() === slug)) {
      Alert.alert('Slug already exists', 'Pick a different slug.');
      return;
    }
    const subtitle = newSubtitle.trim();
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.sort_order ?? 0), 0);
    setIsCreating(true);
    try {
      const { error } = await supabase.from('model_categories').insert({
        slug,
        title,
        subtitle: subtitle.length > 0 ? subtitle : null,
        sort_order: maxOrder + 10,
        is_active: true,
      });
      if (error) throw error;
      await notify();
      await refresh();
      cancelCreate();
    } catch (e: any) {
      console.warn('[ModelCategories] create failed:', e?.message ?? e);
      Alert.alert('Create failed', e?.message ?? 'Could not create category.');
    } finally {
      setIsCreating(false);
    }
  }, [newSlug, newTitle, newSubtitle, categories, refresh, cancelCreate, notify]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Folder size={18} color="#FFD700" />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.headerTitle}>Model categories</Text>
          <Text style={styles.headerHint}>
            Strips shown on the Home tab. Reorder, edit, hide, or delete. Empty categories are hidden automatically.
          </Text>
        </View>
      </View>

      {loading && categories.length === 0 ? (
        <View style={{ padding: 16, alignItems: 'center' }}>
          <ActivityIndicator color="#9ca3af" />
        </View>
      ) : categories.length === 0 ? (
        <Text style={styles.empty}>No model categories yet.</Text>
      ) : (
        <View style={{ marginTop: 4 }}>
          {categories.map((cat, index) => {
            const isFirst = index === 0;
            const isLast = index === categories.length - 1;
            const busy = busySlug === cat.slug;
            const isEditing = editingSlug === cat.slug;

            if (isEditing) {
              return (
                <View key={cat.slug} style={styles.editForm}>
                  <Text style={styles.slugLabel}>
                    Slug: <Text style={styles.slugValue}>{cat.slug}</Text>
                  </Text>
                  <Text style={styles.slugHint}>Slug cannot be changed.</Text>
                  <TextInput
                    style={styles.input}
                    value={editTitle}
                    onChangeText={setEditTitle}
                    placeholder="Title"
                    placeholderTextColor="#6b7280"
                    autoCapitalize="sentences"
                  />
                  <TextInput
                    style={styles.input}
                    value={editSubtitle}
                    onChangeText={setEditSubtitle}
                    placeholder="Subtitle (optional)"
                    placeholderTextColor="#6b7280"
                    autoCapitalize="sentences"
                  />
                  <View style={styles.formActions}>
                    <TouchableOpacity
                      style={[styles.button, isSaving && styles.buttonDisabled]}
                      onPress={cancelEdit}
                      disabled={isSaving}
                    >
                      <Text style={styles.buttonText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.button,
                        styles.buttonPrimary,
                        (isSaving || !editTitle.trim()) && styles.buttonDisabled,
                      ]}
                      onPress={saveEdit}
                      disabled={isSaving || !editTitle.trim()}
                    >
                      {isSaving ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.buttonText}>Save</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }

            return (
              <View key={cat.slug} style={[styles.row, !cat.is_active && styles.rowInactive]}>
                <View style={{ flex: 1, paddingRight: 6 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{cat.title}</Text>
                  <Text style={styles.rowSlug} numberOfLines={1}>{cat.slug}{!cat.is_active ? '  ·  hidden' : ''}</Text>
                </View>
                <View style={styles.rowButtons}>
                  <ActionButton disabled={busy} onPress={() => toggleActive(cat)}>
                    {cat.is_active
                      ? <Eye size={16} color={busy ? '#3f3f46' : '#fff'} />
                      : <EyeOff size={16} color={busy ? '#3f3f46' : '#fff'} />}
                  </ActionButton>
                  <ActionButton disabled={busy} onPress={() => startEdit(cat)}>
                    <Pencil size={16} color={busy ? '#3f3f46' : '#fff'} />
                  </ActionButton>
                  <ActionButton disabled={isFirst || busy} onPress={() => swapWithNeighbor(index, 'up')}>
                    <ArrowUp size={18} color={isFirst || busy ? '#3f3f46' : '#fff'} />
                  </ActionButton>
                  <ActionButton disabled={isLast || busy} onPress={() => swapWithNeighbor(index, 'down')}>
                    <ArrowDown size={18} color={isLast || busy ? '#3f3f46' : '#fff'} />
                  </ActionButton>
                  <ActionButton disabled={busy} onPress={() => deleteCategory(cat)}>
                    <Trash2 size={16} color={busy ? '#3f3f46' : '#ef4444'} />
                  </ActionButton>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {showCreate ? (
        <View style={styles.editForm}>
          <TextInput
            style={styles.input}
            value={newSlug}
            onChangeText={(t) => setNewSlug(t.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
            placeholder="Slug (e.g. premium)"
            placeholderTextColor="#6b7280"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={styles.input}
            value={newTitle}
            onChangeText={setNewTitle}
            placeholder="Title"
            placeholderTextColor="#6b7280"
            autoCapitalize="sentences"
          />
          <TextInput
            style={styles.input}
            value={newSubtitle}
            onChangeText={setNewSubtitle}
            placeholder="Subtitle (optional)"
            placeholderTextColor="#6b7280"
            autoCapitalize="sentences"
          />
          <View style={styles.formActions}>
            <TouchableOpacity
              style={[styles.button, isCreating && styles.buttonDisabled]}
              onPress={cancelCreate}
              disabled={isCreating}
            >
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.button,
                styles.buttonPrimary,
                (isCreating || !newSlug.trim() || !newTitle.trim()) && styles.buttonDisabled,
              ]}
              onPress={createCategory}
              disabled={isCreating || !newSlug.trim() || !newTitle.trim()}
            >
              {isCreating ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Create</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={[styles.button, styles.buttonAdd]} onPress={openCreate}>
          <Plus size={16} color="#fff" />
          <Text style={styles.buttonText}>Add category</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function ActionButton({ children, onPress, disabled }: { children: React.ReactNode; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.actionBtn, disabled && styles.actionBtnDisabled]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
    >
      {children}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 4,
    paddingBottom: 12,
  },
  headerTitle: { color: '#fff', fontFamily: ROUNDED_FONT, fontSize: 15, fontWeight: '500' },
  headerHint: { color: '#9ca3af', fontSize: 12, marginTop: 4, lineHeight: 16 },

  empty: { color: '#9ca3af', fontSize: 13, paddingHorizontal: 4, paddingVertical: 8 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    backgroundColor: '#0f0f0f',
    borderRadius: 10,
    marginBottom: 6,
  },
  rowInactive: { opacity: 0.55 },
  rowTitle: { color: '#fff', fontFamily: ROUNDED_FONT, fontSize: 14, fontWeight: '500' },
  rowSlug: { color: '#6b7280', fontSize: 11, marginTop: 1 },
  rowButtons: { flexDirection: 'row', alignItems: 'center', gap: 2 },

  actionBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  actionBtnDisabled: { opacity: 0.5 },

  editForm: {
    backgroundColor: '#0f0f0f',
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
    marginBottom: 6,
  },
  slugLabel: { color: '#9ca3af', fontSize: 11, marginBottom: 1 },
  slugValue: { color: '#fff', fontFamily: 'Menlo', fontSize: 12 },
  slugHint: { color: '#6b7280', fontSize: 11, marginBottom: 10 },
  input: {
    color: '#fff',
    fontFamily: ROUNDED_FONT,
    fontSize: 14,
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 8,
  },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },

  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#1f2937',
    borderRadius: 8,
  },
  buttonPrimary: { backgroundColor: '#2563eb' },
  buttonDisabled: { opacity: 0.5 },
  buttonAdd: { alignSelf: 'flex-start', marginTop: 10 },
  buttonText: { color: '#fff', fontFamily: ROUNDED_FONT, fontSize: 14, fontWeight: '500' },
});
