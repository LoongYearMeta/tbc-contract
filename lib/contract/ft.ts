import * as tbc from 'tbc-lib-js';
import { getPreTxdata, getCurrentTxdata, getCurrentInputsdata, getContractTxdata, getSize } from '../util/ftunlock';

interface FtInfo {
    contractTxid?: string;
    codeScript: string;
    tapeScript: string;
    totalSupply: number;
    decimal: number;
    name: string;
    symbol: string;
}

/**
 * Class representing a Fungible Token (FT) with methods for minting and transferring.
 */
class FT {
    name: string;
    symbol: string;
    decimal: number;
    totalSupply: number;
    codeScript: string;
    tapeScript: string;
    contractTxid: string;
    network: "testnet" | "mainnet"

    /**
     * Constructs the FT instance either from a transaction ID or parameters.
     * @param txidOrParams - Either a contract transaction ID or token parameters.
     */
    constructor(config?: { txidOrParams?: string | { name: string, symbol: string, amount: number, decimal: number }, network?: "testnet" | "mainnet" }) {
        this.name = '';
        this.symbol = '';
        this.decimal = 0;
        this.totalSupply = 0;
        this.codeScript = '';
        this.tapeScript = '';
        this.contractTxid = '';
        this.network = config?.network ?? "mainnet";
        if (typeof config!.txidOrParams === 'string') {
            // Initialize from an existing contract transaction ID
            this.contractTxid = config!.txidOrParams;
        } else if (config!.txidOrParams) {
            // Initialize with new token parameters
            const { name, symbol, amount, decimal } = config!.txidOrParams;
            if (amount <= 0) {
                throw new Error('Amount must be a natural number');
            }
            // Validate the decimal value
            if (!Number.isInteger(decimal) || decimal <= 0) {
                throw new Error('Decimal must be a positive integer');
            } else if (decimal > 18) {
                throw new Error('The maximum value for decimal cannot exceed 18');
            }
            // Calculate the maximum allowable amount based on the decimal
            const maxAmount = 18 * Math.pow(10, 18 - decimal);
            if (amount > maxAmount) {
                throw new Error(`When decimal is ${decimal}, the maximum amount cannot exceed ${maxAmount}`);
            }
            this.name = name;
            this.symbol = symbol;
            this.decimal = decimal;
            this.totalSupply = amount;
        } else {
            throw new Error('Invalid constructor arguments');
        }
    }

    /**
     * Initializes the FT instance by fetching the FTINFO.
     */
    initialize(ftInfo: FtInfo): void {
        this.name = ftInfo.name;
        this.symbol = ftInfo.symbol;
        this.decimal = ftInfo.decimal;
        this.totalSupply = ftInfo.totalSupply;
        this.codeScript = ftInfo.codeScript;
        this.tapeScript = ftInfo.tapeScript;
    }

    /**
     * Mints a new FT and returns the raw transaction hex.
     * @param privateKey_from - The private key of the sender.
     * @param address_to - The recipient's address.
     * @returns The raw transaction hex string.
     */
    MintFT(privateKey_from: tbc.PrivateKey, address_to: string, utxo: tbc.Transaction.IUnspentOutput): string {
        const privateKey = privateKey_from;
        const address_from = privateKey.toAddress().toString();
        const name = this.name;
        const symbol = this.symbol;
        const decimal = this.decimal;
        const totalSupply = BigInt(this.totalSupply * Math.pow(10, decimal));

        // Prepare the amount in BN format and write it into a buffer
        const amountbn = new tbc.crypto.BN(totalSupply.toString());
        const amountwriter = new tbc.encoding.BufferWriter();
        amountwriter.writeUInt64LEBN(amountbn);
        for (let i = 1; i < 6; i++) {
            amountwriter.writeUInt64LEBN(new tbc.crypto.BN(0));
        }
        const tapeAmount = amountwriter.toBuffer().toString('hex');

        // Convert name, symbol, and decimal to hex
        const nameHex = Buffer.from(name, 'utf8').toString('hex');
        const symbolHex = Buffer.from(symbol, 'utf8').toString('hex');
        const decimalHex = decimal.toString(16).padStart(2, '0');

        // Build the tape script
        const tapeScript = tbc.Script.fromASM(`OP_FALSE OP_RETURN ${tapeAmount} ${decimalHex} ${nameHex} ${symbolHex} 4654617065`);
        //console.log('tape:', tape.toBuffer().toString('hex'));
        const tapeSize = tapeScript.toBuffer().length;

        // Build the code script for minting
        const codeScript = this.getFTmintCode(utxo.txId, utxo.outputIndex, address_to, tapeSize);
        this.codeScript = codeScript.toBuffer().toString('hex');
        this.tapeScript = tapeScript.toBuffer().toString('hex');

        // Construct the transaction
        const tx = new tbc.Transaction()
            .from(utxo)
            .addOutput(new tbc.Transaction.Output({
                script: codeScript,
                satoshis: 2000
            }))
            .addOutput(new tbc.Transaction.Output({
                script: tapeScript,
                satoshis: 0
            }))
            .feePerKb(100)
            .change(privateKey.toAddress())
            .sign(privateKey);
        tx.seal();
        const txraw = tx.uncheckedSerialize();
        this.contractTxid = tx.hash;
        return txraw;
    }

