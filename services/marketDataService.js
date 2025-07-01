// backend/services/marketDataService.js

import axios from 'axios';
import { ethers } from 'ethers';
import config from '../config/default.json' assert { type: 'json' };

// Dexscreener Config
const DEXSCREENER_API_SEARCH_BASE_URL = config.dexscreenerApiSearchBaseUrl;
const PREFERRED_QUOTE_TOKEN_SYMBOLS = config.preferredQuoteTokenSymbols.map(s => s.toUpperCase());
const DEXSCREENER_CALL_DELAY_MS = config.dexscreenerCallDelayMs || 0;
const QUOTE_TOKEN_ADDRESS_MAP = config.quoteTokenMap; // <-- NEW

// On-chain/Ethers Config
const BSC_RPC_URL = config.bscRpcUrl;
const PANCAKESWAP_WBNB_BUSD_PAIR_ADDRESS = config.pancakeSwapWBNBBUSDPairAddress;
const PANCAKESWAP_SUBGRAPH_URL = config.pancakeSwapSubgraphUrl; // New: Subgraph URL

const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);

// ABIs (ensure these are complete and correct)
const ERC20_ABI = [
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address account) view returns (uint256)"
];
const PANCAKESWAP_PAIR_ABI = [
    "function getReserves() public view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast)",
    "function token0() public view returns (address)",
    "function token1() public view returns (address)"
];

/**
 * Gets the price of WBNB in BUSD by querying a known PancakeSwap V2 WBNB/BUSD pair on-chain.
 * @returns {Promise<number>} Price of 1 WBNB in BUSD. Returns 0 if an error occurs.
 */
async function getWbnbPriceInBUSD() {
    try {
        const wbnbAddress = config.monitoredTokens.find(t => t.symbol === "WBNB")?.address;
        const busdAddress = config.baseCurrencyAddress;

        if (!wbnbAddress || !busdAddress || !PANCAKESWAP_WBNB_BUSD_PAIR_ADDRESS) {
            console.warn("WBNB/BUSD addresses or PancakeSwap pair address not found in config for WBNB price fetching.");
            return 0;
        }

        const pairContract = new ethers.Contract(PANCAKESWAP_WBNB_BUSD_PAIR_ADDRESS, PANCAKESWAP_PAIR_ABI, provider);
        const [reserve0, reserve1] = await pairContract.getReserves();
        const token0Address = await pairContract.token0();

        let wbnbPrice;
        if (token0Address.toLowerCase() === wbnbAddress.toLowerCase()) {
            wbnbPrice = parseFloat(ethers.formatUnits(reserve1, 18)) / parseFloat(ethers.formatUnits(reserve0, 18));
        } else if (token0Address.toLowerCase() === busdAddress.toLowerCase()) {
            wbnbPrice = parseFloat(ethers.formatUnits(reserve0, 18)) / parseFloat(ethers.formatUnits(reserve1, 18));
        } else {
            console.warn("WBNB/BUSD pair addresses in config do not match token0/token1 of the specified pair contract.");
            return 0;
        }
        return wbnbPrice;

    } catch (error) {
        console.error("Error fetching WBNB price on-chain:", error.message);
        return 0;
    }
}

/**
 * Fetches market data for a token from PancakeSwap Subgraph (GraphQL).
 * This should be the primary data source to avoid Dexscreener API limits.
 * @param {object} token - The token object with symbol and address.
 * @returns {object|null} Structured market data or null if not found.
 */
