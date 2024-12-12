import * as tbc from 'tbc-lib-js';
import { getPrePreTxdata } from '../util/ftunlock';

interface NFTInfo {
    collectionId: string;
    collectionIndex: number;
    collectionName: string;
    nftCodeBalance: number;
    nftP2pkhBalance: number;
    nftName: string;
    nftSymbol: string;
    nft_attributes: string;
    nftDescription: string;
    nftTransferTimeCount: number;
    nftIcon: string;
}

interface FtInfo {
    contractTxid?: string;
    codeScript: string;
    tapeScript: string;
    totalSupply: number;
    decimal: number;
    name: string;
    symbol: string;
}

class API {
    /**
     * Get the base URL for the specified network.
     *
     * @param {("testnet" | "mainnet")} network - The network type.
     * @returns {string} The base URL for the specified network.
     */
    private static getBaseURL(network: "testnet" | "mainnet"): string {
        const url_testnet = `https://tbcdev.org/v1/tbc/main/`;
        const url_mainnet = `https://turingwallet.xyz/v1/tbc/main/`;
        const base_url = network == "testnet" ? url_testnet : url_mainnet;
        return base_url;
    }

    /**
     * Get the FT balance for a specified contract transaction ID and address or hash.
     *
     * @param {string} contractTxid - The contract transaction ID.
     * @param {string} addressOrHash - The address or hash.
     * @param {("testnet" | "mainnet")} [network] - The network type.
     * @returns {Promise<bigint>} Returns a Promise that resolves to the FT balance.
     * @throws {Error} Throws an error if the address or hash is invalid, or if the request fails.
     */
    static async getFTbalance(contractTxid: string, addressOrHash: string, network?: "testnet" | "mainnet"): Promise<bigint> {
        let base_url = "";
        if (network) {
            base_url = API.getBaseURL(network)
        } else {
            base_url = API.getBaseURL("mainnet")
        }
        let hash = '';
        if (tbc.Address.isValid(addressOrHash)) {
            // If the recipient is an address
            const publicKeyHash = tbc.Address.fromString(addressOrHash).hashBuffer.toString('hex');
            hash = publicKeyHash + '00';
        } else {
            // If the recipient is a hash
            if (addressOrHash.length !== 40) {
                throw new Error('Invalid address or hash');
            }
            hash = addressOrHash + '01';
        }
        const url = base_url + `ft/balance/combine/script/${hash}/contract/${contractTxid}`;
        try {
            const response = await (await fetch(url)).json();
            const ftBalance = response.ftBalance;
            return ftBalance;
        } catch (error) {
            throw new Error("Failed to get ftBalance.");
        }
    }

