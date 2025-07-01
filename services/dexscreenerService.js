// import axios from 'axios';
// // import config from '../config/default.json';
// import config from '../config/default.json' assert { type: 'json' };

// const DEXSCREENER_API_BASE_URL = config.dexscreenerApiBaseUrl;
// const TARGET_CHAIN_ID = config.targetChainId; // e.g., 'bsc'
// const BASE_CURRENCY_ADDRESS = config.baseCurrencyAddress.toLowerCase(); // Ensure lowercase for comparison

// /**
//  * Fetches pair data from Dexscreener using a specific pair address.
//  * @param {string} pairAddress - The unique pair address (e.g., PancakeSwap V2 pool address).
//  * @returns {object|null} The pair data or null if not found/error.
//  */
// async function getPairDataByPairAddress(pairAddress) {
//     try {
//         const url = `${DEXSCREENER_API_BASE_URL}${TARGET_CHAIN_ID}/${pairAddress}`;
//         const response = await axios.get(url);

//         if (response.data && response.data.pairs && response.data.pairs.length > 0) {
//             return response.data.pairs[0]; // Dexscreener returns an array, take the first one
//         }
//         return null;
//     } catch (error) {
//         console.error(`Error fetching pair data for ${pairAddress} from Dexscreener:`, error.message);
//         return null;
//     }
// }

// /**
//  * Searches for a pair on Dexscreener by token addresses.
//  * Useful if you only have the token address and need to find its pair with the base currency.
//  * Dexscreener's search might return multiple pairs; we'll try to find the primary one.
//  * @param {string} targetTokenAddress - The address of the token you're interested in.
//  * @param {string} baseTokenAddress - The address of the base currency (e.g., BUSD).
//  * @returns {object|null} The found pair data or null.
//  */
// async function searchPairByTokens(targetTokenAddress, baseTokenAddress) {
//     try {
//         // Dexscreener API expects token addresses separated by comma for multi-token search
//         const url = `${DEXSCREENER_API_BASE_URL}${TARGET_CHAIN_ID}/${targetTokenAddress.toLowerCase()},${baseTokenAddress.toLowerCase()}`;
//         const response = await axios.get(url);

//         if (response.data && response.data.pairs && response.data.pairs.length > 0) {
//             // Filter to find the pair where the base and quote match our criteria exactly.
//             // Prioritize pairs with a non-zero liquidity and relevant base/quote tokens.
//             const relevantPairs = response.data.pairs.filter(pair => {
//                 const isTargetToken = pair.baseToken.address.toLowerCase() === targetTokenAddress.toLowerCase() ||
//                                       pair.quoteToken.address.toLowerCase() === targetTokenAddress.toLowerCase();
//                 const isBaseToken = pair.baseToken.address.toLowerCase() === baseTokenAddress.toLowerCase() ||
//                                     pair.quoteToken.address.toLowerCase() === baseTokenAddress.toLowerCase();
//                 return isTargetToken && isBaseToken && pair.liquidity && pair.liquidity.usd > 0;
//             });

//             // Try to find the specific pair where targetToken is the quoteToken (common setup)
//             const exactPair = relevantPairs.find(pair =>
//                 pair.quoteToken.address.toLowerCase() === targetTokenAddress.toLowerCase() &&
//                 pair.baseToken.address.toLowerCase() === baseTokenAddress.toLowerCase()
//             );

//             if (exactPair) {
//                 return exactPair;
//             }

//             // If not found, return the most liquid relevant pair, or just the first one
//             if (relevantPairs.length > 0) {
//                 relevantPairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
//                 return relevantPairs[0];
//             }
//         }
//         return null;
//     } catch (error) {
//         // Dexscreener returns 404 for no pairs, which axios throws as an error. Handle gracefully.
//         if (axios.isAxiosError(error) && error.response && error.response.status === 404) {
//             console.log(`No Dexscreener pair found for ${targetTokenAddress}/${baseTokenAddress} on ${TARGET_CHAIN_ID}.`);
//         } else {
//             console.error(`Error searching for pair ${targetTokenAddress}/${baseTokenAddress} on Dexscreener:`, error.message);
//         }
//         return null;
//     }
// }


