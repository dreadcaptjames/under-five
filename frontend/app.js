import { BROWSER_WALLET_KEY, readBrowserWallet, updateBrowserWallet } from "./browser-wallet.mjs";
import { hostedScan } from "./hosted-scan.mjs";

const browserWallet = document.documentElement.dataset.wallet === "browser";
const marketOrigin = document.documentElement.dataset.marketOrigin;
const byId = (id) => document.getElementById(id);
const scanner = byId("scanner-view");
const wallet = byId("wallet-view");
const nav = [...document.querySelectorAll("[data-view]")];
const scanForm = byId("scan-form");
const scanSymbols = byId("scan-symbols");
const scanButton = byId("scan-button");
const scanLabel = byId("scan-button-label");
const universeSize = byId("universe-size");
const scanStatus = byId("scan-status");
const scanUnavailable = byId("scan-unavailable");
const resultFilter = byId("result-filter");
const resultSort = byId("result-sort");
const resultsSubtitle = byId("results-subtitle");
const defaultResultsSubtitle = resultsSubtitle.textContent;
const resultsEmpty = byId("results-empty");
const resultsContent = byId("results-content");
const resultsBody = byId("results-body");
const resultsTable = resultsBody.closest(".table-scroll");
const detailContent = byId("detail-content");
const detailBuy = byId("detail-buy");
const chart = byId("detail-chart");
const walletAdd = byId("wallet-add");
const walletBody = byId("wallet-body");
const tradeDialog = byId("trade-dialog");
const tradeForm = byId("trade-form");
const tradeSymbol = byId("trade-symbol");
const tradePrice = byId("trade-price");
const tradeConfirm = byId("trade-confirm");
const tradeCancel = byId("trade-cancel");

const state = {
    candidates: [],
    hasScanned: false,
    scanUnavailable: false,
    scanning: false,
    selected: null,
    holdings: [],
    walletLoading: true,
    walletError: "",
    walletVersion: 0,
    trade: null,
    savingTrade: false,
};

const priceFormat = new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4,
});
const compactDollars = new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2,
});
const percent = new Intl.NumberFormat("en-US", {
    style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1,
});
const signedPercent = new Intl.NumberFormat("en-US", {
    style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero",
});
const dates = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});

function formatDate(date) {
    return dates.format(new Date(`${date}T00:00:00Z`));
}

function exactPrice(price) {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(price);
    if (!match) return `$${price}`;
    const whole = match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `$${whole}.${(match[2] ?? "").padEnd(2, "0")}`;
}

async function requestWallet(data) {
    if (browserWallet) {
        return data === undefined ? readBrowserWallet() : updateBrowserWallet(data);
    }
    let response;
    const options = {headers: {Accept: "application/json"}};
    if (data !== undefined) {
        options.method = "POST";
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(data);
    }
    try {
        response = await fetch("/api/wallet", options);
    } catch {
        throw new Error("Could not reach UnderFive. Check your connection and try again.");
    }
    const result = await response.json().catch(() => null);
    if (!response.ok || result === null) {
        throw new Error(result?.error || "The dashboard could not complete this request.");
    }
    return result;
}

function appendCell(row, text, className = "") {
    const cell = row.insertCell();
    cell.className = className;
    cell.textContent = text;
    return cell;
}

function setEmpty(element, title, copy) {
    element.querySelector("[data-empty-title]").textContent = title;
    element.querySelector("[data-empty-copy]").textContent = copy;
}

function setStatus(element, message, tone = "") {
    element.textContent = message;
    element.dataset.tone = tone;
    element.hidden = !message;
}

function showUnavailable(reasons) {
    scanUnavailable.hidden = reasons.length === 0;
    scanUnavailable.open = false;
    byId("scan-unavailable-summary").textContent = `${reasons.length} ${reasons.length === 1 ? "ticker" : "tickers"} unavailable`;
    const list = byId("scan-unavailable-list");
    list.replaceChildren(...reasons.map((reason) => {
        const item = document.createElement("li");
        item.textContent = reason;
        return item;
    }));
}

function scanTickers() {
    return scanSymbols.value.trim().split(/[,\s]+/).filter(Boolean).map((symbol) => symbol.toUpperCase());
}

function syncDiscoveryInput() {
    universeSize.disabled = state.scanning || scanTickers().length !== 0;
}

function showView(view) {
    scanner.hidden = view !== "scanner";
    wallet.hidden = view !== "wallet";
    for (const button of nav) {
        if (button.dataset.view === view) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
    }
    if (view === "wallet") refreshWallet();
    else drawChart();
}

