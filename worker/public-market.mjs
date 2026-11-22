import { discoverSymbols, HISTORY_BATCH_SIZE, loadHistories, normalizeSymbol } from "./market.mjs";

const PAGES_ORIGIN = "https://dreadcaptjames.github.io";
const BODY_LIMIT = 4096;
const CACHE_SECONDS = 120;
const BROWSER_HEADERS = { "Access-Control-Allow-Origin": PAGES_ORIGIN, Vary: "Origin" };

class InvalidInput extends Error {}

function json(body, { status = 200, browser = false, cache = false } = {}) {
    return Response.json(body, {
        status,
        headers: {
            ...(browser ? BROWSER_HEADERS : {}),
            "Cache-Control": cache ? `public, max-age=${CACHE_SECONDS}` : "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    });
}

function preflight(request) {
    const method = request.headers.get("Access-Control-Request-Method");
    const headers = request.headers.get("Access-Control-Request-Headers") ?? "";
    if (method !== "POST" || headers.split(",").some((name) => !/^(accept|content-type)?$/i.test(name.trim()))) {
        return json({ error: "This preflight request is not supported." }, { status: 403, browser: true });
    }
    return new Response(null, {
        status: 204,
        headers: {
            ...BROWSER_HEADERS,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Accept, Content-Type",
            "Access-Control-Max-Age": "600",
            Vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
        },
    });
}

async function readPayload(request) {
    const type = request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
    if (type !== "application/json") throw new InvalidInput("Send the request as JSON.");
    if (Number(request.headers.get("Content-Length")) > BODY_LIMIT) {
        throw new InvalidInput("The request is too large.");
    }
    if (!request.body) throw new InvalidInput("Send the request as a JSON object.");

    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let length = 0;
    let text = "";
    while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > BODY_LIMIT) {
            void reader.cancel().catch(() => {});
            throw new InvalidInput("The request is too large.");
        }
        text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();

    try {
        const value = JSON.parse(text);
        if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
        throw new InvalidInput("The request contains invalid JSON.");
    }
    throw new InvalidInput("Send the request as a JSON object.");
}

function scanLimit(body) {
    const { universe_size: limit = 100 } = body;
    if (!Number.isInteger(limit) || limit < 1 || limit > 250) {
        throw new InvalidInput("Choose a discovery limit between 1 and 250.");
    }
    return limit;
}

function historySymbols({ symbols }) {
    if (!Array.isArray(symbols) || !symbols.length || symbols.length > HISTORY_BATCH_SIZE) {
        throw new InvalidInput(`Request daily prices for 1 to ${HISTORY_BATCH_SIZE} stock tickers at a time.`);
    }
    try {
        return [...new Set(symbols.map(normalizeSymbol))].sort();
    } catch (error) {
        throw new InvalidInput(error.message);
    }
}

async function loadResponse(url, body, context) {
    const discovery = url.pathname === "/api/universe";
    const values = discovery ? scanLimit(body) : historySymbols(body);
    const cache = globalThis.caches?.default;
    const key = new URL(`/.underfive-market-cache/v1${url.pathname}`, url.origin);
    key.searchParams.set("query", discovery ? String(values) : values.join(","));
    if (cache) {
        const cached = await cache.match(key.href).catch(() => null);
        if (cached) return cached;
    }

    const data = discovery
        ? { symbols: await discoverSymbols(values) }
        : await loadHistories(values);
    const cacheable = discovery ? data.symbols.length > 0 : data.unavailable.length === 0;
    const response = json(data, { browser: true, cache: cacheable });
    if (cache && cacheable && context) {
        context.waitUntil(cache.put(key.href, response.clone()).catch(() => {}));
    }
    return response;
}

export default {
    async fetch(request, _env, context) {
        const url = new URL(request.url);
        if (url.pathname === "/" && request.method === "GET") {
            return json({ service: "UnderFive market data" });
        }
        if (url.pathname !== "/api/universe" && url.pathname !== "/api/history") {
            return json({ error: "Endpoint not found." }, { status: 404 });
        }
        if (request.headers.get("Origin") !== PAGES_ORIGIN) {
            return json({ error: "Open UnderFive on GitHub Pages to use market data." }, { status: 403 });
        }
        if (request.method === "OPTIONS") return preflight(request);
        if (request.method !== "POST") {
            const response = json({ error: "Send a POST request." }, { status: 405, browser: true });
            response.headers.set("Allow", "POST, OPTIONS");
            return response;
        }

        try {
            return await loadResponse(url, await readPayload(request), context);
        } catch (error) {
            if (error instanceof InvalidInput) {
                return json({ error: error.message }, { status: 400, browser: true });
            }
            console.error("UnderFive market data request failed:", error);
            return json({ error: "Market data is unavailable. Try again shortly." }, { status: 502, browser: true });
        }
    },
};
