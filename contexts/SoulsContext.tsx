import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { imageManager, toAbsolutePath, toRelativePath } from '../lib/imageManager';
import { queries } from '../lib/database/queries';
import type { ImageType } from '../lib/types';

// NOTE: Souls are intentionally LOCAL-ONLY (SQLite). Supabase cloud sync was
// removed because it produced duplicate souls, empty souls, and sync errors
// (re-pulls on reinstall/2nd device, partial image uploads/downloads, no DB
// uniqueness on name). Everything below operates purely on the local DB.

export interface Soul {
  id: string;
  name: string;
  imageUris: string[]; // Up to 9 images (now managed by imageManager)
  createdAt: number;
  updatedAt?: number;
}

interface SoulsContextType {
  souls: Soul[];
  addSoul: (soul: Omit<Soul, 'id' | 'createdAt'>) => Promise<string>;
  updateSoul: (id: string, updates: Partial<Omit<Soul, 'id' | 'createdAt'>>) => Promise<void>;
  deleteSoul: (id: string) => Promise<void>;
  getSoul: (id: string) => Soul | undefined;
}

const SoulsContext = createContext<SoulsContextType | undefined>(undefined);

const STORAGE_KEY = '@foto_souls'; // Keep for migration purposes

export function SoulsProvider({ children }: { children: React.ReactNode }) {
  const [souls, setSouls] = useState<Soul[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load souls from SQLite on mount
  useEffect(() => {
    loadSouls();
  }, []);

  const validateSoulImages = async (soul: Soul): Promise<Soul> => {
    const validImageUris: string[] = [];

    for (const uri of soul.imageUris) {
      try {
        const fileInfo = await FileSystemLegacy.getInfoAsync(uri);
        if (fileInfo.exists) {
          validImageUris.push(uri);
        } else {
          console.warn(`🧹 Removing broken soul image from "${soul.name}": ${uri}`);
        }
      } catch (error) {
        console.warn(`🧹 Error checking soul image, removing: ${uri}`);
      }
    }

    return {
      ...soul,
      imageUris: validImageUris,
    };
  };

  const migrateFromAsyncStorage = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (!stored) return;

      console.log('📦 Migrating souls from AsyncStorage to SQLite...');
      const parsed: Soul[] = JSON.parse(stored);

      for (const soul of parsed) {
        try {
          // Check if soul already exists in SQLite
          const existing = await queries.getSoulById(soul.id);
          if (existing) {
            console.log(`✅ Soul "${soul.name}" already in SQLite, skipping`);
            continue;
          }

          // Insert soul into SQLite
          await queries.insertSoul({
            id: soul.id,
            name: soul.name,
            createdAt: soul.createdAt,
            updatedAt: soul.updatedAt,
          });

          // Insert image relations
          for (let i = 0; i < soul.imageUris.length; i++) {
            const uri = soul.imageUris[i];
            // Create image ID from URI
            const imageId = `soul_img_${soul.id}_${i}`;

            try {
              // Check if image already exists
              const existingImage = await queries.getImageById(imageId);
              if (!existingImage) {
                // Insert image record
                await queries.insertImage({
                  id: imageId,
                  localUri: uri,
                  remoteUri: uri.startsWith('http') ? uri : undefined,
                  type: 'soul',
                  category: soul.name,
                  metadata: {
                    soulId: soul.id,
                    soulName: soul.name,
                    position: i,
                  },
                  createdAt: soul.createdAt,
                  lastAccessedAt: Date.now(),
                  status: 'active',
                });
              }

              // Add image relation
              await queries.addImageRelation(soul.id, imageId, i);
            } catch (imgError) {
              console.warn(`Failed to migrate image ${i} for soul "${soul.name}":`, imgError);
            }
          }

          console.log(`✅ Migrated soul "${soul.name}" to SQLite`);
        } catch (soulError) {
          console.error(`Failed to migrate soul "${soul.name}":`, soulError);
        }
      }

      // After successful migration, clear AsyncStorage
      await AsyncStorage.removeItem(STORAGE_KEY);
      console.log('✅ Migration complete, cleared AsyncStorage');
    } catch (error) {
      console.error('Failed to migrate souls from AsyncStorage:', error);
    }
  };

  const loadSouls = async () => {
    console.log(`🔄 [SoulsContext] Starting soul loading process...`);
    try {
      // Initialize imageManager
      await imageManager.initialize();

      // Migrate from AsyncStorage if needed
      await migrateFromAsyncStorage();

      // Load souls from SQLite
      console.log(`📖 [SoulsContext] Loading souls from SQLite...`);
      const soulRecords = await queries.getAllSouls();
      console.log(`✅ [SoulsContext] Loaded ${soulRecords.length} soul record(s) from SQLite`);

      // Load image URIs for each soul
      const loadedSouls: Soul[] = [];
      for (const record of soulRecords) {
        console.log(`🔍 [SoulsContext] Processing soul: ${record.name} (${record.id})`);
        const imageRecords = await queries.getImageRelations(record.id);
        console.log(`📸 [SoulsContext] Found ${imageRecords.length} image record(s) for soul ${record.name}`);
        // Resolve relative paths to absolute (survives reinstalls)
        const imageUris = imageRecords.map(img => toAbsolutePath(img.localUri, 'soul' as ImageType));

        // OPTIMIZATION: Skip expensive file validation during initial load
        // expo-image will handle missing files gracefully during rendering
        // We still validate asynchronously in background (see below)
        console.log(`✅ [SoulsContext] ${imageUris.length}/${imageUris.length} images loaded for soul ${record.name} (validation deferred)`);

        // Only include souls with at least one image
        if (imageUris.length > 0) {
          loadedSouls.push({
            id: record.id,
            name: record.name,
            imageUris: imageUris,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          });
          console.log(`✅ [SoulsContext] Soul "${record.name}" added to loaded souls`);
        } else {
          console.warn(`🗑️ [SoulsContext] Removing soul "${record.name}" (${record.id}) - no images`);
          await queries.deleteSoul(record.id);
        }
      }

      console.log(`🎉 [SoulsContext] Soul loading complete. Total souls: ${loadedSouls.length}`);
      setSouls(loadedSouls);

      // OPTIMIZATION: Validate images in background after initial load
      setTimeout(async () => {
        console.log(`🔍 [SoulsContext] Starting background image validation...`);
        for (const soul of loadedSouls) {
          const validImageUris: string[] = [];
          for (const uri of soul.imageUris) {
            try {
              const fileInfo = await FileSystemLegacy.getInfoAsync(uri);
              if (fileInfo.exists) {
                validImageUris.push(uri);
              } else {
                console.warn(`🧹 [SoulsContext] Removing broken soul image from "${soul.name}": ${uri}`);
              }
            } catch (error) {
              console.warn(`🧹 [SoulsContext] Error checking soul image, removing: ${uri}`);
            }
          }

          // Update soul if any images were invalid
          if (validImageUris.length !== soul.imageUris.length) {
            console.log(`🔄 [SoulsContext] Updating soul "${soul.name}" after validation: ${validImageUris.length}/${soul.imageUris.length} valid`);
            setSouls(prev => prev.map(s =>
              s.id === soul.id ? { ...s, imageUris: validImageUris } : s
            ));

            // Delete soul if no valid images remain
            if (validImageUris.length === 0) {
              console.warn(`🗑️ [SoulsContext] Removing soul "${soul.name}" (${soul.id}) - no valid images after validation`);
              await queries.deleteSoul(soul.id);
              setSouls(prev => prev.filter(s => s.id !== soul.id));
            }
          }
        }
        console.log(`✅ [SoulsContext] Background image validation complete`);
      }, 2000); // Wait 2 seconds after initial load
    } catch (error) {
      console.error('Failed to load souls:', error);
    } finally {
      setIsLoaded(true);
    }
  };

  const addSoul = useCallback(async (soul: Omit<Soul, 'id' | 'createdAt'>) => {
    const id = `soul_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const createdAt = Date.now();

    console.log(`👤 ADDING NEW SOUL: ${soul.name}`);
    console.log(`📸 Number of images to save: ${soul.imageUris.length}`);
    console.log(`📸 Image URIs:`, soul.imageUris.map((u, i) => `${i}: ${u.substring(0, 50)}...`));

    // Insert soul into SQLite
    await queries.insertSoul({
      id,
      name: soul.name,
      createdAt,
      updatedAt: undefined,
    });

    // Download/copy all soul images to managed cache
    const managedImageUris: string[] = [];
    for (let i = 0; i < soul.imageUris.length; i++) {
      const uri = soul.imageUris[i];
      console.log(`💾 Saving image ${i}/${soul.imageUris.length}: ${uri.substring(0, 50)}...`);

      try {
        const imageRecord = await imageManager.saveImage({
          localUri: uri.startsWith('http') ? undefined : uri,
          remoteUri: uri.startsWith('http') ? uri : undefined,
          type: 'soul',
          category: soul.name,
          metadata: {
            soulId: id,
            soulName: soul.name,
            position: i,
          },
          prefetch: true, // Preload in expo-image cache
        });
        console.log(`✅ Image ${i} saved to: ${imageRecord.localUri.substring(0, 50)}...`);
        managedImageUris.push(imageRecord.localUri);

        // Add image relation to SQLite
        await queries.addImageRelation(id, imageRecord.id, i);
      } catch (error) {
        console.error(`❌ Failed to save soul image ${i}:`, error);
        // Keep original URI as fallback
        managedImageUris.push(uri);
      }
    }

    const newSoul: Soul = {
      ...soul,
      imageUris: managedImageUris,
      id,
      createdAt,
    };

    console.log(`✅ Soul created with ID: ${id}`);
    console.log(`✅ Final managed URIs count: ${managedImageUris.length}`);

    setSouls(prev => [newSoul, ...prev]);

    return id;
  }, []);

  const updateSoul = useCallback(async (
    id: string,
    updates: Partial<Omit<Soul, 'id' | 'createdAt'>>
  ) => {
    console.log(`🔄 UPDATING SOUL: ${id}`);
    console.log(`📝 Updates:`, updates);

    const updatedAt = Date.now();
    let managedImageUris = updates.imageUris;

    // Update soul in SQLite
    await queries.updateSoul(id, {
      name: updates.name,
      updatedAt,
    });

    // If updating imageUris, download/copy new images to managed cache
    if (updates.imageUris) {
      console.log(`📸 Updating ${updates.imageUris.length} images`);

      // Clear existing image relations
      await queries.clearImageRelations(id);

      managedImageUris = [];
      for (let i = 0; i < updates.imageUris.length; i++) {
        const uri = updates.imageUris[i];
        console.log(`🔍 Checking image ${i}: ${uri.substring(0, 50)}...`);

        try {
          // Check if already managed (contains managed path pattern)
          if (uri.includes('generated_images/soul')) {
            console.log(`✅ Image ${i} already managed, keeping as-is`);
            managedImageUris.push(uri);

            // Find existing image record by localUri (compare using relative paths)
            const relativeUri = toRelativePath(uri);
            const existingImages = await queries.getImagesByType('soul', {
              category: updates.name,
            });
            const existingImage = existingImages.find(img => img.localUri === relativeUri);
            if (existingImage) {
              await queries.addImageRelation(id, existingImage.id, i);
            }
            continue;
          }

          console.log(`💾 Saving image ${i} to database...`);
          // Download/copy to managed storage
          const imageRecord = await imageManager.saveImage({
            localUri: uri.startsWith('http') ? undefined : uri,
            remoteUri: uri.startsWith('http') ? uri : undefined,
            type: 'soul',
            category: updates.name || '',
            metadata: {
              soulId: id,
              soulName: updates.name,
              position: i,
            },
            prefetch: true,
          });
          console.log(`✅ Image ${i} saved to: ${imageRecord.localUri.substring(0, 50)}...`);
          managedImageUris.push(imageRecord.localUri);

          // Add image relation
          await queries.addImageRelation(id, imageRecord.id, i);
        } catch (error) {
          console.error(`❌ Failed to save soul image ${i}:`, error);
          managedImageUris.push(uri);
        }
      }
    }

    console.log(`✅ Updating soul state with ${managedImageUris?.length || 0} images`);

    setSouls(prev => prev.map(soul =>
      soul.id === id
        ? {
            ...soul,
            ...updates,
            imageUris: managedImageUris || soul.imageUris,
            updatedAt,
          }
        : soul
    ));
  }, []);

  const deleteSoul = useCallback(async (id: string) => {
    // Delete soul from SQLite (this also clears image relations)
    await queries.deleteSoul(id);

    // Delete associated soul images from imageManager
    try {
      const soulImages = await imageManager.getImagesByType('soul', {
        category: souls.find(s => s.id === id)?.name,
      });

      for (const img of soulImages) {
        if (img.metadata?.soulId === id) {
          await imageManager.deleteImage(img.id, true);
        }
      }
    } catch (error) {
      console.error('Failed to delete soul images:', error);
    }

    setSouls(prev => prev.filter(soul => soul.id !== id));
  }, [souls]);

  const getSoul = useCallback((id: string) => {
    return souls.find(soul => soul.id === id);
  }, [souls]);

  return (
    <SoulsContext.Provider
      value={{
        souls,
        addSoul,
        updateSoul,
        deleteSoul,
        getSoul,
      }}
    >
      {children}
    </SoulsContext.Provider>
  );
}

export function useSouls() {
  const context = useContext(SoulsContext);
  if (!context) {
    throw new Error('useSouls must be used within SoulsProvider');
  }
  return context;
}
