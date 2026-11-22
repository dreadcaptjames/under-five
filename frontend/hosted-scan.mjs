const MAX_SYMBOLS = 250;
const BATCH_SIZE = 12;
const CONCURRENT_BATCHES = 4;
const SYMBOL = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;

async function post(path, payload, marketOrigin) {
    const url = marketOrigin ? new URL(path, marketOrigin) : path;
    let response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: {Accept: "application/json", "Content-Type": "application/json"},
            body: JSON.stringify(payload),
            credentials: marketOrigin ? "omit" : "same-origin",
            signal: AbortSignal.timeout(20_000),
        });
    } catch {
        throw new Error("The market data request timed out or could not connect.");
    }
    const result = await response.json().catch(() => null);
    if (!response.ok || result === null) {
        throw new Error(result?.error || "The market data service could not complete the request.");
    }
    return result;
}

function normalizeSymbols(symbols) {
    if (!Array.isArray(symbols) || symbols.length > MAX_SYMBOLS) {
        throw new Error(`Enter up to ${MAX_SYMBOLS} stock tickers.`);
    }
    return [...new Set(symbols.map((symbol) => {
        if (typeof symbol !== "string") throw new Error("Stock tickers must be text.");
        const clean = symbol.trim();
        const normalized = clean.toUpperCase().replaceAll(".", "-");
        if (/[^\x00-\x7f]/.test(clean) || normalized.length > 15 || !SYMBOL.test(normalized)) {
            throw new Error(`Invalid stock symbol ${JSON.stringify(clean)}.`);
        }
        return normalized;
    }))];
}

async function checkBatch(symbols, marketOrigin) {
    try {
        const {histories, unavailable} = await post("/api/history", {symbols}, marketOrigin);
        if (!histories || typeof histories !== "object" || !Array.isArray(unavailable)) {
            throw new Error("The market data service returned an unexpected response.");
        }
        return {histories, unavailable};
    } catch (error) {
        return {histories: {}, unavailable: symbols.map((symbol) => `${symbol} — ${error.message}`)};
    }
}

async function loadBatches(symbols, marketOrigin) {
    const batches = [];
    for (let start = 0; start < symbols.length; start += BATCH_SIZE) {
        batches.push(symbols.slice(start, start + BATCH_SIZE));
    }

    const results = new Array(batches.length);
    let next = 0;
    const consumers = Array.from({length: Math.min(CONCURRENT_BATCHES, batches.length)}, async () => {
        while (next < batches.length) {
            const index = next++;
            results[index] = await checkBatch(batches[index], marketOrigin);
        }
    });
    await Promise.all(consumers);

    const histories = Object.create(null);
    const unavailable = [];
    results.forEach((result, index) => {
        for (const symbol of batches[index]) {
            if (Object.hasOwn(result.histories, symbol) && Array.isArray(result.histories[symbol])) {
                histories[symbol] = result.histories[symbol];
            }
        }
        for (const reason of result.unavailable) {
            if (typeof reason === "string") unavailable.push(reason);
        }
    });
    return {histories, unavailable};
}

let rankingWorker;
let nextJob = 0;

function rankHistories(histories) {
    return new Promise((resolve, reject) => {
        const worker = rankingWorker ??= new Worker(new URL("./python-worker.js", import.meta.url));
        const id = ++nextJob;
        const onMessage = ({data}) => {
            if (data?.id !== id) return;
            cleanup();
            if (typeof data.error === "string") reject(new Error(data.error));
            else resolve(data.candidates);
        };
        const onFailure = () => {
            cleanup();
            worker.terminate();
            if (rankingWorker === worker) rankingWorker = undefined;
            reject(new Error("Could not start the Python stock ranker. Run the scan again to retry."));
        };
        const timeout = setTimeout(onFailure, 60_000);
        const cleanup = () => {
            clearTimeout(timeout);
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onFailure);
        };
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onFailure);
        worker.postMessage({
            id,
            payload: JSON.stringify({histories, as_of: new Date().toISOString().slice(0, 10)}),
        });
    });
}

export async function hostedScan({symbols = [], universe_size = 100}, marketOrigin) {
    let selected = normalizeSymbols(symbols);
    if (!selected.length) {
        if (!Number.isInteger(universe_size) || universe_size < 1 || universe_size > MAX_SYMBOLS) {
            throw new Error(`Choose a scan size between 1 and ${MAX_SYMBOLS}.`);
        }
        const universe = await post("/api/universe", {universe_size}, marketOrigin);
        if (!Array.isArray(universe.symbols)) {
            throw new Error("The market data service did not return a list of stock tickers.");
        }
        selected = normalizeSymbols(universe.symbols).slice(0, universe_size);
    }
    const {histories, unavailable} = await loadBatches(selected, marketOrigin);
    const checked = Object.keys(histories).length;
    const candidates = checked ? await rankHistories(histories) : [];
    return {candidates, checked, total: selected.length, unavailable};
}
