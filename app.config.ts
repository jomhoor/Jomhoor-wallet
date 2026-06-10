import type { ConfigContext, ExpoConfig } from '@expo/config';

import { ClientEnv, Env } from './env';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  newArchEnabled: true,
  name: Env.NAME,
  description: `${Env.NAME} Mobile App`,
  owner: Env.EXPO_ACCOUNT_OWNER,
  scheme: Env.SCHEME,
  slug: Env.SLUG,
  version: Env.VERSION.toString(),
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  updates: {
    fallbackToCacheTimeout: 0,
    url: `https://u.expo.dev/${Env.EAS_PROJECT_ID}`
  },
  runtimeVersion: Env.VERSION.toString(),
  ios: {
    bundleIdentifier: Env.BUNDLE_ID,
    // Universal Links: the app intercepts https://sso.jomhoor.org/auth/sso* URLs.
    // The AASA file at https://sso.jomhoor.org/.well-known/apple-app-site-association
    // must list the team ID + bundle ID for this to work.
    // auth.jomhoor.org is intentionally excluded — it's browser-only.
    associatedDomains: [
      // production + staging: standard Universal Link
      'applinks:sso.jomhoor.org',
      // development builds: Apple requires ?mode=developer so iOS resolves
      // the AASA via CDN bypass and allows Universal Links in debug builds.
      ...(Env.APP_ENV !== 'production' ? ['applinks:sso.jomhoor.org?mode=developer'] : []),
    ],
    entitlements: {
      'com.apple.developer.kernel.increased-memory-limit': true,
      'com.apple.developer.kernel.extended-virtual-addressing': true
    },
    "infoPlist": {
      "ITSAppUsesNonExemptEncryption": false,
      "NSLocationWhenInUseUsageDescription": "Location access may be used by identity verification features when required.",
      "NFCReaderUsageDescription": "Jomhoor uses NFC to read supported document chips during on-device identity verification.",
      "NSCameraUsageDescription": "Jomhoor uses the camera to scan your identity document and verify your face during the verification process. Images are processed on your device and deleted after verification.",
      "NSFaceIDUsageDescription": "Jomhoor uses Face ID to let you securely unlock the app and protect access to your verified participation status.",
      // Allow self-signed HTTPS (for local Quasar dev server with basicSsl).
      // WebCrypto (crypto.subtle) requires a secure context; without HTTPS the
      // Agora UCAN auth flow fails in the WebView.  Production uses valid certs
      // and does not need this.
      ...(Env.APP_ENV !== 'production' && {
        "NSAppTransportSecurity": {
          "NSAllowsArbitraryLoads": true,
          "NSAllowsLocalNetworking": true,
        }
      }),
    },
    bitcode: false
  },
  android: {
    versionCode: 5,
    ...(Env.GOOGLE_MAPS_API_KEY
      ? {
          config: {
            googleMaps: {
              apiKey: Env.GOOGLE_MAPS_API_KEY,
            },
          },
        }
      : {}),
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#2E3C4B',
    },
    package: Env.PACKAGE,
    // App Links: the app handles https://sso.jomhoor.org/auth/sso* URLs.
    // The assetlinks.json at https://sso.jomhoor.org/.well-known/assetlinks.json
    // must list the package name and SHA-256 cert fingerprint for verification.
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          {
            scheme: 'https',
            host: 'sso.jomhoor.org',
            pathPrefix: '/auth/sso',
          },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  web: {
    favicon: './assets/favicon.png',
    bundler: 'metro',
  },
  plugins: [
    ['expo-asset'],
    ['./plugins/withFaceModelAssets.plugin.js'],
    [
      'expo-font',
      {
        fonts: [
          './assets/fonts/PlaywriteCU-ExtraLight.ttf',
          './assets/fonts/PlaywriteCU-Light.ttf',
          './assets/fonts/PlaywriteCU-Regular.ttf',
          './assets/fonts/PlaywriteCU-Thin.ttf',
          './assets/fonts/Roboto-Black.ttf',
          './assets/fonts/Roboto-BlackItalic.ttf',
          './assets/fonts/Roboto-Bold.ttf',
          './assets/fonts/Roboto-BoldItalic.ttf',
          './assets/fonts/Roboto-Italic.ttf',
          './assets/fonts/Roboto-Light.ttf',
          './assets/fonts/Roboto-LightItalic.ttf',
          './assets/fonts/Roboto-Medium.ttf',
          './assets/fonts/Roboto-MediumItalic.ttf',
          './assets/fonts/Roboto-Regular.ttf',
          './assets/fonts/Roboto-Thin.ttf',
          './assets/fonts/Roboto-ThinItalic.ttf',
          './assets/fonts/NotoSans-Bold.ttf',
          './assets/fonts/NotoSans-Regular.ttf',
          './assets/fonts/NotoSans-SemiBold.ttf',
          './assets/fonts/NotoSans-Medium.ttf',
          './assets/fonts/Parastoo-Regular.ttf',
          './assets/fonts/Parastoo-Bold.ttf',
        ],
      },
    ],
    [
      "expo-splash-screen",
      {
        "backgroundColor": "#f5f6f6",
        "image": "./assets/icon.png",
        "dark": {
          "image": "./assets/icon.png",
          "backgroundColor": "#111111"
        },
        "imageWidth": 200
      }
    ],
    [
      "expo-secure-store",
      {
        "faceIDPermission": "Allow $(PRODUCT_NAME) to access your Face ID biometric data."
      }
    ],
    [
        "react-native-edge-to-edge",
        {
          "android": {
            "parentTheme": "Material3.Dynamic",
            "enforceNavigationBarContrast": false
          }
        }
    ],
    // TEMP: since "modules/e-document" uses custom pod,
    // we need to use `withBuildProperties` in module's plugin
    // in order to incapsulate per module configuration.
    // But `withBuildProperties` method ain't supposed to be called multiple times,
    // so we treat this case as we merge objects
    // plugins order matter: the later one would run first
    // https://github.com/expo/expo/blob/sdk-52/packages/expo-build-properties/src/withBuildProperties.ts#L31C6-L31C57
    ['expo-build-properties', {
      android: {
        minSdkVersion: 26,
        compileSdkVersion : 35,
        targetSdkVersion: 35,
        // TODO to test builded apk release
        ndk: {
          abiFilters: ['arm64-v8a'],
        },
        splits: {
          abi: {
            enable: true,
            reset: true,
            include: ['arm64-v8a'],
            universalApk: false,
          },
        },
      },
      ios: {
        deploymentTarget: '17.5',
      },
    }],
    [
      'app-icon-badge',
      {
        enabled: Env.APP_ENV !== 'production',
        badges: [
          {
            text: Env.APP_ENV,
            type: 'banner',
            color: 'white',
          },
          {
            text: Env.VERSION.toString(),
            type: 'ribbon',
            color: 'white',
          },
        ],
      },
    ],
    [
      "expo-local-authentication",
      {
        "faceIDPermission": "Allow $(PRODUCT_NAME) to use Face ID."
      }
    ],
    // FIX for Face Detection Issue (Hermes + Worklets Incompatibility)
    // https://github.com/mrousavy/react-native-vision-camera/issues
    // Issue: Frame processors with worklets don't run in release builds with Hermes.
    // Root cause: Vision camera plugin must be applied after custom plugins to ensure
    // babel worklet plugins (react-native-worklets-core/plugin, react-native-reanimated/plugin)
    // are properly registered before vision-camera initializes.
    // Plugin execution order: last defined = first to execute (reversed).
    // So vision-camera must come BEFORE custom plugins to run AFTER them.
    ['./plugins/withLocalAar.plugin.js'],
    [
      './plugins/withNfc.plugin/build/index.js',
      {
        includeNdefEntitlement: true,
      },
    ],
    ["react-native-vision-camera", {
      "cameraPermissionText": "$(PRODUCT_NAME) needs access to your Camera.",
    }]
  ],
  extra: {
    ...ClientEnv,
    eas: {
      projectId: Env.EAS_PROJECT_ID,
    },
  },
});
