import { z } from 'zod'

export const MAP_CONTRACT_VERSION = 1 as const
export const MAP_PRIVACY_POLICY_VERSION = 1 as const
export const MAP_CELL_SCHEME = 'h3' as const
export const MAP_MIN_PRIVACY_THRESHOLD_K = 5
export const MAP_DEFAULT_PRIVACY_THRESHOLD_K = 5
export const MAP_DEFAULT_COLLECTION_RESOLUTION = 6
export const MAP_MIN_PUBLISHED_RESOLUTION = 3
export const MAP_ALLOWED_CELL_RESOLUTIONS = [3, 4, 5, 6] as const
export const MAP_DEFAULT_PUBLICATION_WINDOW_SECONDS = 15 * 60
export const MAP_MIN_PUBLICATION_WINDOW_SECONDS = 5 * 60

const countryCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{2,3}$/, 'Country code must be a 2 or 3 letter uppercase code')

export const mapCellResolutionSchema = z
  .number()
  .int()
  .refine(
    value => MAP_ALLOWED_CELL_RESOLUTIONS.includes(value as MapCellResolution),
    'Unsupported map cell resolution',
  )

export const mapCellIdSchema = z.string().trim().min(1).max(64)

export const mapProfileLocationPreferenceSchema = z.enum(['ask', 'share', 'never'])

export const mapLocationSourceSchema = z.enum(['current_device_area', 'saved_home_area', 'either'])

export const mapContributionSourceSchema = z.enum(['current_device_area', 'saved_home_area'])

export const savedHomeAreaSchema = z
  .object({
    contractVersion: z.literal(MAP_CONTRACT_VERSION),
    cellScheme: z.literal(MAP_CELL_SCHEME),
    cellId: mapCellIdSchema,
    cellResolution: mapCellResolutionSchema,
  })
  .strict()

const enabledLocationPolicyFields = {
  source: mapLocationSourceSchema,
  cellScheme: z.literal(MAP_CELL_SCHEME),
  collectionResolution: mapCellResolutionSchema,
  minimumPublishedResolution: mapCellResolutionSchema,
  privacyThresholdK: z.number().int().min(MAP_MIN_PRIVACY_THRESHOLD_K),
  publicationWindowSeconds: z.number().int().min(MAP_MIN_PUBLICATION_WINDOW_SECONDS),
  allowedCellIds: z.array(mapCellIdSchema),
  policyVersion: z.number().int().positive(),
  consentVersion: z.number().int().positive(),
} as const

const createEnabledLocationPolicySchema = (mode: 'optional' | 'required') =>
  z
    .object({
      mode: z.literal(mode),
      ...enabledLocationPolicyFields,
    })
    .strict()

export const proposalLocationPolicySchema = z
  .union([
    z
      .object({
        mode: z.literal('disabled'),
      })
      .strict(),
    createEnabledLocationPolicySchema('optional'),
    createEnabledLocationPolicySchema('required'),
  ])
  .superRefine((policy, context) => {
    if (
      policy.mode !== 'disabled' &&
      policy.minimumPublishedResolution > policy.collectionResolution
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Minimum published resolution cannot exceed collection resolution',
        path: ['minimumPublishedResolution'],
      })
    }
  })

export const nationalityRequirementSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('any') }).strict(),
  z.object({ mode: z.literal('identified') }).strict(),
  z
    .object({
      mode: z.literal('allowlist'),
      allowedCountryCodes: z.array(countryCodeSchema).min(1),
    })
    .strict(),
])

export const ageRequirementSchema = z
  .union([
    z.object({ mode: z.literal('any') }).strict(),
    z
      .object({
        mode: z.literal('range'),
        minimumAge: z.number().int().min(0).max(150).nullable(),
        maximumAge: z.number().int().min(0).max(150).nullable(),
      })
      .strict(),
  ])
  .superRefine((requirement, context) => {
    if (requirement.mode !== 'range') return

    if (requirement.minimumAge === null && requirement.maximumAge === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An age range must define at least one bound',
      })
    }

    if (
      requirement.minimumAge !== null &&
      requirement.maximumAge !== null &&
      requirement.minimumAge > requirement.maximumAge
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Minimum age cannot exceed maximum age',
        path: ['minimumAge'],
      })
    }
  })