    /**
     * Fetches an FT UTXO that satisfies the required amount.
     *
     * @param {string} contractTxid - The contract transaction ID.
     * @param {string} addressOrHash - The recipient's address or hash.
     * @param {bigint} amount - The required amount.
     * @param {string} codeScript - The code script.
     * @param {("testnet" | "mainnet")} [network] - The network type.
     * @returns {Promise<tbc.Transaction.IUnspentOutput>} Returns a Promise that resolves to the FT UTXO.
     * @throws {Error} Throws an error if the request fails or if the FT balance is insufficient.
     */
    static async fetchFtUTXO(contractTxid: string, addressOrHash: string, amount: bigint, codeScript: string, network?: "testnet" | "mainnet"): Promise<tbc.Transaction.IUnspentOutput> {
        let base_url = "";
        if (network) {
            base_url = API.getBaseURL(network)
        } else {
            base_url = API.getBaseURL("mainnet")
        }
        let hash = '';
        if (tbc.Address.isValid(addressOrHash)) {
            // If the recipient is an address
            const publicKeyHash = tbc.Address.fromString(addressOrHash).hashBuffer.toString('hex');
            hash = publicKeyHash + '00';
        } else {
            // If the recipient is a hash
            if (addressOrHash.length !== 40) {
                throw new Error('Invalid address or hash');
            }
            hash = addressOrHash + '01';
        }
        const url = base_url + `ft/utxo/combine/script/${hash}/contract/${contractTxid}`;
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch from URL: ${url}, status: ${response.status}`);
            }
            const responseData = await response.json();
            let data = responseData.ftUtxoList[0];
            for (let i = 0; i < responseData.ftUtxoList.length; i++) {
                if (responseData.ftUtxoList[i].ftBalance >= amount) {
                    data = responseData.ftUtxoList[i];
                    break;
                }
            }
            if (data.ftBalance < amount) {
                const totalBalance = await API.getFTbalance(contractTxid, addressOrHash, network);
                if (totalBalance >= amount) {
                    throw new Error('Insufficient FTbalance, please merge FT UTXOs');
                }
            }
            const fttxo: tbc.Transaction.IUnspentOutput = {
                txId: data.utxoId,
                outputIndex: data.utxoVout,
                script: codeScript,
                satoshis: data.utxoBalance,
                ftBalance: data.ftBalance
            }
            return fttxo;
        } catch (error) {
            throw new Error("Failed to fetch FTUTXO.");
        }
    }

    static async fetchFtUTXOs(contractTxid: string, addressOrHash: string, number: number, codeScript: string, network?: "testnet" | "mainnet"): Promise<tbc.Transaction.IUnspentOutput[]> {
        if (!Number.isInteger(number) || number < 1) {
            throw new Error(`${number} is not a nature number`);
        } else if (number > 5) {
            throw new Error(`The number of FT UTXOs should be less than 6`);
        }
        let base_url = "";
        if (network) {
            base_url = API.getBaseURL(network)
        } else {
            base_url = API.getBaseURL("mainnet")
        }
        let hash = '';
        if (tbc.Address.isValid(addressOrHash)) {
            // If the recipient is an address
            const publicKeyHash = tbc.Address.fromString(addressOrHash).hashBuffer.toString('hex');
            hash = publicKeyHash + '00';
        } else {
            // If the recipient is a hash
            if (addressOrHash.length !== 40) {
                throw new Error('Invalid address or hash');
            }
            hash = addressOrHash + '01';
        }
        const url = base_url + `ft/utxo/combine/script/${hash}/contract/${contractTxid}`;
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch from URL: ${url}, status: ${response.status}`);
            }
            const responseData = await response.json();
            let ftutxos: tbc.Transaction.IUnspentOutput[] = [];
            for (let i = 0; i < responseData.ftUtxoList.length && i < 5; i++) {
                ftutxos.push({
                    txId: responseData.ftUtxoList[i].utxoId,
                    outputIndex: responseData.ftUtxoList[i].utxoVout,
                    script: codeScript,
                    satoshis: responseData.ftUtxoList[i].utxoBalance,
                    ftBalance: responseData.ftUtxoList[i].ftBalance
                });
            }
            return ftutxos;
        } catch (error) {
            console.log(error);
            throw new Error("Failed to fetch FTUTXO.");
        }
    }

    /**
     * Fetches the FT information for a given contract transaction ID.
     *
     * @param {string} contractTxid - The contract transaction ID.
     * @param {("testnet" | "mainnet")} [network] - The network type.
     * @returns {Promise<FtInfo>} Returns a Promise that resolves to an FtInfo object containing the FT information.
     * @throws {Error} Throws an error if the request to fetch FT information fails.
     */
    static async fetchFtInfo(contractTxid: string, network?: "testnet" | "mainnet"): Promise<FtInfo> {
        let base_url = "";
        if (network) {
            base_url = API.getBaseURL(network)
        } else {
            base_url = API.getBaseURL("mainnet")
        }
        const url = base_url + `ft/info/contract/id/${contractTxid}`;
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch from URL: ${url}, status: ${response.status}`);
            }
            const data = await response.json();
            const ftInfo: FtInfo = {
                codeScript: data.ftCodeScript,
                tapeScript: data.ftTapeScript,
                totalSupply: data.ftSupply,
                decimal: data.ftDecimal,
                name: data.ftName,
                symbol: data.ftSymbol
            }
            return ftInfo;
        } catch (error) {
            throw new Error("Failed to fetch FtInfo.");
        }
    }

    /**
     * Fetches the pre-pre transaction data for a given transaction.
     *
     * @param {tbc.Transaction} preTX - The previous transaction.
     * @param {number} preTxVout - The output index of the previous transaction.
     * @param {("testnet" | "mainnet")} [network] - The network type.
     * @returns {Promise<string>} Returns a Promise that resolves to the pre-pre transaction data.
     * @throws {Error} Throws an error if the request fails.
     */
    static async fetchFtPrePreTxData(preTX: tbc.Transaction, preTxVout: number, network?: "testnet" | "mainnet"): Promise<string> {
        const preTXtape = preTX.outputs[preTxVout + 1].script.toBuffer().subarray(3, 51).toString('hex');
        let prepretxdata = '';
        for (let i = preTXtape.length - 16; i >= 0; i -= 16) {
            const chunk = preTXtape.substring(i, i + 16);
            if (chunk != '0000000000000000') {
                const inputIndex = i / 16;
                const prepreTX = await API.fetchTXraw(preTX.inputs[inputIndex].prevTxId.toString('hex'), network);
                prepretxdata = prepretxdata + getPrePreTxdata(prepreTX, preTX.inputs[inputIndex].outputIndex);
            }
        }
        prepretxdata = '57' + prepretxdata;
        return prepretxdata;
    }

    /**
     * Fetches a UTXO that satisfies the required amount.
     *
     * @param {tbc.PrivateKey} privateKey - The private key object.
     * @param {number} amount - The required amount.
     * @param {("testnet" | "mainnet")} [network] - The network type.
     * @returns {Promise<tbc.Transaction.IUnspentOutput>} Returns a Promise that resolves to the UTXO.
     * @throws {Error} Throws an error if the request fails or if the balance is insufficient.
     */
    static async fetchUTXO(privateKey: tbc.PrivateKey, amount: number, network?: "testnet" | "mainnet"): Promise<tbc.Transaction.IUnspentOutput> {
        let base_url = "";
        if (network) {
            base_url = API.getBaseURL(network)
        } else {
            base_url = API.getBaseURL("mainnet")
        }
        const address = privateKey.toAddress().toString();
        const url = base_url + `address/${address}/unspent/`;
        const scriptPubKey = tbc.Script.buildPublicKeyHashOut(address).toBuffer().toString('hex');
        const amount_bn = amount * Math.pow(10, 6);
        try {
            const response = await (await fetch(url)).json();
            if (response.length === 1 && response[0].value > amount_bn) {
                const utxo: tbc.Transaction.IUnspentOutput = {
                    txId: response[0].tx_hash,
                    outputIndex: response[0].tx_pos,
                    script: scriptPubKey,
                    satoshis: response[0].value
                }
                return utxo;
            } else if (response.length === 1 && response[0].value <= amount_bn) {
                throw new Error('Insufficient balance');
            }
            let data = response[0];
            // Select a UTXO with value greater than 5000
            for (let i = 0; i < response.length; i++) {
                if (response[i].value > amount_bn) {
                    data = response[i];
                    break;
                }
            }
            if (data.value < amount_bn) {
                console.log('Please merge UTXO!');
                await new Promise(resolve => setTimeout(resolve, 3000));
                await API.mergeUTXO(privateKey, network);
                await new Promise(resolve => setTimeout(resolve, 5000));
                return await API.fetchUTXO(privateKey, amount, network);
            }
            const utxo: tbc.Transaction.IUnspentOutput = {
                txId: data.tx_hash,
                outputIndex: data.tx_pos,
                script: scriptPubKey,
                satoshis: data.value
            }
            return utxo;
        } catch (error) {
            throw new Error("Failed to fetch UTXO.");
        }
    }

    /**
     * Merges UTXOs for a given private key.
     *
     * @param {tbc.PrivateKey} privateKey - The private key object.
     * @param {("testnet" | "mainnet")} [network] - The network type.
     * @returns {Promise<boolean>} Returns a Promise that resolves to a boolean indicating whether the merge was successful.
     * @throws {Error} Throws an error if the merge fails.
     */
    static async mergeUTXO(privateKey: tbc.PrivateKey, network?: "testnet" | "mainnet"): Promise<boolean> {
        let base_url = "";
        if (network) {
            base_url = API.getBaseURL(network)
        } else {
            base_url = API.getBaseURL("mainnet")
        }
        const address = tbc.Address.fromPrivateKey(privateKey).toString();
        const url = base_url + `address/${address}/unspent/`;
        const scriptPubKey = tbc.Script.buildPublicKeyHashOut(address).toBuffer().toString('hex');
        try {
            const response = await (await fetch(url)).json();
            let sumAmount = 0;
            let utxo: tbc.Transaction.IUnspentOutput[] = [];
            if (response.length === 0) {
                throw new Error('No UTXO available');
            }
            if (response.length === 1) {
                console.log('Merge Success!');
                return true;
            } else {
                for (let i = 0; i < response.length; i++) {
                    sumAmount += response[i].value;
                    utxo.push({
                        txId: response[i].tx_hash,
                        outputIndex: response[i].tx_pos,
                        script: scriptPubKey,
                        satoshis: response[i].value
                    });
                }
            }
            const tx = new tbc.Transaction()
                .from(utxo)
                .to(address, sumAmount - 500)
                .fee(500)
                .change(address)
                .sign(privateKey)
                .seal();
            const txraw = tx.uncheckedSerialize();
            await API.broadcastTXraw(txraw, network);
            await new Promise(resolve => setTimeout(resolve, 3000));
            await API.mergeUTXO(privateKey, network);
            return true;
        } catch (error) {
            throw new Error("Failed to merge UTXO.");
        }
    }

    /**
     * Fetches the raw transaction data for a given transaction ID.
     *
     * @param {string} txid - The transaction ID to fetch.
     * @param {("testnet" | "mainnet")} [network] - The network type.
     * @returns {Promise<tbc.Transaction>} Returns a Promise that resolves to the transaction object.
     * @throws {Error} Throws an error if the request fails.
     */
    static async fetchTXraw(txid: string, network?: "testnet" | "mainnet"): Promise<tbc.Transaction> {
        let base_url = "";
        if (network) {
            base_url = API.getBaseURL(network)
        } else {
            base_url = API.getBaseURL("mainnet")
        }
        const url = base_url + `tx/hex/${txid}`;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch TXraw: ${response.statusText}`);
            }
            const rawtx = await response.json();
            const tx = new tbc.Transaction();
            tx.fromString(rawtx);
            return tx;
        } catch (error) {
            throw new Error("Failed to fetch TXraw.");
        }
    }

    /**
     * Broadcasts the raw transaction to the network.
     *
     * @param {string} txraw - The raw transaction hex.
     * @param {("testnet" | "mainnet")} [network] - The network type.
     * @returns {Promise<string>} Returns a Promise that resolves to the response from the broadcast API.
     * @throws {Error} Throws an error if the request fails.
     */
    static async broadcastTXraw(txraw: string, network?: "testnet" | "mainnet"): Promise<string> {
        let base_url = "";
        if (network) {
            base_url = API.getBaseURL(network)
        } else {
            base_url = API.getBaseURL("mainnet")
        }
        const url = base_url + `broadcast/tx/raw`;
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    txHex: txraw
                })
            });
            if (!response.ok) {
                throw new Error(`Failed to broadcast TXraw: ${response.statusText}`);
            }
            const data = await response.json();
            console.log('txid:', data.result);
            if (data.error) {
                console.log('error:', data.error);
            }
            return data.result;
        } catch (error) {
            throw new Error("Failed to broadcast TXraw.");
        }
    }

    /**
     * Fetches the UTXOs for a given address.
     *
     * @param {string} address - The address to fetch UTXOs for.
     * @param {("testnet" | "mainnet")} [network] - The network type.
     * @returns {Promise<tbc.Transaction.IUnspentOutput[]>} Returns a Promise that resolves to an array of UTXOs.
     * @throws {Error} Throws an error if the request fails.
     */
    static async fetchUTXOs(address: string, network?: "testnet" | "mainnet"): Promise<tbc.Transaction.IUnspentOutput[]> {
        let base_url = "";
        if (network) {
            base_url = API.getBaseURL(network)
        } else {
            base_url = API.getBaseURL("mainnet")
        }
        const url = base_url + `address/${address}/unspent/`;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error("Failed to fetch UTXO: ".concat(response.statusText));
            }
            const data: { tx_hash: string; tx_pos: number; height: number; value: number; }[] = await response.json();

            const scriptPubKey = tbc.Script.buildPublicKeyHashOut(address).toBuffer().toString('hex');

            return data.map((utxo) => ({
                txId: utxo.tx_hash,
                outputIndex: utxo.tx_pos,
                script: scriptPubKey,
                satoshis: utxo.value
            }));
        } catch (error) {
            throw new Error("Failed to fetch UTXO.");
        }
    }

    /**
     * Selects UTXOs for a given address and amount.
     *
     * @param {string} address - The address to fetch UTXOs for.
     * @param {number} amount_tbc - The required amount in TBC.
     * @param {("testnet" | "mainnet")} [network] - The network type.
     * @returns {Promise<tbc.Transaction.IUnspentOutput[]>} Returns a Promise that resolves to an array of selected UTXOs.
     * @throws {Error} Throws an error if the balance is insufficient.
     */
    static async selectUTXOs(address: string, amount_tbc: number, network?: "testnet" | "mainnet"): Promise<tbc.Transaction.IUnspentOutput[]> {
        let utxos: tbc.Transaction.IUnspentOutput[] = [];
        if (network) {
            utxos = await this.fetchUTXOs(address, network);
        } else {
            utxos = await this.fetchUTXOs(address);
        }
        utxos.sort((a, b) => a.satoshis - b.satoshis);
        const amount_satoshis = amount_tbc * Math.pow(10, 6);
        const closestUTXO = utxos.find(utxo => utxo.satoshis >= amount_satoshis + 50000);
        if (closestUTXO) {
            return [closestUTXO];
        }

        let totalAmount = 0;
        const selectedUTXOs: tbc.Transaction.IUnspentOutput[] = [];

        for (const utxo of utxos) {
            totalAmount += utxo.satoshis;
            selectedUTXOs.push(utxo);

            if (totalAmount >= amount_satoshis + 2000) {
                break;
            }
        }

        if (totalAmount < amount_satoshis + 2000) {
            throw new Error("Insufficient balance");
        }

        return selectedUTXOs;
    }

    /**
     * Fetches an NFT UTXO based on the provided script and optional transaction hash.
     *
     * @param {Object} params - The parameters for fetching the NFT UTXO.
     * @param {string} params.script - The script to fetch the UTXO for.
     * @param {string} [params.tx_hash] - The optional transaction hash to filter the UTXOs.
     * @param {("testnet" | "mainnet")} [params.network] - The network type.
     * @returns {Promise<tbc.Transaction.IUnspentOutput>} Returns a Promise that resolves to the NFT UTXO.
     * @throws {Error} Throws an error if the request fails or no matching UTXO is found.
     */
    static async fetchNFTTXO(params: { script: string, tx_hash?: string, network?: "testnet" | "mainnet" }): Promise<tbc.Transaction.IUnspentOutput> {
        const { script, tx_hash, network } = params;
        let base_url = "";
        if (network) {
            base_url = API.getBaseURL(network)
        } else {
            base_url = API.getBaseURL("mainnet")
        }
        const script_hash = Buffer.from(tbc.crypto.Hash.sha256(Buffer.from(script, "hex")).toString("hex"), "hex").reverse().toString("hex");
        const url = base_url + `script/hash/${script_hash}/unspent`;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error("Failed to fetch UTXO: ".concat(response.statusText));
            }
            const data: { tx_hash: string; tx_pos: number; height: number; value: number; }[] = await response.json();
            if (tx_hash) {
                const filteredUTXOs = data.filter(item => item.tx_hash === tx_hash);

                if (filteredUTXOs.length === 0) {
                    throw new Error('No matching UTXO found.');
                }

                const min_vout_utxo = filteredUTXOs.reduce((prev, current) =>
                    prev.tx_pos < current.tx_pos ? prev : current
                );

                return {
                    txId: min_vout_utxo.tx_hash,
                    outputIndex: min_vout_utxo.tx_pos,
                    script: script,
                    satoshis: min_vout_utxo.value
                }
            } else {
                return {
                    txId: data[0].tx_hash,
                    outputIndex: data[0].tx_pos,
                    script: script,
                    satoshis: data[0].value
                }
            }

        } catch (error) {
            throw new Error("Failed to fetch UTXO.");
        }
    }

    /**
     * Fetches the NFT information for a given contract ID.
     *
     * @param {string} contract_id - The contract ID to fetch NFT information for.
     * @param {("testnet" | "mainnet")} [network] - The network type.
     * @returns {Promise<NFTInfo>} Returns a Promise that resolves to an NFTInfo object containing the NFT information.
     * @throws {Error} Throws an error if the request to fetch NFT information fails.
     */
    static async fetchNFTInfo(contract_id: string, network?: "testnet" | "mainnet"): Promise<NFTInfo> {
        let base_url = "";
        if (network) {
            base_url = API.getBaseURL(network)
        } else {
            base_url = API.getBaseURL("mainnet")
        }
        const url = base_url + "nft/infos/contract_ids"
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    if_icon_needed: true,
                    nft_contract_list: [contract_id]
                })
            });
            if (!response.ok) {
                if (!response.ok) {
                    throw new Error("Failed to fetch NFTInfo: ".concat(response.statusText));
                }
            }
            const data = await response.json();

            const nftInfo: NFTInfo = {
                collectionId: data.nftInfoList[0].collectionId,
                collectionIndex: data.nftInfoList[0].collectionIndex,
                collectionName: data.nftInfoList[0].collectionName,
                nftCodeBalance: data.nftInfoList[0].nftCodeBalance,
                nftP2pkhBalance: data.nftInfoList[0].nftP2pkhBalance,
                nftName: data.nftInfoList[0].nftName,
                nftSymbol: data.nftInfoList[0].nftSymbol,
                nft_attributes: data.nftInfoList[0].nft_attributes,
                nftDescription: data.nftInfoList[0].nftDescription,
                nftTransferTimeCount: data.nftInfoList[0].nftTransferTimeCount,
                nftIcon: data.nftInfoList[0].nftIcon
            }

            return nftInfo;
        } catch (error) {
            throw new Error("Failed to fetch NFTInfo.");
        }
    }
}

module.exports = API