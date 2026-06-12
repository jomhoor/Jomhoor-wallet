import type { AppTabScreenProps } from '@/route-types'
import { appCapabilitiesStore, demoPassportProfileStore, identityStore } from '@/store'

import { DocumentsWithDemoProfile, DocumentsWithDocs, DocumentsWithoutDocs } from './components'

export default function DocumentsScreen({}: AppTabScreenProps<'Documents'>) {
  const identities = identityStore.useIdentityStore(state => state.identities)
  const demoPassportProfile = demoPassportProfileStore.useDemoPassportProfileStore(
    state => state.profile,
  )
  const documentDemoModeEnabled = appCapabilitiesStore.useDocumentDemoModeEnabled()

  if (identities.length) {
    return <DocumentsWithDocs />
  }

  if (documentDemoModeEnabled && demoPassportProfile) {
    return <DocumentsWithDemoProfile />
  }

  return <DocumentsWithoutDocs />
}
