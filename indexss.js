// // backend/index.js

// import express from 'express';
// import cors from 'cors';
// import { getMarketData } from './services/marketDataService.js'; // <-- Changed import
// import { calculateTechnicalIndicators, calculatePriceChange, analyzeVolume } from './services/dataService.js';
// import config from './config/default.json' assert { type: 'json' };

// // ... (rest of the config constants and app setup) ...

// /**
//  * Fetches market data for all monitored tokens and updates the history,
//  * then calculates technical indicators and signals.
//  */
// async function fetchAndUpdateMarketData() {
//     console.log(`[${new Date().toISOString()}] Fetching and updating market data...`);
//     for (const token of config.monitoredTokens) {
//         try {
//             const data = await getMarketData(token); // Call the unified service
//             if (data) {
//                 // ... (rest of your existing logic for storing data, calculating indicators, and signals) ...
//                 const dataPoint = {
//                     timestamp: Date.now(),
//                     ...data,
//                     indicators: {},
//                     signals: {}
//                 };
//                 tokenMarketDataHistory[token.symbol].push(dataPoint);

//                 if (tokenMarketDataHistory[token.symbol].length > HISTORY_RETENTION_LIMIT) {
//                     tokenMarketDataHistory[token.symbol].shift();
//                 }

//                 const historicalPrices = tokenMarketDataHistory[token.symbol].map(d => d.currentPrice);
//                 const { rsi, macd } = calculateTechnicalIndicators(historicalPrices);

//                 dataPoint.indicators.rsi = rsi;
//                 dataPoint.indicators.macd = macd;

//                 // RSI Signals
//                 if (rsi !== null) {
//                     if (rsi <= RSI_OVERSOLD) {
//                         dataPoint.signals.rsi = 'OVERSOLD';
//                     } else if (rsi >= RSI_OVERBOUGHT) {
//                         dataPoint.signals.rsi = 'OVERBOUGHT';
//                     } else {
//                         dataPoint.signals.rsi = 'NEUTRAL';
//                     }
//                 } else {
//                     dataPoint.signals.rsi = 'INSUFFICIENT_DATA';
//                 }

//                 // MACD Crossover Signal
//                 if (macd.MACD !== null && macd.signal !== null) {
//                     if (tokenMarketDataHistory[token.symbol].length > 1) {
//                         const prevDataPoint = tokenMarketDataHistory[token.symbol][tokenMarketDataHistory[token.symbol].length - 2];
//                         if (prevDataPoint.indicators && prevDataPoint.indicators.macd && prevDataPoint.indicators.macd.MACD !== null && prevDataPoint.indicators.macd.signal !== null) {
//                             if (macd.MACD > macd.signal && prevDataPoint.indicators.macd.MACD <= prevDataPoint.indicators.macd.signal) {
//                                 dataPoint.signals.macd = 'BULLISH_CROSSOVER';
//                             } else if (macd.MACD < macd.signal && prevDataPoint.indicators.macd.MACD >= prevDataPoint.indicators.macd.signal) {
//                                 dataPoint.signals.macd = 'BEARISH_CROSSOVER';
//                             } else {
//                                 dataPoint.signals.macd = 'NO_CROSSOVER';
//                             }
//                         } else {
//                             dataPoint.signals.macd = 'NO_CROSSOVER'; // Not enough previous MACD data for crossover
//                         }
//                     } else {
//                         dataPoint.signals.macd = 'INSUFFICIENT_DATA';
//                     }
//                 } else {
//                     dataPoint.signals.macd = 'INSUFFICIENT_DATA';
//                 }

//                 // Short-term Price Change (Pump Check)
//                 const priceChangeShort = calculatePriceChange(tokenMarketDataHistory[token.symbol], PRICE_CHANGE_LOOKBACK_MINUTES_SHORT, PRICE_CHANGE_THRESHOLD_SHORT);
//                 if (priceChangeShort !== null) {
//                     if (priceChangeShort >= PRICE_CHANGE_THRESHOLD_SHORT) {
//                         dataPoint.signals.priceChangeShort = `UP ${ (priceChangeShort * 100).toFixed(2) }%`;
//                     } else if (priceChangeShort <= -PRICE_CHANGE_THRESHOLD_SHORT) {
//                         dataPoint.signals.priceChangeShort = `DOWN ${ (priceChangeShort * 100).toFixed(2) }%`;
//                     } else {
//                         dataPoint.signals.priceChangeShort = `FLAT`;
//                     }
//                 } else {
//                     dataPoint.signals.priceChangeShort = 'INSUFFICIENT_DATA';
//                 }

