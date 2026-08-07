/**
 * Probe script — validates that the NVNM canary chain accepts Tempo type-0x76
 * transactions signed with a WebAuthn (passkey) signature envelope.
 *
 * There is no public faucet on this canary, so a zero-balance sender is
 * rejected with a *fee/balance* error. If the node accepts the transaction
 * format (signature, RLP, nonce, fee token), the error will NOT be about the
 * signature or RLP encoding — proving the wallet's signing pipeline is correct.
 *
 * Run: `npm run probe`
 */
import { createClient, http, defineChain } from 'viem'
import { tempo } from 'viem/tempo/chains'
import { TxEnvelopeTempo, SignatureEnvelope } from 'ox/tempo'
import { WebAuthnP256, P256, Bytes, Hex, Address } from 'ox'
import { createHash } from 'node:crypto'

const sha256 = (input) => createHash('sha256').update(input).digest()

const RPC = 'https://rpc.nvnm.canary.mantrachain.dev'
const CHAIN_ID = 787222
const PATHUSD = '0x20c0000000000000000000000000000000000000'
const ORIGIN = 'http://localhost:5173' // must match the wallet's origin

// ---------------------------------------------------------------------------
// 1. Chain definition (same as src/chain.ts)
// ---------------------------------------------------------------------------
const nvnmchain = defineChain({
  ...tempo, // carries the Tempo chainConfig (serializers, formatters, fee hooks)
  id: CHAIN_ID,
  name: 'NVNM Canary',
  nativeCurrency: { name: 'USD', symbol: 'USD', decimals: 6 },
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: {
    default: {
      name: 'Blockscout',
      url: 'https://blockscout.nvnm.canary.mantrachain.dev',
    },
  },
})

const client = createClient({
  chain: nvnmchain.extend({ feeToken: PATHUSD }),
  transport: http(RPC),
})

// ---------------------------------------------------------------------------
// 2. Generate a P-256 key (simulates the passkey's private key)
// ---------------------------------------------------------------------------
const keyPair = await P256.createKeyPair()
const address = Address.fromPublicKey(keyPair.publicKey, { prefix: 0 }) // keccak256(x||y) last 20 bytes

console.log('--- Account ---')
console.log('address:  ', address)

// ---------------------------------------------------------------------------
// 3. Build the transaction envelope (transfer 0.01 pathUSD back to self)
// ---------------------------------------------------------------------------
const transferData = Bytes.concat(
  Bytes.fromHex('0xa9059cbb'), // transfer(address,uint256)
  Bytes.fromHex(Hex.padLeft(address, 32)),
  Bytes.fromNumber(10000n, { size: 32 }),
)

const nonceRpc = await client.request({
  method: 'eth_getTransactionCount',
  params: [address, 'latest'],
})
const nonce = Number(nonceRpc)
const baseFee = BigInt(await client.request({ method: 'eth_gasPrice', params: [] }))

const envelope = TxEnvelopeTempo.from({
  chainId: CHAIN_ID,
  calls: [{ to: PATHUSD, data: Hex.fromBytes(transferData), value: 0n }],
  nonce: BigInt(nonce),
  nonceKey: 0n,
  gas: 600_000n,
  maxFeePerGas: baseFee * 2n,
  maxPriorityFeePerGas: 0n,
  feeToken: PATHUSD,
})

// ---------------------------------------------------------------------------
// 4. WebAuthn-style signature over the sign payload
// ---------------------------------------------------------------------------
const payload = TxEnvelopeTempo.getSignPayload(envelope)
console.log('\n--- Sign payload (challenge) ---')
console.log('payload:', payload)

const clientDataJSON = WebAuthnP256.getClientDataJSON({
  challenge: payload,
  origin: ORIGIN,
})
const authenticatorData = WebAuthnP256.getAuthenticatorData({
  rpId: new URL(ORIGIN).hostname,
  signCount: 0,
})

const messageHash = sha256(
  Bytes.concat(Bytes.fromHex(authenticatorData), sha256(Bytes.fromString(clientDataJSON))),
)
const signature = await P256.sign({ payload: messageHash, privateKey: keyPair.privateKey })

// Local self-check: the signature verifies over the recomputed message hash
const ok = P256.verify({ payload: messageHash, publicKey: keyPair.publicKey, signature })
console.log('\nLocal WebAuthn sig self-verify:', ok ? 'PASS ✔' : 'FAIL ✘')
if (!ok) process.exit(1)

const envelopeSigned = TxEnvelopeTempo.serialize(envelope, {
  signature: SignatureEnvelope.serialize({
    type: 'webAuthn',
    publicKey: keyPair.publicKey,
    signature,
    metadata: { authenticatorData, clientDataJSON },
  }),
})

console.log('\n--- Serialized type-0x76 tx ---')
console.log('len:', envelopeSigned.length / 2 - 1, 'bytes, prefix:', envelopeSigned.slice(0, 4))

// Round-trip check: deserialize what we just serialized and verify the signature
const rt = TxEnvelopeTempo.deserialize(envelopeSigned)
const rtSig = SignatureEnvelope.from(rt.signature)
const rtMessageHash = sha256(
  Bytes.concat(
    Bytes.fromHex(rtSig.metadata.authenticatorData),
    sha256(Bytes.fromString(rtSig.metadata.clientDataJSON)),
  ),
)
const rtOk = P256.verify({
  payload: rtMessageHash,
  publicKey: { prefix: 4, x: rtSig.publicKey.x, y: rtSig.publicKey.y },
  signature: { r: rtSig.signature.r, s: rtSig.signature.s },
})
console.log('round-trip verify:', rtOk ? 'PASS ✔' : 'FAIL ✘')
if (!rtOk) process.exit(1)

// ---------------------------------------------------------------------------
// 5. Broadcast
// ---------------------------------------------------------------------------
console.log('\n--- eth_sendRawTransaction ---')
try {
  const hash = await client.request({
    method: 'eth_sendRawTransaction',
    params: [envelopeSigned],
  })
  console.log('SUCCESS! tx:', hash)
} catch (err) {
  const message = err?.shortMessage ?? err?.message ?? String(err)
  const details = err?.details ?? err?.cause?.details ?? ''
  console.log('Rejected:', message)
  if (details) console.log('details:', details)
  if (/insufficient|fee|balance|funds/i.test(message + details)) {
    console.log('\n✔ Transaction FORMAT accepted (rejected only for funds).')
    console.log('  The WebAuthn signature pipeline is correct.')
    process.exit(0)
  }
  console.log('\n✘ Rejection does not look like a funds issue — inspect above.')
  console.log('raw error:', JSON.stringify(err?.cause ?? err, null, 2).slice(0, 1200))
  process.exit(1)
}