    /**
     * Transfers FT tokens to another address and returns the raw transaction hex.
     * @param privateKey_from - The private key of the sender.
     * @param address_to - The recipient's address.
     * @param amount - The amount to transfer.
     * @returns The raw transaction hex string.
     */
    transfer(privateKey_from: tbc.PrivateKey, address_to: string, amount: number, ftutxo_a: tbc.Transaction.IUnspentOutput, utxo: tbc.Transaction.IUnspentOutput, preTX: tbc.Transaction, prepreTxData: string): string {
        const privateKey = privateKey_from;
        const address_from = privateKey.toAddress().toString();
        const code = this.codeScript;
        const tape = this.tapeScript;
        const decimal = this.decimal;
        const tapeAmountSetIn: bigint[] = [];
        if (amount < 0) {
            throw new Error('Invalid amount input');
        }
        const amountbn = BigInt(amount * Math.pow(10, decimal));
        // Fetch FT UTXO for the transfer
        //const ftutxo_a = await this.fetchFtTXO(this.contractTxid, address_from, amountbn);
        tapeAmountSetIn.push(ftutxo_a.ftBalance!);
        // Calculate the total available balance
        let tapeAmountSum = BigInt(0);
        for (let i = 0; i < tapeAmountSetIn.length; i++) {
            tapeAmountSum += BigInt(tapeAmountSetIn[i]);
        }
        // Check if the balance is sufficient
        if (amountbn > tapeAmountSum) {
            throw new Error('Insufficient balance, please add more FT UTXOs');
        }
        // Validate the decimal and amount
        if (decimal > 18) {
            throw new Error('The maximum value for decimal cannot exceed 18');
        }
        const maxAmount = Math.pow(10, 18 - decimal);
        if (amount > maxAmount) {
            throw new Error(`When decimal is ${decimal}, the maximum amount cannot exceed ${maxAmount}`);
        }
        // Build the amount and change hex strings for the tape
        const { amountHex, changeHex } = FT.buildTapeAmount(amountbn, tapeAmountSetIn);
        // Fetch UTXO for the sender's address
        //const utxo = await API.fetchUTXO(privateKey, 0.1, this.network);
        // Construct the transaction
        const tx = new tbc.Transaction()
            .from(ftutxo_a)
            .from(utxo);

        // Build the code script for the recipient
        const codeScript = FT.buildFTtransferCode(code, address_to);
        tx.addOutput(new tbc.Transaction.Output({
            script: codeScript,
            satoshis: 2000
        }));
        // Build the tape script for the amount
        const tapeScript = FT.buildFTtransferTape(tape, amountHex);
        tx.addOutput(new tbc.Transaction.Output({
            script: tapeScript,
            satoshis: 0
        }));
        // If there's change, add outputs for the change
        if (amountbn < tapeAmountSum) {
            const changeCodeScript = FT.buildFTtransferCode(code, address_from);
            tx.addOutput(new tbc.Transaction.Output({
                script: changeCodeScript,
                satoshis: 2000
            }));

            const changeTapeScript = FT.buildFTtransferTape(tape, changeHex);
            tx.addOutput(new tbc.Transaction.Output({
                script: changeTapeScript,
                satoshis: 0
            }));
        }
        tx.feePerKb(100)
        tx.change(address_from);
        // Set the input script asynchronously for the FT UTXO
        tx.setInputScript({
            inputIndex: 0,
        }, (tx) => {
            const unlockingScript = this.getFTunlock(privateKey, tx, preTX, prepreTxData, 0, ftutxo_a.outputIndex);
            return unlockingScript;
        });
        tx.sign(privateKey);
        tx.seal();
        const txraw = tx.uncheckedSerialize();
        return txraw;
    }

    /**
     * Merges FT UTXOs.
     *
     * @param {tbc.PrivateKey} privateKey_from - The private key object.
     * @returns {Promise<boolean>} Returns a Promise that resolves to a boolean indicating whether the merge was successful.
     * @throws {Error} Throws an error if the merge fails.
     */
    mergeFT(privateKey_from: tbc.PrivateKey, ftutxo: tbc.Transaction.IUnspentOutput[], utxo: tbc.Transaction.IUnspentOutput, preTX: tbc.Transaction[], prepreTxData: string[]): string | true {
        const privateKey = privateKey_from;
        const address = privateKey.toAddress().toString();
        const fttxo_codeScript = FT.buildFTtransferCode(this.codeScript, address).toBuffer().toString('hex');
        let ftutxos: tbc.Transaction.IUnspentOutput[] = [];
        if (ftutxo.length === 0) {
            throw new Error('No FT UTXO available');
        }
        if (ftutxo.length === 1) {
            console.log('Merge Success!');
            return true;
        } else {
            for (let i = 0; i < ftutxo.length && i < 5; i++) {
                ftutxos.push({
                    txId: ftutxo[i].txId,
                    outputIndex: ftutxo[i].outputIndex,
                    script: fttxo_codeScript,
                    satoshis: ftutxo[i].satoshis,
                    ftBalance: ftutxo[i].ftBalance
                });
            }
        }
        const tapeAmountSetIn: bigint[] = [];
        let tapeAmountSum = BigInt(0);
        for (let i = 0; i < ftutxos.length; i++) {
            tapeAmountSetIn.push(ftutxos[i].ftBalance!);
            tapeAmountSum += BigInt(ftutxos[i].ftBalance!);
        }
        const { amountHex, changeHex } = FT.buildTapeAmount(tapeAmountSum, tapeAmountSetIn);
        if (changeHex != '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000') {
            throw new Error('Change amount is not zero');
        }
        const tx = new tbc.Transaction()
            .from(ftutxos)
            .from(utxo);
        const codeScript = FT.buildFTtransferCode(this.codeScript, address);
        tx.addOutput(new tbc.Transaction.Output({
            script: codeScript,
            satoshis: 2000
        }));
        const tapeScript = FT.buildFTtransferTape(this.tapeScript, amountHex);
        tx.addOutput(new tbc.Transaction.Output({
            script: tapeScript,
            satoshis: 0
        }));
        tx.feePerKb(100)
        tx.change(privateKey.toAddress());
        for (let i = 0; i < ftutxos.length; i++) {
            tx.setInputScript({
                inputIndex: i,
            }, (tx) => {
                const unlockingScript = this.getFTunlock(privateKey, tx, preTX[i], prepreTxData[i], i, ftutxos[i].outputIndex);
                return unlockingScript;
            });
        }
        tx.sign(privateKey);
        tx.seal();
        const txraw = tx.uncheckedSerialize();
        return txraw;
    }

