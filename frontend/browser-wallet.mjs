export const BROWSER_WALLET_KEY = "under-five:wallet:v1:";

const tickerPattern = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;

function normalizeSymbol(value) {
    if (typeof value !== "string") throw new Error("Enter a stock ticker.");
    const ticker = value.trim();
    const symbol = ticker.toUpperCase().replaceAll(".", "-");
    if (!/^[\x00-\x7F]+$/.test(ticker) || symbol.length > 15 || !tickerPattern.test(symbol)) {
        throw new Error("Enter a valid stock ticker such as AAPL or BRK.B.");
    }
    return symbol;
}

function normalizePrice(value) {
    if (value == null) return null;
    if (typeof value !== "string") throw new Error("Enter a purchase price in USD.");
    const price = value.trim();
    if (!price) return null;
    const amount = price.match(/^\+?(\d*)(?:\.(\d*))?$/);
    if (!amount || price.length > 32 || !/[1-9]/.test(price)) {
        throw new Error("Enter a positive purchase price such as 2.40.");
    }
    const dollars = amount[1].replace(/^0+/, "") || "0";
    return amount[2] ? `${dollars}.${amount[2]}` : dollars;
}

function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function storageUnavailable() {
    return new Error("Browser storage is unavailable. Check your browser's site settings.");
}

function getStorage() {
    let storage;
    try {
        storage = globalThis.localStorage;
    } catch {
        throw storageUnavailable();
    }
    if (!storage) throw storageUnavailable();
    return storage;
}

function parseHolding(key, raw) {
    try {
        const {symbol, purchased_on, price} = JSON.parse(raw);
        if (key !== BROWSER_WALLET_KEY + symbol || symbol !== normalizeSymbol(symbol)
            || !validDate(purchased_on) || price !== normalizePrice(price)) {
            throw new Error("Invalid holding");
        }
        return {symbol, purchased_on, price};
    } catch {
        throw new Error("Your saved wallet data could not be read.");
    }
}

function orderHoldings(a, b) {
    if (a.symbol < b.symbol) return -1;
    return Number(a.symbol > b.symbol);
}

function readHoldings(storage) {
    const records = [];
    try {
        for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (!key?.startsWith(BROWSER_WALLET_KEY)) continue;
            const raw = storage.getItem(key);
            if (raw !== null) records.push([key, raw]);
        }
    } catch {
        throw storageUnavailable();
    }
    return records.map(([key, raw]) => parseHolding(key, raw)).sort(orderHoldings);
}

export function readBrowserWallet() {
    return {holdings: readHoldings(getStorage())};
}

export function updateBrowserWallet(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("Enter a purchase or sale.");
    }
    const {action} = payload;
    if (action !== "buy" && action !== "sell") throw new Error("Choose Buy or Sell.");
    const symbol = normalizeSymbol(payload.symbol);
    const price = action === "buy" ? normalizePrice(payload.price) : null;
    const storage = getStorage();
    const holdings = readHoldings(storage);
    const index = holdings.findIndex((holding) => holding.symbol === symbol);
    const key = BROWSER_WALLET_KEY + symbol;

    try {
        if (action === "buy" && index === -1) {
            const purchased_on = new Date().toISOString().slice(0, 10);
            const holding = {symbol, purchased_on, price};
            storage.setItem(key, JSON.stringify(holding));
            holdings.push(holding);
            return {holdings: holdings.sort(orderHoldings), changed: true};
        }
        if (action === "sell" && index !== -1) {
            storage.removeItem(key);
            holdings.splice(index, 1);
            return {holdings, changed: true};
        }
    } catch {
        throw new Error("The wallet change could not be saved in this browser.");
    }
    return {holdings, changed: false};
}