async function getMarketDataFromSubgraph(token) {
    const targetTokenAddress = token.address.toLowerCase();
    const targetChainId = config.targetChainId; // Assuming chainId is consistent for subgraph

    const query = `
        query GetTokenPairData($tokenAddress: Bytes!, $quoteTokenSymbols: [String!]) {
            pairs(
                first: 1,
                where: {
                    and: [
                        { token0_in: [$tokenAddress], token1_in: $quoteTokenSymbols }
                        { or: [{ token0: $tokenAddress }, { token1: $tokenAddress }] }
                    ]
                },
                orderBy: reserveUSD,
                orderDirection: desc
            ) {
                id
                token0 { id symbol decimals }
                token1 { id symbol decimals }
                reserve0
                reserve1
                reserveUSD
                volumeUSD
                token0Price
                token1Price
            }
        }
    `;

    // Map preferred quote token symbols to their addresses for the subgraph query
    // You'll need to augment your config.monitoredTokens or have a separate map
    // For simplicity here, let's assume you'd filter on symbol if subgraph query fails on address
    // const quoteTokenAddresses = PREFERRED_QUOTE_TOKEN_SYMBOLS.map(symbol =>
    //     config.monitoredTokens.find(t => t.symbol.toUpperCase() === symbol)?.address?.toLowerCase()
    // ).filter(Boolean); // Filter out undefined/null addresses
    const quoteAddresses = PREFERRED_QUOTE_TOKEN_SYMBOLS.map(symbol => {
        const address = QUOTE_TOKEN_ADDRESS_MAP[symbol.toUpperCase()];
        if (!address) {
            console.warn(`Quote token symbol ${symbol} not found in quoteTokenMap.`);
        }
        return address ? address.toLowerCase() : null;
    }).filter(Boolean);

    if (quoteAddresses.length === 0) {
        console.warn("No valid preferred quote token addresses found for subgraph query.");
        return null;
    }

    try {
        const response = await axios.post(PANCAKESWAP_SUBGRAPH_URL, {
            query: `
                query GetTokenPairData($tokenAddress: Bytes!, $quoteAddresses: [Bytes!]) {
                    pairs(
                        first: 1,
                        where: {
                            and: [
                                { or: [{ token0: $tokenAddress }, { token1: $tokenAddress }] },
                                { or: [{ token0_in: $quoteAddresses }, { token1_in: $quoteAddresses }] }
                            ]
                        },
                        orderBy: reserveUSD,
                        orderDirection: desc
                    ) {
                        id
                        token0 { id symbol decimals }
                        token1 { id symbol decimals }
                        reserve0
                        reserve1
                        reserveUSD
                        volumeUSD
                        token0Price
                        token1Price
                        // Add more fields if needed, like dailyVolumeUSD if available
                    }
                }
            `,
            variables: {
                tokenAddress: targetTokenAddress,
                quoteAddresses: quoteAddresses
            }
        });

        const pairs = response.data.data?.pairs;
        if (!pairs || pairs.length === 0) {
            console.log(`Subgraph: No suitable pair found for ${token.symbol} (${token.address})`);
            return null;
        }

        const selectedPair = pairs[0];

        // Determine baseToken and quoteToken based on the queried token
        let baseTokenData, quoteTokenData;
        if (selectedPair.token0.id.toLowerCase() === targetTokenAddress) {
            baseTokenData = selectedPair.token0;
            quoteTokenData = selectedPair.token1;
        } else {
            baseTokenData = selectedPair.token1;
            quoteTokenData = selectedPair.token0;
        }

        // Calculate current price based on the pair reserves or token prices
        let currentPrice;
        if (selectedPair.token0.id.toLowerCase() === targetTokenAddress) {
            // Price of token0 in terms of token1
            currentPrice = parseFloat(selectedPair.token1Price);
        } else {
            // Price of token1 in terms of token0
            currentPrice = parseFloat(selectedPair.token0Price);
        }

        // Fallback for currentPrice if tokenPrices are not reliable or available for the pair
        if (isNaN(currentPrice) || currentPrice <= 0) {
             const reserve0Formatted = parseFloat(ethers.formatUnits(selectedPair.reserve0, selectedPair.token0.decimals));
             const reserve1Formatted = parseFloat(ethers.formatUnits(selectedPair.reserve1, selectedPair.token1.decimals));
             if (reserve0Formatted > 0 && reserve1Formatted > 0) {
                 if (selectedPair.token0.id.toLowerCase() === targetTokenAddress) {
                     currentPrice = reserve1Formatted / reserve0Formatted;
                 } else {
                     currentPrice = reserve0Formatted / reserve1Formatted;
                 }
             }
        }


        return {
            pairAddress: selectedPair.id, // Subgraph `id` is the pair address
            chainId: targetChainId, // Subgraph doesn't directly provide chainId in pair, assume target
            pairName: `${baseTokenData.symbol}/${quoteTokenData.symbol}`,
            baseToken: { address: baseTokenData.id, symbol: baseTokenData.symbol, decimals: parseInt(baseTokenData.decimals) },
            quoteToken: { address: quoteTokenData.id, symbol: quoteTokenData.symbol, decimals: parseInt(quoteTokenData.decimals) },
            currentPrice: currentPrice,
            currentVolume: parseFloat(selectedPair.volumeUSD || 0), // Use volumeUSD for h24 equivalent
            currentLiquidity: parseFloat(selectedPair.reserveUSD || 0) // Subgraph provides reserveUSD directly
        };

    } catch (error) {
        console.error(`Error fetching market data from Subgraph for ${token.symbol}:`, error.message);
        return null;
    }
}

