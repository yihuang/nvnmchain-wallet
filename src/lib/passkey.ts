import { WebAuthnP256, Account } from 'viem/tempo'
import { P256, PublicKey, Hex, Address } from 'ox'
import type { Hex as OxHex } from 'ox'

/** Minimal shape of a WebAuthn P-256 credential (id + public key). */
export type P256Credential = {
  id: string
  publicKey: Hex.Hex
  raw?: unknown
}
import * as keystore from './keystore'
import { getPathUsdBalance, publicClient } from './client'

export type WalletAccount = {
  address: string
  credential: P256Credential
  rpId: string
  label: string
  email: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Normalizes an email address for use as the account name:
 * trims surrounding whitespace and lowercases the whole address
 * (the standard, practical normalization for email identity).
 */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase()
}

export function isValidEmail(input: string): boolean {
  return EMAIL_RE.test(normalizeEmail(input))
}

/**
 * Creates a brand-new passkey on the device ("Register").
 * The derived EVM address is keccak256(publicKeyX || publicKeyY) truncated
 * to the last 20 bytes — the same derivation the chain uses for P-256 and
 * WebAuthn accounts. The normalized email becomes the account name.
 */
export async function registerPasskey(email: string): Promise<WalletAccount> {
  const normalized = normalizeEmail(email)
  const rpId = window.location.hostname
  const credential = await WebAuthnP256.createCredential({
    label: normalized,
    rpId,
    // requireResidentKey + userVerification are set by the SDK already;
    // keep the default authenticator selection (platform authenticator).
  })

  keystore.saveCredential({
    id: credential.id,
    publicKey: credential.publicKey,
    rpId,
    label: normalized,
    email: normalized,
    source: 'created',
    createdAt: Date.now(),
  })

  return {
    address: deriveAddress(credential.publicKey),
    credential,
    rpId,
    label: normalized,
    email: normalized,
  }
}

/**
 * Signs a challenge with an existing passkey ("Login").
 * The credential is found by id; its public key is loaded from the keystore
 * (it cannot be extracted from the authenticator).
 */
export async function loginPasskey(
  credentialId: string,
): Promise<WalletAccount> {
  const stored = keystore.getCredentialById(credentialId)
  if (!stored) throw new Error('Credential not found in keystore')

  const credential = await WebAuthnP256.getCredential({
    credentialId,
    rpId: stored.rpId,
    hash: `0x${'00'.repeat(32)}`, // auth-only login challenge
    async getPublicKey() {
      return stored.publicKey as `0x${string}`
    },
  })

  return {
    address: deriveAddress(credential.publicKey),
    credential: {
      id: credential.id,
      publicKey: credential.publicKey,
      raw: credential.raw,
    },
    rpId: stored.rpId,
    label: stored.label,
    email: stored.email ?? stored.label,
  }
}

/**
 * Signs in with ANY passkey available on this device (including passkeys
 * synced from other devices via iCloud Keychain / Google Password Manager).
 *
 * Works with zero local data. A WebAuthn assertion does not reveal the
 * credential's public key directly — ECDSA recovery from a signature yields
 * TWO candidate keys that both validate, so the true key is identified by
 * intersecting candidates from a second assertion (the real key appears in
 * every assertion, the decoy candidate differs each time). If exactly one
 * candidate already has on-chain state (balance/nonce/code), a single
 * assertion suffices. The result is persisted locally for one-tap logins.
 */
export async function loginWithDiscoverablePasskey(): Promise<WalletAccount> {
  const rpId = window.location.hostname

  // Prefer locally-known credentials for this RP first: an allowCredentials
  // request prompts the platform authenticator directly (Touch ID) instead of
  // offering the cross-device QR flow. Only fall through when the credential
  // is no longer available in this browser (e.g. a new browser profile).
  const local = keystore.listCredentials().filter((c) => c.rpId === rpId)
  for (const c of local) {
    try {
      return await loginPasskey(c.id)
    } catch {
      // credential not in this browser's authenticator → keep going
    }
  }

  const first = await getAssertionCandidates(rpId)
  let publicKeyHex: OxHex.Hex | null = await disambiguateByOnChainState(
    first.candidates,
  )
  if (!publicKeyHex) {
    // Ambiguous → confirm with a second assertion and take the intersection
    const second = await getAssertionCandidates(rpId)
    publicKeyHex =
      (first.candidates.find((k) =>
        second.candidates.includes(k),
      ) as OxHex.Hex | undefined) ?? null
    if (!publicKeyHex) {
      throw new Error(
        'Could not identify the passkey from the assertions — please try again.',
      )
    }
  }

  const label = first.userHandle || `passkey-${first.id.slice(0, 8)}`
  const address = deriveAddress(publicKeyHex)

  keystore.saveCredential({
    id: first.id,
    publicKey: publicKeyHex,
    rpId,
    label,
    email: first.userHandle ?? '',
    source: 'recovered',
    createdAt: Date.now(),
  })

  return {
    address,
    credential: {
      id: first.id,
      publicKey: publicKeyHex,
      raw: first.credential,
    },
    rpId,
    label,
    email: first.userHandle ?? '',
  }
}

