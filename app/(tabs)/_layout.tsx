import { Tabs } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { DynamicColorIOS, Platform } from 'react-native';
import {
  Sparkles,
  Aperture,
  Wand2,
  Pencil,
  Images,
  Flame,
  Camera,
  BookOpen,
  Video,
} from 'lucide-react-native';
import { useSettings } from '../../contexts/SettingsContext';
import { useLibrary, isProcessingStatus } from '../../contexts/LibraryContext';
// import { useClipboardInspireWatcher } from '../hooks/useClipboardInspireWatcher';
import { useTranslation } from 'react-i18next';

// Land on Inspire at launch (also enforced by app/index.tsx's redirect).
export const unstable_settings = {
  initialRouteName: 'inspire',
};

const PROCESSING_BADGE_COLOR = '#22c55e'; // green-500
const ACTIVE_TINT = '#ffffff';
const INACTIVE_TINT = '#8e8e93';

type TabIconProps = { color: string; size: number };

export default function TabLayout() {
  const { visibleTabs } = useSettings();
  const { t } = useTranslation();
  const { images } = useLibrary();
  // Copy Shot's clipboard auto-paste watcher is disabled in freym: it routes
  // into the archived Imagine tab, and the Inspire tab here is the freym
  // prompt feed, not a reference-photo intake.
  // useClipboardInspireWatcher();

  const hasProcessingImages = images?.length > 0 && images.some(img => isProcessingStatus(img.status));
  const processingCount = images?.filter(img => isProcessingStatus(img.status)).length || 0;

  // ── iOS: keep the native liquid-glass tab bar (NativeTabs + SF Symbols) ──
  // DynamicColorIOS is iOS-only but this branch only runs on iOS, so it's safe.
  if (Platform.OS === 'ios') {
    return (
      <NativeTabs
        tintColor={DynamicColorIOS({ dark: 'white', light: 'black' })}
        badgeBackgroundColor={PROCESSING_BADGE_COLOR}
      >
        {/* ── 5-tab structure: Inspire · Photo · Video · Edit · Library ── */}
        <NativeTabs.Trigger name="inspire" hidden={!visibleTabs.inspire}>
          <NativeTabs.Trigger.Label>{t('tabs.inspire')}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: 'rectangle.badge.sparkles', selected: 'rectangle.badge.sparkles.fill' }} />
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="create" hidden={!visibleTabs.create}>
          <NativeTabs.Trigger.Label>{t('tabs.photo')}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: 'camera.aperture', selected: 'camera.aperture' }} />
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="video" hidden={!visibleTabs.video}>
          <NativeTabs.Trigger.Label>{t('tabs.video')}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: 'video', selected: 'video.fill' }} />
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="editor" hidden={!visibleTabs.editor}>
          <NativeTabs.Trigger.Label>{t('tabs.edit')}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: 'pencil.tip.crop.circle', selected: 'pencil.tip.crop.circle.fill' }} />
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="library" hidden={!visibleTabs.library}>
          <NativeTabs.Trigger.Label>{t('tabs.library')}</NativeTabs.Trigger.Label>
          {hasProcessingImages
            ? <NativeTabs.Trigger.Icon sf={{ default: 'progress.indicator', selected: 'progress.indicator' }} />
            : <NativeTabs.Trigger.Icon sf={{ default: 'tray', selected: 'tray.fill' }} />}
          {hasProcessingImages && (
            <NativeTabs.Trigger.Badge selectedBackgroundColor={PROCESSING_BADGE_COLOR}>
              {processingCount.toString()}
            </NativeTabs.Trigger.Badge>
          )}
        </NativeTabs.Trigger>

        {/* ── Archived tabs — hidden by default, re-enableable in Settings ── */}
        <NativeTabs.Trigger name="home" hidden={!visibleTabs.home}>
          <NativeTabs.Trigger.Label>{t('tabs.home')}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: 'flame', selected: 'flame.fill' }} />
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="imagine" hidden={!visibleTabs.imagine}>
          <NativeTabs.Trigger.Label>Copy Shot</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: 'camera.aperture', selected: 'camera.aperture' }} />
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="tools" hidden={!visibleTabs.tools}>
          <NativeTabs.Trigger.Label>{t('tabs.effects')}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: 'sparkle', selected: 'sparkle' }} />
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="recipes" hidden={!visibleTabs.recipes}>
          <NativeTabs.Trigger.Label>{t('tabs.recipes')}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: 'book', selected: 'book.fill' }} />
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  // ── Android: JS Tabs navigator (lucide icons + always-on labels) ──
  // Avoids the generic ic_menu_* system glyphs NativeTabs uses on Android.
  const href = (visible: boolean) => (visible ? undefined : null);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE_TINT,
        tabBarInactiveTintColor: INACTIVE_TINT,
        tabBarShowLabel: true,
        tabBarStyle: {
          backgroundColor: '#000',
          borderTopColor: '#1c1c1e',
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
        tabBarBadgeStyle: {
          backgroundColor: PROCESSING_BADGE_COLOR,
          color: '#000',
          fontSize: 11,
        },
      }}
    >
      {/* ── 5-tab structure: Inspire · Photo · Video · Edit · Library ── */}
      <Tabs.Screen
        name="inspire"
        options={{
          href: href(visibleTabs.inspire),
          title: t('tabs.inspire'),
          tabBarIcon: ({ color, size }: TabIconProps) => <Sparkles color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          href: href(visibleTabs.create),
          title: t('tabs.photo'),
          tabBarIcon: ({ color, size }: TabIconProps) => <Camera color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="video"
        options={{
          href: href(visibleTabs.video),
          title: t('tabs.video'),
          tabBarIcon: ({ color, size }: TabIconProps) => <Video color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="editor"
        options={{
          href: href(visibleTabs.editor),
          title: t('tabs.edit'),
          tabBarIcon: ({ color, size }: TabIconProps) => <Pencil color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          href: href(visibleTabs.library),
          title: t('tabs.library'),
          tabBarIcon: ({ color, size }: TabIconProps) => <Images color={color} size={size} />,
          tabBarBadge: hasProcessingImages ? processingCount : undefined,
        }}
      />

      {/* ── Archived tabs — hidden by default, re-enableable in Settings ── */}
      <Tabs.Screen
        name="home"
        options={{
          href: href(visibleTabs.home),
          title: t('tabs.home'),
          tabBarIcon: ({ color, size }: TabIconProps) => <Flame color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="imagine"
        options={{
          href: href(visibleTabs.imagine),
          title: 'Copy Shot',
          tabBarIcon: ({ color, size }: TabIconProps) => <Aperture color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="tools"
        options={{
          href: href(visibleTabs.tools),
          title: t('tabs.effects'),
          tabBarIcon: ({ color, size }: TabIconProps) => <Wand2 color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="recipes"
        options={{
          href: href(visibleTabs.recipes),
          title: t('tabs.recipes'),
          tabBarIcon: ({ color, size }: TabIconProps) => <BookOpen color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
