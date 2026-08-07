import { P256, Hex, PublicKey, Signature } from 'ox'

const msgHash = '0x52f23b1c99f81827711311102e588911bbd0145c284dcb511f742292af223a1b'
const r = Hex.fromBytes(Uint8Array.from(Buffer.from('a622938951639493413586eb5392c8d96b5c9f7f5c58efe89f6e462f90627eee0', 'hex')))
const s = Hex.fromBytes(Uint8Array.from(Buffer.from('c6d9ec39ad29ae5bd1069a38726e072adecc24f56380e088542b61fc349c6853', 'hex')))
const expectedPub = '0x1b2386d0a780f7a08e6086935beb533ee918a792e8f9347d4556509dd1db856447f20811ec2874c5dda6709973427afc3118d61434931bc7557f61019d2d87e4'

const pk = P256.recoverPublicKey({ payload: msgHash, signature: { r, s, yParity: 0 } })
const pkHex = PublicKey.toHex(pk, { includePrefix: false })
console.log('recovered matches:', pkHex === expectedPub)

// try different verify signature forms
const forms = {
  'hex r/s': { r, s },
  'hex r/s + yParity 0': { r, s, yParity: 0 },
  'bigint r/s': { r: BigInt(r), s: BigInt(s) },
  'bigint + yParity': { r: BigInt(r), s: BigInt(s), yParity: 0 },
}
for (const [name, sig] of Object.entries(forms)) {
  try {
    const ok = P256.verify({ payload: msgHash, publicKey: pk, signature: sig })
    console.log(`verify (${name}):`, ok)
  } catch (e) {
    console.log(`verify (${name}) threw:`, String(e).slice(0, 80))
  }
}
