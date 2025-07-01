import 'dotenv/config'; // Load environment variables from .env
import express from 'express';
import cors from 'cors';

import config from './config/default.json' assert { type: 'json' };
import * as dataService from './services/dataService.js';
import * as dexscreenerService from './services/dexscreenerService.js';
import * as indicatorService from './services/indicatorService.js';

const app = express();
const PORT = process.env.PORT || config.apiPort;

// Global variable to store current signals (for API endpoint)
let currentSignals = [];

const allowedOrigins = [
  'http://localhost:5173', // For your local frontend development
  'http://localhost:3000'  // If your frontend runs on 3000 for some reason
  // Add your Vercel frontend URL here when deployed!
  // Example: 'https://your-frontend-app.vercel.app'
  // It's best to get this from an environment variable in production
];
const productionFrontendUrl = process.env.FRONTEND_VERCEL_URL;
if (productionFrontendUrl) {
    allowedOrigins.push(productionFrontendUrl);
}

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    // or if the origin is in our allowed list.
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Specify allowed methods
  credentials: true, // If you're sending cookies or authorization headers
  optionsSuccessStatus: 204 // Some legacy browsers (IE11, various SmartTVs) choke on 200
};

// Middleware
app.use(cors(corsOptions)); // Allow frontend to access API
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
        console.log(targetTokenSymbol, targetTokenAddress);

        try {
            // 1. Fetch real-time market data from Dexscreener
            const marketData = await dexscreenerService.getMarketData(targetTokenAddress, targetTokenSymbol);

            if (!marketData) {
                console.warn(`Skipping ${targetTokenSymbol}: Could not fetch market data from Dexscreener.`);
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
                quoteToken: { address: quoteToken.address, symbol: quoteToken.symbol, name: targetTokenName },
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
// app.get('/api/signals', (req, res) => {
//     res.json(currentSignals);
// });

app.get('/api/signals', (req, res) => {
    // If signals aren't ready yet, respond with an empty array or a loading message
    if (currentSignals.length === 0) {
        // Option 1: Send an empty array (frontend will show 'No signals available')
        res.json([]);
        // Option 2: Send a specific message (frontend should handle it)
        // res.status(202).json({ message: "Signals are being generated, please try again soon.", status: "generating" });
        // Make sure your frontend can gracefully handle this 202 status or message
    } else {
        res.json(currentSignals);
    }
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