function visibleCandidates() {
    const query = resultFilter.value.trim().toUpperCase().replaceAll(".", "-");
    const key = resultSort.value;
    return state.candidates.filter(({symbol}) => symbol.includes(query)).sort((a, b) => {
        if (key === "symbol") return a.symbol.localeCompare(b.symbol);
        const order = key === "price" ? a.price - b.price : b[key] - a[key];
        return order || a.symbol.localeCompare(b.symbol);
    });
}

function isHeld(symbol) {
    return state.holdings.some((holding) => holding.symbol === symbol);
}

function makeResultRow(candidate, rank) {
    const row = document.createElement("tr");
    row.dataset.symbol = candidate.symbol;
    appendCell(row, String(rank), "table-rank");
    const ticker = document.createElement("button");
    ticker.type = "button";
    ticker.className = "ticker-button";
    ticker.textContent = candidate.symbol;
    ticker.setAttribute("aria-label", `View ${candidate.symbol} details`);
    ticker.setAttribute("aria-controls", "detail-content");
    const badge = document.createElement("span");
    badge.className = "held-badge";
    badge.textContent = "Held";
    badge.hidden = !isHeld(candidate.symbol);
    appendCell(row, "").append(ticker, badge);
    appendCell(row, priceFormat.format(candidate.price));
    appendCell(row, signedPercent.format(candidate.return_5), "is-positive");
    appendCell(row, signedPercent.format(candidate.return_20), "is-positive");
    appendCell(row, percent.format(candidate.score), "table-score");
    return row;
}

function renderResults() {
    const matches = visibleCandidates();
    const hasCandidates = state.candidates.length > 0;
    resultFilter.disabled = !hasCandidates;
    resultSort.disabled = !hasCandidates;
    resultsEmpty.hidden = matches.length > 0;
    resultsContent.hidden = !hasCandidates;
    resultsTable.hidden = matches.length === 0;
    byId("scan-count").textContent = state.hasScanned ? String(state.candidates.length) : "—";

    if (state.scanning && !state.hasScanned) {
        setEmpty(resultsEmpty, "Scanning for candidates", "Checking recent prices and trading volume.");
    } else if (state.scanUnavailable) {
        setEmpty(resultsEmpty, "No daily price data", "Try again in a moment or scan different tickers.");
    } else if (state.hasScanned && !hasCandidates) {
        setEmpty(resultsEmpty, "No stocks met the filters", "Try a larger list or scan different tickers.");
    } else if (hasCandidates && matches.length === 0) {
        setEmpty(resultsEmpty, "No matching tickers", "Clear the search to see all scan results.");
    } else if (!state.hasScanned) {
        setEmpty(resultsEmpty, "No scan yet", "Run a scan to get a ranked list of candidates.");
    }

    resultsSubtitle.textContent = resultFilter.value.trim()
        ? `${matches.length} of ${state.candidates.length} candidates`
        : defaultResultsSubtitle;
    resultsBody.replaceChildren(...matches.map((candidate, index) => makeResultRow(candidate, index + 1)));
    const selected = matches.find(({symbol}) => symbol === state.selected?.symbol) ?? matches[0];
    selectCandidate(selected ?? null);
}

function updateDetailButton() {
    if (!state.selected) return;
    const held = isHeld(state.selected.symbol);
    const label = detailBuy.querySelector("[data-button-label]") ?? detailBuy;
    label.textContent = held ? "View in wallet" : "Record purchase";
}

function selectCandidate(candidate) {
    state.selected = candidate;
    for (const row of resultsBody.rows) {
        const selected = row.dataset.symbol === candidate?.symbol;
        row.classList.toggle("is-selected", selected);
        row.querySelector("button").setAttribute("aria-pressed", String(selected));
    }
    byId("detail-empty").hidden = Boolean(candidate);
    detailContent.hidden = !candidate;
    if (!candidate) return;

    byId("detail-symbol").textContent = candidate.symbol;
    byId("detail-price").textContent = priceFormat.format(candidate.price);
    byId("detail-date").textContent = `As of ${formatDate(candidate.date)}`;
    byId("detail-return-5").textContent = signedPercent.format(candidate.return_5);
    byId("detail-return-20").textContent = signedPercent.format(candidate.return_20);
    byId("detail-volume").textContent = compactDollars.format(candidate.avg_dollar_volume);
    byId("detail-score").textContent = percent.format(candidate.score);
    chart.setAttribute("aria-label", `${candidate.symbol} adjusted closing prices over the last ${candidate.trend.length} trading sessions`);
    updateDetailButton();
    drawChart();
}