    /**
     * Generates the unlocking script for an FT transfer.
     * @param privateKey_from - The private key of the sender.
     * @param currentTX - The current transaction object.
     * @param currentUnlockIndex - The index of the input being unlocked.
     * @param preTxId - The transaction ID of the previous transaction.
     * @param preVout - The output index in the previous transaction.
     * @returns The unlocking script as a tbc.Script object.
     */
    getFTunlock(privateKey_from: tbc.PrivateKey, currentTX: tbc.Transaction, preTX: tbc.Transaction, prepreTxData: string, currentUnlockIndex: number, preTxVout: number): tbc.Script {
        const privateKey = privateKey_from;
        const prepretxdata = prepreTxData;
        //const preTX = await API.fetchTXraw(preTxId, this.network);
        const pretxdata = getPreTxdata(preTX, preTxVout);
        const currenttxdata = getCurrentTxdata(currentTX, currentUnlockIndex);
        const sig = (currentTX.getSignature(currentUnlockIndex, privateKey).length / 2).toString(16).padStart(2, '0') + currentTX.getSignature(currentUnlockIndex, privateKey);
        const publicKey = (privateKey.toPublicKey().toString().length / 2).toString(16).padStart(2, '0') + privateKey.toPublicKey().toString();
        const unlockingScript = new tbc.Script(`${currenttxdata}${prepretxdata}${sig}${publicKey}${pretxdata}`);
        return unlockingScript;
    }

    /**
     * Generates the unlocking script for an FT swap.
     * @param privateKey_from - The private key of the sender.
     * @param currentTX - The current transaction object.
     * @param currentUnlockIndex - The index of the input being unlocked.
     * @param preTxId - The transaction ID of the previous transaction.
     * @param preVout - The output index in the previous transaction.
     * @returns The unlocking script as a tbc.Script object.
     */
    getFTunlockSwap(privateKey_from: tbc.PrivateKey, currentTX: tbc.Transaction, preTX: tbc.Transaction, prepreTxData: string, contractTX: tbc.Transaction, currentUnlockIndex: number, preTxId: string, preVout: number): tbc.Script {
        const privateKey = privateKey_from;
        const prepretxdata = prepreTxData;
        //const contractTX = await API.fetchTXraw(currentTX.inputs[0].prevTxId.toString('hex'), this.network);
        const contracttxdata = getContractTxdata(contractTX, currentTX.inputs[0].outputIndex);
        //const preTX = await API.fetchTXraw(preTxId, this.network);
        const pretxdata = getPreTxdata(preTX, preVout);
        const currentinputsdata = getCurrentInputsdata(currentTX);
        const currenttxdata = getCurrentTxdata(currentTX, currentUnlockIndex);
        const sig = (currentTX.getSignature(currentUnlockIndex, privateKey).length / 2).toString(16).padStart(2, '0') + currentTX.getSignature(currentUnlockIndex, privateKey);
        const publicKey = (privateKey.toPublicKey().toString().length / 2).toString(16).padStart(2, '0') + privateKey.toPublicKey().toString();
        const unlockingScript = new tbc.Script(`${currenttxdata}${prepretxdata}${sig}${publicKey}${currentinputsdata}${contracttxdata}${pretxdata}`);
        return unlockingScript;
    }