//                 // Volume Analysis
//                 const volumeAnalysis = analyzeVolume(tokenMarketDataHistory[token.symbol], VOLUME_LOOKBACK_MINUTES, VOLUME_INCREASE_FACTOR);
//                 if (volumeAnalysis) {
//                     if (volumeAnalysis.volumeIncreased) {
//                         dataPoint.signals.volume = `HIGH_VOLUME_INCREASE (Latest: $${volumeAnalysis.latestVolume.toFixed(2)}, Avg Prev: $${volumeAnalysis.averagePreviousVolume.toFixed(2)})`;
//                     } else {
//                         dataPoint.signals.volume = `NORMAL_VOLUME`;
//                     }
//                 } else {
//                     dataPoint.signals.volume = 'INSUFFICIENT_DATA';
//                 }

//                 // Liquidity Slippage Check
//                 if (data.currentLiquidity < 10000) { // Example threshold
//                     dataPoint.signals.liquiditySlippage = 'HIGH_SLIPPAGE_RISK';
//                 } else {
//                     dataPoint.signals.liquiditySlippage = 'NORMAL_SLIPPAGE_RISK';
//                 }

//                 // Price Pumped Check
//                 const priceChangePumped = calculatePriceChange(tokenMarketDataHistory[token.symbol], PRICE_CHANGE_LOOKBACK_HOURS_PUMPED * 60, PRICE_CHANGE_THRESHOLD_PUMPED);
//                 if (priceChangePumped !== null) {
//                     if (priceChangePumped >= PRICE_CHANGE_THRESHOLD_PUMPED) {
//                         dataPoint.signals.pumped = `YES (${ (priceChangePumped * 100).toFixed(2) }%)`;
//                     } else {
//                         dataPoint.signals.pumped = `NO (${ (priceChangePumped * 100).toFixed(2) }%)`;
//                     }
//                 } else {
//                     dataPoint.signals.pumped = 'INSUFFICIENT_DATA';
//                 }

//                 console.log(`Updated data for ${token.symbol}: Price=${data.currentPrice.toFixed(8)}, Liquidity=$${data.currentLiquidity.toFixed(2)}, RSI=${rsi?.toFixed(2) || 'N/A'}, MACD=${macd.MACD?.toFixed(2) || 'N/A'}`);
//             } else {
//                 console.warn(`Could not get market data for ${token.symbol}.`);
//             }
//         } catch (error) {
//             console.error(`Error processing ${token.symbol}:`, error.message);
//         }
//     }
// }
// // ... (rest of the API endpoints and server start) ...

import 'dotenv/config'; // Load environment variables from .env
import express from 'express';
import cors from 'cors';

import config from './config/default.json' assert { type: 'json' };
import * as dataService from './services/dataService.js';
import * as marketDataService from './services/marketDataService.js'; // <-- Changed import
import * as indicatorService from './services/indicatorService.js';

const app = express();
const PORT = process.env.PORT || config.apiPort;

// Global variable to store current signals (for API endpoint)
let currentSignals = [];

// Middleware
app.use(cors()); // Allow frontend to access API
app.use(express.json()); // Enable JSON body parsing for requests (if needed)

// This map will store the last buy signal info for display on the frontend
const lastBuySignalsDisplay = new Map();

/**
 * The main loop to fetch data, generate signals, and store history.
 */
