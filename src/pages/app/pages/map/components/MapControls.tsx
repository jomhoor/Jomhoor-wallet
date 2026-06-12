import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, Text, View } from 'react-native'

import type { MapProposalCatalogItem } from '@/api/modules/map'

type Props = {
  proposals: MapProposalCatalogItem[]
  selectedProposalId: string | null
  selectedQuestionIndex: number | null
  onSelectProposal: (proposalId: string) => void
  onSelectQuestion: (questionIndex: number) => void
}

function SelectorChip({
  label,
  selected,
  onPress,
}: {
  label: string
  selected: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`rounded-full px-4 py-2 ${selected ? 'bg-primaryMain' : 'bg-backgroundContainer'}`}
    >
      <Text className={`typography-body3 ${selected ? 'text-baseWhite' : 'text-textPrimary'}`}>
        {label}
      </Text>
    </Pressable>
  )
}

export default function MapControls({
  proposals,
  selectedProposalId,
  selectedQuestionIndex,
  onSelectProposal,
  onSelectQuestion,
}: Props) {
  const { t } = useTranslation()
  const selectedProposal = proposals.find(proposal => proposal.proposalId === selectedProposalId)

  return (
    <View className='gap-3'>
      <Text className='typography-subtitle2 text-textPrimary'>{t('map.select-proposal')}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        {proposals.map(proposal => (
          <SelectorChip
            key={proposal.proposalId}
            label={proposal.title}
            selected={proposal.proposalId === selectedProposalId}
            onPress={() => onSelectProposal(proposal.proposalId)}
          />
        ))}
      </ScrollView>

      {selectedProposal ? (
        <>
          <Text className='typography-subtitle2 mt-2 text-textPrimary'>
            {t('map.select-question')}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            {selectedProposal.questions.map((question, questionIndex) => (
              <SelectorChip
                key={`${selectedProposal.proposalId}-${questionIndex}`}
                label={question.title}
                selected={questionIndex === selectedQuestionIndex}
                onPress={() => onSelectQuestion(questionIndex)}
              />
            ))}
          </ScrollView>
        </>
      ) : null}
    </View>
  )
}
