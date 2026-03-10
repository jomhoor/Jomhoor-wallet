import { Time } from '@distributedlab/tools'
import { useNavigation } from '@react-navigation/native'
import { useQuery } from '@tanstack/react-query'
import { JsonRpcProvider } from 'ethers'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, RefreshControl, Text, View } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { RARIMO_CHAINS } from '@/api/modules/rarimo'
import { Config } from '@/config'
import { createProposalContract } from '@/helpers'
import { formatDateDMY } from '@/helpers/formatters'
import AppContainer from '@/pages/app/components/AppContainer'
import { ProposalStatus } from '@/pages/app/pages/poll/types'
import { parseProposalFromContract } from '@/pages/app/pages/poll/utils'
import type { AppTabScreenProps } from '@/route-types'
import { identityStore } from '@/store'
import { useAppPaddings, useBottomBarOffset } from '@/theme'
import { UiCard, UiHorizontalDivider, UiIcon, UiScreenScrollable } from '@/ui'

const rmoProvider = new JsonRpcProvider(RARIMO_CHAINS[Config.RMO_CHAIN_ID].rpcEvm)
const proposalContract = createProposalContract(Config.PROPOSAL_STATE_CONTRACT_ADDRESS, rmoProvider)

interface ProposalListItem {
  id: number
  title: string
  description: string
  status: ProposalStatus
  startTimestamp: number
  duration: number
  nationalities: string[]
  totalVotes: number
}

// Mapping from 2-letter (INID) to 3-letter (passport) ISO codes
const ISO_2_TO_3: Record<string, string> = {
  IR: 'IRN', // Iran
  DE: 'DEU', // Germany
  US: 'USA', // United States
  // Add more as needed
}

/**
 * Check if user's nationality is eligible for a proposal
 * @param userNationality - 3-letter ISO code (e.g., 'IRN')
 * @param proposalNationalities - Array of allowed nationalities (can be 2 or 3 letter)
 * @returns true if eligible (empty array means all countries allowed)
 */
function isUserEligible(userNationality: string | null, proposalNationalities: string[]): boolean {
  // If user has no nationality set, we can't determine eligibility
  if (!userNationality) {
    if (__DEV__) console.log('[Eligibility] No user nationality set')
    return false
  }

  // Empty nationalities array means all countries are allowed
  if (proposalNationalities.length === 0) {
    if (__DEV__) console.log('[Eligibility] Empty nationalities = all allowed')
    return true
  }

  const userUpper = userNationality.toUpperCase()

  // Convert user's 2-letter code to 3-letter if applicable
  const userNormalized = ISO_2_TO_3[userUpper] || userUpper

  // Check if user's nationality is in the allowed list
  // Support both 2-letter (INID) and 3-letter (passport) codes
  const result = proposalNationalities.some(nat => {
    const natUpper = nat.toUpperCase()
    // Convert proposal's 2-letter code to 3-letter if applicable
    const natNormalized = ISO_2_TO_3[natUpper] || natUpper
    // Compare normalized (3-letter) versions
    return natNormalized === userNormalized
  })

  if (__DEV__) {
    console.log(
      '[Eligibility] User:',
      userUpper,
      '→',
      userNormalized,
      'Allowed:',
      proposalNationalities,
      'Eligible:',
      result,
    )
  }

  return result
}

type FilterMode = 'all' | 'eligible' | 'ineligible'