/**
 * Fetches market data for a token from Dexscreener (as a fallback).
 * @param {object} token - The token object with symbol and address.
 * @returns {object|null} Structured market data or null if not found.
 */
async function getMarketDataFromDexscreener(token) {
    const targetTokenSymbol = token.symbol;
    const targetTokenAddress = token.address;

    let selectedPair = null;

    for (const quoteSymbol of PREFERRED_QUOTE_TOKEN_SYMBOLS) {
        const queryString = `${targetTokenSymbol}/${quoteSymbol}`;
        const url = `${DEXSCREENER_API_SEARCH_BASE_URL}?q=${queryString}`;
        // console.log(`Attempting Dexscreener fallback for ${queryString} from: ${url}`); // Keep silent for fallback

        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Connection': 'keep-alive'
                }
            });

            if (!response.data || !response.data.pairs || response.data.pairs.length === 0) {
                // console.log(`Dexscreener: No pairs found for query "${queryString}". Trying next quote token...`);
                continue;
            }

            const relevantPairs = response.data.pairs.filter(pair => {
                const isPancakeSwap = pair.dexId.toLowerCase().includes('pancakeswap');
                const isOnTargetChain = pair.chainId.toLowerCase() === config.targetChainId.toLowerCase();
                const isTargetTokenInPair =
                    pair.baseToken.address.toLowerCase() === targetTokenAddress.toLowerCase() ||
                    pair.quoteToken.address.toLowerCase() === targetTokenAddress.toLowerCase();
                const isQuoteTokenMatched = pair.quoteToken.symbol.toUpperCase() === quoteSymbol.toUpperCase() ||
                                            pair.baseToken.symbol.toUpperCase() === quoteSymbol.toUpperCase();
                const hasLiquidity = pair.liquidity && pair.liquidity.usd > 0;

                return isPancakeSwap && isOnTargetChain && isTargetTokenInPair && isQuoteTokenMatched && hasLiquidity;
            });

            if (relevantPairs.length > 0) {
                relevantPairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
                selectedPair = relevantPairs[0];
                break;
            }

        } catch (error) {
            if (axios.isAxiosError(error) && error.response) {
                console.error(`Dexscreener API fallback error for ${queryString} (HTTP ${error.response.status}): ${error.response.data.toString().substring(0, 200)}...`);
            } else {
                console.error(`Failed to get market data from Dexscreener fallback for ${queryString}:`, error.message);
            }
            continue;
        } finally {
            // Apply delay only when calling Dexscreener
            if (DEXSCREENER_CALL_DELAY_MS > 0) {
                await new Promise(resolve => setTimeout(resolve, DEXSCREENER_CALL_DELAY_MS));
            }
        }
    }

    if (!selectedPair) {
        // console.warn(`Dexscreener fallback: No suitable PancakeSwap pair found for ${targetTokenSymbol}.`);
        return null;
    }

    // --- On-chain verification for Dexscreener fetched data ---
    // (This part ensures consistency, even if fetched from Dexscreener)
    const onChainLiquidity = await getOnChainLiquidity(
        selectedPair.pairAddress,
        selectedPair.baseToken,
        selectedPair.quoteToken
    );

    let finalLiquidityUsd = selectedPair.liquidity?.usd || 0;
    if (onChainLiquidity !== null) {
        // console.log(`On-chain liquidity for ${selectedPair.pairName} (${selectedPair.pairAddress}): $${onChainLiquidity.toFixed(2)}`);
        const diffPercent = (finalLiquidityUsd > 0) ? Math.abs((onChainLiquidity - finalLiquidityUsd) / finalLiquidityUsd) * 100 : 0;
        if (finalLiquidityUsd > 0 && diffPercent > 5) {
            console.warn(`Significant liquidity discrepancy (Dexscreener Fallback) for ${selectedPair.pairName}: Dexscreener $${finalLiquidityUsd.toFixed(2)}, On-chain $${onChainLiquidity.toFixed(2)} (${diffPercent.toFixed(2)}% difference).`);
        }
        finalLiquidityUsd = onChainLiquidity;
    } else {
        console.warn(`On-chain liquidity verification failed (Dexscreener Fallback) for ${selectedPair.pairName}. Using Dexscreener reported data.`);
    }
    // --- End On-chain verification ---

    const currentPrice = parseFloat(selectedPair.priceUsd) || 0;
    const currentVolume = parseFloat(selectedPair.volume?.h24) || 0;

    let baseTokenData, quoteTokenData;
    if (selectedPair.baseToken.address.toLowerCase() === targetTokenAddress.toLowerCase()) {
        baseTokenData = selectedPair.baseToken;
        quoteTokenData = selectedPair.quoteToken;
    } else {
        baseTokenData = selectedPair.quoteToken;
        quoteTokenData = selectedPair.baseToken;
    }

    return {
        pairAddress: selectedPair.pairAddress,
        chainId: selectedPair.chainId,
        pairName: `${baseTokenData.symbol}/${quoteTokenData.symbol}`,
        baseToken: baseTokenData,
        quoteToken: quoteTokenData,
        currentPrice,
        currentVolume,
        currentLiquidity: finalLiquidityUsd
    };
}


