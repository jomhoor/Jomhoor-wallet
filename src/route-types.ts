import type { NavigatorScreenParams } from '@react-navigation/native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'

import { DocType } from './utils/e-document'

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamsList>
  LocalAuth: NavigatorScreenParams<LocalAuthStackParamsList>
  App: NavigatorScreenParams<AppStackParamsList>
}

// FIXME: Inherits wrong `params` interface
export type RootStackScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>

export type AuthStackParamsList = {
  Intro: undefined
  CreateWallet: { isImporting: boolean } | undefined
}

export type AuthStackScreenProps<T extends keyof AuthStackParamsList> = NativeStackScreenProps<
  AuthStackParamsList,
  T
>

export type LocalAuthStackParamsList = {
  EnableBiometrics: undefined
  EnablePasscode: undefined
  Lockscreen: undefined
  SetPasscode: undefined
}

export type LocalAuthStackScreenProps<T extends keyof LocalAuthStackParamsList> =
  NativeStackScreenProps<LocalAuthStackParamsList, T>

export type AppStackParamsList = {
  Home: undefined
  Documents: undefined
  Proposals: undefined
  Hub: undefined
  Compass: undefined
  Wallet: undefined
  Profile: undefined
  InviteOthers?: {
    tag?: string
  }
  Poll?: { proposalId?: string }
  Scan?: {
    documentType?: DocType
  }
}

export type AppStackScreenProps<T extends keyof AppStackParamsList> = NativeStackScreenProps<
  AppStackParamsList,
  T
>

// Backward-compatible alias for screens that were previously tabs
export type AppTabParamsList = AppStackParamsList
export type AppTabScreenProps<T extends keyof AppStackParamsList> = AppStackScreenProps<T>

declare global {
  namespace ReactNavigation {
    /*eslint-disable-next-line @typescript-eslint/no-empty-object-type*/
    interface RootParamList extends RootStackParamList {}
  }
}
