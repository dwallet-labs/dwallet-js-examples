import {
  DWalletClient,
  SuiHTTPTransport,
} from '@dwallet-network/dwallet.js/client'
import { Ed25519Keypair } from '@dwallet-network/dwallet.js/keypairs/ed25519'
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
import { requestSuiFromFaucetV0 as requestDwltFromFaucetV0 } from '@dwallet-network/dwallet.js/faucet'

// Note 1: this code corresponds this these docs:
// https://github.com/dwallet-labs/dwallet-network/pull/288/files#diff-dd79ea94a1a746acd93933c8ae13fda533d4f1c9cc9e4a5ad0d5e2d94483dd11
// Note 2: Do not change the versions of the dwallet imports!

void (async function () {
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
  const response = await requestDwltFromFaucetV0({
    // Connect to Testnet
    host: 'https://faucet.alpha.testnet.dwallet.cloud/gas',
    recipient: keypair.toSuiAddress(),
  })

  console.log(response)

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
  console.log('dwallet id ', dwalletID)

  const bytes: Uint8Array = new TextEncoder().encode('dWallets are coming...')

  const signMessagesIDSHA256 = await createPartialUserSignedMessages(
    dkg?.dwalletID!,
    dkg?.decentralizedDKGOutput!,
    new Uint8Array(dkg?.secretKeyShare!),
    [bytes],
    'SHA256',
    keypair,
    client,
  )

  console.log('signMessagesIDSHA256', signMessagesIDSHA256)

  const sigSHA256 = await approveAndSign(
    dkg?.dwalletCapID!,
    signMessagesIDSHA256!,
    [bytes],
    dkg?.dwalletID!,
    'SHA256',
    keypair,
    client,
  )

  console.log('sigSHA256', sigSHA256)

  const signMessagesIDKECCAK256 = await createPartialUserSignedMessages(
    dkg?.dwalletID!,
    dkg?.decentralizedDKGOutput!,
    new Uint8Array(dkg?.secretKeyShare!),
    [bytes],
    'KECCAK256',
    keypair,
    client,
  )

  console.log('signMessagesIDKECCAK256', signMessagesIDKECCAK256)

  const sigKECCAK256 = await approveAndSign(
    dkg?.dwalletCapID!,
    signMessagesIDKECCAK256!,
    [bytes],
    dkg?.dwalletID!,
    'KECCAK256',
    keypair,
    client,
  )

  console.log('sigKECCAK256:')
  console.log(sigKECCAK256)
})()