/**
 * Main function to get market data, prioritizing Subgraph and falling back to Dexscreener.
 * @param {object} token - The token object containing symbol and address.
 * @returns {object|null} Structured market data or null.
 */
export async function getMarketData(token) {
    let data = await getMarketDataFromSubgraph(token);

    if (!data) {
        console.log(`Subgraph failed for ${token.symbol}. Falling back to Dexscreener...`);
        data = await getMarketDataFromDexscreener(token);
    } else {
        console.log(`Successfully fetched data for ${token.symbol} from Subgraph.`);
    }

    // Always perform on-chain liquidity verification for any data acquired (Subgraph or Dexscreener)
    // The getMarketDataFromSubgraph should ideally already fetch reserves for on-chain calc
    // But if getOnChainLiquidity is strictly for *pair contracts* from a web3 provider, we keep it here.
    if (data && data.pairAddress) {
        const onChainLiquidity = await getOnChainLiquidity(
            data.pairAddress,
            data.baseToken,
            data.quoteToken
        );
        if (onChainLiquidity !== null) {
            // Here, we decide if we trust on-chain more than what Subgraph/Dexscreener reported.
            // Typically, on-chain is the source of truth for liquidity.
            // We can compare or simply use the on-chain value if available.
            data.currentLiquidity = onChainLiquidity;
            // console.log(`Final liquidity for ${data.pairName} after on-chain verification: $${data.currentLiquidity.toFixed(2)}`);
        } else {
            console.warn(`On-chain liquidity verification failed for ${data.pairName}. Using reported liquidity.`);
        }
    }

    return data;
}

