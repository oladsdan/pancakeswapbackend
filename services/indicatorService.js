import TI from 'technicalindicators';
// import config from '../config/default.json';
import config from '../config/default.json' assert { type: 'json' };
import * as dataService from './dataService.js'; // Import dataService

/**
 * Calculates the Relative Strength Index (RSI).
 * @param {Array<object>} priceHistory - Array of objects [{ price: number, timestamp: Date }]
 * @param {number} period - RSI period.
 * @returns {number|null} Latest RSI value or null if not enough data.
 */
function calculateRSI(priceHistory, period = config.indicatorPeriodRSI) {
    if (priceHistory.length < period) {
        return null;
    }
    const prices = priceHistory.map(d => d.price);
    const rsiResult = TI.RSI.calculate({ values: prices, period });
    return rsiResult.length > 0 ? rsiResult[rsiResult.length - 1] : null;
}

/**
 * Calculates the Moving Average Convergence Divergence (MACD).
 * @param {Array<object>} priceHistory - Array of objects [{ price: number, timestamp: Date }]
 * @returns {object|null} Latest MACD values (MACD, Signal, Histogram) or null.
 */
function calculateMACD(priceHistory) {
    if (priceHistory.length < config.macdSlowPeriod) { // MACD needs more data than RSI typically
        return null;
    }
    const prices = priceHistory.map(d => d.price);
    const macdResult = TI.MACD.calculate({
        values: prices,
        fastPeriod: config.macdFastPeriod,
        slowPeriod: config.macdSlowPeriod,
        signalPeriod: config.macdSignalPeriod,
        SimpleMAOscillator: false,
        SimpleMASignal: false
    });
    return macdResult.length > 0 ? macdResult[macdResult.length - 1] : null;
}

/**
 * Checks for rapid short-term price increase.
 * @param {Array<object>} priceHistory - Array of objects [{ price: number, timestamp: Date }]
 * @param {number} currentPrice - Current price of the token.
 * @returns {object} Result, percentage change, and reason.
 */
function isPriceRisingRapidly(priceHistory, currentPrice) {
    const lookbackMinutes = config.priceChangeLookbackMinutesShort;
    const threshold = config.priceChangeThresholdShort; // e.g., 0.01 for 1%
    const now = Date.now();

    const recentPrices = priceHistory.filter(d => (now - d.timestamp.getTime()) <= lookbackMinutes * 60 * 1000);

    if (recentPrices.length < 2) {
        return { result: false, change: 0, reason: `Not enough data for ${lookbackMinutes} min price trend.` };
    }

    const oldestPrice = recentPrices[0].price;
    if (oldestPrice === 0) { // Avoid division by zero
        return { result: false, change: 0, reason: `Oldest price is zero for ${lookbackMinutes} min trend.` };
    }

    const change = (currentPrice - oldestPrice) / oldestPrice;
    const result = change >= threshold;
    const reason = result
        ? `Price increased by ${((change * 100).toFixed(2))}% in last ${lookbackMinutes} min (>=${threshold * 100}% required).`
        : `Price only increased by ${((change * 100).toFixed(2))}% in last ${lookbackMinutes} min (<${threshold * 100}% required).`;

    return { result, change, reason };
}

/**
 * Checks if 24-hour volume is significantly increasing compared to an average.
 * Dexscreener gives us a 24h volume. We can compare current 24h volume to previous average 24h volume values.
 * @param {Array<object>} volumeHistory - Array of objects [{ volume: number, timestamp: Date }]
 * @param {number} currentVolume - Current 24h volume of the token.
 * @returns {object} Result, current volume, average volume, and reason.
 */