// /**
//  * Fetches comprehensive market data for a given target token.
//  * This function will search for the relevant pair on Dexscreener using the base currency.
//  * @param {string} targetTokenAddress - The address of the token to get market data for.
//  * @returns {object|null} Structured market data including price, volume, liquidity, and pair metadata.
//  */
// export async function getMarketData(targetTokenAddress) {
//     try {
//         const pairData = await searchPairByTokens(targetTokenAddress, BASE_CURRENCY_ADDRESS);

//         if (!pairData) {
//             console.warn(`Dexscreener: Could not find a suitable pair for ${targetTokenAddress} with ${config.baseCurrencySymbol}.`);
//             return null;
//         }

//         // Extract relevant data
//         const currentPrice = parseFloat(pairData.priceUsd) || 0;
//         const currentVolume = parseFloat(pairData.volume?.h24) || 0;
//         const currentLiquidity = parseFloat(pairData.liquidity?.usd) || 0;

//         return {
//             pairAddress: pairData.pairAddress,
//             chainId: pairData.chainId,
//             pairName: pairData.pairName,
//             baseToken: pairData.baseToken,
//             quoteToken: pairData.quoteToken, // This is the 'target' token in our context
//             currentPrice,
//             currentVolume,
//             currentLiquidity
//         };

//     } catch (error) {
//         console.error(`Failed to get market data for ${targetTokenAddress}:`, error);
//         return null;
//     }
// }

// backend/services/dexscreenerService.js

import axios from 'axios';
import config from '../config/default.json' assert { type: 'json' };

const DEXSCREENER_API_SEARCH_BASE_URL = config.dexscreenerApiSearchBaseUrl; // Updated base URL
const TARGET_CHAIN_ID = config.targetChainId;
const PREFERRED_QUOTE_TOKEN_SYMBOLS = config.preferredQuoteTokenSymbols.map(s => s.toUpperCase());
const DEXSCREENER_CALL_DELAY_MS = config.dexscreenerCallDelayMs || 0;
/**
 * Fetches comprehensive market data for a given target token symbol using Dexscreener's /latest/dex/search endpoint.
 * It queries for the token symbol paired with preferred quote tokens (WBNB/BUSD),
 * filters for PancakeSwap pairs on the target chain, and selects the one with the highest liquidity.
 *
 * @param {object} token - The token object containing symbol and address.
 * @returns {object|null} Structured market data including price, volume, liquidity, and pair metadata.
 */
