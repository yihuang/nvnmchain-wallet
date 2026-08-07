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
}

/**
 * Creates a brand-new passkey on the device ("Register").
 * The derived EVM address is keccak256(publicKeyX || publicKeyY) truncated
 * to the last 20 bytes — the same derivation the chain uses for P-256 and
 * WebAuthn accounts.
 */
export async function registerPasskey(label: string): Promise<WalletAccount> {
  const rpId = window.location.hostname
  const credential = await WebAuthnP256.createCredential({
    label,
    rpId,
    // requireResidentKey + userVerification are set by the SDK already;
    // keep the default authenticator selection (platform authenticator).
  })

  keystore.saveCredential({
    id: credential.id,
    publicKey: credential.publicKey,
    rpId,
    label,
    createdAt: Date.now(),
  })

  return { address: deriveAddress(credential.publicKey), credential, rpId, label }
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
