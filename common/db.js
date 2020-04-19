const {MongoClient} = require('mongodb');
const Web3 = require('web3');
const { SWAP_STATUS_UNSIGNED, SWAP_STATUS_SUBMITTED, SWAP_STATUS_SIGNED, SWAP_STATUS_CONFIRMED} = require('./constants');

const SWAP_COLLECTION = 'swap';
const SIGNATURE_COLLECTION = 'signature';

class Db {
    constructor(url, dbName) {
        this.url = url;
        this.dbName = dbName;
    }

    async init() {
        this.client = await MongoClient.connect(this.url);
        this.db = this.client.db(this.dbName);
    }

    async teardown() {
        if (!this.client) {
            throw new Error('No Mongo client, accountant not initialized');
        }
        console.log('Closing db connection');
        return this.client.close();
    }

    async clear(collection) {
        await this.db.collection(collection).deleteMany({});
        console.log('Deleted all rows', collection);
    }

    /**
     * Insert LogBurn event emitted by Ethereum
     *
     * @param {Swap} unsignedSwap
     */
    async insertUnsignedSwap(unsignedSwap) {
        const record = {
            ...unsignedSwap,
            amount: unsignedSwap.amount.toString(),
            nonce: unsignedSwap.amount.toString(),
        };
        this.db.collection(SWAP_COLLECTION).insertOne(record);
    }

    async insertSignature(user, transactionHash, signature) {
        const record = {_id: signature.signature, user, transactionHash, signature};
        this.db.collection(SIGNATURE_COLLECTION).insertOne(record);
    }

    /**
     * Fetch the specified swap
     *
     * @param {string} transactionHash
     * @returns {Promise<Swap>}
     */
    async fetchSwap(transactionHash) {
        const query = {_id: transactionHash};
        const swap = await this.db.collection(SWAP_COLLECTION).findOne(query);
        swap.amount = Web3.utils.toBN(swap.amount);
        swap.nonce = Web3.utils.toBN(swap.nonce);
        return swap;
    }

    /**
     * Fetch the specified unsigned tx encoded in JSON
     *
     * @param {string} transactionHash
     * @returns {Promise<string>}
     */
    async fetchUnsignedTx(transactionHash) {
        const query = {_id: transactionHash};
        const swap = await this.db.collection(SWAP_COLLECTION).findOne(query);
        return swap.unsignedTx;
    }

    /**
     * Updates the swap status.
     * @param mintTransactionHash - The Enigma Chain mint transaction hash
     * @param status - blockchain status
     */
    async updateSwapStatus(transactionHash, mintTransactionHash, status) {
        console.log(`updating swap ethTxHash=${transactionHash}, mintTransactionHash=${mintTransactionHash}, status=${status}`)
        if (!(mintTransactionHash && status)) {
            return
        } else if (!status >= SWAP_STATUS_SIGNED && status <= SWAP_STATUS_CONFIRMED) {
            throw new Error("Invalid status")
        }

        const query = {_id: transactionHash};
        
        var values = { $set: {status: status, mintTransactionHash: mintTransactionHash } };
        this.db.collection(SWAP_COLLECTION).updateOne(query, values, function(err, res) {
            if (err) throw err;
            console.log(`Updates transactionHash=${transactionHash}`);
        });
    }

    /**
     * Find all by status.
     *
     * @returns {Promise<Array<Swap>>}
     */
    async findAllByStatus(status) {
        const query = {status: status};
        const result = await this.db.collection(SWAP_COLLECTION).find(query);
        const swaps = await result.toArray();
        for (const swap of swaps) {
            swap.amount = Web3.utils.toBN(swap.amount);
            swap.nonce = Web3.utils.toBN(swap.nonce);
        }
        return swaps;
    }

    /**
     * Finds above threshold swap (multisig tx candidates)
     *
     * @param {number} threshold
     * @returns {Promise<Array<AboveThresholdUnsignedSwap>>}
     */
    async findAboveThresholdUnsignedSwaps(threshold) {
        const unsignedSwaps = await this.findAllByStatus(SWAP_STATUS_UNSIGNED);
        const aboveThresholdUnsignedSwaps = [];
        for (const swap of unsignedSwaps) {
            const {transactionHash, unsignedTx, status} = swap;
            // TODO: Consider indexing this field
            const query = {transactionHash: swap.transactionHash};
            // Slightly inefficient to fetch results instead on counting, but saves us from querying twice
            const result = await this.db.collection(SIGNATURE_COLLECTION).find(query);
            const signatures = await result.toArray();
            if (signatures.length >= threshold) {
                aboveThresholdUnsignedSwaps.push({
                    transactionHash,
                    unsignedTx,
                    status,
                    signatures,
                });
            }
        }
        return aboveThresholdUnsignedSwaps;
    }
}

module.exports = {Db, SWAP_COLLECTION, SIGNATURE_COLLECTION};
