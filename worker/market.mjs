const YAHOO_URL = "https://query1.finance.yahoo.com";
const YAHOO_EXCHANGES = ["ASE", "NCM", "NGM", "NMS", "NYQ"];
const NASDAQ_EXCHANGES = ["nasdaq", "nyse", "amex"];
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";
const MARKET_DATE = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
const HEADERS = {Accept: "application/json", "User-Agent": USER_AGENT};

export const HISTORY_BATCH_SIZE = 12;

export function normalizeSymbol(value) {
    if (typeof value !== "string") throw new TypeError("Enter a valid stock ticker.");
    const original = value.trim();
    const symbol = original.replaceAll(".", "-").toUpperCase();
    if (!/^[\x00-\x7f]*$/.test(original) || !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/.test(symbol) || symbol.length > 15) {
        throw new TypeError(`Invalid stock ticker: ${original}`);
    }
    return symbol;
}

async function yahooScreen(limit, fetcher) {
    const session = await fetcher("https://fc.yahoo.com", {
        headers: HEADERS, redirect: "manual", signal: AbortSignal.timeout(8_000),
    });
    const cookies = session.headers.getSetCookie?.() ?? session.headers.getAll?.("Set-Cookie")
        ?? [session.headers.get("Set-Cookie") ?? ""];
    const cookie = cookies.map((item) => item.match(/(?:^|,\s*)(A3=[^;,\s]+)/)?.[1]).find(Boolean);
    await session.arrayBuffer();
    if (!cookie) throw new Error("Yahoo session unavailable.");

    const headers = {...HEADERS, Cookie: cookie};
    const tokenResponse = await fetcher(`${YAHOO_URL}/v1/test/getcrumb`, {
        headers: {...headers, Accept: "text/plain,*/*"}, redirect: "manual", signal: AbortSignal.timeout(8_000),
    });
    const token = (await tokenResponse.text()).trim();
    if (!tokenResponse.ok || !/^[\w./+\-]{1,64}$/.test(token)) throw new Error("Yahoo session unavailable.");

    const params = new URLSearchParams({
        crumb: token, lang: "en-US", region: "US", formatted: "false", corsDomain: "finance.yahoo.com",
    });
    const request = {
        offset: 0, size: limit, sortField: "avgdailyvol3m", sortType: "DESC", quoteType: "EQUITY",
        query: {operator: "AND", operands: [
            {operator: "OR", operands: YAHOO_EXCHANGES.map((exchange) => ({operator: "EQ", operands: ["exchange", exchange]}))},
            {operator: "GT", operands: ["intradayprice", 0]},
            {operator: "LT", operands: ["intradayprice", 5]},
        ]},
    };
    const response = await fetcher(`${YAHOO_URL}/v1/finance/screener?${params}`, {
        method: "POST", headers: {...headers, "Content-Type": "application/json"},
        body: JSON.stringify(request), redirect: "manual", signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("Yahoo stock discovery is unavailable.");

    const {finance} = await response.json();
    const quotes = finance?.result?.[0]?.quotes;
    if (!Array.isArray(quotes)) throw new Error("Yahoo stock discovery returned incomplete data.");
    return quotes.filter((quote) =>
        quote?.currency === "USD" && quote.quoteType === "EQUITY" && YAHOO_EXCHANGES.includes(quote.exchange)
        && typeof quote.regularMarketPrice === "number" && quote.regularMarketPrice > 0 && quote.regularMarketPrice < 5
        && !quote.corporateActions?.some((action) => action.meta?.eventType === "DELISTING")
    ).map((quote) => quote.symbol);
}

async function nasdaqScreen(fetcher) {
    const exchanges = await Promise.all(NASDAQ_EXCHANGES.map(async (exchange) => {
        const params = new URLSearchParams({exchange, tableonly: "true", limit: "10000", download: "true"});
        const response = await fetcher(`https://api.nasdaq.com/api/screener/stocks?${params}`, {
            headers: {...HEADERS, Origin: "https://www.nasdaq.com", Referer: "https://www.nasdaq.com/"},
            signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) throw new Error("Nasdaq stock discovery is unavailable.");
        const {data} = await response.json();
        const rows = data?.rows ?? data?.table?.rows;
        if (!Array.isArray(rows)) throw new Error("Nasdaq stock discovery returned incomplete data.");
        return rows;
    }));
    return exchanges.flat().filter((row) => {
        if (typeof row?.lastsale !== "string" || !row.lastsale.startsWith("$")) return false;
        const price = Number(row.lastsale.slice(1));
        return price > 0 && price < 5 && !/\b(warrants?|rights?|units?|preferred)\b/i.test(row.name);
    }).sort((left, right) => Number(right.volume || 0) - Number(left.volume || 0)).map((row) => row.symbol);
}

export async function discoverSymbols(limit, {fetcher = fetch} = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 250) {
        throw new RangeError("Choose a scan size between 1 and 250.");
    }
    let symbols;
    try {
        symbols = await yahooScreen(limit, fetcher);
    } catch {
        symbols = await nasdaqScreen(fetcher);
    }
    const normalized = new Set();
    for (const symbol of symbols) {
        try {
            normalized.add(normalizeSymbol(symbol));
        } catch {
            continue;
        }
        if (normalized.size === limit) break;
    }
    return [...normalized];
}

function marketDate(timestamp) {
    const parts = MARKET_DATE.formatToParts(timestamp * 1000);
    const byType = Object.fromEntries(parts.map(({type, value}) => [type, value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
}

async function loadHistory(symbol, fetcher) {
    const response = await fetcher(`${YAHOO_URL}/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d`, {
        headers: HEADERS, signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 404 || response.status === 422) throw new Error("no daily prices");
    if (!response.ok) throw new Error("Yahoo Finance history unavailable");

    const {chart} = await response.json();
    const result = chart?.result?.[0];
    if (!Array.isArray(result?.timestamp)) throw new Error("no daily prices");
    const {meta, indicators, timestamp} = result;
    if (meta?.currency !== "USD" || meta?.instrumentType !== "EQUITY" || !YAHOO_EXCHANGES.includes(meta?.exchangeName)) {
        throw new Error("requires a USD equity listed on Nasdaq, NYSE, or NYSE American");
    }
    const quotes = indicators?.quote?.[0];
    const adjusted = indicators?.adjclose?.[0]?.adjclose;
    const bars = [];
    for (const [index, time] of timestamp.entries()) {
        const close = quotes?.close?.[index];
        const adjustedClose = adjusted?.[index];
        const volume = quotes?.volume?.[index];
        if ([time, close, adjustedClose, volume].every(Number.isFinite) && close > 0 && adjustedClose > 0 && volume >= 0) {
            bars.push({date: marketDate(time), close, adjusted_close: adjustedClose, volume: Math.floor(volume)});
        }
    }
    if (bars.length === 0) throw new Error("no usable daily prices");
    return bars.sort((left, right) => left.date.localeCompare(right.date));
}

export async function loadHistories(symbols, {fetcher = fetch} = {}) {
    if (!Array.isArray(symbols) || symbols.length > HISTORY_BATCH_SIZE) {
        throw new RangeError(`Request up to ${HISTORY_BATCH_SIZE} tickers at a time.`);
    }
    const tickers = [...new Set(symbols.map(normalizeSymbol))];
    const results = await Promise.allSettled(tickers.map((ticker) => loadHistory(ticker, fetcher)));
    const histories = {};
    const unavailable = [];
    for (const [index, result] of results.entries()) {
        const symbol = tickers[index];
        if (result.status === "fulfilled") histories[symbol] = result.value;
        else unavailable.push(`${symbol} (${result.reason instanceof Error ? result.reason.message : "history unavailable"})`);
    }
    return {histories, unavailable};
}
