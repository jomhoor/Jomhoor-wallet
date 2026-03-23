import type { AppTabScreenProps } from '@/route-types'
import { identityStore } from '@/store'

import { DocumentsWithDocs, DocumentsWithoutDocs } from './components'

export default function DocumentsScreen({}: AppTabScreenProps<'Documents'>) {
  const identities = identityStore.useIdentityStore(state => state.identities)

  if (!identities.length) {
    return <DocumentsWithoutDocs />
  }

  return <DocumentsWithDocs />
}
