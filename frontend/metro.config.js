const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('svg');
config.resolver.assetExts.push('wasm');

const WEB_SHIMS = {
  'expo-sqlite': 'src/shims/expo-sqlite.web.js',
  'expo-secure-store': 'src/shims/expo-secure-store.web.js',
};

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_SHIMS[moduleName]) {
    return {
      filePath: path.resolve(__dirname, WEB_SHIMS[moduleName]),
      type: 'sourceFile',
    };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
