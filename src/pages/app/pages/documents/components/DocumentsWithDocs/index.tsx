import { useTranslation } from 'react-i18next'

import { AppStackScrollLayout } from '@/pages/app/components/app-stack-scroll-layout'
import { identityStore } from '@/store'

import { DocumentCard } from './components'

export default function DocumentsWithDocs() {
  const { t } = useTranslation()
  const identities = identityStore.useIdentityStore(state => state.identities)

  return (
    <AppStackScrollLayout title={t('home.documents')}>
      <DocumentCard identity={identities[0]} />
    </AppStackScrollLayout>
  )
}
