import {DWalletClient} from '@dwallet-network/dwallet.js/client';
import {Ed25519Keypair} from '@dwallet-network/dwallet.js/keypairs/ed25519';

// Necessary functions to work with encryption keys.
import {
    createDWallet,
    getOrCreateEncryptionKey,
    storeEncryptionKey,
    setActiveEncryptionKey,
    EncryptionKeyScheme,
    createActiveEncryptionKeysTable
} from "@dwallet-network/dwallet.js/signature-mpc";
import {requestSuiFromFaucetV0 as requestDwltFromFaucetV0} from '@dwallet-network/dwallet.js/faucet';


async function foo() {
    // Create a new DWalletClient object that points to the desired network.
    const client = new DWalletClient({url: 'http://fullnode.alpha.devnet.dwallet.cloud:9000'});
    const keypair = new Ed25519Keypair();

    // Get tokens from the Testnet faucet server.
    const response = await requestDwltFromFaucetV0({
        // Connect to Testnet
        host: 'http://faucet.alpha.devnet.dwallet.cloud/gas',
        recipient: keypair.toSuiAddress(),
    });

    console.log(response);

    const encryptionKeysTable = await createActiveEncryptionKeysTable(client, keypair);
    const activeEncryptionKeysTableID = encryptionKeysTable.objectId;

    const senderEncryptionKeyObj = await getOrCreateEncryptionKey(keypair, client, activeEncryptionKeysTableID);

    console.log("senderEncryptionKeyObj", senderEncryptionKeyObj);

    const pubKeyRef = await storeEncryptionKey(
        senderEncryptionKeyObj.encryptionKey,
        EncryptionKeyScheme.Paillier,
        keypair,
        client,
    );

    console.log("pubKeyRef", pubKeyRef);

    await setActiveEncryptionKey(
        client,
        keypair,
        pubKeyRef?.objectId!,
        activeEncryptionKeysTableID,
    );

}


// foo().catch(console.error);


async function bar() {

    // Create a new DWalletClient object pointing to the network you want to use.
    const client = new DWalletClient({url: 'http://fullnode.alpha.devnet.dwallet.cloud:9000'});
    const keypair = new Ed25519Keypair();

    // Get tokens from the Testnet faucet server.
    const response = await requestDwltFromFaucetV0({
        // connect to Testnet
        host: 'http://faucet.alpha.devnet.dwallet.cloud/gas',
        recipient: keypair.toSuiAddress(),
    });
    console.log(response);

    const encryptionKeysTable = await createActiveEncryptionKeysTable(client, keypair);
    const activeEncryptionKeysTableID = encryptionKeysTable.objectId;

    const encryptionKeyObj = await getOrCreateEncryptionKey(keypair, client, activeEncryptionKeysTableID,);

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
}

bar().catch(console.error);
