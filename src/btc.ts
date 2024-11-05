import { Ed25519Keypair } from '@dwallet-network/dwallet.js/keypairs/ed25519'
import {
  DWalletClient,
  SuiHTTPTransport,
} from '@dwallet-network/dwallet.js/client'
import { requestSuiFromFaucetV0 as requestDwltFromFaucetV0 } from '@dwallet-network/dwallet.js/faucet'
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

import { sha256 } from '@noble/hashes/sha256'

import * as bitcoin from 'bitcoinjs-lib'
import axios from 'axios'
import { BufferWriter, varuint } from 'bitcoinjs-lib/src/cjs/bufferutils'
import { Transaction } from 'bitcoinjs-lib'
// @ts-ignore
import * as bscript from 'bitcoinjs-lib/src/script'

async function btc() {
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

  let { dwalletID, decentralizedDKGOutput, secretKeyShare } = dkg!

  // Set the required network.
  const TESTNET = bitcoin.networks.testnet

  // Get the dWallet object.
  const dwallet = await client.getObject({
    id: dwalletID,
    options: { showContent: true },
  })
  if (dwallet?.data?.content?.dataType == 'moveObject') {
    // Get the dWallet's public key.

    const dWalletPubkey = Buffer.from(
      // @ts-ignore
      dwallet?.data?.content?.fields['public_key'],
    )

    // Getting the Bitcoin Testnet address and the output.
    const address = bitcoin.payments.p2wpkh({
      pubkey: dWalletPubkey,
      network: TESTNET,
    }).address!
    const output = bitcoin.payments.p2wpkh({
      pubkey: dWalletPubkey,
      network: TESTNET,
    }).output!

    console.log('The Bitcoin Testnet address of the dWallet is', address)
    console.log('The Bitcoin Testnet output of the dWallet is', output)

    // The rest of the code will be shown in the next steps.

    // Part 2
    // The recipient address is also a bitcoin testnet address.
    // You can generate it in the same way we created the dWallet's
    // address by providing its own key pair.
    const recipientAddress = 'put the recipient address here'
    // Put any number you want to send in Satoshi.
    const amount = 500

    // Get the UTXO for the sender address.
    const { txID, vOut, satoshi } = await getUTXO(address)

    const psbt = new bitcoin.Psbt({ network: TESTNET })

    // Add the input UTXO.
    psbt.addInput({
      hash: txID,
      index: vOut,
      witnessUtxo: {
        script: output,
        // @ts-ignore
        value: satoshi,
      },
    })

    // Add the recipient output.
    psbt.addOutput({
      address: recipientAddress,
      // @ts-ignore
      value: amount,
    })

    // Calculate change and add change output if necessary,
    // 150 Satoshi is a simple fee.
    // Choose the value you want to spend.
    const fee = 150
    const change = satoshi - amount - fee

    // Sending the rest to the back to the sender.
    if (change > 0) {
      psbt.addOutput({
        address,
        // @ts-ignore
        value: change,
      })
    }

    const tx = bitcoin.Transaction.fromBuffer(psbt.data.getTransaction())

    // Part 3

    const signingScript = bitcoin.payments.p2pkh({
      hash: output.slice(2),
    }).output!
    console.log('Signing script:', signingScript.toString())

    const bytesToSign = txBytesToSign(
      tx,
      0,
      signingScript,
      satoshi,
      bitcoin.Transaction.SIGHASH_ALL,
    )

    // We calculate the hash
    // to sign manually because the dWallet Network doesn't support this bitcoin hashing algorithm yet.
    // This will be fixed in the following issue: https://github.com/dwallet-labs/dwallet-network/issues/161.
    const signMessagesIDSHA256 = await createPartialUserSignedMessages(
      dwalletID!,
      decentralizedDKGOutput,
      new Uint8Array(secretKeyShare),
      [bytesToSign],
      'SHA256',
      keypair,
      client,
    )

    const sigSHA256 = await approveAndSign(
      dkg?.dwalletCapID!,
      signMessagesIDSHA256!,
      [bytesToSign],
      dkg?.dwalletID!,
      'SHA256',
      keypair,
      client,
    )

    const dWalletSig = Buffer.from(sigSHA256[0])

    // To put the signature in the transaction, we get the calculated witness and set it as the input witness.
    const witness = bitcoin.payments.p2wpkh({
      output: output,
      pubkey: dWalletPubkey,
      signature: bscript.signature.encode(
        dWalletSig,
        bitcoin.Transaction.SIGHASH_ALL,
      ),
    }).witness!

    // Set the witness of the first input (in our case, we only have one).
    tx.setWitness(0, witness)

    const txHex = tx.toHex()

    // Part 4

    // Broadcast the transaction.
    const broadcastUrl = `https://blockstream.info/testnet/api/tx`
    try {
      const response = await axios.post(broadcastUrl, txHex)
      console.log('Transaction Broadcast:', response.data)
    } catch (error) {
      console.error('Error broadcasting transaction:', error)
    }
  }
}