function isVolumeIncreasing(volumeHistory, currentVolume) {
    const lookbackMinutes = config.volumeLookbackMinutes;
    const increaseFactor = config.volumeIncreaseFactor; // e.g., 0.2 for 20%
    const now = Date.now();

    const recentVolumes = volumeHistory.filter(d => (now - d.timestamp.getTime()) <= lookbackMinutes * 60 * 1000);

    if (recentVolumes.length < 5) { // Need a few points to calculate a meaningful average
        return { result: false, current: currentVolume, average: 0, reason: `Not enough data for volume trend over ${lookbackMinutes} min.` };
    }

    // Exclude the most recent volume from average calculation to avoid skewing
    const volumesForAverage = recentVolumes.slice(0, recentVolumes.length - 1).map(d => d.volume);
    const averageVolume = volumesForAverage.reduce((sum, vol) => sum + vol, 0) / volumesForAverage.length;

    if (averageVolume === 0) {
        return { result: false, current: currentVolume, average: 0, reason: `Average volume is zero over ${lookbackMinutes} min.` };
    }

    const result = currentVolume >= averageVolume * (1 + increaseFactor);
    const reason = result
        ? `Current 24h volume ($${currentVolume.toFixed(2)}) is >= ${(increaseFactor * 100).toFixed(0)}% higher than average ($${averageVolume.toFixed(2)}) over ${lookbackMinutes} min.`
        : `Current 24h volume ($${currentVolume.toFixed(2)}) is < ${(increaseFactor * 100).toFixed(0)}% higher than average ($${averageVolume.toFixed(2)}) over ${lookbackMinutes} min.`;

    return { result, current: currentVolume, average: averageVolume, reason };
}


/**
 * Assesses liquidity based on implied slippage (or just total liquidity USD).
 * Higher total liquidity suggests lower slippage for typical trades.
 * @param {number} currentLiquidity - The current total USD liquidity.
 * @returns {object} Result and reason.
 */
function isLiquidityStable(currentLiquidity) {
    const threshold = config.liquiditySlippageThresholdPercent; // e.g., 2% (meaning we want low slippage)
    // Dexscreener gives total liquidity in USD. We infer stability from a high enough value.
    // A concrete "slippage %" would require simulating a trade, which Dexscreener doesn't directly provide.
    // We'll use a heuristic: if liquidity is above a certain (arbitrary) threshold, we consider it stable.
    // For this example, let's say >= $50,000 liquidity is "stable" for typical signals.
    const liquidityMinThreshold = 50000; // This value is arbitrary, adjust based on desired risk
    const result = currentLiquidity >= liquidityMinThreshold;
    const reason = result
        ? `Liquidity is strong ($${currentLiquidity.toFixed(2)} USD >= $${liquidityMinThreshold.toFixed(2)} USD).`
        : `Liquidity is low ($${currentLiquidity.toFixed(2)} USD < $${liquidityMinThreshold.toFixed(2)} USD).`;

    return { result, impact: currentLiquidity, reason };
}

/**
 * Detects if the token has already had a significant pump over a longer period.
 * @param {Array<object>} priceHistory - Array of objects [{ price: number, timestamp: Date }]
 * @param {number} currentPrice - Current price of the token.
 * @returns {object} Result (true if pumped), percentage change, and reason.
 */
function hasPumpedRecently(priceHistory, currentPrice) {
    const lookbackHours = config.priceChangeLookbackHoursPumped;
    const threshold = config.priceChangeThresholdPumped; // e.g., 0.15 for 15%
    const now = Date.now();

    const longerTermPrices = priceHistory.filter(d => (now - d.timestamp.getTime()) <= lookbackHours * 60 * 60 * 1000);

    if (longerTermPrices.length < 2) {
        return { result: false, change: 0, reason: `Not enough data for ${lookbackHours} hr pump check.` };
    }

    const oldestPrice = longerTermPrices[0].price;
    if (oldestPrice === 0) {
        return { result: false, change: 0, reason: `Oldest price is zero for ${lookbackHours} hr pump check.` };
    }

    const change = (currentPrice - oldestPrice) / oldestPrice;
    const result = change >= threshold;
    const reason = result
        ? `Price already pumped by ${((change * 100).toFixed(2))}% in last ${lookbackHours} hour(s) (>=${threshold * 100}%).`
        : `Price change in last ${lookbackHours} hour(s) is ${((change * 100).toFixed(2))}% (<${threshold * 100}%).`;

    return { result, change, reason };
}

