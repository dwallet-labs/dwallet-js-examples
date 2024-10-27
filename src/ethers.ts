import {
  DWalletClient,
  SuiHTTPTransport,
} from '@dwallet-network/dwallet.js/client'
import { Ed25519Keypair } from '@dwallet-network/dwallet.js/keypairs/ed25519'
import { requestSuiFromFaucetV0 as requestDwltFromFaucetV0 } from '@dwallet-network/dwallet.js/faucet'
import { ethers } from 'ethers'
import * as elliptic from 'elliptic'

import {
  createDWallet,
  getOrCreateEncryptionKey,
  storeEncryptionKey,
  setActiveEncryptionKey,
  EncryptionKeyScheme,
  createActiveEncryptionKeysTable,
  createPartialUserSignedMessages,
  approveAndSign,
} from '@dwallet-network/dwallet.js/signature-mpc'

import { recovery_id_keccak256 as recoveryIdKeccak256 } from '@dwallet-network/signature-mpc-wasm'

async function run() {
  // Create a new DWalletClient object pointing to the network you want to use.
  const client = new DWalletClient({
    transport: new SuiHTTPTransport({
      // url: 'http://fullnode.alpha.devnet.dwallet.cloud:9000',
      url: 'https://fullnode.alpha.testnet.dwallet.cloud',
      WebSocketConstructor: WebSocket as never,
    }),
  })
  const keypair = new Ed25519Keypair()

  // Get tokens from the Testnet faucet server.
  await requestDwltFromFaucetV0({
    // Connect to Testnet
    host: 'https://faucet.alpha.testnet.dwallet.cloud/gas',
    recipient: keypair.toSuiAddress(),
  })

  const encryptionKeysTable = await createActiveEncryptionKeysTable(
    client,
    keypair,
  )
  let activeEncryptionKeysTableID = encryptionKeysTable.objectId
  let encryptionKeyObj = await getOrCreateEncryptionKey(
    keypair,
    client,
    activeEncryptionKeysTableID,
  )

  const pubKeyRef = await storeEncryptionKey(
    encryptionKeyObj.encryptionKey,
    EncryptionKeyScheme.Paillier,
    keypair,
    client,
  )
  await setActiveEncryptionKey(
    client,
    keypair,
    pubKeyRef?.objectId!,
    activeEncryptionKeysTableID,
  )
  const dkg = await createDWallet(
    keypair,
    client,
    encryptionKeyObj.encryptionKey,
    encryptionKeyObj.objectID,
  )

  let { dwalletID } = dkg!

  // Get the dWallet object.
  const dwallet = await client.getObject({
    id: dwalletID,
    options: { showContent: true },
  })
  if (dwallet?.data?.content?.dataType == 'moveObject') {
    // Get the public key.

    const pubKeyHex = Buffer.from(
      // @ts-ignore
      dwallet?.data?.content?.fields['public_key'],
    ).toString('hex')

    // The public key is in its compressed form, so we uncompress it, as the
    // address is derived from the uncompressed public key.
    const ec = new elliptic.ec('secp256k1')
    const publicKeyUncompressed = ec
      .keyFromPublic(pubKeyHex, 'hex')
      .getPublic(false, 'hex')

    let pubkey = Buffer.from(publicKeyUncompressed, 'hex')

    // Here we are doing keccak256 hashing of our ECDSA public key.
    const ethereumAddress = ethers.getAddress(
      ethers.keccak256(pubkey).slice(-40),
    )

    console.log('dWallet Ethereum address is', ethereumAddress)
  }

  const provider = new ethers.EtherscanProvider(
    ethers.Network.from('sepolia'),
    '',
  )

  // Get chainId from network.
  const chainId = (await provider.getNetwork()).chainId

  const tx = new ethers.Transaction()
  // * fill the tx parameters here *

  // `tx.unsignedSerialized` is a hex string starting with `0x`, so we remove it by slicing the first two
  // characters before parsing it as a hex string into a byte array.
  const bytes = Uint8Array.from(
    Buffer.from(tx.unsignedSerialized.slice(2), 'hex'),
  )

  // Sign the transaction bytes
  const signMessagesIdKECCAK256 = await createPartialUserSignedMessages(
    dkg?.dwalletID!,
    dkg?.decentralizedDKGOutput!,
    new Uint8Array(dkg?.secretKeyShare!),
    [bytes],
    'KECCAK256',
    keypair,
    client,
  )
  const sigKECCAK256 = await approveAndSign(
    dkg?.dwalletCapID!,
    signMessagesIdKECCAK256!,
    [bytes],
    dkg?.dwalletID!,
    'KECCAK256',
    keypair,
    client,
  )
  const sig = Buffer.from(sigKECCAK256[0]).toString('hex')

  const recoveryId =
    '0' +
    recoveryIdKeccak256(
      // @ts-ignore
      dwallet?.data?.content?.fields['public_key'],
      bytes,
      sigKECCAK256[0],
    ).toString(16)

  // Serialized signature in a formate r[32-byte]-s[32-byte]-v[1-byte] where v is recovery ID.
  tx.signature = '0x' + sig + recoveryId

  const response = await provider.broadcastTransaction(tx.serialized)
  console.log(`Transaction successful with hash: ${response.hash}`)
}

run().catch(console.error)