// Getting the unspent transaction output for a given address.
async function getUTXO(
  address: string,
): Promise<{ utxo: any; txID: string; vOut: number; satoshi: number }> {
  const utxoUrl = `https://blockstream.info/testnet/api/address/${address}/utxo`
  const { data: utxos } = await axios.get(utxoUrl)

  if (utxos.length === 0) {
    throw new Error('No UTXOs found for this address')
  }

  // Taking the first unspent transaction.
  // You can change and return them all and to choose or to use more than one input.
  const utxo = utxos[0]
  const txID = utxo.txid
  const vout = utxo.vout
  const satoshis = utxo.value

  return { utxo: utxo, txID: txID, vOut: vout, satoshi: satoshis }
}

function varSliceSize(someScript: Uint8Array): number {
  const length = someScript.length

  return varuint.encodingLength(length) + length
}

function txBytesToSign(
  tx: Transaction,
  inIndex: number,
  prevOutScript: Uint8Array,
  value: number,
  hashType: number,
): Buffer {
  const ZERO: Buffer = Buffer.from(
    '0000000000000000000000000000000000000000000000000000000000000000',
    'hex',
  )

  let tbuffer: Buffer = Buffer.from([])
  let bufferWriter: BufferWriter

  let hashOutputs = ZERO
  let hashPrevious = ZERO
  let hashSequence = ZERO

  if (!(hashType & bitcoin.Transaction.SIGHASH_ANYONECANPAY)) {
    tbuffer = Buffer.allocUnsafe(36 * tx.ins.length)
    bufferWriter = new BufferWriter(tbuffer, 0)

    tx.ins.forEach(txIn => {
      bufferWriter.writeSlice(txIn.hash)
      bufferWriter.writeUInt32(txIn.index)
    })

    hashPrevious = Buffer.from(sha256(sha256(tbuffer)))
  }

  if (
    !(hashType & bitcoin.Transaction.SIGHASH_ANYONECANPAY) &&
    (hashType & 0x1f) !== bitcoin.Transaction.SIGHASH_SINGLE &&
    (hashType & 0x1f) !== bitcoin.Transaction.SIGHASH_NONE
  ) {
    tbuffer = Buffer.allocUnsafe(4 * tx.ins.length)
    bufferWriter = new BufferWriter(tbuffer, 0)

    tx.ins.forEach(txIn => {
      bufferWriter.writeUInt32(txIn.sequence)
    })

    hashSequence = Buffer.from(sha256(sha256(tbuffer)))
  }

  if (
    (hashType & 0x1f) !== bitcoin.Transaction.SIGHASH_SINGLE &&
    (hashType & 0x1f) !== bitcoin.Transaction.SIGHASH_NONE
  ) {
    const txOutsSize = tx.outs.reduce((sum, output) => {
      return sum + 8 + varSliceSize(output.script)
    }, 0)

    tbuffer = Buffer.allocUnsafe(txOutsSize)
    bufferWriter = new BufferWriter(tbuffer, 0)

    tx.outs.forEach(out => {
      bufferWriter.writeUInt64(out.value)
      bufferWriter.writeVarSlice(out.script)
    })

    hashOutputs = Buffer.from(sha256(sha256(tbuffer)))
  } else if (
    (hashType & 0x1f) === bitcoin.Transaction.SIGHASH_SINGLE &&
    inIndex < tx.outs.length
  ) {
    const output = tx.outs[inIndex]

    tbuffer = Buffer.allocUnsafe(8 + varSliceSize(output.script))
    bufferWriter = new BufferWriter(tbuffer, 0)
    bufferWriter.writeUInt64(output.value)
    bufferWriter.writeVarSlice(output.script)

    hashOutputs = Buffer.from(sha256(sha256(tbuffer)))
  }

  tbuffer = Buffer.allocUnsafe(156 + varSliceSize(prevOutScript))
  bufferWriter = new BufferWriter(tbuffer, 0)

  const input = tx.ins[inIndex]
  bufferWriter.writeInt32(tx.version)
  bufferWriter.writeSlice(hashPrevious)
  bufferWriter.writeSlice(hashSequence)
  bufferWriter.writeSlice(input.hash)
  bufferWriter.writeUInt32(input.index)
  bufferWriter.writeVarSlice(prevOutScript)
  bufferWriter.writeUInt64(value)
  bufferWriter.writeUInt32(input.sequence)
  bufferWriter.writeSlice(hashOutputs)
  bufferWriter.writeUInt32(tx.locktime)
  bufferWriter.writeUInt32(hashType)

  return tbuffer
}

btc().catch(console.error)