function drawChart() {
    const trend = state.selected?.trend;
    if (!trend || trend.length < 2 || scanner.hidden) return;
    const {width, height} = chart.getBoundingClientRect();
    if (width < 80 || height < 45) return;
    const ratio = window.devicePixelRatio || 1;
    chart.width = Math.round(width * ratio);
    chart.height = Math.round(height * ratio);
    const ctx = chart.getContext("2d");
    ctx.scale(ratio, ratio);

    const bottomPrice = Math.min(...trend);
    const topPrice = Math.max(...trend);
    const padding = Math.max((topPrice - bottomPrice) * 0.1, topPrice * 0.005);
    const min = Math.max(0, bottomPrice - padding);
    const max = topPrice + padding;
    const spread = max - min;
    const digits = Math.min(6, Math.max(2, 1 - Math.floor(Math.log10(spread))));
    const tickFormat = new Intl.NumberFormat("en-US", {maximumFractionDigits: digits});
    ctx.font = `11px ${getComputedStyle(chart).fontFamily}`;
    const left = 2;
    const top = 12;
    const right = width - ctx.measureText(`$${tickFormat.format(max)}`).width - 10;
    const bottom = height - 6;
    const points = trend.map((price, index) => [
        left + (index / (trend.length - 1)) * (right - left),
        top + ((max - price) / spread) * (bottom - top),
    ]);

    ctx.textBaseline = "middle";
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#e3ebe7";
    ctx.fillStyle = "#526760";
    for (let tick = 0; tick < 4; tick += 1) {
        const y = top + (tick / 3) * (bottom - top);
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.fillText(`$${tickFormat.format(max - (tick / 3) * spread)}`, right + 7, y);
    }

    const fill = ctx.createLinearGradient(0, top, 0, bottom);
    fill.addColorStop(0, "rgba(8, 131, 103, .18)");
    fill.addColorStop(1, "rgba(8, 131, 103, .025)");
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    for (const point of points) ctx.lineTo(...point);
    ctx.lineTo(right, bottom);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    ctx.lineWidth = 2.25;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#088367";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(...points.at(-1), 3.25, 0, Math.PI * 2);
    ctx.fillStyle = "#088367";
    ctx.fill();
}

function renderWallet() {
    byId("wallet-count").textContent = state.walletLoading ? "—" : String(state.holdings.length);
    const empty = byId("wallet-empty");
    empty.hidden = state.holdings.length > 0;
    byId("wallet-content").hidden = state.holdings.length === 0;
    if (state.walletLoading) {
        setEmpty(empty, "Loading your wallet", "Opening your saved holdings.");
    } else if (state.walletError) {
        setEmpty(empty, "Wallet could not load", state.walletError);
    } else {
        setEmpty(empty, "Your wallet is empty", "Record a purchase here or choose a stock from your scan results.");
    }

    const rows = state.holdings.map((holding) => {
        const row = document.createElement("tr");
        appendCell(row, holding.symbol, "wallet-ticker");
        appendCell(row, "1");
        appendCell(row, formatDate(holding.purchased_on));
        appendCell(row, holding.price === null ? "—" : exactPrice(holding.price),
            holding.price === null ? "wallet-empty-price" : "");
        const sale = document.createElement("button");
        sale.type = "button";
        sale.className = "button button--subtle sale-button";
        sale.dataset.sell = holding.symbol;
        sale.textContent = "Record sale";
        sale.setAttribute("aria-label", `Record sale of ${holding.symbol}`);
        appendCell(row, "").append(sale);
        return row;
    });
    walletBody.replaceChildren(...rows);
    for (const row of resultsBody.rows) {
        row.querySelector(".held-badge").hidden = !isHeld(row.dataset.symbol);
    }
    updateDetailButton();
}

async function refreshWallet() {
    const version = ++state.walletVersion;
    try {
        const result = await requestWallet();
        if (version !== state.walletVersion) return;
        state.holdings = result.holdings;
        state.walletError = "";
    } catch (error) {
        if (version !== state.walletVersion) return;
        state.walletError = error.message;
    }
    state.walletLoading = false;
    renderWallet();
}

let toastTimer;
function showToast(message) {
    const toast = byId("toast");
    clearTimeout(toastTimer);
    const label = toast.querySelector("[data-toast-message]") ?? toast;
    label.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
}

function startTrade(action, symbol = "") {
    const selling = action === "sell";
    state.trade = {action, symbol};
    tradeForm.reset();
    tradeSymbol.value = symbol;
    tradeSymbol.required = !symbol;
    byId("trade-title").textContent = selling ? `Record sale of ${symbol}` : "Record a purchase";
    byId("trade-copy").textContent = selling
        ? `Confirm that you sold your share of ${symbol} to remove it from your wallet.`
        : symbol ? `Add one share of ${symbol} to your wallet.` : "Add one share of a stock you purchased.";
    byId("trade-symbol-field").hidden = Boolean(symbol);
    byId("trade-price-field").hidden = selling;
    tradeConfirm.textContent = selling ? "Record sale" : "Record purchase";
    tradeConfirm.dataset.action = action;
    setStatus(byId("trade-error"), "");
    tradeDialog.showModal();
    if (selling) tradeCancel.focus();
    else if (symbol) tradePrice.focus();
    else tradeSymbol.focus();
}

scanForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.scanning) return;
    const symbols = scanTickers();
    const size = Number(universeSize.value);
    state.scanning = true;
    scanButton.disabled = true;
    scanButton.setAttribute("aria-busy", "true");
    scanLabel.textContent = "Scanning…";
    scanSymbols.disabled = true;
    syncDiscoveryInput();
    showUnavailable([]);
    setStatus(scanStatus, "Fetching daily market data. This may take a moment.");
    if (!state.hasScanned) renderResults();

    try {
        const result = await hostedScan({symbols, universe_size: size}, marketOrigin);
        state.candidates = result.candidates;
        state.hasScanned = true;
        state.scanUnavailable = result.total > 0 && result.checked === 0;
        resultFilter.value = "";
        const checked = `Checked ${result.checked} of ${result.total} ${result.total === 1 ? "ticker" : "tickers"}.`;
        if (state.scanUnavailable) {
            setStatus(scanStatus, `${checked} Daily price data is unavailable.`, "error");
        } else {
            setStatus(scanStatus, checked);
        }
        showUnavailable(result.unavailable);
    } catch (error) {
        setStatus(scanStatus, error.message, "error");
    } finally {
        state.scanning = false;
        scanButton.disabled = false;
        scanButton.removeAttribute("aria-busy");
        scanLabel.textContent = "Run scan";
        scanSymbols.disabled = false;
        syncDiscoveryInput();
        renderResults();
    }
});

scanSymbols.addEventListener("input", syncDiscoveryInput);
resultFilter.addEventListener("input", renderResults);
resultSort.addEventListener("change", renderResults);
resultsBody.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-symbol]");
    if (!row) return;
    selectCandidate(state.candidates.find(({symbol}) => symbol === row.dataset.symbol));
    if (window.matchMedia("(max-width: 930px)").matches) {
        detailContent.scrollIntoView({block: "nearest"});
    }
});

for (const button of nav) {
    button.addEventListener("click", () => showView(button.dataset.view));
}
detailBuy.addEventListener("click", () => {
    if (!state.selected) return;
    if (isHeld(state.selected.symbol)) {
        showView("wallet");
        byId("wallet-title").focus();
    } else {
        startTrade("buy", state.selected.symbol);
    }
});
walletAdd.addEventListener("click", () => startTrade("buy"));
walletBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sell]");
    if (button) startTrade("sell", button.dataset.sell);
});

tradeCancel.addEventListener("click", () => tradeDialog.close());
tradeDialog.addEventListener("cancel", (event) => {
    if (state.savingTrade) event.preventDefault();
});
tradeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.savingTrade || !state.trade) return;
    const {action, symbol: preset} = state.trade;
    const symbol = (preset || tradeSymbol.value).trim().toUpperCase().replaceAll(".", "-");
    const price = tradePrice.value.trim();
    const body = {action, symbol};
    if (action === "buy" && price) body.price = price;

    state.savingTrade = true;
    tradeConfirm.disabled = true;
    tradeCancel.disabled = true;
    tradeConfirm.setAttribute("aria-busy", "true");
    tradeConfirm.textContent = "Saving…";
    setStatus(byId("trade-error"), "");

    try {
        const result = await requestWallet(body);
        state.walletVersion += 1;
        state.holdings = result.holdings;
        state.walletLoading = false;
        state.walletError = "";
        renderWallet();
        tradeDialog.close();
        if (action === "buy") {
            showToast(result.changed ? `Purchase of ${symbol} recorded.` : `${symbol} is already in your wallet.`);
        } else {
            walletAdd.focus();
            showToast(result.changed ? `Sale of ${symbol} recorded.` : `${symbol} is no longer in your wallet.`);
        }
    } catch (error) {
        setStatus(byId("trade-error"), error.message, "error");
    } finally {
        state.savingTrade = false;
        tradeConfirm.disabled = false;
        tradeCancel.disabled = false;
        tradeConfirm.removeAttribute("aria-busy");
        tradeConfirm.textContent = action === "sell" ? "Record sale" : "Record purchase";
    }
});

new ResizeObserver(drawChart).observe(chart);
if (browserWallet) {
    window.addEventListener("storage", ({key}) => {
        if (key === null || key.startsWith(BROWSER_WALLET_KEY)) refreshWallet();
    });
}
syncDiscoveryInput();
renderResults();
refreshWallet();
