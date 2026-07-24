import { ExpoConfig, ConfigContext } from "expo/config";

const IS_DEV = process.env.APP_VARIANT === "development";
const IS_PREVIEW = process.env.APP_VARIANT === "preview";

export default ({ config }: ConfigContext): ExpoConfig => ({
  name: "freym",
  // Single EAS project for all variants (dev/preview differ by bundle id + scheme).
  slug: "freym-studio",
  icon: IS_DEV ? "./assets/icon-dev.png" : IS_PREVIEW ? "./assets/icon-preview.png" : "./assets/icon-lab.png",
  scheme: IS_DEV ? "freymdev" : IS_PREVIEW ? "freympreview" : "freym",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  ios: {
    supportsTablet: false,
    bundleIdentifier: IS_DEV ? "genai.freym.studio.dev" : "genai.freym.studio",
    usesAppleSignIn: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      UIUserInterfaceStyle: "Dark",
      // In-app localization (v1, LTR). ar/he added when RTL ships.
      // Changing these requires a fresh native build to take effect.
      CFBundleDevelopmentRegion: "en",
      CFBundleLocalizations: [
        "en", "es", "fr", "de", "it", "pt-BR", "ru", "ja", "ko",
        "zh-Hans", "zh-Hant", "nl", "tr", "pl", "uk", "hi", "th", "id", "vi", "sv",
      ],
      NSPhotoLibraryUsageDescription: "Allow $(PRODUCT_NAME) to access your photos to use as reference images for AI generation.",
      NSPhotoLibraryAddUsageDescription: "Allow $(PRODUCT_NAME) to save generated images to your photo library.",
      NSCameraUsageDescription: "Allow $(PRODUCT_NAME) to take a photo with your camera so you can use it as the input for a recipe.",
      NSUserTrackingUsageDescription: "freym uses this to measure how our ads perform so we can keep credits cheap and the free tier generous. We never sell your personal data.",
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: IS_DEV ? "./assets/icon-dev.png" : "./assets/icon-lab.png",
      backgroundColor: "#E6F4FE",
    },
    predictiveBackGestureEnabled: false,
    package: IS_DEV ? "genai.freym.studio.dev" : "genai.freym.studio",
  },
  web: {
    output: "static",
  },
  plugins: [
    "expo-router",
    "expo-apple-authentication",
    "expo-font",
    "expo-image",
    "expo-secure-store",
    "expo-sharing",
    "expo-sqlite",
    "expo-video",
    "expo-web-browser",
    // Photos-only. Default granularPermissions include 'audio' → Android shows a
    // bogus "access music and audio" (READ_MEDIA_AUDIO) prompt. The app only
    // reads/saves images, so scope it to 'photo'.
    [
      "expo-media-library",
      {
        photosPermission:
          "Allow $(PRODUCT_NAME) to access your photos to use as reference images for AI generation.",
        savePhotosPermission:
          "Allow $(PRODUCT_NAME) to save generated images to your photo library.",
        granularPermissions: ["photo"],
        isAccessMediaLocationEnabled: false,
      },
    ],
    // Image + camera only, no video recording → drop the RECORD_AUDIO (microphone)
    // permission the plugin adds by default.
    [
      "expo-image-picker",
      {
        photosPermission:
          "Allow $(PRODUCT_NAME) to access your photos to use as reference images for AI generation.",
        cameraPermission:
          "Allow $(PRODUCT_NAME) to take a photo with your camera so you can use it as the input for a recipe.",
        microphonePermission: false,
      },
    ],
    [
      "@sentry/react-native/expo",
      {
        url: "https://sentry.io/",
        project: "freym-studio",
        organization: "dearjournal",
      },
    ],
    [
      "expo-tracking-transparency",
      {
        userTrackingPermission: "freym uses this to measure how our ads perform so we can keep credits cheap and the free tier generous. We never sell your personal data.",
      },
    ],
    [
      "react-native-appsflyer",
      {
        shouldUseStrictMode: true,
      },
    ],
    // Resolves AndroidManifest backup-attribute conflict between
    // expo-secure-store and the AppsFlyer SDK (see plugin for details).
    "./plugins/withAndroidBackupToolsReplace",
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    router: {},
    eas: {
      projectId: "f8b98d76-a118-4a34-b86b-4de4d4b5cf8f",
    },
  },
  owner: "genue",
});
