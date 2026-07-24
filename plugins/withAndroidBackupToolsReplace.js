// Resolves an AndroidManifest merger conflict between expo-secure-store and the
// AppsFlyer SDK. Both declare <application> backup attributes:
//   android:dataExtractionRules  (secure_store_data_extraction_rules vs appsflyer_data_extraction_rules)
//   android:fullBackupContent    (secure_store_backup_rules         vs appsflyer_backup_rules)
// The manifest merger cannot pick a winner and fails processReleaseMainManifest.
// We keep secure-store's values (the app-level manifest) and tell the merger to
// override the library declarations via tools:replace.
const { withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

const REPLACE = "android:dataExtractionRules,android:fullBackupContent";

module.exports = function withAndroidBackupToolsReplace(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    // Ensure the tools namespace exists on the root <manifest> element.
    manifest.$ = manifest.$ || {};
    if (!manifest.$["xmlns:tools"]) {
      manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";
    }

    const application =
      AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    application.$ = application.$ || {};

    // Merge with any pre-existing tools:replace list without duplicating entries.
    const existing = (application.$["tools:replace"] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const merged = Array.from(
      new Set([...existing, ...REPLACE.split(",")])
    ).join(",");
    application.$["tools:replace"] = merged;

    return config;
  });
};