export const proposalParticipationPolicySchema = z
  .object({
    contractVersion: z.literal(MAP_CONTRACT_VERSION),
    proposalId: z.string().trim().min(1),
    nationality: nationalityRequirementSchema,
    age: ageRequirementSchema,
    location: proposalLocationPolicySchema,
  })
  .strict()

export const mapContextSchema = z
  .object({
    contractVersion: z.literal(MAP_CONTRACT_VERSION),
    cellScheme: z.literal(MAP_CELL_SCHEME),
    cellId: mapCellIdSchema,
    cellResolution: mapCellResolutionSchema,
    source: mapContributionSourceSchema,
    policyVersion: z.number().int().positive(),
    consentVersion: z.number().int().positive(),
  })
  .strict()

export const mapMarkerOptionBreakdownSchema = z
  .object({
    optionIndex: z.number().int().nonnegative(),
    count: z.number().int().min(MAP_MIN_PRIVACY_THRESHOLD_K),
    percentage: z.number().min(0).max(1),
  })
  .strict()

export const mapMarkerSchema = z
  .object({
    contractVersion: z.literal(MAP_CONTRACT_VERSION),
    proposalId: z.string().trim().min(1),
    questionIndex: z.number().int().nonnegative(),
    cellScheme: z.literal(MAP_CELL_SCHEME),
    cellId: mapCellIdSchema,
    cellResolution: mapCellResolutionSchema,
    parentCellId: mapCellIdSchema.nullable(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    totalMappedVotes: z.number().int().min(MAP_MIN_PRIVACY_THRESHOLD_K),
    optionBreakdown: z.array(mapMarkerOptionBreakdownSchema),
    breakdownSuppressed: z.boolean(),
    privacy: z
      .object({
        thresholdK: z.number().int().min(MAP_MIN_PRIVACY_THRESHOLD_K),
        policyVersion: z.number().int().positive(),
        mergedCellCount: z.number().int().positive(),
        maxMergeDepth: z.number().int().nonnegative(),
        publicationWindowSeconds: z.number().int().min(MAP_MIN_PUBLICATION_WINDOW_SECONDS),
      })
      .strict(),
  })
  .strict()
  .superRefine((marker, context) => {
    if (marker.breakdownSuppressed && marker.optionBreakdown.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Suppressed breakdowns must not expose option counts',
        path: ['optionBreakdown'],
      })
    }

    if (!marker.breakdownSuppressed && marker.optionBreakdown.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A visible breakdown must contain at least one option',
        path: ['optionBreakdown'],
      })
    }

    if (!marker.breakdownSuppressed) {
      const optionIndexes = new Set<number>()
      let visibleVoteCount = 0

      marker.optionBreakdown.forEach((entry, index) => {
        if (optionIndexes.has(entry.optionIndex)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Visible breakdowns must not contain duplicate option indexes',
            path: ['optionBreakdown', index, 'optionIndex'],
          })
        }
        optionIndexes.add(entry.optionIndex)
        visibleVoteCount += entry.count

        const expectedPercentage = entry.count / marker.totalMappedVotes
        if (Math.abs(entry.percentage - expectedPercentage) > Number.EPSILON * 10) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Option percentage must match its share of total mapped votes',
            path: ['optionBreakdown', index, 'percentage'],
          })
        }
      })

      if (visibleVoteCount !== marker.totalMappedVotes) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Visible option counts must add up to total mapped votes',
          path: ['optionBreakdown'],
        })
      }
    }
  })

export const mapMarkersQuerySchema = z
  .object({
    proposalId: z.string().trim().min(1),
    questionIndex: z.number().int().nonnegative(),
    resolution: mapCellResolutionSchema.optional(),
  })
  .strict()

export const mapMarkersResponseSchema = z.array(mapMarkerSchema)

