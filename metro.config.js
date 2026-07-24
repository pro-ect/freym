const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

config.resolver = {
  ...config.resolver,
  sourceExts: [...(config.resolver?.sourceExts || []), 'mjs', 'cjs'],
  // Onboarding videos ship as .mov/.MOV assets (Copy Shot onboarding). Without
  // these in assetExts, Metro treats require('…/8photos_onb.MOV') as a module
  // and fails to resolve it.
  assetExts: [...(config.resolver?.assetExts || []), 'mov', 'MOV'],
};

module.exports = config;
