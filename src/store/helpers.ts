import type { StateStorage } from 'zustand/middleware'

import { getStorageItemAsync, setStorageItemAsync, storage } from '@/core'
import {
  classifyIdentityCreationError,
  logIdentityDiagnostic,
  logIdentityDiagnosticError,
} from '@/helpers/identity-proof-diagnostics'

export const zustandStorage: StateStorage = {
  setItem: (name, value) => {
    logIdentityDiagnostic('SecureStorage', 'zustandStorage.setItem', {
      key: name,
      valueLength: value.length,
    })
    return storage.set(name, value)
  },
  getItem: name => {
    const value = storage.getString(name)
    logIdentityDiagnostic('SecureStorage', 'zustandStorage.getItem', {
      key: name,
      hasValue: value !== undefined && value !== null,
      valueLength: value?.length ?? 0,
    })
    return value ?? null
  },
  removeItem: name => {
    logIdentityDiagnostic('SecureStorage', 'zustandStorage.removeItem', {
      key: name,
    })
    return storage.delete(name)
  },
}

export const zustandSecureStorage: StateStorage = {
  setItem: async (name, value): Promise<void> => {
    logIdentityDiagnostic('SecureStorage', 'zustandSecureStorage.setItem:start', {
      key: name,
      valueLength: value.length,
    })
    try {
      await setStorageItemAsync(name, value)
      logIdentityDiagnostic('SecureStorage', 'zustandSecureStorage.setItem:success', {
        key: name,
      })
    } catch (error) {
      const classification = classifyIdentityCreationError({
        stage: 'secure-storage-set-item',
        error,
      })
      logIdentityDiagnosticError({
        domain: 'SecureStorage',
        event: 'zustandSecureStorage.setItem:failed',
        stage: 'secure-storage-set-item',
        classification,
        error,
        context: {
          key: name,
          valueLength: value.length,
        },
      })
      throw error
    }
  },
  getItem: async (name): Promise<string | null> => {
    logIdentityDiagnostic('SecureStorage', 'zustandSecureStorage.getItem:start', {
      key: name,
    })
    try {
      const value = await getStorageItemAsync(name)
      logIdentityDiagnostic('SecureStorage', 'zustandSecureStorage.getItem:success', {
        key: name,
        hasValue: value !== undefined && value !== null,
        valueLength: value?.length ?? 0,
      })
      return value ?? null
    } catch (error) {
      const classification = classifyIdentityCreationError({
        stage: 'secure-storage-get-item',
        error,
      })
      logIdentityDiagnosticError({
        domain: 'SecureStorage',
        event: 'zustandSecureStorage.getItem:failed',
        stage: 'secure-storage-get-item',
        classification,
        error,
        context: {
          key: name,
        },
      })
      throw error
    }
  },
  removeItem: async (name): Promise<void> => {
    logIdentityDiagnostic('SecureStorage', 'zustandSecureStorage.removeItem:start', {
      key: name,
    })
    try {
      await setStorageItemAsync(name, null)
      logIdentityDiagnostic('SecureStorage', 'zustandSecureStorage.removeItem:success', {
        key: name,
      })
    } catch (error) {
      const classification = classifyIdentityCreationError({
        stage: 'secure-storage-remove-item',
        error,
      })
      logIdentityDiagnosticError({
        domain: 'SecureStorage',
        event: 'zustandSecureStorage.removeItem:failed',
        stage: 'secure-storage-remove-item',
        classification,
        error,
        context: {
          key: name,
        },
      })
      throw error
    }
  },
}
