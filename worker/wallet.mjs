const selectHoldings = `
    SELECT symbol, purchased_on, price
    FROM holdings
    WHERE owner_id = ?
    ORDER BY symbol
`;

export class WalletInputError extends Error {}

function requireWallet(env, ownerId) {
    if (!(typeof ownerId === "string" && ownerId)) {
        throw new Error("An authenticated owner is required to access the wallet.");
    }
    if (!env?.DB) {
        throw new Error("The wallet database is unavailable.");
    }
    return env.DB;
}

function normalizeSymbol(value) {
    if (typeof value !== "string") {
        throw new WalletInputError("Enter a stock ticker.");
    }
    const ticker = value.trim();
    const symbol = ticker.toUpperCase().replaceAll(".", "-");
    if (!/^[\x00-\x7F]+$/.test(ticker) || symbol.length > 15 || !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/.test(symbol)) {
        throw new WalletInputError("Enter a valid stock ticker such as AAPL or BRK.B.");
    }
    return symbol;
}

function normalizePrice(value) {
    if (value == null) return null;
    if (typeof value !== "string") {
        throw new WalletInputError("Enter a purchase price in USD.");
    }
    const price = value.trim();
    if (!price) return null;

    const amount = price.match(/^\+?(\d*)(?:\.(\d*))?$/);
    if (!amount || price.length > 32 || !/[1-9]/.test(price)) {
        throw new WalletInputError("Enter a positive purchase price such as 2.40.");
    }
    const dollars = amount[1].replace(/^0+/, "") || "0";
    const fraction = amount[2];
    return fraction ? `${dollars}.${fraction}` : dollars;
}

export async function readWallet(env, ownerId) {
    const database = requireWallet(env, ownerId);
    const { results } = await database.prepare(selectHoldings).bind(ownerId).all();
    return { holdings: results };
}

export async function updateWallet(env, ownerId, payload) {
    const database = requireWallet(env, ownerId);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new WalletInputError("Enter a purchase or sale.");
    }
    const { action } = payload;
    const symbol = normalizeSymbol(payload.symbol);

    let mutation;
    if (action === "buy") {
        const price = normalizePrice(payload.price);
        const purchasedOn = new Date().toISOString().slice(0, 10);
        mutation = database.prepare(`
            INSERT INTO holdings (owner_id, symbol, purchased_on, price)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (owner_id, symbol) DO NOTHING
        `).bind(ownerId, symbol, purchasedOn, price);
    } else if (action === "sell") {
        mutation = database.prepare(`
            DELETE FROM holdings WHERE owner_id = ? AND symbol = ?
        `).bind(ownerId, symbol);
    } else {
        throw new WalletInputError("Choose Buy or Sell.");
    }

    const [result, { results }] = await database.batch([
        mutation,
        database.prepare(selectHoldings).bind(ownerId),
    ]);
    return { holdings: results, changed: result.meta.changes === 1 };
}
