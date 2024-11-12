// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: BSD-3-Clause-Clear

import { bcs } from '@dwallet-network/dwallet.js/bcs'
import {
  DWalletClient,
  OwnedObjectRef,
  SuiHTTPTransport,
} from '@dwallet-network/dwallet.js/client'
import { requestSuiFromFaucetV0 as requestDwltFromFaucetV0 } from '@dwallet-network/dwallet.js/faucet'
import { Ed25519Keypair } from '@dwallet-network/dwallet.js/keypairs/ed25519'
import {
  createActiveEncryptionKeysTable,
  createDWallet,
  createPartialUserSignedMessages,
  getOrCreateEncryptionKey,
  submitDWalletCreationProof,
  submitTxStateProof,
} from '@dwallet-network/dwallet.js/signature-mpc'
import { SuiClient } from '@mysten/sui.js/client'
import { TransactionBlock as TransactionBlockSUI } from '@mysten/sui.js/transactions'

type NetworkConfig = {
  // Service to get TX data from SUI, a temporary solution.
  lightClientTxDataService: string
  // The URL of the dWallet node.
  dWalletNodeUrl: string
  // The dwallet package ID in SUI network where the dWallet cap is defined.
  dWalletCapPackageIDInSUI: string
  // The SUI RPC URL (full node).
  suiRPCURL: string
  // The object ID of the registry in dWallet network.
  dWalletRegistryObjectID: string
  // The object ID of the config in dWallet network.
  dWalletConfigObjectID: string
  // The URL of the faucet in dwallet network.
  dWalletFaucetURL: string
}

function getLocalConf(): NetworkConfig {
  return {
    lightClientTxDataService: 'http://localhost:6920/gettxdata',
    dWalletNodeUrl: 'http://127.0.0.1:9000',
    dWalletFaucetURL: 'http://127.0.0.1:9123/gas',
    dWalletCapPackageIDInSUI:
      '0x96c235dfd098a3e0404cfe5bf9c05bbc268b75649d051d4808019f5eb81d3eec',
    suiRPCURL: 'https://fullnode.testnet.sui.io',
    dWalletRegistryObjectID:
      '0x4de2a30287ed40600b53c40bfb3eeae7ef4ecf9ba9a90df732c363318612f084',
    dWalletConfigObjectID:
      '0xcc88a86628098c1472959ba6ad5e1c0fc0c1fd632b7ec21d265fb8efd5d55aea',
  }
}

function getTestNetConf(): NetworkConfig {
  return {
    lightClientTxDataService:
      'https://lightclient-rest-server.alpha.testnet.dwallet.cloud/gettxdata',
    dWalletNodeUrl: 'https://fullnode.alpha.testnet.dwallet.cloud',
    dWalletFaucetURL: 'https://faucet.alpha.testnet.dwallet.cloud/gas',
    dWalletCapPackageIDInSUI:
      '0x96c235dfd098a3e0404cfe5bf9c05bbc268b75649d051d4808019f5eb81d3eec',
    suiRPCURL: 'https://fullnode.testnet.sui.io:443',
    dWalletRegistryObjectID:
      '0x4de2a30287ed40600b53c40bfb3eeae7ef4ecf9ba9a90df732c363318612f084',
    dWalletConfigObjectID:
      '0xcc88a86628098c1472959ba6ad5e1c0fc0c1fd632b7ec21d265fb8efd5d55aea',
  }
}