    /**
     * Builds the code script for minting FT tokens.
     * @param txid - The transaction ID of the UTXO used for minting.
     * @param vout - The output index of the UTXO.
     * @param address - The recipient's address.
     * @param tapeSize - The size of the tape script.
     * @returns The code script as a tbc.Script object.
     */
    getFTmintCode(txid: string, vout: number, address: string, tapeSize: number): tbc.Script {
        const writer = new tbc.encoding.BufferWriter();
        writer.writeReverse(Buffer.from(txid, 'hex'));
        writer.writeUInt32LE(vout);
        const utxoHex = writer.toBuffer().toString('hex');
        const publicKeyHash = tbc.Address.fromString(address).hashBuffer.toString('hex');
        const hash = publicKeyHash + '00';
        const tapeSizeHex = getSize(tapeSize).toString('hex');

        // The codeScript is constructed with specific opcodes and parameters for FT minting
        const codeScript = new tbc.Script(`OP_9 OP_PICK OP_TOALTSTACK OP_1 OP_PICK OP_SIZE OP_5 OP_SUB OP_SPLIT 0x05 0x4654617065 OP_EQUALVERIFY OP_3 OP_SPLIT OP_8 OP_SPLIT OP_8 OP_SPLIT OP_8 OP_SPLIT OP_8 OP_SPLIT OP_8 OP_SPLIT OP_8 OP_SPLIT OP_DROP OP_BIN2NUM OP_DUP OP_0 OP_EQUAL OP_NOTIF OP_FROMALTSTACK OP_DUP OP_5 0x01 0x28 OP_MUL OP_SPLIT 0x01 0x28 OP_SPLIT OP_DROP OP_TOALTSTACK OP_DROP OP_TOALTSTACK OP_ENDIF OP_SWAP OP_BIN2NUM OP_DUP OP_0 OP_EQUAL OP_NOTIF OP_FROMALTSTACK OP_DUP OP_4 0x01 0x28 OP_MUL OP_SPLIT 0x01 0x28 OP_SPLIT OP_DROP OP_TOALTSTACK OP_DROP OP_TOALTSTACK OP_ENDIF OP_ADD OP_SWAP OP_BIN2NUM OP_DUP OP_0 OP_EQUAL OP_NOTIF OP_FROMALTSTACK OP_DUP OP_3 0x01 0x28 OP_MUL OP_SPLIT 0x01 0x28 OP_SPLIT OP_DROP OP_TOALTSTACK OP_DROP OP_TOALTSTACK OP_ENDIF OP_ADD OP_SWAP OP_BIN2NUM OP_DUP OP_0 OP_EQUAL OP_NOTIF OP_FROMALTSTACK OP_DUP OP_2 0x01 0x28 OP_MUL OP_SPLIT 0x01 0x28 OP_SPLIT OP_DROP OP_TOALTSTACK OP_DROP OP_TOALTSTACK OP_ENDIF OP_ADD OP_SWAP OP_BIN2NUM OP_DUP OP_0 OP_EQUAL OP_NOTIF OP_FROMALTSTACK OP_DUP OP_1 0x01 0x28 OP_MUL OP_SPLIT 0x01 0x28 OP_SPLIT OP_DROP OP_TOALTSTACK OP_DROP OP_TOALTSTACK OP_ENDIF OP_ADD OP_SWAP OP_BIN2NUM OP_DUP OP_0 OP_EQUAL OP_NOTIF OP_FROMALTSTACK OP_DUP OP_0 0x01 0x28 OP_MUL OP_SPLIT 0x01 0x28 OP_SPLIT OP_DROP OP_TOALTSTACK OP_DROP OP_TOALTSTACK OP_ENDIF OP_ADD OP_FROMALTSTACK OP_DROP OP_TOALTSTACK OP_DROP OP_TOALTSTACK OP_SHA256 OP_CAT OP_FROMALTSTACK OP_CAT OP_2 OP_PICK OP_2 OP_PICK OP_CAT OP_TOALTSTACK OP_3 OP_PICK OP_TOALTSTACK OP_TOALTSTACK OP_PARTIAL_HASH OP_CAT OP_CAT OP_FROMALTSTACK OP_CAT OP_SHA256 OP_CAT OP_TOALTSTACK OP_SHA256 OP_FROMALTSTACK OP_CAT OP_CAT OP_SHA256 OP_SHA256 OP_6 OP_PUSH_META 0x01 0x20 OP_SPLIT OP_DROP OP_EQUALVERIFY OP_FROMALTSTACK OP_1 OP_SPLIT OP_NIP 0x01 0x14 OP_SPLIT OP_1 OP_SPLIT OP_DROP OP_BIN2NUM OP_DUP OP_0 OP_EQUAL OP_IF OP_DROP OP_1 OP_PICK OP_HASH160 OP_EQUALVERIFY OP_CHECKSIGVERIFY OP_ELSE OP_1 OP_EQUALVERIFY OP_2 OP_PICK OP_HASH160 OP_EQUALVERIFY OP_TOALTSTACK OP_CAT OP_FROMALTSTACK OP_CAT OP_CAT OP_SHA256 OP_CAT OP_CAT OP_CAT OP_SHA256 OP_SHA256 OP_OVER 0x01 0x20 OP_SPLIT OP_DROP OP_EQUALVERIFY OP_SHA256 OP_5 OP_PUSH_META OP_EQUALVERIFY OP_CHECKSIGVERIFY OP_ENDIF OP_DUP OP_2 OP_EQUAL OP_IF OP_DROP OP_2 OP_PICK OP_2 OP_PICK OP_CAT OP_TOALTSTACK OP_TOALTSTACK OP_PARTIAL_HASH OP_CAT OP_CAT OP_FROMALTSTACK OP_CAT OP_SHA256 OP_CAT OP_CAT OP_CAT OP_SHA256 OP_SHA256 OP_FROMALTSTACK OP_FROMALTSTACK OP_DUP OP_FROMALTSTACK OP_FROMALTSTACK 0x01 0x24 OP_SPLIT OP_DROP OP_DUP OP_TOALTSTACK 0x01 0x20 OP_SPLIT OP_DROP OP_5 OP_ROLL OP_EQUALVERIFY OP_2SWAP OP_EQUAL OP_IF OP_FROMALTSTACK OP_DROP OP_TOALTSTACK OP_TOALTSTACK OP_ELSE OP_FROMALTSTACK 0x24 0x${utxoHex} OP_EQUALVERIFY OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_ENDIF OP_DUP OP_2 OP_EQUAL OP_IF OP_DROP OP_2 OP_PICK OP_2 OP_PICK OP_CAT OP_TOALTSTACK OP_TOALTSTACK OP_PARTIAL_HASH OP_CAT OP_CAT OP_FROMALTSTACK OP_CAT OP_SHA256 OP_CAT OP_CAT OP_CAT OP_SHA256 OP_SHA256 OP_FROMALTSTACK OP_FROMALTSTACK OP_DUP OP_FROMALTSTACK OP_FROMALTSTACK 0x01 0x20 OP_SPLIT OP_DROP OP_5 OP_ROLL OP_EQUALVERIFY OP_2SWAP OP_EQUALVERIFY OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_DUP OP_2 OP_EQUAL OP_IF OP_DROP OP_2 OP_PICK OP_2 OP_PICK OP_CAT OP_TOALTSTACK OP_TOALTSTACK OP_PARTIAL_HASH OP_CAT OP_CAT OP_FROMALTSTACK OP_CAT OP_SHA256 OP_CAT OP_CAT OP_CAT OP_SHA256 OP_SHA256 OP_FROMALTSTACK OP_FROMALTSTACK OP_DUP OP_FROMALTSTACK OP_FROMALTSTACK 0x01 0x20 OP_SPLIT OP_DROP OP_5 OP_ROLL OP_EQUALVERIFY OP_2SWAP OP_EQUALVERIFY OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_DUP OP_2 OP_EQUAL OP_IF OP_DROP OP_2 OP_PICK OP_2 OP_PICK OP_CAT OP_TOALTSTACK OP_TOALTSTACK OP_PARTIAL_HASH OP_CAT OP_CAT OP_FROMALTSTACK OP_CAT OP_SHA256 OP_CAT OP_CAT OP_CAT OP_SHA256 OP_SHA256 OP_FROMALTSTACK OP_FROMALTSTACK OP_DUP OP_FROMALTSTACK OP_FROMALTSTACK 0x01 0x20 OP_SPLIT OP_DROP OP_5 OP_ROLL OP_EQUALVERIFY OP_2SWAP OP_EQUALVERIFY OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_DUP OP_2 OP_EQUAL OP_IF OP_DROP OP_2 OP_PICK OP_2 OP_PICK OP_CAT OP_TOALTSTACK OP_TOALTSTACK OP_PARTIAL_HASH OP_CAT OP_CAT OP_FROMALTSTACK OP_CAT OP_SHA256 OP_CAT OP_CAT OP_CAT OP_SHA256 OP_SHA256 OP_FROMALTSTACK OP_FROMALTSTACK OP_DUP OP_FROMALTSTACK OP_FROMALTSTACK 0x01 0x20 OP_SPLIT OP_DROP OP_5 OP_ROLL OP_EQUALVERIFY OP_2SWAP OP_EQUALVERIFY OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_DUP OP_2 OP_EQUAL OP_IF OP_DROP OP_2 OP_PICK OP_2 OP_PICK OP_CAT OP_TOALTSTACK OP_TOALTSTACK OP_PARTIAL_HASH OP_CAT OP_CAT OP_FROMALTSTACK OP_CAT OP_SHA256 OP_CAT OP_CAT OP_CAT OP_SHA256 OP_SHA256 OP_FROMALTSTACK OP_FROMALTSTACK OP_DUP OP_FROMALTSTACK OP_FROMALTSTACK 0x01 0x20 OP_SPLIT OP_DROP OP_5 OP_ROLL OP_EQUALVERIFY OP_2SWAP OP_EQUALVERIFY OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_DUP OP_2 OP_EQUAL OP_0 OP_EQUALVERIFY OP_7 OP_EQUALVERIFY OP_FROMALTSTACK OP_FROMALTSTACK OP_SWAP OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_DUP OP_2 OP_EQUAL OP_IF OP_DROP OP_DUP OP_SIZE OP_DUP 0x01 0x${tapeSizeHex} OP_EQUAL OP_IF OP_5 OP_SUB OP_SPLIT 0x05 0x4654617065 OP_EQUALVERIFY OP_3 OP_SPLIT OP_SWAP OP_DROP OP_FROMALTSTACK OP_DUP OP_8 OP_MUL OP_2 OP_ROLL OP_SWAP OP_SPLIT OP_8 OP_SPLIT OP_DROP OP_BIN2NUM OP_DUP OP_0 OP_EQUAL OP_NOTIF OP_FROMALTSTACK OP_FROMALTSTACK OP_DUP OP_9 OP_PICK OP_9 OP_PICK OP_CAT OP_EQUALVERIFY OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_FROMALTSTACK OP_SWAP OP_SUB OP_TOALTSTACK OP_DROP OP_TOALTSTACK OP_SHA256 OP_CAT OP_TOALTSTACK OP_PARTIAL_HASH OP_FROMALTSTACK OP_CAT OP_CAT OP_FROMALTSTACK OP_FROMALTSTACK OP_FROMALTSTACK OP_3 OP_ROLL OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_ELSE OP_DROP 0x01 0x${tapeSizeHex} OP_EQUAL OP_IF OP_2 OP_PICK OP_SIZE OP_5 OP_SUB OP_SPLIT 0x05 0x4654617065 OP_EQUAL OP_0 OP_EQUALVERIFY OP_DROP OP_ENDIF OP_PARTIAL_HASH OP_CAT OP_FROMALTSTACK OP_FROMALTSTACK OP_FROMALTSTACK OP_3 OP_ROLL OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_ENDIF OP_DUP OP_2 OP_EQUAL OP_IF OP_DROP OP_DUP OP_SIZE OP_DUP 0x01 0x${tapeSizeHex} OP_EQUAL OP_IF OP_5 OP_SUB OP_SPLIT 0x05 0x4654617065 OP_EQUALVERIFY OP_3 OP_SPLIT OP_SWAP OP_DROP OP_FROMALTSTACK OP_DUP OP_8 OP_MUL OP_2 OP_ROLL OP_SWAP OP_SPLIT OP_8 OP_SPLIT OP_DROP OP_BIN2NUM OP_DUP OP_0 OP_EQUAL OP_NOTIF OP_FROMALTSTACK OP_FROMALTSTACK OP_DUP OP_9 OP_PICK OP_9 OP_PICK OP_CAT OP_EQUALVERIFY OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_FROMALTSTACK OP_SWAP OP_SUB OP_TOALTSTACK OP_DROP OP_TOALTSTACK OP_SHA256 OP_CAT OP_TOALTSTACK OP_PARTIAL_HASH OP_FROMALTSTACK OP_CAT OP_CAT OP_FROMALTSTACK OP_FROMALTSTACK OP_FROMALTSTACK OP_3 OP_ROLL OP_FROMALTSTACK OP_CAT OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_ELSE OP_DROP 0x01 0x${tapeSizeHex} OP_EQUAL OP_IF OP_2 OP_PICK OP_SIZE OP_5 OP_SUB OP_SPLIT 0x05 0x4654617065 OP_EQUAL OP_0 OP_EQUALVERIFY OP_DROP OP_ENDIF OP_PARTIAL_HASH OP_CAT OP_FROMALTSTACK OP_FROMALTSTACK OP_FROMALTSTACK OP_3 OP_ROLL OP_FROMALTSTACK OP_CAT OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_ENDIF OP_DUP OP_2 OP_EQUAL OP_IF OP_DROP OP_DUP OP_SIZE OP_DUP 0x01 0x${tapeSizeHex} OP_EQUAL OP_IF OP_5 OP_SUB OP_SPLIT 0x05 0x4654617065 OP_EQUALVERIFY OP_3 OP_SPLIT OP_SWAP OP_DROP OP_FROMALTSTACK OP_DUP OP_8 OP_MUL OP_2 OP_ROLL OP_SWAP OP_SPLIT OP_8 OP_SPLIT OP_DROP OP_BIN2NUM OP_DUP OP_0 OP_EQUAL OP_NOTIF OP_FROMALTSTACK OP_FROMALTSTACK OP_DUP OP_9 OP_PICK OP_9 OP_PICK OP_CAT OP_EQUALVERIFY OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_FROMALTSTACK OP_SWAP OP_SUB OP_TOALTSTACK OP_DROP OP_TOALTSTACK OP_SHA256 OP_CAT OP_TOALTSTACK OP_PARTIAL_HASH OP_FROMALTSTACK OP_CAT OP_CAT OP_FROMALTSTACK OP_FROMALTSTACK OP_FROMALTSTACK OP_3 OP_ROLL OP_FROMALTSTACK OP_CAT OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_ELSE OP_DROP 0x01 0x${tapeSizeHex} OP_EQUAL OP_IF OP_2 OP_PICK OP_SIZE OP_5 OP_SUB OP_SPLIT 0x05 0x4654617065 OP_EQUAL OP_0 OP_EQUALVERIFY OP_DROP OP_ENDIF OP_PARTIAL_HASH OP_CAT OP_FROMALTSTACK OP_FROMALTSTACK OP_FROMALTSTACK OP_3 OP_ROLL OP_FROMALTSTACK OP_CAT OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_ENDIF OP_DUP OP_2 OP_EQUAL OP_IF OP_DROP OP_DUP OP_SIZE OP_DUP 0x01 0x${tapeSizeHex} OP_EQUAL OP_IF OP_5 OP_SUB OP_SPLIT 0x05 0x4654617065 OP_EQUALVERIFY OP_3 OP_SPLIT OP_SWAP OP_DROP OP_FROMALTSTACK OP_DUP OP_8 OP_MUL OP_2 OP_ROLL OP_SWAP OP_SPLIT OP_8 OP_SPLIT OP_DROP OP_BIN2NUM OP_DUP OP_0 OP_EQUAL OP_NOTIF OP_FROMALTSTACK OP_FROMALTSTACK OP_DUP OP_9 OP_PICK OP_9 OP_PICK OP_CAT OP_EQUALVERIFY OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_FROMALTSTACK OP_SWAP OP_SUB OP_TOALTSTACK OP_DROP OP_TOALTSTACK OP_SHA256 OP_CAT OP_TOALTSTACK OP_PARTIAL_HASH OP_FROMALTSTACK OP_CAT OP_CAT OP_FROMALTSTACK OP_FROMALTSTACK OP_FROMALTSTACK OP_3 OP_ROLL OP_FROMALTSTACK OP_CAT OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_ELSE OP_DROP 0x01 0x${tapeSizeHex} OP_EQUAL OP_IF OP_2 OP_PICK OP_SIZE OP_5 OP_SUB OP_SPLIT 0x05 0x4654617065 OP_EQUAL OP_0 OP_EQUALVERIFY OP_DROP OP_ENDIF OP_PARTIAL_HASH OP_CAT OP_FROMALTSTACK OP_FROMALTSTACK OP_FROMALTSTACK OP_3 OP_ROLL OP_FROMALTSTACK OP_CAT OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_ENDIF OP_DUP OP_2 OP_EQUAL OP_IF OP_DROP OP_DUP OP_SIZE OP_DUP 0x01 0x${tapeSizeHex} OP_EQUAL OP_IF OP_5 OP_SUB OP_SPLIT 0x05 0x4654617065 OP_EQUALVERIFY OP_3 OP_SPLIT OP_SWAP OP_DROP OP_FROMALTSTACK OP_DUP OP_8 OP_MUL OP_2 OP_ROLL OP_SWAP OP_SPLIT OP_8 OP_SPLIT OP_DROP OP_BIN2NUM OP_DUP OP_0 OP_EQUAL OP_NOTIF OP_FROMALTSTACK OP_FROMALTSTACK OP_DUP OP_9 OP_PICK OP_9 OP_PICK OP_CAT OP_EQUALVERIFY OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_FROMALTSTACK OP_SWAP OP_SUB OP_TOALTSTACK OP_DROP OP_TOALTSTACK OP_SHA256 OP_CAT OP_TOALTSTACK OP_PARTIAL_HASH OP_FROMALTSTACK OP_CAT OP_CAT OP_FROMALTSTACK OP_FROMALTSTACK OP_FROMALTSTACK OP_3 OP_ROLL OP_FROMALTSTACK OP_CAT OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_ELSE OP_DROP 0x01 0x${tapeSizeHex} OP_EQUAL OP_IF OP_2 OP_PICK OP_SIZE OP_5 OP_SUB OP_SPLIT 0x05 0x4654617065 OP_EQUAL OP_0 OP_EQUALVERIFY OP_DROP OP_ENDIF OP_PARTIAL_HASH OP_CAT OP_FROMALTSTACK OP_FROMALTSTACK OP_FROMALTSTACK OP_3 OP_ROLL OP_FROMALTSTACK OP_CAT OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_ENDIF OP_DUP OP_2 OP_EQUAL OP_IF OP_DROP OP_DUP OP_SIZE OP_DUP 0x01 0x${tapeSizeHex} OP_EQUAL OP_IF OP_5 OP_SUB OP_SPLIT 0x05 0x4654617065 OP_EQUALVERIFY OP_3 OP_SPLIT OP_SWAP OP_DROP OP_FROMALTSTACK OP_DUP OP_8 OP_MUL OP_2 OP_ROLL OP_SWAP OP_SPLIT OP_8 OP_SPLIT OP_DROP OP_BIN2NUM OP_DUP OP_0 OP_EQUAL OP_NOTIF OP_FROMALTSTACK OP_FROMALTSTACK OP_DUP OP_9 OP_PICK OP_9 OP_PICK OP_CAT OP_EQUALVERIFY OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_FROMALTSTACK OP_SWAP OP_SUB OP_TOALTSTACK OP_DROP OP_TOALTSTACK OP_SHA256 OP_CAT OP_TOALTSTACK OP_PARTIAL_HASH OP_FROMALTSTACK OP_CAT OP_CAT OP_FROMALTSTACK OP_FROMALTSTACK OP_FROMALTSTACK OP_3 OP_ROLL OP_FROMALTSTACK OP_CAT OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_ELSE OP_DROP 0x01 0x${tapeSizeHex} OP_EQUAL OP_IF OP_2 OP_PICK OP_SIZE OP_5 OP_SUB OP_SPLIT 0x05 0x4654617065 OP_EQUAL OP_0 OP_EQUALVERIFY OP_DROP OP_ENDIF OP_PARTIAL_HASH OP_CAT OP_FROMALTSTACK OP_FROMALTSTACK OP_FROMALTSTACK OP_3 OP_ROLL OP_FROMALTSTACK OP_CAT OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_ENDIF OP_DUP OP_2 OP_EQUAL OP_IF OP_DROP OP_DUP OP_SIZE OP_DUP 0x01 0x${tapeSizeHex} OP_EQUAL OP_IF OP_5 OP_SUB OP_SPLIT 0x05 0x4654617065 OP_EQUALVERIFY OP_3 OP_SPLIT OP_SWAP OP_DROP OP_FROMALTSTACK OP_DUP OP_8 OP_MUL OP_2 OP_ROLL OP_SWAP OP_SPLIT OP_8 OP_SPLIT OP_DROP OP_BIN2NUM OP_DUP OP_0 OP_EQUAL OP_NOTIF OP_FROMALTSTACK OP_FROMALTSTACK OP_DUP OP_9 OP_PICK OP_9 OP_PICK OP_CAT OP_EQUALVERIFY OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_FROMALTSTACK OP_SWAP OP_SUB OP_TOALTSTACK OP_DROP OP_TOALTSTACK OP_SHA256 OP_CAT OP_TOALTSTACK OP_PARTIAL_HASH OP_FROMALTSTACK OP_CAT OP_CAT OP_FROMALTSTACK OP_FROMALTSTACK OP_FROMALTSTACK OP_3 OP_ROLL OP_FROMALTSTACK OP_CAT OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_ELSE OP_DROP 0x01 0x${tapeSizeHex} OP_EQUAL OP_IF OP_2 OP_PICK OP_SIZE OP_5 OP_SUB OP_SPLIT 0x05 0x4654617065 OP_EQUAL OP_0 OP_EQUALVERIFY OP_DROP OP_ENDIF OP_PARTIAL_HASH OP_CAT OP_FROMALTSTACK OP_FROMALTSTACK OP_FROMALTSTACK OP_3 OP_ROLL OP_FROMALTSTACK OP_CAT OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_ENDIF OP_DUP OP_2 OP_EQUAL OP_IF OP_DROP OP_DUP OP_SIZE OP_DUP 0x01 0x${tapeSizeHex} OP_EQUAL OP_IF OP_5 OP_SUB OP_SPLIT 0x05 0x4654617065 OP_EQUALVERIFY OP_3 OP_SPLIT OP_SWAP OP_DROP OP_FROMALTSTACK OP_DUP OP_8 OP_MUL OP_2 OP_ROLL OP_SWAP OP_SPLIT OP_8 OP_SPLIT OP_DROP OP_BIN2NUM OP_DUP OP_0 OP_EQUAL OP_NOTIF OP_FROMALTSTACK OP_FROMALTSTACK OP_DUP OP_9 OP_PICK OP_9 OP_PICK OP_CAT OP_EQUALVERIFY OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_FROMALTSTACK OP_SWAP OP_SUB OP_TOALTSTACK OP_DROP OP_TOALTSTACK OP_SHA256 OP_CAT OP_TOALTSTACK OP_PARTIAL_HASH OP_FROMALTSTACK OP_CAT OP_CAT OP_FROMALTSTACK OP_FROMALTSTACK OP_FROMALTSTACK OP_3 OP_ROLL OP_FROMALTSTACK OP_CAT OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_ELSE OP_DROP 0x01 0x${tapeSizeHex} OP_EQUAL OP_IF OP_2 OP_PICK OP_SIZE OP_5 OP_SUB OP_SPLIT 0x05 0x4654617065 OP_EQUAL OP_0 OP_EQUALVERIFY OP_DROP OP_ENDIF OP_PARTIAL_HASH OP_CAT OP_FROMALTSTACK OP_FROMALTSTACK OP_FROMALTSTACK OP_3 OP_ROLL OP_FROMALTSTACK OP_CAT OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_TOALTSTACK OP_ENDIF OP_ENDIF OP_DUP OP_2 OP_EQUAL OP_0 OP_EQUALVERIFY OP_FROMALTSTACK OP_FROMALTSTACK OP_0 OP_EQUALVERIFY OP_DROP OP_1 OP_EQUALVERIFY OP_FROMALTSTACK OP_FROMALTSTACK OP_SHA256 OP_7 OP_PUSH_META OP_EQUAL OP_NIP 0x21 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff OP_DROP OP_RETURN 0x15 0x${hash} 0x05 0x32436f6465`);
        return codeScript;
    }

