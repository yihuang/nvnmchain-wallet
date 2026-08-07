import { P256, Hex, PublicKey } from 'ox'

const msgHash = Uint8Array.from(Buffer.from('52f23b1c99f81827711311102e588911bbd0145c284dcb511f742292af223a1b', 'hex'))
const rBytes = Uint8Array.from(Buffer.from('a622938951639493413586eb5392c8d96b5c9f7f5c58efe89f6e462f90627eee0', 'hex'))
const sBytes = Uint8Array.from(Buffer.from('c6d9ec39ad29ae5bd1069a38726e072adecc24f56380e088542b61fc349c6853', 'hex'))
const expectedPub = '0x1b2386d0a780f7a08e6086935beb533ee918a792e8f9347d4556509dd1db856447f20811ec2874c5dda6709973427afc3118d61434931bc7557f61019d2d87e4'
const r = Hex.fromBytes(rBytes)
const s = Hex.fromBytes(sBytes)
const compact = new Uint8Array(64)
compact.set(rBytes, 0); compact.set(sBytes, 32)

console.log('s high?', sBytes[0] > 0x7f)

for (const yParity of [0, 1]) {
  const pk = P256.recoverPublicKey({ payload: msgHash, signature: { r, s, yParity } })
  const pkBytes = PublicKey.toBytes(pk)
  const ok = P256.noble.verify(compact, msgHash, pkBytes, { lowS: false, prehash: false })
  const pkHex = PublicKey.toHex(pk, { includePrefix: false })
  console.log(`yParity=${yParity}: noble.verify=${ok} match=${pkHex === expectedPub}`)
}
