import files from "underfive:assets";
import { discoverSymbols, loadHistories } from "./market.mjs";
import { readWallet, updateWallet, WalletInputError } from "./wallet.mjs";

const tickerPattern = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
const pagePolicy = "default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'";
const pythonPolicy = "default-src 'self'; script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net; " +
    "connect-src 'self' https://cdn.jsdelivr.net; object-src 'none'; base-uri 'none'";

class BadRequest extends Error {}

function json(body, status = 200) {
    return Response.json(body, {
        status,
        headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
}

async function readPayload(request) {
    const type = request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
    if (type !== "application/json") throw new BadRequest("Send the request as JSON.");
    const content = await request.text();
    if (content.length > 16_384) throw new BadRequest("The request is too large.");
    try {
        const data = JSON.parse(content);
        if (data && typeof data === "object" && !Array.isArray(data)) return data;
    } catch {
        throw new BadRequest("The request contains invalid JSON.");
    }
    throw new BadRequest("The request must be a JSON object.");
}

function normalizeTickers(symbols) {
    if (!Array.isArray(symbols) || symbols.length < 1 || symbols.length > 12) {
        throw new BadRequest("Request daily prices for 1 to 12 stock tickers at a time.");
    }
    return [...new Set(symbols.map(symbol => {
        if (typeof symbol !== "string" || !/^[\x00-\x7F]*$/.test(symbol)) {
            throw new BadRequest("Enter valid U.S. stock tickers.");
        }
        const ticker = symbol.trim().toUpperCase().replaceAll(".", "-");
        if (ticker.length > 15 || !tickerPattern.test(ticker)) {
            throw new BadRequest(`Invalid stock ticker: ${symbol.slice(0, 32)}`);
        }
        return ticker;
    }))];
}

async function handleApi(request, env, url) {
    if (request.headers.get("Sec-Fetch-Site") === "cross-site") {
        return json({ error: "Open UnderFive directly to use this action." }, 403);
    }
    const ownerId = request.headers.get("oai-authenticated-user-id");
    if (!ownerId) return json({ error: "Sign in to use UnderFive." }, 401);

    if (url.pathname === "/api/wallet") {
        if (request.method === "GET") return json(await readWallet(env, ownerId));
        if (request.method === "POST") return json(await updateWallet(env, ownerId, await readPayload(request)));
    }
    if (request.method === "POST" && url.pathname === "/api/universe") {
        const { universe_size: limit = 100 } = await readPayload(request);
        if (!Number.isInteger(limit) || limit < 1 || limit > 250) {
            throw new BadRequest("Choose a discovery limit between 1 and 250.");
        }
        return json({ symbols: await discoverSymbols(limit) });
    }
    if (request.method === "POST" && url.pathname === "/api/history") {
        const { symbols } = await readPayload(request);
        return json(await loadHistories(normalizeTickers(symbols)));
    }
    return json({ error: "Endpoint not found." }, 404);
}

function serveAsset(pathname, method) {
    const file = files[pathname];
    if (!file || (method !== "GET" && method !== "HEAD")) return new Response("Not found", { status: 404 });
    const contents = file.base64
        ? Uint8Array.from(atob(file.base64), character => character.charCodeAt(0))
        : file.contents;
    return new Response(method === "HEAD" ? null : contents, {
        headers: {
            "Content-Type": file.type,
            "Content-Security-Policy": pathname === "/assets/python-worker.js" ? pythonPolicy : pagePolicy,
            "Cache-Control": "private, no-cache",
            "X-Content-Type-Options": "nosniff",
        },
    });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (!url.pathname.startsWith("/api/")) return serveAsset(url.pathname, request.method);
        try {
            return await handleApi(request, env, url);
        } catch (error) {
            if (error instanceof BadRequest || error instanceof WalletInputError) {
                return json({ error: error.message }, 400);
            }
            console.error(`UnderFive ${url.pathname}:`, error);
            if (url.pathname === "/api/wallet") {
                return json({ error: "The wallet could not be opened. Try again shortly." }, 503);
            }
            return json({ error: "Market data is unavailable. Try again shortly." }, 502);
        }
    },
};