// Keep getOnChainLiquidity function as it was, likely unchanged:
/**
 * Verifies the on-chain liquidity of a PancakeSwap V2 pair.
 * Handles errors gracefully to prevent backend shutdown.
 * @param {string} pairAddress - The address of the PancakeSwap V2 Pair contract.
 * @param {object} baseToken - The base token object (from Dexscreener data/subgraph).
 * @param {object} quoteToken - The quote token object (from Dexscreener data/subgraph).
 * @returns {Promise<number|null>} The calculated USD liquidity from on-chain, or null if an error occurs.
 */
async function getOnChainLiquidity(pairAddress, baseToken, quoteToken) {
    try {
        const pairContract = new ethers.Contract(pairAddress, PANCAKESWAP_PAIR_ABI, provider);

        const [reserve0, reserve1] = await pairContract.getReserves();
        const token0Address = await pairContract.token0();
        const token1Address = await pairContract.token1();

        let token0Info = { address: token0Address, decimals: null }; // Initialize with null decimals
        let token1Info = { address: token1Address, decimals: null };

        // Prioritize decimals from provided token objects (from subgraph/Dexscreener)
        if (baseToken.address.toLowerCase() === token0Address.toLowerCase()) {
            token0Info.decimals = baseToken.decimals;
            token1Info.decimals = quoteToken.decimals;
        } else {
            token0Info.decimals = quoteToken.decimals;
            token1Info.decimals = baseToken.decimals;
        }

        // Fallback to fetching decimals on-chain if not provided
        if (typeof token0Info.decimals !== 'number' || isNaN(token0Info.decimals)) {
            const token0Contract = new ethers.Contract(token0Info.address, ERC20_ABI, provider);
            token0Info.decimals = await token0Contract.decimals();
        }
        if (typeof token1Info.decimals !== 'number' || isNaN(token1Info.decimals)) {
            const token1Contract = new ethers.Contract(token1Info.address, ERC20_ABI, provider);
            token1Info.decimals = await token1Contract.decimals();
        }

        const reserve0Formatted = parseFloat(ethers.formatUnits(reserve0, token0Info.decimals));
        const reserve1Formatted = parseFloat(ethers.formatUnits(reserve1, token1Info.decimals));

        let totalUsdLiquidity = 0;

        const quoteTokenSymbolUpper = quoteToken.symbol.toUpperCase();
        const wbnbPriceUsd = await getWbnbPriceInBUSD(); // Always get WBNB price if needed

        if (quoteTokenSymbolUpper === "BUSD") {
            if (quoteToken.address.toLowerCase() === token0Info.address.toLowerCase()) {
                totalUsdLiquidity = reserve0Formatted * 2;
            } else {
                totalUsdLiquidity = reserve1Formatted * 2;
            }
        } else if (quoteTokenSymbolUpper === "WBNB") {
            if (wbnbPriceUsd === 0) {
                console.warn("Could not get WBNB price for on-chain liquidity calculation.");
                return null;
            }
            if (quoteToken.address.toLowerCase() === token0Info.address.toLowerCase()) {
                totalUsdLiquidity = (reserve0Formatted * wbnbPriceUsd) * 2;
            } else {
                totalUsdLiquidity = (reserve1Formatted * wbnbPriceUsd) * 2;
            }
        } else {
            console.warn(`Unsupported quote token for on-chain liquidity calculation: ${quoteToken.symbol}.`);
            return null;
        }

        return totalUsdLiquidity;

    } catch (error) {
        console.error(`Ethers.js On-chain verification error for pair ${pairAddress}:`, error.message);
        return null;
    }
}