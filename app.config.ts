import type { ConfigContext, ExpoConfig } from '@expo/config'

import { ClientEnv, Env } from './env'

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
  runtimeVersion: {
    policy: 'appVersion',
  },
  ios: {
    bundleIdentifier: Env.BUNDLE_ID,
    entitlements: {
      'com.apple.developer.kernel.increased-memory-limit': true,
      'com.apple.developer.kernel.extended-virtual-addressing': true
    },
    "infoPlist": {
      "ITSAppUsesNonExemptEncryption": false,
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
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#2E3C4B',
    },
    package: Env.PACKAGE,
  },
  web: {
    favicon: './assets/favicon.png',
    bundler: 'metro',
  },
  plugins: [
    ['expo-asset'],
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
        minSdkVersion: 27,
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
    ["react-native-vision-camera", {
      "cameraPermissionText": "$(PRODUCT_NAME) needs access to your Camera.",
    }],
    ['./plugins/withNfc.plugin/build/index.js'],
    ['./plugins/withLocalAar.plugin.js']
  ],
  extra: {
    ...ClientEnv,
    eas: {
      projectId: Env.EAS_PROJECT_ID,
    },
  },
});
