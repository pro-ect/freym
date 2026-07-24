import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { browsePublicRecipes, type PublicRecipe } from '../lib/recipes/supabaseRecipes';

const CACHE_KEY = '@community_recipes_cache';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CachedRecipesData {
  recipes: PublicRecipe[];
  dimensions: Record<string, { width: number; height: number }>;
  timestamp: number;
}

// Module-level memory cache (survives component remounts)
let memoryCache: CachedRecipesData | null = null;

// Debounce timer for dimension persistence to AsyncStorage
let dimensionSaveTimer: ReturnType<typeof setTimeout> | null = null;

function saveCacheToStorage() {
  if (!memoryCache) return;
  if (dimensionSaveTimer) clearTimeout(dimensionSaveTimer);
  dimensionSaveTimer = setTimeout(() => {
    if (memoryCache) {
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(memoryCache)).catch(() => {});
    }
  }, 1000);
}

interface RecipesContextType {
  recipes: PublicRecipe[];
  isLoading: boolean;
  isRefreshing: boolean;
  loadRecipes: () => Promise<void>;
  refreshRecipes: () => Promise<void>;
  removeRecipe: (id: string) => void;
  getDimensions: (id: string) => { width: number; height: number } | undefined;
  updateDimensions: (id: string, width: number, height: number) => void;
}

const RecipesContext = createContext<RecipesContextType | undefined>(undefined);

export function RecipesProvider({ children }: { children: React.ReactNode }) {
  const [recipes, setRecipes] = useState<PublicRecipe[]>(memoryCache?.recipes ?? []);
  const [isLoading, setIsLoading] = useState(!memoryCache);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isFetchingRef = useRef(false);
  const hasLoadedOnceRef = useRef(!!memoryCache);

  const fetchFromNetwork = useCallback(async (): Promise<PublicRecipe[]> => {
    return browsePublicRecipes({ sortBy: 'latest', limit: 50 });
  }, []);

  const loadRecipes = useCallback(async () => {
    if (isFetchingRef.current) return;

    // Memory cache is fresh — no network needed
    if (memoryCache && Date.now() - memoryCache.timestamp < CACHE_TTL) {
      if (recipes.length === 0) {
        setRecipes(memoryCache.recipes);
      }
      setIsLoading(false);
      return;
    }

    // Try AsyncStorage on first load
    if (!hasLoadedOnceRef.current) {
      try {
        const cached = await AsyncStorage.getItem(CACHE_KEY);
        if (cached) {
          const parsed: CachedRecipesData = JSON.parse(cached);
          memoryCache = parsed;
          setRecipes(parsed.recipes);
          setIsLoading(false);
          hasLoadedOnceRef.current = true;

          if (Date.now() - parsed.timestamp < CACHE_TTL) {
            return; // Still fresh
          }
          // Stale — continue to background refresh below
        }
      } catch {
        // ignore parse errors
      }
    }

    // Network fetch
    isFetchingRef.current = true;
    if (!hasLoadedOnceRef.current) setIsLoading(true);

    try {
      const fresh = await fetchFromNetwork();
      setRecipes(fresh);
      hasLoadedOnceRef.current = true;

      const dims = memoryCache?.dimensions ?? {};
      memoryCache = { recipes: fresh, dimensions: dims, timestamp: Date.now() };
      saveCacheToStorage();
    } catch (error) {
      console.error('[RecipesCache] Network fetch failed:', error);
      if (!hasLoadedOnceRef.current) setRecipes([]);
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [recipes.length, fetchFromNetwork]);

  const refreshRecipes = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const fresh = await fetchFromNetwork();
      setRecipes(fresh);
      const dims = memoryCache?.dimensions ?? {};
      memoryCache = { recipes: fresh, dimensions: dims, timestamp: Date.now() };
      saveCacheToStorage();
    } catch (error) {
      console.error('[RecipesCache] Refresh failed:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchFromNetwork]);

  const removeRecipe = useCallback((id: string) => {
    setRecipes(prev => {
      const updated = prev.filter(r => r.id !== id);
      if (memoryCache) {
        memoryCache = { ...memoryCache, recipes: updated, timestamp: Date.now() };
        saveCacheToStorage();
      }
      return updated;
    });
  }, []);

  const getDimensionsFn = useCallback((id: string) => {
    return memoryCache?.dimensions?.[id];
  }, []);

  const updateDimensionsFn = useCallback((id: string, width: number, height: number) => {
    if (!memoryCache) return;
    if (memoryCache.dimensions[id]) return; // Already cached
    memoryCache = {
      ...memoryCache,
      dimensions: { ...memoryCache.dimensions, [id]: { width, height } },
    };
    saveCacheToStorage();
  }, []);

  return (
    <RecipesContext.Provider value={{
      recipes,
      isLoading,
      isRefreshing,
      loadRecipes,
      refreshRecipes,
      removeRecipe,
      getDimensions: getDimensionsFn,
      updateDimensions: updateDimensionsFn,
    }}>
      {children}
    </RecipesContext.Provider>
  );
}

export function useRecipes() {
  const context = useContext(RecipesContext);
  if (!context) {
    throw new Error('useRecipes must be used within RecipesProvider');
  }
  return context;
}