export async function getMarketData(tokenaddress, tokensymbol) {
    const targetTokenSymbol = tokensymbol;
    const targetTokenAddress = tokenaddress;

    let selectedPair = null;

    // Iterate through preferred quote tokens and try to find a pair
    for (const quoteSymbol of PREFERRED_QUOTE_TOKEN_SYMBOLS) {
        // Construct the query string for the search endpoint
        const queryString = `${targetTokenSymbol}/${quoteSymbol}`;
        const url = `${DEXSCREENER_API_SEARCH_BASE_URL}?q=${queryString}`;
        console.log(`Fetching Dexscreener data for ${queryString} from: ${url}`);

        try {
            const response = await axios.get(url);

            if (!response.data || !response.data.pairs || response.data.pairs.length === 0) {
                console.log(`Dexscreener: No pairs found for query "${queryString}". Trying next quote token...`);
                continue; // Try the next preferred quote token
            }

            const allPairsForQuery = response.data.pairs;

            // Filter for PancakeSwap and the exact chain ID
            const relevantPairs = allPairsForQuery.filter(pair => {
                const isPancakeSwap = pair.dexId.toLowerCase() === 'pancakeswap';
                const isOnTargetChain = pair.chainId.toLowerCase() === TARGET_CHAIN_ID.toLowerCase();

                // Ensure that our target token address is part of this pair
                const isTargetTokenInPair =
                    pair.baseToken.address.toLowerCase() === targetTokenAddress.toLowerCase() ||
                    pair.quoteToken.address.toLowerCase() === targetTokenAddress.toLowerCase();

                // Ensure the quote token is the one we are currently trying to match (WBNB or BUSD)
                const isQuoteTokenMatched = pair.quoteToken.symbol.toUpperCase() === quoteSymbol.toUpperCase();

                // Also ensure it has some liquidity (important to filter out defunct pairs)
                const hasLiquidity = pair.liquidity && pair.liquidity.usd > 0;

                return isPancakeSwap && isOnTargetChain && isTargetTokenInPair && isQuoteTokenMatched && hasLiquidity;
            });

            if (relevantPairs.length > 0) {
                // Sort by liquidity (USD) in descending order to pick the most liquid pair
                relevantPairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
                selectedPair = relevantPairs[0];
                break; // Found a suitable pair, stop searching
            }

        } catch (error) {
            if (error.response && error.response.status === 429) {
                console.error("Dexscreener rate limit hit:", error.message);
                throw { isRateLimit: true, message: "Dexscreener rate limit hit" };
            }
            if (axios.isAxiosError(error) && error.response) {
                console.error(`Dexscreener API error for ${queryString} (HTTP ${error.response.status}):`, error.response.data);
            } else {
                console.error(`Failed to get market data for ${queryString} from Dexscreener:`, error.message);
            }
            // Continue to next quote symbol if there's an error for the current one
            throw error; // Re-throw other errors
            // continue;
        } finally {
            // Implement the delay AFTER each API call, whether it succeeded or failed
            if (DEXSCREENER_CALL_DELAY_MS > 0) {
                await new Promise(resolve => setTimeout(resolve, DEXSCREENER_CALL_DELAY_MS));
            
            }
        }
    }

    if (!selectedPair) {
        console.warn(`Dexscreener: No suitable PancakeSwap pair with WBNB/BUSD found for ${targetTokenSymbol} (${targetTokenAddress}) on chain ${TARGET_CHAIN_ID}.`);
        return null;
    }

    // Extract relevant data from the selected pair
    const currentPrice = parseFloat(selectedPair.priceUsd) || 0;
    const currentVolume = parseFloat(selectedPair.volume?.h24) || 0; // Using h24 volume as requested
    const currentLiquidity = parseFloat(selectedPair.liquidity?.usd) || 0;

    // Map baseToken and quoteToken correctly for our internal schema
    // The target token might be base or quote in Dexscreener's response
    let baseTokenData, quoteTokenData;
    if (selectedPair.baseToken.address.toLowerCase() === targetTokenAddress.toLowerCase()) {
        baseTokenData = selectedPair.baseToken;
        quoteTokenData = selectedPair.quoteToken;
    } else if (selectedPair.quoteToken.address.toLowerCase() === targetTokenAddress.toLowerCase()) {
        baseTokenData = selectedPair.baseToken;
        quoteTokenData = selectedPair.quoteToken;
    } else {
        // Fallback or error: this should ideally not happen if filtering is correct
        console.error(`Logic error: Target token ${targetTokenAddress} not found as base or quote in selected pair ${selectedPair.pairAddress}`);
        return null;
    }

    // Return a structured object matching what index.js and dataService expect
    return {
        pairAddress: selectedPair.pairAddress,
        chainId: selectedPair.chainId,
        pairName: `${baseTokenData.symbol}/${quoteTokenData.symbol}`, // Ensure correct naming, e.g., TUT/WBNB
        baseToken: baseTokenData,
        quoteToken: quoteTokenData,
        currentPrice,
        currentVolume,
        currentLiquidity
    };
}