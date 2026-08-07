/**
 * Persists passkey credential metadata in localStorage.
 *
 * A WebAuthn credential's private key never leaves the authenticator
 * (phone/security-key/browser), but the public key is NOT recoverable
 * from the credential afterwards — so we store it alongside the
 * credential id. The wallet address is derived from this public key.
 */

export type StoredCredential = {
  id: string
  publicKey: string // 0x-prefixed hex, 64-byte uncompressed (x||y)
  rpId: string
  label: string
  createdAt: number
}

const KEY = 'nvnmchain:credentials:v1'
const LAST = 'nvnmchain:lastCredential'

export function listCredentials(): StoredCredential[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveCredential(cred: StoredCredential): void {
  const all = listCredentials().filter((c) => c.id !== cred.id)
  all.push(cred)
  localStorage.setItem(KEY, JSON.stringify(all))
  localStorage.setItem(LAST, cred.id)
}

export function removeCredential(id: string): void {
  const all = listCredentials().filter((c) => c.id !== id)
  localStorage.setItem(KEY, JSON.stringify(all))
}

export function getLastCredentialId(): string | null {
  return localStorage.getItem(LAST)
}

export function getCredentialById(id: string): StoredCredential | null {
  return listCredentials().find((c) => c.id === id) ?? null
}

export function clearCredentials(): void {
  localStorage.removeItem(KEY)
  localStorage.removeItem(LAST)
}