export type MapCellResolution = (typeof MAP_ALLOWED_CELL_RESOLUTIONS)[number]
export type MapProfileLocationPreference = z.infer<typeof mapProfileLocationPreferenceSchema>
export type MapLocationSource = z.infer<typeof mapLocationSourceSchema>
export type MapContributionSource = z.infer<typeof mapContributionSourceSchema>
export type SavedHomeArea = z.infer<typeof savedHomeAreaSchema>
export type ProposalLocationPolicy = z.infer<typeof proposalLocationPolicySchema>
export type EnabledProposalLocationPolicy = Exclude<ProposalLocationPolicy, { mode: 'disabled' }>
export type NationalityRequirement = z.infer<typeof nationalityRequirementSchema>
export type AgeRequirement = z.infer<typeof ageRequirementSchema>
export type ProposalParticipationPolicy = z.infer<typeof proposalParticipationPolicySchema>
export type MapContext = z.infer<typeof mapContextSchema>
export type MapMarkerOptionBreakdown = z.infer<typeof mapMarkerOptionBreakdownSchema>
export type MapMarker = z.infer<typeof mapMarkerSchema>
export type MapMarkersQuery = z.infer<typeof mapMarkersQuerySchema>
export type MapMarkersResponse = z.infer<typeof mapMarkersResponseSchema>

export type MapContextPolicyErrorCode =
  | 'LOCATION_DISABLED'
  | 'LOCATION_REQUIRED'
  | 'INVALID_MAP_CONTEXT'
  | 'POLICY_VERSION_MISMATCH'
  | 'CONSENT_VERSION_MISMATCH'
  | 'CELL_RESOLUTION_MISMATCH'
  | 'LOCATION_SOURCE_NOT_ALLOWED'
  | 'LOCATION_CELL_NOT_ALLOWED'

export type MapContextPolicyValidationResult =
  | { ok: true; mapContext: MapContext | null }
  | { ok: false; errorCode: MapContextPolicyErrorCode }

export const validateMapContextForPolicy = (
  policy: ProposalLocationPolicy,
  input: unknown,
): MapContextPolicyValidationResult => {
  const hasMapContext = input !== undefined && input !== null

  if (policy.mode === 'disabled') {
    return hasMapContext
      ? { ok: false, errorCode: 'LOCATION_DISABLED' }
      : { ok: true, mapContext: null }
  }

  if (!hasMapContext) {
    return policy.mode === 'required'
      ? { ok: false, errorCode: 'LOCATION_REQUIRED' }
      : { ok: true, mapContext: null }
  }

  const parsed = mapContextSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, errorCode: 'INVALID_MAP_CONTEXT' }
  }

  const mapContext = parsed.data
  if (mapContext.policyVersion !== policy.policyVersion) {
    return { ok: false, errorCode: 'POLICY_VERSION_MISMATCH' }
  }
  if (mapContext.consentVersion !== policy.consentVersion) {
    return { ok: false, errorCode: 'CONSENT_VERSION_MISMATCH' }
  }
  if (mapContext.cellResolution !== policy.collectionResolution) {
    return { ok: false, errorCode: 'CELL_RESOLUTION_MISMATCH' }
  }
  if (policy.source !== 'either' && mapContext.source !== policy.source) {
    return { ok: false, errorCode: 'LOCATION_SOURCE_NOT_ALLOWED' }
  }
  if (policy.allowedCellIds.length > 0 && !policy.allowedCellIds.includes(mapContext.cellId)) {
    return { ok: false, errorCode: 'LOCATION_CELL_NOT_ALLOWED' }
  }

  return { ok: true, mapContext }
}

export const createDefaultOptionalLocationPolicy = (): EnabledProposalLocationPolicy => ({
  mode: 'optional',
  source: 'either',
  cellScheme: MAP_CELL_SCHEME,
  collectionResolution: MAP_DEFAULT_COLLECTION_RESOLUTION,
  minimumPublishedResolution: MAP_MIN_PUBLISHED_RESOLUTION,
  privacyThresholdK: MAP_DEFAULT_PRIVACY_THRESHOLD_K,
  publicationWindowSeconds: MAP_DEFAULT_PUBLICATION_WINDOW_SECONDS,
  allowedCellIds: [],
  policyVersion: MAP_PRIVACY_POLICY_VERSION,
  consentVersion: 1,
})
