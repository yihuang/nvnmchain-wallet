import { P256, Hex, Address, PublicKey } from 'ox'

const msgHash = '0x52f23b1c99f81827711311102e588911bbd0145c284dcb511f742292af223a1b'
const r = '0xa622938951639493413586eb5392c8d96b5c9f7f5c58efe89f6e462f90627eee0'
const s = '0xc6d9ec39ad29ae5bd1069a38726e072adecc24f56380e088542b61fc349c6853'
const expectedPub = '0x1b2386d0a780f7a08e6086935beb533ee918a792e8f9347d4556509dd1db856447f20811ec2874c5dda6709973427afc3118d61434931bc7557f61019d2d87e4'

for (const yParity of [0, 1]) {
  try {
    const pk = P256.recoverPublicKey({ payload: msgHash, signature: { r, s, yParity } })
    const pkHex = PublicKey.toHex(pk, { includePrefix: false })
    const verify = P256.verify({ payload: msgHash, publicKey: pk, signature: { r, s } })
    console.log(`yParity=${yParity}: verify=${verify}`)
    console.log('  recovered:', pkHex)
    console.log('  expected :', expectedPub)
    console.log('  match:', pkHex === expectedPub)
  } catch (e) {
    console.log(`yParity=${yParity}: error`, String(e).slice(0, 120))
  }
}
