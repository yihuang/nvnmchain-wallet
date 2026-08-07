import { P256, Hex, PublicKey, Address } from 'ox'

const sigHex = '3046022100a622938951639493413586eb5392c8d96b5c9f7f5c58efe89f6e462f90627eee022100c6d9ec39ad29ae5bd1069a38726e072adecc24f56380e088542b61fc349c6853'
const msgHash = '0x52f23b1c99f81827711311102e588911bbd0145c284dcb511f742292af223a1b'
const expectedPub = '0x1b2386d0a780f7a08e6086935beb533ee918a792e8f9347d4556509dd1db856447f20811ec2874c5dda6709973427afc3118d61434931bc7557f61019d2d87e4'

const b = Uint8Array.from(Buffer.from(sigHex, 'hex'))
let off = 2
const rLen = b[off + 1]
let r = b.slice(off + 2, off + 2 + rLen)
off += 2 + rLen
const sLen = b[off + 1]
let s = b.slice(off + 2, off + 2 + sLen)
const strip = (x) => { let i = 0; while (i < x.length - 1 && x[i] === 0) i++; return x.slice(i) }
r = strip(r); s = strip(s)
console.log('r bytes:', r.length, '| s bytes:', s.length)

for (const yParity of [0, 1]) {
  try {
    const pk = P256.recoverPublicKey({ payload: msgHash, signature: { r: Hex.fromBytes(r), s: Hex.fromBytes(s), yParity } })
    const pkHex = PublicKey.toHex(pk, { includePrefix: false })
    const ok = P256.verify({ payload: msgHash, publicKey: pk, signature: { r: Hex.fromBytes(r), s: Hex.fromBytes(s) } })
    console.log(`yParity=${yParity} verify=${ok} match=${pkHex === expectedPub}`)
  } catch (e) {
    console.log(`yParity=${yParity} error:`, String(e).slice(0, 100))
  }
}