async function main() {
  getLocalConf()

  const {
    dWalletConfigObjectID,
    dWalletCapPackageIDInSUI,
    dWalletNodeUrl,
    lightClientTxDataService,
    dWalletRegistryObjectID,
    suiRPCURL,
    dWalletFaucetURL,
  } = getTestNetConf()

  const msgStr = 'dWallets are coming... to Sui'
  const message: Uint8Array = new TextEncoder().encode(msgStr)
  const keyPair = Ed25519Keypair.deriveKeypairFromSeed(
    'witch collapse practice feed shame open despair creek road again ice least',
  )
  const address = keyPair.getPublicKey().toSuiAddress()
  console.log('Created Address', address)

  await requestDwltFromFaucetV0({
    host: dWalletFaucetURL,
    recipient: address,
  })

  console.log('Creating dWallet')
  const dwalletClient = new DWalletClient({
    transport: new SuiHTTPTransport({
      url: dWalletNodeUrl,
    }),
  })
  const encryptionKeysHolder = await createActiveEncryptionKeysTable(
    dwalletClient,
    keyPair,
  )
  const activeEncryptionKeysTableID = encryptionKeysHolder.objectId
  const senderEncryptionKeyObj = await getOrCreateEncryptionKey(
    keyPair,
    dwalletClient,
    activeEncryptionKeysTableID,
  )
  const createdDWallet = await createDWallet(
    keyPair,
    dwalletClient,
    senderEncryptionKeyObj.encryptionKey,
    senderEncryptionKeyObj.objectID,
  )
  if (createdDWallet == null) {
    throw new Error('createDWallet() returned null')
  }
  const dWalletCapID = createdDWallet.dwalletCapID

  console.log(`Wrapping dWalletCapID: ${dWalletCapID} in Sui network`)
  const dwalletCapTxB = await buildCreateDWalletCapTx(
    dWalletCapID,
    dWalletCapPackageIDInSUI,
    keyPair,
  )
  const suiClient = new SuiClient({ url: suiRPCURL })
  const createCapInSuiRes = await suiClient.signAndExecuteTransactionBlock({
    signer: keyPair,
    transactionBlock: dwalletCapTxB,
    options: {
      showEffects: true,
    },
  })
  const createdCapObjInSui = createCapInSuiRes.effects?.created?.[0]
  if (createdCapObjInSui) {
    console.log(
      `dWallet cap wrapper created in Sui network, ID: ${createdCapObjInSui.reference.objectId}`,
    )
  } else {
    throw new Error('dwallet_cap::create_cap failed: No objects were created')
  }

  // Wait for 5 seconds to allow the Sui network to process the request.
  await new Promise(resolve => setTimeout(resolve, 5 * 1000))

  // The function on Sui Network dwallet_cap::create_cap emits an event — DWalletNetworkInitCapRequest.
  // To prove on the dWallet Network that `DWalletNetworkInitCapRequest` event was emitted, call the
  // `submitDWalletCreationProof()` function,
  // which submits a state proof that the transaction on the Sui Network created a new `DWalletCap`.
  // This will create a new `CapWrapper` object in dWallet Network, that wraps the `DWalletCap` and registers the
  // corresponding `cap_id_sui` on Sui, thus forming the link between the two objects.
  console.log(
    `Submitting the Sui Network dWallet cap creation proof to dWallet network`,
  )
  const createCapInSuiTxID = createCapInSuiRes.digest
  let dwalletCreationProofRes = await submitDWalletCreationProof(
    dwalletClient,
    suiClient,
    dWalletConfigObjectID,
    dWalletRegistryObjectID,
    dWalletCapID,
    createCapInSuiTxID,
    lightClientTxDataService,
    keyPair,
  )
  const capWrapperInDwalletRef =
    dwalletCreationProofRes.effects?.created?.[0]?.reference
  if (!capWrapperInDwalletRef) {
    throw new Error(
      'submitDWalletCreationProof failed: No objects were created',
    )
  }
  console.log(
    'dWallet cap wrapper creation proof created in dWallet Network, Tx ID:',
    dwalletCreationProofRes.digest,
  )

  // Now that our dWallet is linked to a `DWalletCap` on Sui, its owner can use it to approve a message for signing.
  // For example, if we want to sign the message `"dWallets are coming... to Sui"`, we can call the
  // `dwallet_cap::approve_message()` method on Sui:
  console.log(`Approving message: "${msgStr}" in Sui network`)
  let approveMsgTxB = buildApproveMsgTx(
    message,
    dWalletCapPackageIDInSUI,
    createdCapObjInSui,
  )
  let approveMsgRes = await suiClient.signAndExecuteTransactionBlock({
    signer: keyPair,
    transactionBlock: approveMsgTxB,
    options: {
      showEffects: true,
    },
  })
  const approveMsgTxID = approveMsgRes.digest
  console.log(
    `Message "${msgStr}" approved in Sui network, TX ID: ${approveMsgTxID}`,
  )

  /// Sign the message in dWallet network.
  console.log('Pre-Signing the message in dWallet network')
  const signMessagesIDSHA256 = await createPartialUserSignedMessages(
    createdDWallet.dwalletID,
    createdDWallet.decentralizedDKGOutput,
    new Uint8Array(createdDWallet.secretKeyShare),
    [message],
    'SHA256',
    keyPair,
    dwalletClient,
  )
  if (signMessagesIDSHA256 == null) {
    throw new Error('createPartialUserSignedMessages returned null')
  }
  console.log('Pre-Sign message ID:', signMessagesIDSHA256)

  // Next, call the `submitTxStateProof()` function, which will submit a state proof to the dWallet network that this
  // transaction on Sui network approved this message for signing.
  console.log('Signing the message in dWallet network')
  const res = await submitTxStateProof(
    dwalletClient,
    suiClient,
    createdDWallet.dwalletID,
    dWalletConfigObjectID,
    dWalletRegistryObjectID,
    capWrapperInDwalletRef,
    signMessagesIDSHA256,
    approveMsgTxID,
    lightClientTxDataService,
    keyPair,
  )
  console.log('submitTxStateProof result', res)
}