    /**
     * Builds the code script for transferring FT to a new address or hash.
     * @param code - The original code script in hex.
     * @param addressOrHash - The recipient's address or hash.
     * @returns The new code script as a tbc.Script object.
     */
    static buildFTtransferCode(code: string, addressOrHash: string): tbc.Script {
        if (tbc.Address.isValid(addressOrHash)) {
            // If the recipient is an address
            const publicKeyHashBuffer = tbc.Address.fromString(addressOrHash).hashBuffer;
            const hashBuffer = Buffer.concat([publicKeyHashBuffer, Buffer.from([0x00])]);
            const codeBuffer = Buffer.from(code, 'hex');
            hashBuffer.copy(codeBuffer, 1537, 0, 21); // Replace the hash in the code script
            const codeScript = new tbc.Script(codeBuffer.toString('hex'));
            return codeScript;
        } else {
            // If the recipient is a hash
            if (addressOrHash.length !== 40) {
                throw new Error('Invalid address or hash');
            }
            const hash = addressOrHash + '01';
            const hashBuffer = Buffer.from(hash, 'hex');
            const codeBuffer = Buffer.from(code, 'hex');
            hashBuffer.copy(codeBuffer, 1537, 0, 21); // Replace the hash in the code script
            const codeScript = new tbc.Script(codeBuffer.toString('hex'));
            return codeScript;
        }
    }

