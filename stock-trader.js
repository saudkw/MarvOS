import { clearStatus, STATUS_NAMES, writeStatus } from "/MarvOS/lib/status.js";

/** @param {NS} ns */
export async function main(ns) {
    const flags = ns.flags([
        ["reserve", 1_000_000_000],
        ["cash-pct", 0.85],
        ["interval", 6_000],
        ["history", 12],
        ["buy-threshold", 0.56],
        ["sell-threshold", 0.50],
        ["min-position", 50_000_000],
    ]);

    ns.disableLog("ALL");
    ns.atExit(() => clearStatus(ns, STATUS_NAMES.stock));

    const access = getAccess(ns);
    if (!access.wse || !access.tix) {
        ns.tprint("stock-trader.js: WSE Account and TIX API Access are required");
        return;
    }

    /** @type {Map<string, number[]>} */
    const history = new Map();
    let lastAction = "warming up";

    while (true) {
        const accessNow = getAccess(ns);
        const symbols = ns.stock.getSymbols();
        for (const sym of symbols) {
            const series = history.get(sym) ?? [];
            series.push(ns.stock.getPrice(sym));
            while (series.length > flags.history) series.shift();
            history.set(sym, series);
        }

        // Warm up price history before momentum mode can trade.
        const ready = accessNow.fourSigmaApi || [...history.values()].every((series) => series.length >= flags.history);
        if (ready) {
            lastAction = trade(ns, accessNow, history, flags);
        }

        writeStatus(ns, STATUS_NAMES.stock, {
            mode: accessNow.fourSigmaApi ? "4s" : "momentum",
            action: lastAction,
            reserve: Number(flags.reserve),
            invested: portfolioValue(ns),
            cash: ns.getServerMoneyAvailable("home"),
            symbols: ns.stock.getSymbols().length,
        });

        ns.clearLog();
        ns.print("===== STOCK TRADER =====");
        ns.print(`Mode        : ${accessNow.fourSigmaApi ? "4S" : "Momentum"}`);
        ns.print(`Cash        : ${ns.formatNumber(ns.getServerMoneyAvailable("home"), 2)}`);
        ns.print(`Invested    : ${ns.formatNumber(portfolioValue(ns), 2)}`);
        ns.print(`Action      : ${lastAction}`);

        await ns.sleep(Math.max(2_000, Number(flags.interval) || 6_000));
    }
}

function trade(ns, access, history, flags) {
    const reserve = Math.max(0, Number(flags.reserve) || 0);
    const cashPct = clamp(Number(flags["cash-pct"]) || 0.85, 0.05, 1);
    const buyThreshold = clamp(Number(flags["buy-threshold"]) || 0.56, 0.51, 0.75);
    const sellThreshold = clamp(Number(flags["sell-threshold"]) || 0.50, 0.40, 0.55);
    const minPosition = Math.max(10_000_000, Number(flags["min-position"]) || 50_000_000);

    let actions = 0;
    let summary = [];

    for (const sym of ns.stock.getSymbols()) {
        const signal = access.fourSigmaApi
            ? ns.stock.getForecast(sym)
            : momentumSignal(history.get(sym) ?? []);
        const [shares, avgPrice] = ns.stock.getPosition(sym);
        if (shares > 0 && signal <= sellThreshold) {
            const result = ns.stock.sellStock(sym, shares);
            if (result > 0) {
                actions += 1;
                summary.push(`sell ${sym}`);
            }
        }
    }

    const candidates = ns.stock.getSymbols()
        .map((sym) => ({
            sym,
            signal: access.fourSigmaApi ? ns.stock.getForecast(sym) : momentumSignal(history.get(sym) ?? []),
            price: ns.stock.getAskPrice(sym),
            maxShares: ns.stock.getMaxShares(sym),
            longShares: ns.stock.getPosition(sym)[0],
        }))
        .filter((row) => row.signal >= buyThreshold)
        .sort((a, b) => b.signal - a.signal);

    let buyingPower = Math.max(0, (ns.getServerMoneyAvailable("home") - reserve) * cashPct);
    for (const row of candidates) {
        if (buyingPower < minPosition) break;

        const remainingShares = Math.max(0, row.maxShares - row.longShares);
        if (remainingShares <= 0) continue;

        const affordableShares = Math.floor(buyingPower / row.price);
        const shares = Math.min(remainingShares, affordableShares);
        if (shares <= 0) continue;

        const bought = ns.stock.buyStock(row.sym, shares);
        if (bought > 0) {
            const spent = shares * row.price;
            buyingPower = Math.max(0, buyingPower - spent);
            actions += 1;
            summary.push(`buy ${row.sym}`);
        }
    }

    return actions > 0 ? summary.join(", ") : "hold";
}

function momentumSignal(series) {
    if (series.length < 3) return 0.5;
    const start = series[0];
    const end = series[series.length - 1];
    const slope = start > 0 ? (end - start) / start : 0;
    return clamp(0.5 + slope * 8, 0.35, 0.65);
}

function portfolioValue(ns) {
    let total = 0;
    for (const sym of ns.stock.getSymbols()) {
        const [shares] = ns.stock.getPosition(sym);
        if (shares > 0) {
            total += shares * ns.stock.getBidPrice(sym);
        }
    }
    return total;
}

function getAccess(ns) {
    return {
        wse: safeBool(() => ns.stock.hasWSEAccount()),
        tix: safeBool(() => ns.stock.hasTIXAPIAccess()),
        fourSigmaApi: safeBool(() => ns.stock.has4SDataTIXAPI()),
    };
}

function safeBool(fn) {
    try {
        return Boolean(fn());
    } catch {
        return false;
    }
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
