import { http } from 'viem'
import { createClient, Account, Addresses } from 'viem/tempo'
import { nvnmchain, PATHUSD, RPC_URL } from '../chain'
import type { StoredCredential } from './keystore'

/**
 * Shared Tempo client for public reads (no account).
 */
export const publicClient = createClient({
  chain: nvnmchain.extend({ feeToken: PATHUSD }),
  transport: http(nvnmchain.rpcUrls.default.http[0]),
})

/**
 * Wallet client bound to a passkey-backed WebAuthn account.
 * Transactions sent through this client are serialized as Tempo
 * Transactions (EIP-2718 type 0x76) signed with the passkey.
 */
export function walletClientFor(credential: StoredCredential) {
  const account = Account.fromWebAuthnP256({
    id: credential.id,
    publicKey: credential.publicKey as `0x${string}`,
  })
  return createClient({
    account,
    chain: nvnmchain.extend({ feeToken: PATHUSD }),
    transport: http(nvnmchain.rpcUrls.default.http[0]),
  })
}

const pathUsdAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ type: 'address', name: 'account' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

export async function getPathUsdBalance(address: string): Promise<bigint> {
  return publicClient.readContract({
    address: PATHUSD,
    abi: pathUsdAbi,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
  })
}

/**
 * Estimates the gas and pathUSD fee for a transfer.
 *
 * Gas is measured with `tempo_simulateV1`, which returns `gasUsed` even when
 * the transfer reverts (e.g. the sender has no pathUSD balance yet) — so this
 * works before the account is funded. The fee reserve is deterministic:
 * the node pre-charges `gasLimit × maxFeePerGas`, refunding unused gas.
 */
export type FeeEstimate = {
  /** Gas limit to set on the tx (simulated gas + buffer). */
  gasLimit: bigint
  /** Fee cap we commit to on-chain. */
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  /** Reserve needed on top of the send amount, in pathUSD base units. */
  fee: bigint
}

const FALLBACK_GAS = 300_000n
const GAS_BUFFER = 30_000n
const GAS_PRICE_MULTIPLIER = 2n

export async function estimateTransferFee(
  from: string,
  to: string,
): Promise<FeeEstimate> {
  let gasPrice: bigint
  try {
    gasPrice = await publicClient.getGasPrice()
  } catch {
    gasPrice = 600_000_000n
  }
  const maxFeePerGas = gasPrice * GAS_PRICE_MULTIPLIER
  const gasUsed = await simulateTransferGas(from, to)
  const gasLimit = gasUsed + GAS_BUFFER
  // pathUSD has 6 decimals; gas price is quoted in wei (1e18) → /1e12
  const fee = (gasLimit * maxFeePerGas) / 10n ** 12n
  return { gasLimit, maxFeePerGas, maxPriorityFeePerGas: 0n, fee }
}

async function simulateTransferGas(from: string, to: string): Promise<bigint> {
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tempo_simulateV1',
        params: [
          {
            blockStateCalls: [
              {
                blockOverrides: {},
                calls: [
                  {
                    from,
                    to: PATHUSD,
                    data: encodeTransfer(to, 1n),
                    value: '0x0',
                  },
                ],
              },
            ],
          },
          'latest',
        ],
      }),
    })
    const json = await res.json()
    const gasUsed = json?.result?.blocks?.[0]?.calls?.[0]?.gasUsed
    const g = gasUsed ? BigInt(gasUsed) : 0n
    return g > 0n ? g : FALLBACK_GAS
  } catch {
    return FALLBACK_GAS
  }
}

/**
 * Sends a pathUSD transfer in a Tempo Transaction signed by the passkey.
 * Fees are paid in pathUSD (the chain's fee token).
 *
 * @returns hash plus final on-chain status: 'ok' | 'reverted' | 'timeout'
 */