main()
  .then(() => console.log('Done'))
  .catch(e => console.error(e))

/**
 * Emits an event to notify the initialization of a new dWallet capability.
 *
 * event::emit(DWalletNetworkInitCapRequest {
 *     // The object ID of the newly created `DWalletCap` object.
 *     cap_id: object::id(&cap),
 *     // The object ID of the dWallet capability on the dWallet Network that you wish to control.
 *     dwallet_network_cap_id,
 * });
 */
async function buildCreateDWalletCapTx(
  dwalletCapID: string | undefined,
  dWalletCapPackageIDInSUI: string,
  keyPair: Ed25519Keypair,
) {
  let txb = new TransactionBlockSUI()
  let dWalletCapArg = txb.pure(dwalletCapID)
  let [cap] = txb.moveCall({
    target: `${dWalletCapPackageIDInSUI}::dwallet_cap::create_cap`,
    arguments: [dWalletCapArg],
  })
  txb.transferObjects([cap], keyPair.toSuiAddress())
  txb.setGasBudget(10000000)
  return txb
}

function buildApproveMsgTx(
  message: Uint8Array,
  dWalletCapPackageIDInSUI: string,
  createdCapObjInSui: OwnedObjectRef,
) {
  let txb = new TransactionBlockSUI()

  let signMsgArg = txb.pure(
    bcs.vector(bcs.vector(bcs.u8())).serialize([message]),
  )
  const createdCapObjInSuiArg = txb.objectRef(createdCapObjInSui.reference)
  // Approve the message for the given dWallet cap.
  txb.moveCall({
    target: `${dWalletCapPackageIDInSUI}::dwallet_cap::approve_message`,
    arguments: [createdCapObjInSuiArg, signMsgArg],
  })
  txb.setGasBudget(10000000)

  return txb
}

// Create the capability and approve the message in a single transaction.
async function buildCreateDWalletCapAndApproveTx(
  dwalletCapID: string | undefined,
  dWalletCapPackageIDInSUI: string,
  keyPair: Ed25519Keypair,
  msgToSign: Uint8Array,
) {
  let txb = new TransactionBlockSUI()
  let dWalletCapArg = txb.pure(dwalletCapID)
  let [cap] = txb.moveCall({
    target: `${dWalletCapPackageIDInSUI}::dwallet_cap::create_cap`,
    arguments: [dWalletCapArg],
  })
  let signMsgArg = txb.pure(
    bcs.vector(bcs.vector(bcs.u8())).serialize([msgToSign]),
  )

  // Approve the message for the given dWallet cap.
  txb.moveCall({
    target: `${dWalletCapPackageIDInSUI}::dwallet_cap::approve_message`,
    arguments: [cap, signMsgArg],
  })
  txb.transferObjects([cap], keyPair.toSuiAddress())
  txb.setGasBudget(10000000)
  return txb
}
