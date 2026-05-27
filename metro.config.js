// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config')
const { mergeConfig } = require('metro-config')
const { withNativeWind } = require('nativewind/metro')
const { wrapWithReanimatedMetroConfig } = require('react-native-reanimated/metro-config')

/**
 *
 * @param {InputConfigT} config
 * @returns {InputConfigT}
 */
const withSvgTransformer = config => {
  const { resolver, transformer } = config

  config.transformer = {
    ...transformer,
    babelTransformerPath: require.resolve('react-native-svg-transformer'),
  }
  config.resolver = {
    ...resolver,
    assetExts: resolver.assetExts.filter(ext => ext !== 'svg'),
    sourceExts: [...resolver.sourceExts, 'svg'],
  }

  return config
}

const withCircomFilesAndPolyfills = config => {
  const { resolver } = config

  config.resolver = {
    ...resolver,
    assetExts: [...resolver.assetExts, 'bin', 'wasm', 'zkey', 'dat', 'pem', 'cer', 'json'],
    extraNodeModules: {
      crypto: require.resolve('crypto-browserify'),
      fs: require.resolve('buffer/'),
      http: require.resolve('stream-http'),
      os: require.resolve('os-browserify/browser.js'),
      constants: require.resolve('constants-browserify'),
      path: require.resolve('path-browserify'),
      stream: require.resolve('readable-stream'),
    },
  }

  return config
}

const path = require('path')

module.exports = (() => {
  let config = getDefaultConfig(__dirname)

  // Note: Removed packages from watchFolders to prevent duplicate asset bundling
  // from both workspace packages/ and node_modules/@iland/passport-verification.
  // The file: dependency in package.json resolves @iland/passport-verification
  // to the installed node_modules version during Metro bundling.

  return mergeConfig(
    withSvgTransformer(config),
    withCircomFilesAndPolyfills(config),
    wrapWithReanimatedMetroConfig(config),
    withNativeWind(config, { input: './src/theme/global.css' }),
  )
})()