type AssertionCandidates = {
  id: string
  credential: PublicKeyCredential
  candidates: string[] // two candidate public keys (hex x||y)
  userHandle: string | null
}

async function getAssertionCandidates(
  rpId: string,
): Promise<AssertionCandidates> {
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId,
      userVerification: 'required',
      timeout: 60_000,
      // No allowCredentials → discoverable (resident) passkeys only,
      // browser shows a picker with the synced passkeys.
    },
  })) as PublicKeyCredential | null
  if (!assertion) throw new Error('Passkey prompt was cancelled.')

  const response = assertion.response as AuthenticatorAssertionResponse
  const authData = new Uint8Array(response.authenticatorData)
  const sigBytes = new Uint8Array(response.signature)
  const { r, s } = parseAssertionSignature(sigBytes)

  // messageHash = sha256(authenticatorData || sha256(clientDataJSON))
  const clientHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', response.clientDataJSON),
  )
  const messageHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', concatBytes(authData, clientHash).buffer as ArrayBuffer),
  )

  const candidates = [0, 1].map((yParity) =>
    PublicKey.toHex(
      P256.recoverPublicKey({
        payload: messageHash,
        signature: { r, s, yParity },
      }),
      { includePrefix: false },
    ),
  )

  return {
    id: assertion.id,
    credential: assertion,
    candidates,
    userHandle: response.userHandle
      ? new TextDecoder().decode(response.userHandle)
      : null,
  }
}

/**
 * If exactly one recovered candidate has any on-chain footprint, it's the
 * real account — no second assertion needed. Returns null when ambiguous
 * (e.g. a brand-new account with no activity yet).
 */
async function disambiguateByOnChainState(
  candidates: string[],
): Promise<OxHex.Hex | null> {
  const states = await Promise.all(
    candidates.map(async (pk) => {
      const address = deriveAddress(pk)
      try {
        const balance = await getPathUsdBalance(address)
        const nonce = await publicClient.getTransactionCount({ address })
        const code = await publicClient.getCode({ address })
        return balance > 0n || nonce > 0 || code !== '0x'
      } catch {
        return false
      }
    }),
  )
  const matches = candidates.filter((_, i) => states[i])
  return matches.length === 1
    ? (matches[0] as OxHex.Hex)
    : null
}

function parseAssertionSignature(
  bytes: Uint8Array,
): { r: OxHex.Hex; s: OxHex.Hex } {
  let r: Uint8Array
  let s: Uint8Array
  if (bytes.length === 64) {
    // Raw r || s (ES256, most platform authenticators)
    r = bytes.slice(0, 32)
    s = bytes.slice(32)
  } else if (bytes.length >= 68 && bytes.length <= 74 && bytes[0] === 0x30) {
    // DER-encoded ECDSA signature (some authenticators / the Chrome
    // virtual authenticator): 30 <len> 02 <rlen> <r> 02 <slen> <s>
    ;({ r, s } = parseDerSignature(bytes))
  } else {
    throw new Error(`Unexpected assertion signature format (${bytes.length} bytes).`)
  }
  return {
    r: Hex.padLeft(Hex.fromBytes(r), 32),
    s: Hex.padLeft(Hex.fromBytes(s), 32),
  }
}

function parseDerSignature(bytes: Uint8Array): {
  r: Uint8Array
  s: Uint8Array
} {
  let offset = 2 // skip 0x30 <total length>
  if (bytes[offset] !== 0x02) throw new Error('Invalid DER signature (r tag).')
  const rLen = bytes[offset + 1]
  let r: Uint8Array = bytes.slice(offset + 2, offset + 2 + rLen)
  offset += 2 + rLen
  if (bytes[offset] !== 0x02) throw new Error('Invalid DER signature (s tag).')
  const sLen = bytes[offset + 1]
  let s: Uint8Array = bytes.slice(offset + 2, offset + 2 + sLen)
  // DER integers carry a 0x00 prefix when the high bit is set — strip it
  r = stripLeadingZero(r)
  s = stripLeadingZero(s)
  return { r, s }
}

function stripLeadingZero(bytes: Uint8Array): Uint8Array {
  let start = 0
  while (start < bytes.length - 1 && bytes[start] === 0) start++
  return bytes.slice(start) as Uint8Array
}

/**
 * ECDSA public-key recovery: a signature (r, s) over a message yields two
 * candidate public keys (one per possible R-point parity). Both candidates
 * pass signature verification, so the caller must disambiguate (on-chain
 * state, or intersecting candidates from a second assertion).
 */

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

/** Derives the Tempo P-256/WebAuthn account address. */
export function deriveAddress(publicKeyHex: string): Address.Address {
  const account = Account.fromWebAuthnP256({
    id: 'derivation',
    publicKey: publicKeyHex as `0x${string}`,
  })
  return account.address
}
