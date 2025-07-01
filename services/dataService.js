import mongoose from 'mongoose';
import TokenData from '../models/TokenData.js';
// import config from '../config/default.json'; // Ensure this path is correct
import config from '../config/default.json' assert { type: 'json' };

const MONGODB_URI = process.env.MONGODB_URI;
const HISTORY_RETENTION_LIMIT = config.historyRetentionLimit;

/**
 * Establishes a connection to MongoDB.
 */
export async function connectDb() {
    if (mongoose.connection.readyState === 1) {
        console.log('Already connected to MongoDB.');
        return;
    }
    try {
        await mongoose.connect(MONGODB_URI, {
            // useNewUrlParser: true, // Deprecated in Mongoose 6+
            // useUnifiedTopology: true, // Deprecated in Mongoose 6+
        });
        console.log('MongoDB connected successfully.');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1); // Exit process if cannot connect to DB
    }
}

/**
 * Initializes (or updates) a token pair's metadata in the database.
 * This ensures an entry exists for each monitored pair.
 * @param {object} pairData - The initial metadata for the token pair from Dexscreener.
 */
export async function initializeTokenData(pairData) {
    try {
        const { pairAddress, chainId, baseToken, quoteToken, pairCreatedAt, pairName } = pairData;

        // Ensure proper object structure for baseToken and quoteToken
        const baseTokenAddress = baseToken.address;
        const baseTokenSymbol = baseToken.symbol;
        const targetTokenAddress = quoteToken.address; // For Dexscreener, quoteToken is often the one you're interested in
        const targetTokenSymbol = quoteToken.symbol;
        const targetTokenName = quoteToken.name || quoteToken.symbol; // Dexscreener might not always provide name

        let tokenDoc = await TokenData.findOne({ pairAddress });

        if (!tokenDoc) {
            tokenDoc = new TokenData({
                pairAddress,
                chainId,
                baseTokenAddress,
                baseTokenSymbol,
                targetTokenAddress,
                targetTokenSymbol,
                targetTokenName,
                pairName,
                priceHistory: [],
                volumeHistory: [],
                liquidityHistory: [],
                lastUpdated: new Date()
            });
            console.log(`Initialized new token pair: ${pairName} (${pairAddress})`);
        } else {
            // Update metadata if needed (e.g., symbol, name might change, though rare for addresses)
            tokenDoc.baseTokenAddress = baseTokenAddress;
            tokenDoc.baseTokenSymbol = baseTokenSymbol;
            tokenDoc.targetTokenAddress = targetTokenAddress;
            tokenDoc.targetTokenSymbol = targetTokenSymbol;
            tokenDoc.targetTokenName = targetTokenName;
            tokenDoc.pairName = pairName;
            tokenDoc.lastUpdated = new Date();
        }
        await tokenDoc.save();
        return tokenDoc;
    } catch (error) {
        console.error(`Error initializing/updating token data for pair ${pairData.pairAddress}:`, error);
        return null;
    }
}

/**
 * Updates the historical market data for a given token pair.
 * It also prunes history to keep it within the retention limit.
 * @param {string} pairAddress - The unique address of the token pair.
 * @param {number} currentPrice - The current price of the token.
 * @param {number} currentVolume - The current 24h volume.
 * @param {number} currentLiquidity - The current total liquidity.
 */
export async function updateMarketData(pairAddress, currentPrice, currentVolume, currentLiquidity) {
    try {
        const tokenDoc = await TokenData.findOne({ pairAddress });

        if (!tokenDoc) {
            console.warn(`Attempted to update non-existent token pair: ${pairAddress}. Initialize first.`);
            return;
        }

        const now = new Date();

        // Add new data points
        tokenDoc.priceHistory.push({ price: currentPrice, timestamp: now });
        tokenDoc.volumeHistory.push({ volume: currentVolume, timestamp: now });
        tokenDoc.liquidityHistory.push({ liquidity: currentLiquidity, timestamp: now });

        // Prune historical arrays to maintain a fixed size (HISTORY_RETENTION_LIMIT)
        if (tokenDoc.priceHistory.length > HISTORY_RETENTION_LIMIT) {
            tokenDoc.priceHistory = tokenDoc.priceHistory.slice(-HISTORY_RETENTION_LIMIT);
        }
        if (tokenDoc.volumeHistory.length > HISTORY_RETENTION_LIMIT) {
            tokenDoc.volumeHistory = tokenDoc.volumeHistory.slice(-HISTORY_RETENTION_LIMIT);
        }
        if (tokenDoc.liquidityHistory.length > HISTORY_RETENTION_LIMIT) {
            tokenDoc.liquidityHistory = tokenDoc.liquidityHistory.slice(-HISTORY_RETENTION_LIMIT);
        }

        tokenDoc.lastUpdated = now;
        await tokenDoc.save();
    } catch (error) {
        console.error(`Error updating market data for ${pairAddress}:`, error);
    }
}

/**
 * Retrieves the full historical price data for a given token pair.
 * @param {string} pairAddress - The unique address of the token pair.
 * @returns {Array<object>} An array of price history objects.
 */
export async function getPriceHistory(pairAddress) {
    try {
        const tokenDoc = await TokenData.findOne({ pairAddress }, { priceHistory: 1 });
        return tokenDoc ? tokenDoc.priceHistory : [];
    } catch (error) {
        console.error(`Error fetching price history for ${pairAddress}:`, error);
        return [];
    }
}

/**
 * Retrieves the full historical volume data for a given token pair.
 * @param {string} pairAddress - The unique address of the token pair.
 * @returns {Array<object>} An array of volume history objects.
 */
export async function getVolumeHistory(pairAddress) {
    try {
        const tokenDoc = await TokenData.findOne({ pairAddress }, { volumeHistory: 1 });
        return tokenDoc ? tokenDoc.volumeHistory : [];
    } catch (error) {
        console.error(`Error fetching volume history for ${pairAddress}:`, error);
        return [];
    }
}

/**
 * Retrieves the full historical liquidity data for a given token pair.
 * @param {string} pairAddress - The unique address of the token pair.
 * @returns {Array<object>} An array of liquidity history objects.
 */
export async function getLiquidityHistory(pairAddress) {
    try {
        const tokenDoc = await TokenData.findOne({ pairAddress }, { liquidityHistory: 1 });
        return tokenDoc ? tokenDoc.liquidityHistory : [];
    } catch (error) {
        console.error(`Error fetching liquidity history for ${pairAddress}:`, error);
        return [];
    }
}

/**
 * Retrieves the full TokenData document for a given pair address.
 * @param {string} pairAddress - The unique address of the token pair.
 * @returns {object|null} The token document or null if not found.
 */
export async function getTokenData(pairAddress) {
    try {
        return await TokenData.findOne({ pairAddress });
    } catch (error) {
        console.error(`Error fetching token data for ${pairAddress}:`, error);
        return null;
    }
}