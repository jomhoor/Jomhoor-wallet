import { zodResolver } from '@hookform/resolvers/zod'
import { poseidon } from '@iden3/js-crypto'
import { useNavigation } from '@react-navigation/native'
import { useQuery } from '@tanstack/react-query'
import { hexlify, JsonRpcProvider, toUtf8Bytes } from 'ethers'
import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Image, Pressable, Text, View } from 'react-native'
import { useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { z as zod } from 'zod'

import { apiClient, queryClient } from '@/api/client'
import { RARIMO_CHAINS } from '@/api/modules/rarimo'
import { Config } from '@/config'
import { bus, DefaultBusEvents } from '@/core'
import { createPoseidonSMTContract, createProposalContract, sleep } from '@/helpers'
import { formatDateDMY } from '@/helpers/formatters'
import { tryCatch } from '@/helpers/try-catch'
import { AppStackScreenProps } from '@/route-types'
import { identityStore, walletStore } from '@/store'
import { NoirEIDIdentity } from '@/store/modules/identity/Identity'
import {
  UiBottomSheet,
  UiButton,
  UiCard,
  UiHorizontalDivider,
  UiIcon,
  UiScreenScrollable,
  useUiBottomSheet,
} from '@/ui'
import { EIDBasedQueryIdentityCircuit } from '@/utils/circuits/eid-based-query-identity-circuit'
import { QueryProofParams } from '@/utils/circuits/types/QueryIdentity'
import { computeInidCitizenshipMask, INID_MASKS } from '@/utils/citizenship-mask'

import PollStateScreen from './components/PollStateScreen'
import { ZERO_DATE_HEX } from './constants'
import { DecodedWhitelistData, ProposalMetadata } from './types'
import { decodeWhitelistData, parseProposalFromContract } from './utils'

enum Screen {
  Questions = 'questions',
  Submitting = 'submitting',
  Finish = 'finish',
}

const voteSchema = zod.object({
  votes: zod
    .array(
      zod
        .number()
        .nullable()
        .refine(v => v !== null, 'You must answer this question'),
    )
    .nonempty('At least one vote required'),
})

const rmoProvider = new JsonRpcProvider(RARIMO_CHAINS[Config.RMO_CHAIN_ID].rpcEvm)
const proposalContract = createProposalContract(Config.PROPOSAL_STATE_CONTRACT_ADDRESS, rmoProvider)

export default function PollScreen({ route }: AppStackScreenProps<'Poll'>) {
  const insets = useSafeAreaInsets()
  const bottomSheet = useUiBottomSheet()
  const navigation = useNavigation()
  const { t } = useTranslation()

  const identities = identityStore.useIdentityStore(state => state.identities)
  const privateKey = walletStore.useWalletStore(state => state.privateKey)

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [screen, setScreen] = useState<Screen>(Screen.Questions)

  const progress = useSharedValue(0)

  const startProgress = useCallback(() => {
    progress.value = withTiming(99, { duration: 5_000 })
  }, [progress])

  // Fetch proposal from contract
  const {
    data: parsedProposal,
    isLoading: isParsedProposalLoading,
    error: parsedProposalError,
  } = useQuery({
    queryKey: ['contractProposal', route.params?.proposalId],
    queryFn: async () => {
      console.log('[Poll] Fetching proposal from contract, proposalId:', route.params?.proposalId)
      if (!route.params?.proposalId) throw new Error('proposalId is not defined')

      try {
        const raw = await proposalContract.contractInstance.getProposalInfo(
          BigInt(route.params?.proposalId ?? 0),
        )
        console.log(
          '[Poll] Contract proposal fetched successfully, raw:',
          JSON.stringify(raw, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
        )
        const parsed = parseProposalFromContract(raw)
        console.log(
          '[Poll] Parsed proposal:',
          JSON.stringify(parsed, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
        )
        return parsed
      } catch (error) {
        console.error('[Poll] Error fetching proposal from contract:', error)
        throw error
      }
    },
    enabled: Boolean(route.params?.proposalId),
  })

  // Fetch proposal metadata from IPFS (with mock fallback for local testing)
  const {
    data: proposalMetadata,
    isLoading: isProposalMetadataLoading,
    error: proposalMetadataError,
  } = useQuery({
    queryKey: ['ipfsProposalMetadata', parsedProposal?.cid],
    queryFn: async (): Promise<ProposalMetadata | null> => {
      console.log(
        '[Poll] Fetching IPFS metadata, cid:',
        parsedProposal?.cid,
        'chainId:',
        Config.RMO_CHAIN_ID,
        'type:',
        typeof Config.RMO_CHAIN_ID,
      )
      if (!parsedProposal) return null

      // Mock fallback for local testing (chain ID 31337)
      const isLocalChain = String(Config.RMO_CHAIN_ID) === '31337'
      if (isLocalChain) {
        console.log('[Poll] Local chain detected, using mock metadata')
        return {
          title: `Test Proposal ${route.params?.proposalId}`,
          description:
            'This is a mock proposal for local testing. The actual IPFS metadata could not be fetched.',
          acceptedOptions: [
            {
              title: 'Do you support this proposal?',
              variants: ['Yes', 'No', 'Abstain'],
            },
          ],
        }
      }

      try {
        // Check if the CID field contains inline JSON metadata (not an IPFS hash)
        try {
          const inlineMetadata = JSON.parse(parsedProposal.cid) as ProposalMetadata
          console.log('[Poll] CID contains inline JSON metadata, using directly')
          return inlineMetadata
        } catch {
          // Not JSON — treat as IPFS CID
        }

        // Strip ipfs:// prefix if present
        const cleanCid = parsedProposal.cid.replace(/^ipfs:\/\//, '')
        const url = `${Config.IPFS_NODE_URL}/${cleanCid}`
        console.log('[Poll] IPFS URL:', url)
        const result = await apiClient.get<ProposalMetadata>(url)
        console.log('[Poll] IPFS metadata fetched:', result.data)
        return result.data
      } catch (error) {
        console.log('[Poll] IPFS fetch error:', error)
        throw error
      }
    },
    enabled: Boolean(parsedProposal),
    retry: false, // Don't retry on local chain
  })

  // Log current state
  console.log(
    '[Poll] State - isParsedProposalLoading:',
    isParsedProposalLoading,
    'isProposalMetadataLoading:',
    isProposalMetadataLoading,
    'parsedProposal:',
    !!parsedProposal,
    'proposalMetadata:',
    !!proposalMetadata,
    'parsedProposalError:',
    parsedProposalError,
    'proposalMetadataError:',
    proposalMetadataError,
  )

  const {
    data: isVoted,
    isLoading: isVotedLoading,
    error: isVotedError,
  } = useQuery({
    queryKey: ['isVoted', route.params?.proposalId],
    queryFn: async () => {
      console.log('[Poll] Checking if already voted, proposalId:', route.params?.proposalId)
      const [isVoted] = await tryCatch(
        (async () => {
          if (!route.params?.proposalId) throw new Error('proposalId is not defined')
          const proposalId = route.params?.proposalId
          const privateKeyBigInt = BigInt(`0x${privateKey}`)
          const eventId = await proposalContract.contractInstance.getProposalEventId(proposalId)
          console.log('[Poll] eventId:', eventId.toString())

          const pkHash = poseidon.hash([privateKeyBigInt])

          const nullifier = poseidon.hash([privateKeyBigInt, pkHash, eventId])
          const proposalInfo = await proposalContract.contractInstance.getProposalInfo(proposalId)
          const proposalSmtContractAddress = proposalInfo.proposalSMT
          const poseidonSmtContract = createPoseidonSMTContract(
            proposalSmtContractAddress,
            rmoProvider,
          )
          const proof = await poseidonSmtContract.contractInstance.getProof(
            '0x' + nullifier.toString(16).padStart(64, '0'),
          )
          console.log('[Poll] isVoted proof existence:', proof.existence)
          return proof.existence
        })(),
      )
      console.log('[Poll] isVoted result:', isVoted)
      return isVoted
    },
    enabled: Boolean(route.params?.proposalId),
  })

  const {
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { isSubmitting },
  } = useForm<zod.infer<typeof voteSchema>>({
    resolver: zodResolver(voteSchema),
    defaultValues: { votes: [] },
  })

  const votes = watch('votes')

  const submit = (vote: number) => {
    selectVote(currentQuestionIndex, vote)
    handleSubmit(async ({ votes }) => {
      await generateProof({ votes: votes.filter(v => v !== null) as number[] })
    })
  }

  const goToNextQuestion = (vote: number) => {
    selectVote(currentQuestionIndex, vote)
    setCurrentQuestionIndex(prev => prev + 1)
  }

  const selectVote = (index: number, vote: number) => {
    setValue(`votes.${index}`, vote)
  }

  const generateProof = async ({ votes }: { votes: number[] }) => {
    progress.value = 0
    setScreen(Screen.Submitting)
    startProgress()
    try {
      console.log('[Poll] Starting proof generation, votes:', votes)
      if (!route.params?.proposalId) throw new Error('proposalId is not defined')
      if (!identities.length) throw new Error("Your identity hasn't registered yet!")
      const currentIdentity = identities[identities.length - 1]

      if (!currentIdentity) throw new Error("Identity doesn't exist")
      console.log('[Poll] Current identity type:', currentIdentity.constructor.name)
      if (!(currentIdentity instanceof NoirEIDIdentity))
        throw new Error('Identity is not NoirEIDIdentity')

      console.log('[Poll] Creating EIDBasedQueryIdentityCircuit')
      const circuitParams = new EIDBasedQueryIdentityCircuit(
        currentIdentity,
        proposalContract.contractInstance,
      )
      // Get whitelist data - prefer fresh decode from raw proposal to avoid stale cache issues
      let whitelistData: DecodedWhitelistData
      const cachedWhitelistData = parsedProposal?.votingWhitelistData
      const rawWhitelistHex = parsedProposal?.rawProposal?.[2]?.[6]?.[0]?.toString()

      if (rawWhitelistHex) {
        // Always decode fresh from raw hex to avoid any serialization/cache issues with bigint
        whitelistData = decodeWhitelistData(rawWhitelistHex)
        console.log(
          '[Poll] Fresh-decoded whitelist data from raw hex:',
          JSON.stringify(whitelistData, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
        )
      } else if (cachedWhitelistData) {
        whitelistData = cachedWhitelistData
        console.log(
          '[Poll] Using cached whitelist data (no raw hex available):',
          JSON.stringify(whitelistData, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
        )
      } else {
        throw new Error('No whitelist data available for this proposal')
      }

      // Diagnostic: verify selector value
      const selectorValue = whitelistData.selector
      console.log(
        '[Poll] Selector diagnostic - value:',
        String(selectorValue),
        'type:',
        typeof selectorValue,
        'BigInt check:',
        BigInt(selectorValue).toString(),
      )
      if (BigInt(selectorValue) === 0n && rawWhitelistHex) {
        console.warn(
          '[Poll] WARNING: selector is 0 after decode! Raw hex:',
          rawWhitelistHex.substring(0, 140),
        )
      }

      console.log('[Poll] Getting passport info...')
      const { timestamp, identityCounter } = await circuitParams.getPassportInfo()
      console.log(
        '[Poll] Passport info - timestamp:',
        timestamp,
        'identityCounter:',
        identityCounter,
      )

      const { timestampUpper, identityCountUpper } = await circuitParams.getVotingBounds({
        whitelistData,
        timestamp,
        identityCounter,
      })
      console.log(
        '[Poll] Voting bounds - timestampUpper:',
        timestampUpper,
        'identityCountUpper:',
        identityCountUpper,
      )

      const proposalId = route.params?.proposalId
      const eventId = await circuitParams.getEventId(proposalId)
      const eventData = circuitParams.getEventData(votes)
      console.log('[Poll] Event - id:', eventId.toString(), 'data:', eventData)

      // Compute citizenship mask for INID (2-letter country codes)
      // IMPORTANT: The circuit's citizenship_check is controlled by selector_bits[1]
      // In Noir's to_be_bits::<18>(), bit 1 is the 2nd MSB, so it corresponds to value 2^16 = 65536
      // If selector doesn't have bit 1 set, citizenship_check expects res == 0, so we MUST pass mask = 0
      const selector = BigInt(whitelistData.selector)
      const selectorBit1Set = (selector & (1n << 16n)) !== 0n // Check if bit 1 (value 65536) is set
      console.log(
        '[Poll] Selector:',
        selector.toString(),
        'hex: 0x' + selector.toString(16),
        'bit 1 (citizenship_check) enabled:',
        selectorBit1Set,
      )

      const nationalities = whitelistData.nationalities || []
      let citizenshipMask: string
      if (!selectorBit1Set) {
        // citizenship_check is DISABLED in circuit - MUST pass mask = 0
        citizenshipMask = '0x0'
        console.log('[Poll] Citizenship check DISABLED by selector, using mask = 0')
      } else if (nationalities.length > 0) {
        citizenshipMask = computeInidCitizenshipMask(nationalities)
      } else {
        citizenshipMask = INID_MASKS.ALL
      }
      console.log('[Poll] Citizenship mask for nationalities', nationalities, ':', citizenshipMask)

      // Policy: Allow expired ID cards to vote
      // We use wide expiration bounds (expirationDateLower='000000', expirationDateUpper='999999')
      // to allow all expiration dates, but current_date must be accurate for contract validation
      // The contract checks that current_date is close to block.timestamp (within ~1 day)
      const now = new Date()
      const currentDateStr =
        now.getFullYear().toString().slice(2) +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0')
      console.log('[Poll] Using actual current date:', currentDateStr)

      // Use the freshly decoded selector value (converted via BigInt for safety)
      const selectorStr = BigInt(whitelistData.selector).toString()
      console.log('[Poll] Final selector string for circuit:', selectorStr)

      const params: QueryProofParams = {
        eventId: String(eventId),
        eventData,
        identityCountUpper: String(identityCountUpper),
        timestampUpper: String(timestampUpper),
        selector: selectorStr,
        // Use ZERO_DATE for all date bounds = "no restriction" (Rarimo convention)
        // When both lower and upper bounds are ZERO_DATE, the circuit skips the check.
        // The contract also uses ZERO_DATE, so these must match exactly.
        expirationDateLower: ZERO_DATE_HEX, // "000000" = no restriction
        expirationDateUpper: ZERO_DATE_HEX, // "000000" = no restriction (must match contract's hardcoded ZERO_DATE)
        birthDateLower: ZERO_DATE_HEX, // "000000" = no restriction
        birthDateUpper: ZERO_DATE_HEX, // "000000" = no restriction (must match proposal config)
        skIdentity: `0x${privateKey}`,
        identityCounter: String(identityCounter),
        timestamp: String(timestamp),
        currentDate: hexlify(toUtf8Bytes(currentDateStr)),
        identityCountLower: '0',
        citizenshipMask,
        timestampLower: '0',
      }
      console.log('[Poll] Query proof params:', JSON.stringify(params))

      console.log('[Poll] Calling prove()...')
      const proof = await circuitParams.prove(params)
      console.log('[Poll] Proof generated, calling submitVote...')
      await circuitParams.submitVote({ proof, votes, proposalId })

      bus.emit(DefaultBusEvents.success, { message: t('poll.proof-success') })
      progress.value = withTiming(100, { duration: 100 })
      setScreen(Screen.Finish)
      reset()
      await sleep(5_000)
    } catch (error) {
      console.error('Proof generation failed:', error)
      progress.value = 0
      setScreen(Screen.Questions)
      bus.emit(DefaultBusEvents.error, { message: t('poll.proof-failed') })
    }
  }

  // Initialize form votes array when metadata arrives
  useEffect(() => {
    if (proposalMetadata?.acceptedOptions?.length) {
      reset({ votes: Array(proposalMetadata.acceptedOptions.length).fill(null) })
    }
  }, [proposalMetadata?.acceptedOptions?.length, reset])

  const isLastQuestion = useMemo(
    () => currentQuestionIndex === (proposalMetadata?.acceptedOptions?.length ?? 0) - 1,
    [currentQuestionIndex, proposalMetadata?.acceptedOptions?.length],
  )

  const isLoading =
    isParsedProposalLoading ||
    isProposalMetadataLoading ||
    isVotedLoading ||
    !proposalMetadata ||
    !parsedProposal

  const isError =
    parsedProposalError || proposalMetadataError || !route.params?.proposalId || isVotedError

  console.log(
    '[Poll] Render check - isLoading:',
    isLoading,
    'isError:',
    isError,
    'isVoted:',
    isVoted,
  )
  console.log(
    '[Poll] Loading breakdown - isParsedProposalLoading:',
    isParsedProposalLoading,
    'isProposalMetadataLoading:',
    isProposalMetadataLoading,
    'isVotedLoading:',
    isVotedLoading,
    '!proposalMetadata:',
    !proposalMetadata,
    '!parsedProposal:',
    !parsedProposal,
  )

  if (isLoading) {
    console.log('[Poll] Showing Loading screen')
    return <PollStateScreen.Loading />
  }
  if (isError) {
    console.log('[Poll] Showing Error screen')
    return <PollStateScreen.Error />
  }
  if (isVoted)
    return (
      <PollStateScreen.AlreadyVoted
        onGoBack={() => {
          navigation.navigate('App', { screen: 'Home' })
        }}
      />
    )
  if (!identities.length) {
    return (
      <PollStateScreen.NoIdentity
        onGoBack={() => {
          navigation.navigate('App', { screen: 'Home' })
        }}
      />
    )
  }
  // Screens map
  const screensMap: Record<Screen, ReactNode> = {
    [Screen.Questions]: (
      <QuestionScreen
        questions={proposalMetadata.acceptedOptions}
        currentQuestionIndex={currentQuestionIndex}
        currentVoteIndex={votes[currentQuestionIndex]}
        onSelectVote={vote => selectVote(currentQuestionIndex, vote)}
        onBack={() => setCurrentQuestionIndex(i => Math.max(i - 1, 0))}
        onClose={() => bottomSheet.dismiss()}
        onSubmit={isLastQuestion ? submit : goToNextQuestion}
      />
    ),
    [Screen.Submitting]: <PollStateScreen.Submitting animatedValue={progress} />,
    [Screen.Finish]: (
      <PollStateScreen.Finished
        onGoBack={() => {
          bottomSheet.dismiss()
          queryClient.invalidateQueries({
            queryKey: ['isVoted', route.params?.proposalId],
          })
          navigation.navigate('App', { screen: 'Home' })
        }}
      />
    ),
  }

  return (
    <>
      <UiScreenScrollable style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View className='flex-row p-4'>
          <View className='relative w-full gap-6 overflow-hidden rounded-3xl'>
            <UiCard className='flex-1 gap-4 p-6'>
              <View className='flex-col gap-2'>
                <Text className='typography-h6 text-textPrimary'>{proposalMetadata.title}</Text>
                <Text className='typography-body3 text-textSecondary'>
                  {proposalMetadata.description}
                </Text>
              </View>
              <View className='overflow-hidden rounded-md'>
                <Image
                  source={{ uri: `${Config.IPFS_NODE_URL}/${proposalMetadata?.imageCid}` }}
                  className='h-48 w-full'
                />
              </View>
              <View className='mt-6 flex-row items-center justify-between'>
                <View className='flex-row items-center gap-2'>
                  <UiIcon
                    customIcon='calendarBlankIcon'
                    size={20}
                    className='color-textSecondary'
                  />
                  <Text className='typography-subtitle5 text-textSecondary'>
                    {formatDateDMY(parsedProposal?.startTimestamp)}
                  </Text>
                </View>
              </View>

              <Pressable
                className='absolute right-[15px] top-[15px]'
                onPress={() => navigation.navigate('App', { screen: 'Home' })}
              >
                <View className='h-10 w-10 items-center justify-center rounded-full bg-componentPrimary'>
                  <UiIcon customIcon='closeIcon' size={20} className='color-textPrimary' />
                </View>
              </Pressable>
            </UiCard>
          </View>
        </View>

        <UiHorizontalDivider className='my-5' />

        <View className='gap-3 px-6'>
          {[
            t('poll.citizen-of-iran'),
            t('poll.after-date', { date: formatDateDMY(parsedProposal.startTimestamp) }),
            t('poll.before-date', {
              date: formatDateDMY(parsedProposal.startTimestamp + parsedProposal.duration),
            }),
          ].map(title => (
            <View key={title} className='flex-row items-center gap-2'>
              <UiIcon customIcon='checkIcon' size={20} className='color-successMain' />
              <Text className='typography-subtitle4 text-textPrimary'>{title}</Text>
            </View>
          ))}
        </View>

        <View className='w-full flex-1 justify-end px-4 pb-4'>
          <UiButton title={t('poll.vote')} onPress={bottomSheet.present} className='mt-8 w-full' />
        </View>
      </UiScreenScrollable>

      <UiBottomSheet
        ref={bottomSheet.ref}
        isCloseDisabled={isSubmitting}
        snapPoints={['100%']}
        headerComponent={<></>}
        enableDynamicSizing={false}
        backgroundStyle={{ backgroundColor: 'backgroundContainer' }}
      >
        {screensMap[screen]}
      </UiBottomSheet>
    </>
  )
}

interface Question {
  title: string
  variants: string[]
}
interface QuestionScreenProps {
  questions: Question[]
  currentQuestionIndex: number
  currentVoteIndex: number | null
  onSelectVote: (id: number) => void
  onSubmit: (id: number) => void
  onBack: () => void
  onClose: () => void
}

function QuestionScreen({
  questions,
  currentVoteIndex,
  onSelectVote,
  currentQuestionIndex,
  onSubmit,
  onBack,
  onClose,
}: QuestionScreenProps) {
  const currentQuestion = questions[currentQuestionIndex]
  const isCanGoBack = currentQuestionIndex > 0
  const isLast = currentQuestionIndex === questions.length - 1
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()

  return (
    <View
      key={currentQuestionIndex}
      className='h-full gap-3 bg-backgroundPrimary px-screen-x py-gutter'
      style={{
        paddingBottom: insets.bottom,
      }}
    >
      <View className='flex-row items-center justify-between'>
        <Text className='typography-subtitle4 text-textSecondary'>
          {t('poll.question-counter', {
            current: currentQuestionIndex + 1,
            total: questions.length,
          })}
        </Text>
        <Pressable onPress={onClose}>
          <View className='h-10 w-10 items-center justify-center rounded-full bg-componentPrimary'>
            <UiIcon customIcon='closeIcon' size={20} className='color-textPrimary' />
          </View>
        </Pressable>
      </View>

      <View className='flex-1 gap-3'>
        <UiCard className='w-full justify-center gap-5 px-gutter py-gutter'>
          <Text className='typography-h6 text-center text-textPrimary'>
            {currentQuestion.title}
          </Text>
          <UiHorizontalDivider />
          <Text className='typography-overline2 text-textSecondary'>{t('poll.pick-answer')}</Text>

          <View className='mt-3 gap-3'>
            {currentQuestion.variants.map((answer, index) => {
              const id = Number(index)
              const isSelected = currentVoteIndex === id

              return (
                <UiButton
                  key={`${answer}-${index}`}
                  color='primary'
                  variant='outlined'
                  size='medium'
                  onPress={() => onSelectVote(id)}
                >
                  <View className='relative w-full flex-row items-center justify-between'>
                    <Text
                      className='flex-1 truncate pr-6 text-sm text-textPrimary'
                      numberOfLines={1}
                      ellipsizeMode='tail'
                    >
                      {answer}
                    </Text>

                    {isSelected && (
                      <View className='absolute right-0'>
                        <UiIcon customIcon='checkIcon' size={20} className='color-successMain' />
                      </View>
                    )}
                  </View>
                </UiButton>
              )
            })}
          </View>
        </UiCard>
      </View>

      <>
        <UiHorizontalDivider />

        <View className='flex-row gap-3'>
          {isCanGoBack && (
            <UiButton
              variant='outlined'
              title={t('poll.previous')}
              className='flex-1'
              leadingIconProps={{ customIcon: 'arrowLeftIcon' }}
              onPress={onBack}
            />
          )}

          <UiButton
            title={isLast ? t('poll.finish') : t('poll.next-question')}
            trailingIconProps={{ customIcon: 'arrowRightIcon' }}
            disabled={currentVoteIndex === null}
            className='flex-1'
            onPress={() => onSubmit(currentVoteIndex as number)}
          />
        </View>
      </>
    </View>
  )
}
