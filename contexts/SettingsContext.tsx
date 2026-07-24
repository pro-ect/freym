/**
 * Settings Context
 *
 * Manages app-wide settings like auto-save to media library
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { getDefaultTabs } from '../config/appVariant';
import { applyLanguage } from '../lib/i18n';

export type TabName = 'home' | 'recipes' | 'editor' | 'create' | 'video' | 'inspire' | 'library' | 'imagine' | 'tools';
export type ApiProvider = 'replicate' | 'fal';

interface SettingsContextType {
  autoSaveToLibrary: boolean;
  setAutoSaveToLibrary: (value: boolean) => void;
  // Frozen at app launch — what the tab layout renders. Avoids crashing
  // `<NativeTabs.Trigger hidden>` flips at runtime.
  visibleTabs: Record<TabName, boolean>;
  // Mirrors AsyncStorage — what settings UI edits. Applies on next relaunch.
  pendingVisibleTabs: Record<TabName, boolean>;
  hasPendingTabChanges: boolean;
  setTabVisibility: (tabName: TabName, visible: boolean) => void;
  // BYOK (Bring Your Own Key) status
  hasCustomApiKey: boolean;
  checkApiKeyStatus: () => Promise<void>;
  // Admin status (from database is_admin column)
  isAdmin: boolean;
  // API Provider setting (admin-only, default: fal)
  apiProvider: ApiProvider;
  setApiProvider: (provider: ApiProvider) => Promise<void>;
  // Admin: Force show library empty state (for testing)
  forceLibraryEmptyState: boolean;
  setForceLibraryEmptyState: (value: boolean) => void;
  // Admin: reveal the OpenAI-direct model switcher on the Copy Shot tab.
  // Off by default; only meaningful for admins.
  showDirectModel: boolean;
  setShowDirectModel: (value: boolean) => Promise<void>;
  // Admin: run the in-app Photo Agent through the fast direct-model path
  // (Gemini planner) instead of the managed Claude agent. Off by default;
  // only honored server-side for admins. For A/B latency testing.
  useDirectAgentModel: boolean;
  setUseDirectAgentModel: (value: boolean) => Promise<void>;
  // App UI language: a specific tag (e.g. 'de', 'pt-BR') or null = follow device locale.
  appLanguage: string | null;
  setAppLanguage: (lang: string | null) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const SETTINGS_STORAGE_KEY = '@app_settings';
const API_PROVIDER_KEY = '@api_provider';
const LANGUAGE_STORAGE_KEY = '@app_language';
const SHOW_DIRECT_MODEL_KEY = '@show_direct_model';
const USE_DIRECT_AGENT_MODEL_KEY = '@use_direct_agent_model';

// Bump this when the default tab set changes so existing installs reset to the new
// defaults on next launch instead of being stuck on stale AsyncStorage. The current
// version (3) hides the Imagine (editor) tab and shows Inspire by default:
// Home / Studio / Inspire / Recipes / Library.
// v4: Aya rebrand — 5-tab structure (Inspire · Imagine · Effects · Edit · Library),
// archives home/create/recipes/video. Bump force-migrates existing users.
const TABS_SCHEMA_VERSION = 5;

const DEFAULT_VISIBLE_TABS: Record<TabName, boolean> = getDefaultTabs() as Record<TabName, boolean>;

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [autoSaveToLibrary, setAutoSaveToLibraryState] = useState(false);
  const [visibleTabs, setVisibleTabsState] = useState<Record<TabName, boolean>>(DEFAULT_VISIBLE_TABS);
  const [pendingVisibleTabs, setPendingVisibleTabsState] = useState<Record<TabName, boolean>>(DEFAULT_VISIBLE_TABS);
  const [hasCustomApiKey, setHasCustomApiKey] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [apiProvider, setApiProviderState] = useState<ApiProvider>('fal');
  const [forceLibraryEmptyState, setForceLibraryEmptyStateValue] = useState(false);
  const [showDirectModel, setShowDirectModelState] = useState(false);
  const [useDirectAgentModel, setUseDirectAgentModelState] = useState(false);
  const [appLanguage, setAppLanguageState] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load settings on mount. Language is applied inside loadSettings (before the
  // isLoaded gate flips) so children first render in the correct language.
  useEffect(() => {
    loadSettings();
    loadApiProvider();
    loadShowDirectModel();
    loadUseDirectAgentModel();
    checkApiKeyStatus();
    checkAdminStatus();
  }, []);

  const loadShowDirectModel = async () => {
    try {
      const saved = await AsyncStorage.getItem(SHOW_DIRECT_MODEL_KEY);
      setShowDirectModelState(saved === 'true');
    } catch (error) {
      console.error('Error loading showDirectModel:', error);
    }
  };

  const setShowDirectModel = async (value: boolean) => {
    try {
      await AsyncStorage.setItem(SHOW_DIRECT_MODEL_KEY, value ? 'true' : 'false');
      setShowDirectModelState(value);
    } catch (error) {
      console.error('Error saving showDirectModel:', error);
    }
  };

  const loadUseDirectAgentModel = async () => {
    try {
      const saved = await AsyncStorage.getItem(USE_DIRECT_AGENT_MODEL_KEY);
      setUseDirectAgentModelState(saved === 'true');
    } catch (error) {
      console.error('Error loading useDirectAgentModel:', error);
    }
  };

  const setUseDirectAgentModel = async (value: boolean) => {
    try {
      await AsyncStorage.setItem(USE_DIRECT_AGENT_MODEL_KEY, value ? 'true' : 'false');
      setUseDirectAgentModelState(value);
    } catch (error) {
      console.error('Error saving useDirectAgentModel:', error);
    }
  };

  const checkAdminStatus = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setIsAdmin(false);
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .maybeSingle();

      if (error) {
        console.error('Error checking admin status:', error);
        setIsAdmin(false);
        return;
      }

      const isAdminUser = data?.is_admin || false;
      setIsAdmin(isAdminUser);
      console.log('Admin status:', isAdminUser, 'for user:', user.email || user.id);
    } catch (error) {
      console.error('Error checking admin status:', error);
      setIsAdmin(false);
    }
  };

  const loadSettings = async () => {
    // Apply the saved language override (or device locale) before the
    // isLoaded gate releases, so the first render is in the right language.
    try {
      const savedLang = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
      setAppLanguageState(savedLang);
      applyLanguage(savedLang);
    } catch (error) {
      console.error('Error loading language:', error);
    }

    try {
      const settingsJson = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);
      if (settingsJson) {
        const settings = JSON.parse(settingsJson);
        setAutoSaveToLibraryState(settings.autoSaveToLibrary ?? false);

        const savedVersion = settings.tabsSchemaVersion ?? 1;
        if (savedVersion < TABS_SCHEMA_VERSION) {
          // Migrate: replace saved tabs with the new defaults and persist with the bumped version.
          const migrated = { ...DEFAULT_VISIBLE_TABS };
          setVisibleTabsState(migrated);
          setPendingVisibleTabsState(migrated);
          await AsyncStorage.setItem(
            SETTINGS_STORAGE_KEY,
            JSON.stringify({
              autoSaveToLibrary: settings.autoSaveToLibrary ?? false,
              visibleTabs: migrated,
              tabsSchemaVersion: TABS_SCHEMA_VERSION,
            }),
          );
        } else {
          // Merge saved tabs with default tabs to handle new tabs being added
          const mergedTabs = { ...DEFAULT_VISIBLE_TABS, ...settings.visibleTabs };
          setVisibleTabsState(mergedTabs);
          setPendingVisibleTabsState(mergedTabs);
        }
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setIsLoaded(true);
    }
  };

  const setAutoSaveToLibrary = async (value: boolean) => {
    try {
      setAutoSaveToLibraryState(value);
      const settings = {
        autoSaveToLibrary: value,
        visibleTabs: pendingVisibleTabs,
        tabsSchemaVersion: TABS_SCHEMA_VERSION,
      };
      await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  };

  // Persists the change but keeps the live `visibleTabs` frozen — applies on next launch.
  // Flipping `<NativeTabs.Trigger hidden>` while mounted crashes the native tab controller.
  const setTabVisibility = async (tabName: TabName, visible: boolean) => {
    try {
      const newPending = { ...pendingVisibleTabs, [tabName]: visible };
      setPendingVisibleTabsState(newPending);
      const settings = {
        autoSaveToLibrary,
        visibleTabs: newPending,
        tabsSchemaVersion: TABS_SCHEMA_VERSION,
      };
      await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.error('Error saving tab visibility:', error);
    }
  };

  const hasPendingTabChanges = (Object.keys(pendingVisibleTabs) as TabName[]).some(
    (tab) => pendingVisibleTabs[tab] !== visibleTabs[tab]
  );

  const checkApiKeyStatus = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setHasCustomApiKey(false);
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('has_custom_key')
        .eq('id', user.id)
        .maybeSingle();

      if (error) {
        console.error('Error checking API key status:', error);
        setHasCustomApiKey(false);
        return;
      }

      setHasCustomApiKey(data?.has_custom_key || false);
    } catch (error) {
      console.error('Error checking API key status:', error);
      setHasCustomApiKey(false);
    }
  };

  const loadApiProvider = async () => {
    try {
      const savedProvider = await AsyncStorage.getItem(API_PROVIDER_KEY);
      if (savedProvider && (savedProvider === 'replicate' || savedProvider === 'fal')) {
        setApiProviderState(savedProvider as ApiProvider);
        console.log('Loaded API provider:', savedProvider);
      }
    } catch (error) {
      console.error('Error loading API provider:', error);
    }
  };

  const setApiProvider = async (provider: ApiProvider) => {
    try {
      await AsyncStorage.setItem(API_PROVIDER_KEY, provider);
      setApiProviderState(provider);
      console.log('Set API provider:', provider);
    } catch (error) {
      console.error('Error saving API provider:', error);
    }
  };

  const setForceLibraryEmptyState = (value: boolean) => {
    setForceLibraryEmptyStateValue(value);
  };

  // Set the app UI language. Pass a tag ('de', 'pt-BR', …) to override, or
  // null to follow the device locale. Persists and re-renders all screens.
  const setAppLanguage = async (lang: string | null) => {
    try {
      if (lang) {
        await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
      } else {
        await AsyncStorage.removeItem(LANGUAGE_STORAGE_KEY);
      }
      setAppLanguageState(lang);
      applyLanguage(lang);
    } catch (error) {
      console.error('Error saving language:', error);
    }
  };

  // Don't render children until settings are loaded
  if (!isLoaded) {
    return null;
  }

  return (
    <SettingsContext.Provider
      value={{
        autoSaveToLibrary,
        setAutoSaveToLibrary,
        visibleTabs,
        pendingVisibleTabs,
        hasPendingTabChanges,
        setTabVisibility,
        hasCustomApiKey,
        checkApiKeyStatus,
        isAdmin,
        apiProvider,
        setApiProvider,
        forceLibraryEmptyState,
        setForceLibraryEmptyState,
        showDirectModel,
        setShowDirectModel,
        useDirectAgentModel,
        setUseDirectAgentModel,
        appLanguage,
        setAppLanguage,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
