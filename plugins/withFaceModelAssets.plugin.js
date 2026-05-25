/**
 * Custom Expo plugin to copy face model assets from @iland/passport-verification
 * to the app's assets directory so they're bundled in native builds.
 *
 * This ensures the TensorFlow.js face detection model is available in:
 * - Release builds
 * - TestFlight builds
 * - Production builds
 */
const fs = require('fs')
const path = require('path')
const { withAppBuildGradle, withPodfile } = require('@expo/config-plugins')

module.exports = function withFaceModelAssets(config) {
  // Copy model files to app assets for bundling
  const modelSourceDir = path.join(
    __dirname,
    '../packages/passport-verification/assets/mobilefacenet',
  )
  const appAssetsDir = path.join(__dirname, '../assets/face-models')

  // Ensure the destination directory exists
  if (!fs.existsSync(appAssetsDir)) {
    fs.mkdirSync(appAssetsDir, { recursive: true })
  }

  // Copy model files if source exists
  if (fs.existsSync(modelSourceDir)) {
    const files = fs.readdirSync(modelSourceDir)
    files.forEach(file => {
      const source = path.join(modelSourceDir, file)
      const dest = path.join(appAssetsDir, file)

      // Only copy if destination doesn't exist or is different
      if (!fs.existsSync(dest) || fs.statSync(source).mtime > fs.statSync(dest).mtime) {
        fs.copyFileSync(source, dest)
        console.log(`Copied face model asset: ${file}`)
      }
    })
  } else {
    console.warn(
      `Face model source not found at ${modelSourceDir}. ` +
        `Models will be loaded from node_modules at runtime.`,
    )
  }

  return config
}