/**
 * Generates a combined "Buy" or "Hold" signal based on multiple indicators.
 * @param {string} pairAddress - The unique pair address.
 * @param {number} currentPrice - Current price of the token.
 * @param {number} currentVolume - Current 24h volume.
 * @param {number} currentLiquidity - Current total liquidity.
 * @param {string} pairName - Name of the pair for display.
 * @returns {object} Signal, indicator values, and detailed reasons.
 */
export async function generateCombinedSignal(pairAddress, currentPrice, currentVolume, currentLiquidity, pairName) {
    const signalDetails = [];
    let signal = "Hold";

    // Fetch historical data from MongoDB
    const priceHistory = await dataService.getPriceHistory(pairAddress);
    const volumeHistory = await dataService.getVolumeHistory(pairAddress);
    // liquidityHistory is used implicitly by isLiquidityStable, not directly by an indicator calculation,
    // so we pass currentLiquidity directly.

    // Calculate Indicators
    const rsi = calculateRSI(priceHistory);
    const macd = calculateMACD(priceHistory);

    // Evaluate conditions
    const rsiCondition = rsi !== null && rsi <= config.rsiOversold; // RSI is oversold
    signalDetails.push(`RSI (${config.indicatorPeriodRSI}): ${rsi !== null ? rsi.toFixed(2) : 'N/A'} (Oversold < ${config.rsiOversold}? ${rsiCondition ? '✅' : '❌'})`);

    const macdCondition = macd !== null && macd.MACD > macd.signal; // MACD line crossed above Signal line (bullish)
    signalDetails.push(`MACD: MACD Line ${macd !== null ? macd.MACD.toFixed(4) : 'N/A'}, Signal Line ${macd !== null ? macd.signal.toFixed(4) : 'N/A'} (MACD > Signal? ${macdCondition ? '✅' : '❌'})`);

    const priceTrend = isPriceRisingRapidly(priceHistory, currentPrice);
    signalDetails.push(`Price Trend (Last ${config.priceChangeLookbackMinutesShort} min): ${priceTrend.reason} (${priceTrend.result ? '✅' : '❌'})`);

    const volumeTrend = isVolumeIncreasing(volumeHistory, currentVolume);
    signalDetails.push(`Volume Trend (Last ${config.volumeLookbackMinutes} min): ${volumeTrend.reason} (${volumeTrend.result ? '✅' : '❌'})`);

    const liquidityStatus = isLiquidityStable(currentLiquidity);
    signalDetails.push(`Liquidity: ${liquidityStatus.reason} (${liquidityStatus.result ? '✅' : '❌'})`);

    const pumpedStatus = hasPumpedRecently(priceHistory, currentPrice);
    signalDetails.push(`Recently Pumped (Last ${config.priceChangeLookbackHoursPumped} hr): ${pumpedStatus.reason} (${!pumpedStatus.result ? '✅' : '❌'}- Must NOT have pumped)`);


    // Combined Buy Logic
    const canBuy =
        rsiCondition &&
        macdCondition &&
        priceTrend.result &&
        volumeTrend.result &&
        liquidityStatus.result &&
        !pumpedStatus.result; // Must NOT have pumped recently

    if (canBuy) {
        signal = "Buy";
    }

    return {
        signal,
        pairName,
        currentPrice: currentPrice.toFixed(8), // Format for display
        currentVolume: currentVolume.toFixed(2),
        currentLiquidity: currentLiquidity.toFixed(2),
        rsi: rsi !== null ? rsi.toFixed(2) : 'N/A',
        macd: macd !== null ? macd.MACD.toFixed(4) : 'N/A',
        macdSignal: macd !== null ? macd.signal.toFixed(4) : 'N/A',
        macdHistogram: macd !== null ? macd.histogram.toFixed(4) : 'N/A',
        priceChangeShort: (priceTrend.change * 100).toFixed(2),
        volumeIncrease: (volumeTrend.current > 0 && volumeTrend.average > 0) ? ((volumeTrend.current / volumeTrend.average - 1) * 100).toFixed(2) : 'N/A',
        liquidityStatus: liquidityStatus.result ? 'Strong' : 'Low',
        pumpedRecently: pumpedStatus.result ? 'Yes' : 'No',
        signalDetails
    };
}