export async function sendPathUsd(
  credential: StoredCredential,
  to: string,
  amount: bigint,
  fee: FeeEstimate,
  onSubmitted?: (hash: string) => void,
): Promise<{ hash: string; status: 'ok' | 'reverted' | 'timeout' }> {
  const client = walletClientFor(credential)
  const hash = await client.sendTransaction({
    to: PATHUSD,
    data: encodeTransfer(to, amount),
    value: 0n,
    feeToken: PATHUSD,
    gas: fee.gasLimit,
    maxFeePerGas: fee.maxFeePerGas,
    maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
  })
  onSubmitted?.(hash)
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 60_000,
    })
    return {
      hash,
      status: receipt.status === 'success' ? 'ok' : 'reverted',
    }
  } catch {
    return { hash, status: 'timeout' }
  }
}

export function encodeTransfer(to: string, amount: bigint): `0x${string}` {
  const fn = 'a9059cbb' // transfer(address,uint256)
  const toPart = to.slice(2).toLowerCase().padStart(64, '0')
  const amountPart = amount.toString(16).padStart(64, '0')
  return `0x${fn}${toPart}${amountPart}`
}

// ---------------------------------------------------------------------------
// Transaction history via Blockscout API
// ---------------------------------------------------------------------------
export type HistoryItem = {
  hash: string
  from: string
  to: string
  status: 'ok' | 'error' | 'pending'
  timestamp: string
  fee?: string
}

export async function getHistory(
  address: string,
  limit = 20,
): Promise<HistoryItem[]> {
  const url = `${nvnmchain.blockExplorers!.default.url}/api/v2/addresses/${address}/transactions?filter=to%20%7C%20from`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()
  const items: any[] = data?.items ?? []
  return items.slice(0, limit).map((t) => ({
    hash: t.hash,
    from: t.from?.hash ?? '',
    to: t.to?.hash ?? '',
    status: t.status === 'ok' ? 'ok' : t.status === 'error' ? 'error' : 'pending',
    timestamp: t.timestamp,
    fee: t.fee?.value,
  }))
}

/** Attempts the Tempo faucet RPC (not enabled on this canary). */
export async function tryFaucet(address: string): Promise<string | null> {
  try {
    const res = await fetch(nvnmchain.rpcUrls.default.http[0], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tempo_fundAddress',
        params: [address],
      }),
    })
    const json = await res.json()
    if (json?.result) return json.result
    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// AccountKeychain precompile — access keys
// ---------------------------------------------------------------------------
const keychainAbi = [
  {
    type: 'function',
    name: 'getKey',
    stateMutability: 'view',
    inputs: [
      { type: 'address', name: 'account' },
      { type: 'address', name: 'keyId' },
    ],
    outputs: [
      {
        type: 'tuple',
        components: [
          { type: 'uint8', name: 'signatureType' },
          { type: 'address', name: 'keyId' },
          { type: 'uint64', name: 'expiry' },
          { type: 'bool', name: 'enforceLimits' },
          { type: 'bool', name: 'isRevoked' },
        ],
        name: 'keyInfo',
      },
    ],
  },
  {
    type: 'function',
    name: 'isAdminKey',
    stateMutability: 'view',
    inputs: [
      { type: 'address', name: 'account' },
      { type: 'address', name: 'keyId' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const

export const ACCOUNT_KEYCHAIN = Addresses.accountKeychain

export async function getKeyInfo(
  account: string,
  keyId: string,
): Promise<{
  signatureType: number
  expiry: bigint
  enforceLimits: boolean
  isRevoked: boolean
} | null> {
  try {
    const [info, isAdmin] = await publicClient.multicall({
      contracts: [
        {
          address: ACCOUNT_KEYCHAIN,
          abi: keychainAbi,
          functionName: 'getKey',
          args: [account as `0x${string}`, keyId as `0x${string}`],
        },
        {
          address: ACCOUNT_KEYCHAIN,
          abi: keychainAbi,
          functionName: 'isAdminKey',
          args: [account as `0x${string}`, keyId as `0x${string}`],
        },
      ],
    })
    if (info.status !== 'success' || info.result === undefined) return null
    const k = info.result
    return {
      signatureType: Number(k.signatureType),
      expiry: k.expiry,
      enforceLimits: k.enforceLimits,
      isRevoked: k.isRevoked,
      ...(isAdmin.status === 'success' ? { isAdmin: isAdmin.result } : {}),
    }
  } catch {
    return null
  }
}
