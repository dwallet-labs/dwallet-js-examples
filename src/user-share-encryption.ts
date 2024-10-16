import {DWalletClient, SuiHTTPTransport} from '@dwallet-network/dwallet.js/client';
import {Ed25519Keypair} from '@dwallet-network/dwallet.js/keypairs/ed25519';
import {
    createDWallet,
    getOrCreateEncryptionKey,
    storeEncryptionKey,
    setActiveEncryptionKey,
    EncryptionKeyScheme,
    createActiveEncryptionKeysTable,
    getEncryptedUserShareByObjectID,
    sendUserShareToSuiPubKey,
    getEncryptedUserShareByObjID
} from "@dwallet-network/dwallet.js/signature-mpc";
import {serialized_pubkeys_from_decentralized_dkg_output} from '@dwallet-network/signature-mpc-wasm';
import {requestSuiFromFaucetV0 as requestDwltFromFaucetV0} from '@dwallet-network/dwallet.js/faucet';


async function userShareEncryption() {
    // Create a new DWalletClient object pointing to the network you want to use.
    const client = new DWalletClient({
        transport: new SuiHTTPTransport({
            url: 'http://fullnode.alpha.devnet.dwallet.cloud:9000',
            WebSocketConstructor: WebSocket as never,
        }),
    });
    const keypair = new Ed25519Keypair();
    const otherKeypair = new Ed25519Keypair();
    ``

    // Get tokens from the Testnet faucet server.
    const response = await requestDwltFromFaucetV0({
        // Connect to Testnet
        host: 'http://faucet.alpha.devnet.dwallet.cloud/gas',
        recipient: keypair.toSuiAddress(),
    });

    console.log(response);

    const encryptionKeysTable = await createActiveEncryptionKeysTable(client, keypair);
    let activeEncryptionKeysTableID = encryptionKeysTable.objectId;
    let encryptionKeyObj = await getOrCreateEncryptionKey(keypair, client, activeEncryptionKeysTableID,);

    const pubKeyRef = await storeEncryptionKey(
        encryptionKeyObj.encryptionKey,
        EncryptionKeyScheme.Paillier,
        keypair,
        client,
    );
    await setActiveEncryptionKey(
        client,
        keypair,
        pubKeyRef?.objectId!,
        activeEncryptionKeysTableID,
    );
    const createdDwallet = await createDWallet(keypair, client, encryptionKeyObj.encryptionKey, encryptionKeyObj.objectID);

    let {dwalletID} = createdDwallet!;
    console.log("dwallet id ", dwalletID);

    // Get your encrypted user secret share.
    let encryptedSecretShare = await getEncryptedUserShareByObjectID(
        client,
        createdDwallet?.encryptedSecretShareObjID!,
    );

    // Verify you signed the dkg output public keys before using it to send the user share.
    let signedDWalletPubKeys = new Uint8Array(encryptedSecretShare?.signedDWalletPubKeys!);
    console.log("signedDWalletPubKeys ", signedDWalletPubKeys);

    const res = await keypair
        .getPublicKey()
        .verify(
            serialized_pubkeys_from_decentralized_dkg_output(
                new Uint8Array(createdDwallet?.decentralizedDKGOutput!),
            ),
            signedDWalletPubKeys,
        );

    console.assert(res, "Failed to verify the signed dkg output public keys");

    const objRef = await sendUserShareToSuiPubKey(
        client,
        keypair,
        createdDwallet!,
        otherKeypair.getPublicKey(), // this is sent to you off-chain by the receiver
        activeEncryptionKeysTableID,
        signedDWalletPubKeys,
    );
}
