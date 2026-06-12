import type { Provider, Signer } from 'ethers'

import {
  BioPassportVoting__factory,
  NoirIdVoting__factory,
  PoseidonSMT__factory,
  ProposalState__factory,
  Registration__factory,
  StateKeeper__factory,
} from '@/types/contracts'

type AbstractFactoryClass = {
  connect: (address: string, signerOrProvider: Signer | Provider) => unknown
  createInterface: () => unknown
}

type AbstractFactoryClassReturnType<F extends AbstractFactoryClass> = {
  contractInstance: ReturnType<F['connect']>
  contractInterface: ReturnType<F['createInterface']>
}

type RawProvider = Provider | Signer

const createContract = <F extends AbstractFactoryClass>(
  address: string,
  rawProvider: RawProvider,
  factoryClass: F,
): AbstractFactoryClassReturnType<F> => {
  const contractInstance = factoryClass.connect(address, rawProvider) as ReturnType<F['connect']>

  const contractInterface = factoryClass.createInterface() as ReturnType<F['createInterface']>

  return {
    contractInstance,
    contractInterface,
  }
}

export const createPoseidonSMTContract = (address: string, provider: RawProvider) => {
  const { contractInstance, contractInterface } = createContract(
    address,
    provider,
    PoseidonSMT__factory,
  )

  return {
    contractInstance,
    contractInterface,
  }
}

export const createStateKeeperContract = (address: string, rawProvider: RawProvider) => {
  const { contractInstance, contractInterface } = createContract(
    address,
    rawProvider,
    StateKeeper__factory,
  )

  return {
    contractInstance,
    contractInterface,
  }
}

export const createRegistrationContract = (address: string, rawProvider: RawProvider) => {
  const { contractInstance, contractInterface } = createContract(
    address,
    rawProvider,
    Registration__factory,
  )

  return {
    contractInstance,
    contractInterface,
  }
}

export const createProposalContract = (address: string, rawProvider: RawProvider) => {
  const { contractInstance, contractInterface } = createContract(
    address,
    rawProvider,
    ProposalState__factory,
  )

  return {
    contractInstance,
    contractInterface,
  }
}

export const createNoirIdVotingContract = (address: string, rawProvider: RawProvider) => {
  const { contractInstance, contractInterface } = createContract(
    address,
    rawProvider,
    NoirIdVoting__factory,
  )

  return {
    contractInstance,
    contractInterface,
  }
}

export const createBioPassportVotingContract = (address: string, rawProvider: RawProvider) => {
  const { contractInstance, contractInterface } = createContract(
    address,
    rawProvider,
    BioPassportVoting__factory,
  )

  return {
    contractInstance,
    contractInterface,
  }
}
