const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Add 'svg' to the asset extensions to let expo-image load local SVG assets using require()
config.resolver.assetExts.push('svg');

// Add 'wasm' so Metro can resolve wa-sqlite's WebAssembly binary (used by
// expo-sqlite on the web platform).
config.resolver.assetExts.push('wasm');

// On web, substitute expo-sqlite with a no-op shim so the wa-sqlite .wasm
// binary is never bundled (it is either missing or can't be handled by Metro).
// The app's data layer always falls back to the Supabase backend on web anyway.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'expo-sqlite') {
    return {
      filePath: path.resolve(__dirname, 'shims/expo-sqlite.web.js'),
      type: 'sourceFile',
    };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;