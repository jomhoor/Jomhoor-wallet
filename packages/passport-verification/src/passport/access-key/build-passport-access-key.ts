import { createPassportCredentials } from '../mrz'
import type { PassportCredentialsInput } from '../types'

export const buildPassportAccessKey = (input: PassportCredentialsInput): string => {
  const credentials = createPassportCredentials(input)
  return credentials.mrzKey
}
