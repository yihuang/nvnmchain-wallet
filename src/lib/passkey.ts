import { WebAuthnP256, Account } from 'viem/tempo'
import type { Hex } from 'ox'

/** Minimal shape of a WebAuthn P-256 credential (id + public key). */
export type P256Credential = {
  id: string
  publicKey: Hex.Hex
  raw?: unknown
}
import * as keystore from './keystore'

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

/** Derives the Tempo P-256/WebAuthn account address. */
export function deriveAddress(publicKeyHex: string): string {
  const account = Account.fromWebAuthnP256({
    id: 'derivation',
    publicKey: publicKeyHex as `0x${string}`,
  })
  return account.address
}