// eslint-disable-next-line no-empty-pattern
export default function ProposalsScreen({}: AppTabScreenProps<'Proposals'>) {
  const insets = useSafeAreaInsets()
  const appPaddings = useAppPaddings()
  const offset = useBottomBarOffset()
  const navigation = useNavigation()
  const { t } = useTranslation()

  const identities = identityStore.useIdentityStore(state => state.identities)
  const hasIdentity = identities.length > 0

  // Get user's nationality from their registered identity
  const userNationality = useMemo(() => {
    if (!hasIdentity) return null
    const currentIdentity = identities[identities.length - 1]
    const nationality = currentIdentity?.document?.personDetails?.nationality ?? null

    // Debug logging
    if (__DEV__) {
      console.log(
        `[Proposals] User nationality: ${nationality}, from identity type: ${currentIdentity?.document?.docCode}`,
      )
    }

    return nationality
  }, [identities, hasIdentity])

  const [filterMode, setFilterMode] = useState<FilterMode>('all')

  const {
    data: proposals,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['proposalsList'],
    queryFn: async (): Promise<ProposalListItem[]> => {
      console.log(
        '[Proposals] Fetching proposals from contract:',
        Config.PROPOSAL_STATE_CONTRACT_ADDRESS,
      )
      console.log('[Proposals] RPC URL:', RARIMO_CHAINS[Config.RMO_CHAIN_ID]?.rpcEvm)
      try {
        const lastProposalId = await proposalContract.contractInstance.lastProposalId()
        const proposalCount = Number(lastProposalId)
        console.log('[Proposals] Found', proposalCount, 'proposals')

        if (proposalCount === 0) return []

        const proposalPromises: Promise<ProposalListItem | null>[] = []

        for (let i = 1; i <= proposalCount; i++) {
          proposalPromises.push(
            (async () => {
              try {
                const raw = await proposalContract.contractInstance.getProposalInfo(BigInt(i))
                const parsed = parseProposalFromContract(raw)
                console.log(
                  '[Proposals] Proposal',
                  i,
                  '- status:',
                  parsed.status,
                  'nationalities:',
                  parsed.votingWhitelistData?.nationalities,
                )

                // Skip hidden proposals
                if (
                  parsed.status === ProposalStatus.DoNotShow ||
                  parsed.status === ProposalStatus.None
                ) {
                  console.log('[Proposals] Skipping proposal', i, '- status is DoNotShow or None')
                  return null
                }

                // Calculate total votes across all options
                const totalVotes = parsed.voteResults.reduce(
                  (sum, optionVotes) => sum + optionVotes.reduce((a, b) => a + b, 0),
                  0,
                )

                // Extract title - try to parse JSON if description contains raw JSON
                let title = t('proposals.proposal-number', { id: i })
                let description = parsed.cid

                if (parsed.cid.startsWith('{')) {
                  try {
                    const metadata = JSON.parse(parsed.cid)
                    if (metadata.title) title = metadata.title
                    if (metadata.description) description = metadata.description
                  } catch {
                    // Keep default title if JSON parsing fails
                  }
                }

                return {
                  id: i,
                  title,
                  description,
                  status: parsed.status,
                  startTimestamp: parsed.startTimestamp,
                  duration: parsed.duration,
                  nationalities: parsed.votingWhitelistData?.nationalities ?? [],
                  totalVotes,
                }
              } catch (error) {
                console.error(`Failed to fetch proposal ${i}:`, error)
                return null
              }
            })(),
          )
        }

        const results = await Promise.all(proposalPromises)
        return results.filter((p): p is ProposalListItem => p !== null)
      } catch (error) {
        console.error('[Proposals] Failed to fetch proposals:', error)
        throw error
      }
    },
    staleTime: 30_000, // 30 seconds
  })

  // Filter proposals based on eligibility
  const filteredProposals = useMemo(() => {
    if (!proposals) return []
    if (filterMode === 'all') return proposals

    return proposals.filter(proposal => {
      const eligible = isUserEligible(userNationality, proposal.nationalities)
      return filterMode === 'eligible' ? eligible : !eligible
    })
  }, [proposals, filterMode, userNationality])

  // Count proposals by eligibility for filter badges
  const eligibilityCounts = useMemo(() => {
    if (!proposals) return { eligible: 0, ineligible: 0 }
    return proposals.reduce(
      (acc, proposal) => {
        const eligible = isUserEligible(userNationality, proposal.nationalities)
        return {
          eligible: acc.eligible + (eligible ? 1 : 0),
          ineligible: acc.ineligible + (!eligible ? 1 : 0),
        }
      },
      { eligible: 0, ineligible: 0 },
    )
  }, [proposals, userNationality])

  const getStatusColor = (status: ProposalStatus) => {
    switch (status) {
      case ProposalStatus.Started:
        return 'text-successMain'
      case ProposalStatus.Waiting:
        return 'text-warningMain'
      case ProposalStatus.Ended:
        return 'text-textSecondary'
      default:
        return 'text-textSecondary'
    }
  }

  const getStatusLabel = (status: ProposalStatus) => {
    switch (status) {
      case ProposalStatus.Started:
        return t('proposals.active')
      case ProposalStatus.Waiting:
        return t('proposals.upcoming')
      case ProposalStatus.Ended:
        return t('proposals.ended')
      default:
        return t('proposals.unknown')
    }
  }

  const formatNationalities = (nationalities: string[]) => {
    if (nationalities.length === 0) return t('proposals.all-countries')
    if (nationalities.length <= 3) return nationalities.join(', ')
    return `${nationalities.slice(0, 2).join(', ')} ${t('proposals.more-countries', { count: nationalities.length - 2 })}`
  }

  const handleProposalPress = (proposalId: number) => {
    navigation.navigate('App', {
      screen: 'Poll',
      params: { proposalId: String(proposalId) },
    })
  }

  if (isLoading) {
    return (
      <AppContainer>
        <UiScreenScrollable
          style={{
            paddingTop: insets.top,
            paddingLeft: appPaddings.left,
            paddingRight: appPaddings.right,
            paddingBottom: offset,
          }}
          className='gap-4'
        >
          <Text className='typography-h4 text-textPrimary'>{t('proposals.title')}</Text>
          {[1, 2, 3].map(i => (
            <ProposalCardSkeleton key={i} delay={i * 100} />
          ))}
        </UiScreenScrollable>
      </AppContainer>
    )
  }

  if (isError) {
    return (
      <AppContainer>
        <UiScreenScrollable
          style={{
            paddingTop: insets.top,
            paddingLeft: appPaddings.left,
            paddingRight: appPaddings.right,
            paddingBottom: offset,
          }}
          className='items-center justify-center gap-4'
        >
          <UiIcon customIcon='warningIcon' className='size-16 text-errorMain' />
          <Text className='typography-h6 text-textPrimary'>{t('proposals.failed-to-load')}</Text>
          <Pressable onPress={() => refetch()} className='rounded-full bg-primaryMain px-6 py-3'>
            <Text className='typography-buttonMedium text-baseWhite'>{t('proposals.retry')}</Text>
          </Pressable>
        </UiScreenScrollable>
      </AppContainer>
    )
  }

  return (
    <AppContainer>
      <UiScreenScrollable
        scrollViewProps={{
          refreshControl: <RefreshControl refreshing={isRefetching} onRefresh={refetch} />,
        }}
        style={{
          paddingTop: insets.top,
          paddingLeft: appPaddings.left,
          paddingRight: appPaddings.right,
          paddingBottom: offset,
        }}
        className='gap-4'
      >
        <View className='flex flex-row items-center justify-between'>
          <Text className='typography-h4 text-textPrimary'>{t('proposals.title')}</Text>
          {userNationality && (
            <View className='flex flex-row items-center gap-1 rounded-full bg-backgroundContainer px-2 py-1'>
              <UiIcon customIcon='earthLineIcon' className='size-3 text-textSecondary' />
              <Text className='typography-caption text-textSecondary'>{userNationality}</Text>
            </View>
          )}
        </View>

        {/* Filter tabs */}
        {hasIdentity && userNationality && proposals && proposals.length > 0 && (
          <View className='flex flex-row gap-2'>
            <FilterChip
              label={t('proposals.all')}
              count={proposals.length}
              isActive={filterMode === 'all'}
              onPress={() => setFilterMode('all')}
            />
            <FilterChip
              label={t('proposals.eligible')}
              count={eligibilityCounts.eligible}
              isActive={filterMode === 'eligible'}
              onPress={() => setFilterMode('eligible')}
              variant='success'
            />
            <FilterChip
              label={t('proposals.ineligible')}
              count={eligibilityCounts.ineligible}
              isActive={filterMode === 'ineligible'}
              onPress={() => setFilterMode('ineligible')}
              variant='error'
            />
          </View>
        )}

        {!hasIdentity && (
          <UiCard className='bg-warningDark/20 flex flex-row items-center gap-3'>
            <UiIcon customIcon='warningIcon' className='size-6 text-warningMain' />
            <Text className='typography-body3 flex-1 text-textPrimary'>
              {t('proposals.create-identity-hint')}
            </Text>
          </UiCard>
        )}

        {filteredProposals.length === 0 ? (
          <UiCard className='items-center justify-center py-10'>
            <UiIcon
              customIcon='identificationCardIcon'
              className='mb-4 size-16 text-textSecondary'
            />
            <Text className='typography-h6 text-center text-textPrimary'>
              {filterMode === 'all'
                ? t('proposals.no-proposals')
                : t('proposals.no-filtered', {
                    filter:
                      filterMode === 'eligible'
                        ? t('proposals.eligible')
                        : t('proposals.ineligible'),
                  })}
            </Text>
            <Text className='typography-body3 mt-2 text-center text-textSecondary'>
              {filterMode === 'all' ? t('proposals.check-back') : t('proposals.try-filter')}
            </Text>
          </UiCard>
        ) : (
          filteredProposals.map(proposal => {
            const isEligible = isUserEligible(userNationality, proposal.nationalities)
            return (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                onPress={() => handleProposalPress(proposal.id)}
                statusLabel={getStatusLabel(proposal.status)}
                statusColorClass={getStatusColor(proposal.status)}
                formattedNationalities={formatNationalities(proposal.nationalities)}
                isEligible={hasIdentity ? isEligible : undefined}
              />
            )
          })
        )}
      </UiScreenScrollable>
    </AppContainer>
  )
}

