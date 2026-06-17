const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add 'svg' to the asset extensions to let expo-image load local SVG assets using require()
config.resolver.assetExts.push('svg');

module.exports = config;