async function signalGenerationLoop() {
    console.log(`\n--- Signal Generation Loop Started: ${new Date().toLocaleTimeString()} ---`);
    const allSignals = [];

    // Ensure DB connection is active for each loop, or handle reconnects
    await dataService.connectDb();

    for (const tokenConfig of config.monitoredTokens) {
        const targetTokenAddress = tokenConfig.address;
        const targetTokenSymbol = tokenConfig.symbol;
        const targetTokenName = tokenConfig.name;

        console.log(`Processing ${targetTokenSymbol} (${targetTokenAddress})...`);
        // The console.log(targetTokenSymbol, targetTokenAddress); line can be removed as it's redundant.

        try {
            // 1. Fetch real-time market data using the new marketDataService
            // This service now intelligently fetches from Subgraph first, then falls back to Dexscreener.
            const marketData = await marketDataService.getMarketData(tokenConfig); // <-- Pass the full tokenConfig object

            if (!marketData) {
                console.warn(`Skipping ${targetTokenSymbol}: Could not fetch market data.`);
                allSignals.push({
                    pairName: `${targetTokenSymbol}/${config.baseCurrencySymbol}`,
                    signal: "Error",
                    currentPrice: "N/A",
                    signalDetails: [`Could not fetch market data for ${targetTokenSymbol}`]
                });
                continue;
            }

            const { pairAddress, chainId, pairName, baseToken, quoteToken, currentPrice, currentVolume, currentLiquidity } = marketData;

            // 2. Initialize/Update token metadata in MongoDB if it's a new pair or needs updating
            await dataService.initializeTokenData({
                pairAddress,
                chainId,
                baseToken: { address: baseToken.address, symbol: baseToken.symbol },
                // Make sure quoteToken also has address, symbol, and name if needed by initializeTokenData
                // The quoteToken from marketDataService now has id (address), symbol, and decimals.
                // You might need to adjust dataService.initializeTokenData if it expects a 'name' field for quoteToken.
                // For now, let's assume `name` is handled for baseToken or the overall pair.
                quoteToken: { address: quoteToken.address, symbol: quoteToken.symbol },
                pairName
            });

            // 3. Store current market data historically in MongoDB
            await dataService.updateMarketData(pairAddress, currentPrice, currentVolume, currentLiquidity);

            // 4. Generate combined signal using historical data from MongoDB
            const signalResult = await indicatorService.generateCombinedSignal(
                pairAddress,
                currentPrice,
                currentVolume,
                currentLiquidity,
                pairName
            );

            // 5. Update last buy signal display information
            if (signalResult.signal === "Buy") {
                lastBuySignalsDisplay.set(pairName, {
                    timestamp: new Date().toISOString(),
                    price: currentPrice
                });
            }
            // Add last buy info to the signal result for frontend display
            const lastBuyInfo = lastBuySignalsDisplay.get(pairName);
            if (lastBuyInfo) {
                signalResult.lastBuySignal = {
                    timestamp: lastBuyInfo.timestamp,
                    price: lastBuyInfo.price.toFixed(8)
                };
            }

            allSignals.push(signalResult);

        } catch (error) {
            console.error(`Error processing ${targetTokenSymbol} (${targetTokenAddress}):`, error);
            allSignals.push({
                pairName: `${targetTokenSymbol}/${config.baseCurrencySymbol}`,
                signal: "Error",
                currentPrice: "N/A",
                signalDetails: [`An unexpected error occurred: ${error.message}`]
            });
        }
    }

    currentSignals = allSignals; // Update global signals for API
    console.log(`--- Signal Generation Loop Finished. ${allSignals.length} signals processed. ---`);
}

// API Endpoint
app.get('/api/signals', (req, res) => {
    res.json(currentSignals);
});

// Start the signal generator and API server
async function startSignalGeneratorAndApi() {
    console.log('Starting signal generator and API server...');

    // Initial database connection
    await dataService.connectDb();

    // Run first signal generation immediately
    await signalGenerationLoop();

    // Schedule subsequent runs
    setInterval(signalGenerationLoop, config.refreshIntervalMs);

    // Start Express API server
    app.listen(PORT, () => {
        console.log(`API Server listening on port ${PORT}`);
        console.log(`Access signals at http://localhost:${PORT}/api/signals`);
        console.log(`Remember to also start your React frontend in a separate terminal (e.g., on port 5173 for Vite)`);
    }).on('error', (err) => {
        console.error('Failed to start API server:', err.message);
        if (err.code === 'EADDRINUSE') {
            console.error(`Port ${PORT} is already in use. Please close the other application or choose a different port.`);
        }
        process.exit(1); // Exit if server cannot start
    });
}

startSignalGeneratorAndApi().catch(console.error);