    /**
     * Builds the tape script with the specified amount for transfer.
     * @param tape - The original tape script in hex.
     * @param amountHex - The amount in hex format.
     * @returns The new tape script as a tbc.Script object.
     */
    static buildFTtransferTape(tape: string, amountHex: string): tbc.Script {
        const amountHexBuffer = Buffer.from(amountHex, 'hex');
        const tapeBuffer = Buffer.from(tape, 'hex');
        amountHexBuffer.copy(tapeBuffer, 3, 0, 48); // Replace the amount in the tape script
        const tapeScript = new tbc.Script(tapeBuffer.toString('hex'));
        return tapeScript;
    }

    /**
     * Builds the amount and change hex strings for the tape script.
     * @param amountBN - The amount to transfer in BN format.
     * @param tapeAmountSet - The set of amounts from the input tapes.
     * @param ftInputIndex - (Optional) The index of the FT input.
     * @returns An object containing amountHex and changeHex.
     */
    static buildTapeAmount(amountBN: bigint, tapeAmountSet: bigint[], ftInputIndex?: number) {
        let i = 0;
        let j = 0;
        const amountwriter = new tbc.encoding.BufferWriter();
        const changewriter = new tbc.encoding.BufferWriter();
        // Initialize with zeros if ftInputIndex is provided
        if (ftInputIndex) {
            for (j = 0; j < ftInputIndex; j++) {
                amountwriter.writeUInt64LEBN(new tbc.crypto.BN(0));
                changewriter.writeUInt64LEBN(new tbc.crypto.BN(0));
            }
        }
        // Build the amount and change for each tape slot
        for (i = 0; i < 6; i++) {
            if (amountBN <= BigInt(0)) {
                break;
            }
            if (tapeAmountSet[i] < amountBN) {
                amountwriter.writeUInt64LEBN(new tbc.crypto.BN(tapeAmountSet[i].toString()));
                changewriter.writeUInt64LEBN(new tbc.crypto.BN(0));
                amountBN -= BigInt(tapeAmountSet[i]);
            } else {
                amountwriter.writeUInt64LEBN(new tbc.crypto.BN(amountBN.toString()));
                changewriter.writeUInt64LEBN(new tbc.crypto.BN((BigInt(tapeAmountSet[i]) - amountBN).toString()));
                amountBN = BigInt(0);
            }
        }
        // Fill the remaining slots with zeros or remaining amounts
        for (j += i; i < 6 && j < 6; i++, j++) {
            if (tapeAmountSet[i]) {
                amountwriter.writeUInt64LEBN(new tbc.crypto.BN(0));
                changewriter.writeUInt64LEBN(new tbc.crypto.BN(tapeAmountSet[i].toString()));
            } else {
                amountwriter.writeUInt64LEBN(new tbc.crypto.BN(0));
                changewriter.writeUInt64LEBN(new tbc.crypto.BN(0));
            }
        }
        const amountHex = amountwriter.toBuffer().toString('hex');
        const changeHex = changewriter.toBuffer().toString('hex');
        return { amountHex, changeHex };
    }

}

module.exports = FT;