function FilterChip({
  label,
  count,
  isActive,
  onPress,
  variant = 'default',
}: {
  label: string
  count: number
  isActive: boolean
  onPress: () => void
  variant?: 'default' | 'success' | 'error'
}) {
  const bgClass = isActive
    ? variant === 'success'
      ? 'bg-successDark'
      : variant === 'error'
        ? 'bg-errorDark'
        : 'bg-primaryMain'
    : 'bg-backgroundContainer'
  const textClass = isActive ? 'text-baseWhite' : 'text-textSecondary'

  return (
    <Pressable
      onPress={onPress}
      className={`flex flex-row items-center gap-1 rounded-full px-3 py-1.5 ${bgClass}`}
    >
      <Text className={`typography-caption ${textClass}`}>{label}</Text>
      <Text className={`typography-caption ${textClass}`}>({count})</Text>
    </Pressable>
  )
}

function ProposalCard({
  proposal,
  onPress,
  statusLabel,
  statusColorClass,
  formattedNationalities,
  isEligible,
}: {
  proposal: ProposalListItem
  onPress: () => void
  statusLabel: string
  statusColorClass: string
  formattedNationalities: string
  isEligible?: boolean // undefined = no identity registered
}) {
  const { t } = useTranslation()
  const endTime = new Time(proposal.startTimestamp * 1000).add(proposal.duration, 'seconds')
  const startTime = new Time(proposal.startTimestamp * 1000)
  const isActive = proposal.status === ProposalStatus.Started

  return (
    <Pressable onPress={onPress}>
      <UiCard className='gap-3'>
        <View className='flex flex-row items-start justify-between'>
          <View className='flex-1'>
            <Text className='typography-subtitle2 text-textPrimary'>{proposal.title}</Text>
            <Text className='typography-caption mt-1 text-textSecondary' numberOfLines={1}>
              {proposal.description}
            </Text>
          </View>
          <View className='ml-3 rounded-full bg-backgroundPrimary px-3 py-1'>
            <Text className={`typography-caption ${statusColorClass}`}>{statusLabel}</Text>
          </View>
        </View>

        <UiHorizontalDivider />

        <View className='flex flex-row items-center justify-between'>
          <View className='flex flex-row items-center gap-2'>
            <UiIcon customIcon='earthLineIcon' className='size-4 text-textSecondary' />
            <Text className='typography-caption text-textSecondary'>{formattedNationalities}</Text>
          </View>
          {isEligible !== undefined && (
            <View
              className={`flex flex-row items-center gap-1 rounded-full px-2 py-0.5 ${
                isEligible ? 'bg-successDark/20' : 'bg-errorDark/20'
              }`}
            >
              <UiIcon
                libIcon='FontAwesome'
                name={isEligible ? 'check' : 'times'}
                size={10}
                className={isEligible ? 'text-successMain' : 'text-errorMain'}
              />
              <Text
                className={`typography-caption ${isEligible ? 'text-successMain' : 'text-errorMain'}`}
              >
                {isEligible ? t('proposals.eligible') : t('proposals.ineligible')}
              </Text>
            </View>
          )}
        </View>

        <View className='flex flex-row items-center justify-between'>
          <View className='flex flex-row items-center gap-2'>
            <UiIcon
              libIcon='FontAwesome'
              name='calendar'
              className='text-textSecondary'
              size={14}
            />
            <Text className='typography-caption text-textSecondary'>
              {isActive
                ? t('proposals.ends', { date: formatDateDMY(endTime) })
                : t('proposals.starts', { date: formatDateDMY(startTime) })}
            </Text>
          </View>

          <View className='flex flex-row items-center gap-2'>
            <UiIcon libIcon='FontAwesome' name='users' className='text-textSecondary' size={14} />
            <Text className='typography-caption text-textSecondary'>
              {t('proposals.votes-count', { count: proposal.totalVotes })}
            </Text>
          </View>
        </View>

        <View className='mt-1 flex flex-row items-center justify-end'>
          <Text className='typography-buttonSmall text-primaryMain'>
            {t('proposals.view-details')}
          </Text>
          <UiIcon customIcon='arrowRightIcon' className='ml-1 size-4 text-primaryMain' />
        </View>
      </UiCard>
    </Pressable>
  )
}

function SkeletonBox({ delay = 0, className }: { delay?: number; className?: string }) {
  const opacity = useSharedValue(1)

  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(withTiming(0.3, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true),
    )
    return () => cancelAnimation(opacity)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))

  return <Animated.View style={animatedStyle} className={className} />
}

function ProposalCardSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <UiCard className='gap-3'>
      <View className='flex flex-row items-start justify-between'>
        <View className='flex-1'>
          <SkeletonBox delay={delay} className='h-5 w-3/4 rounded-md bg-backgroundPrimary' />
          <SkeletonBox
            delay={delay + 50}
            className='mt-2 h-3 w-full rounded-md bg-backgroundPrimary'
          />
        </View>
        <SkeletonBox
          delay={delay + 100}
          className='ml-3 h-6 w-16 rounded-full bg-backgroundPrimary'
        />
      </View>

      <UiHorizontalDivider />

      <View className='flex flex-row items-center justify-between'>
        <SkeletonBox delay={delay + 150} className='h-4 w-24 rounded-md bg-backgroundPrimary' />
        <SkeletonBox delay={delay + 200} className='h-4 w-16 rounded-md bg-backgroundPrimary' />
      </View>
    </UiCard>
  )
}
