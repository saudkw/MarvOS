/** @param {NS} ns */
export async function main(ns) {
    const flags = ns.flags([
        ["prefix", "MiniMarv-"],
        ["min-ram", 2],
        ["max-ram", 0],
        ["reserve", 250_000_000],
        ["budget-pct", 0.25],
        ["interval", 20_000],
        ["max-ops", 1],
        ["once", false],
    ]);

    ns.disableLog("ALL");

    const minRam = normalizeRam(flags["min-ram"]);
    if (minRam < 2) {
        ns.tprint("buyservers.js: min-ram must be a power of two >= 2");
        return;
    }

    while (true) {
        const action = buyOrUpgrade(ns, {
            prefix: String(flags.prefix || "pserv-"),
            minRam,
            maxRam: normalizeMaxRam(ns, flags["max-ram"]),
            reserve: Math.max(0, Number(flags.reserve) || 0),
            budgetPct: clampBudget(flags["budget-pct"]),
            maxOps: Math.max(1, Math.floor(Number(flags["max-ops"]) || 1)),
        });

        if (action.notify && action.message) ns.tprint(action.message);
        if (flags.once) return;
        await ns.sleep(Math.max(5_000, Number(flags.interval) || 30_000));
    }
}

function buyOrUpgrade(ns, config) {
    let budget = getBudget(ns, config.reserve, config.budgetPct);
    if (budget <= 0) {
        return { notify: false, message: `[BUY] Waiting | reserve=${ns.formatNumber(config.reserve)}` };
    }

    const changes = [];
    let guard = 0;
    while (budget > 0 && guard < config.maxOps) {
        guard += 1;
        const action = singleBuyOrUpgrade(ns, config, budget);
        if (!action) break;
        changes.push(action.message);
        budget = getBudget(ns, config.reserve, config.budgetPct);
    }

    if (changes.length > 0) {
        return { notify: true, message: changes.join(" | ") };
    }
    return { notify: false, message: `[BUY] No affordable server actions | budget=${ns.formatNumber(budget)}` };
}

function singleBuyOrUpgrade(ns, config, budget) {
    const limit = ns.getPurchasedServerLimit();
    const servers = ns.getPurchasedServers().sort((a, b) => ns.getServerMaxRam(a) - ns.getServerMaxRam(b));

    if (servers.length < limit) {
        const ram = bestAffordablePurchaseRam(ns, budget, config.minRam, config.maxRam);
        if (ram > 0) {
            const name = nextServerName(ns, config.prefix);
            const purchased = ns.purchaseServer(name, ram);
            if (purchased) {
                return { message: `bought ${purchased} @ ${ram}GB` };
            }
            return null;
        }
        return null;
    }

    const target = cheapestUpgradeable(ns, servers, budget, config.maxRam);
    if (!target) return null;

    const upgraded = ns.upgradePurchasedServer(target.host, target.newRam);
    if (upgraded) {
        return { message: `upgraded ${target.host} -> ${target.newRam}GB` };
    }
    return null;
}

function cheapestUpgradeable(ns, servers, budget, maxRam) {
    let best = null;

    for (const host of servers) {
        const currentRam = ns.getServerMaxRam(host);
        let nextRam = currentRam * 2;
        if (maxRam > 0) nextRam = Math.min(nextRam, maxRam);
        if (nextRam <= currentRam) continue;

        const cost = ns.getPurchasedServerUpgradeCost(host, nextRam);
        if (!Number.isFinite(cost) || cost <= 0 || cost > budget) continue;

        if (!best || cost < best.cost) {
            best = { host, newRam: nextRam, cost };
        }
    }

    return best;
}

function bestAffordablePurchaseRam(ns, budget, minRam, maxRam) {
    const purchasedMax = ns.getPurchasedServerMaxRam();
    const cap = maxRam > 0 ? Math.min(maxRam, purchasedMax) : purchasedMax;
    let ram = minRam;
    let best = 0;

    while (ram <= cap) {
        const cost = ns.getPurchasedServerCost(ram);
        if (cost <= budget) best = ram;
        ram *= 2;
    }

    return best;
}

function nextServerName(ns, prefix) {
    const existing = new Set(ns.getPurchasedServers());
    for (let i = 1; i <= ns.getPurchasedServerLimit(); i++) {
        const candidate = `${prefix}${i}`;
        if (!existing.has(candidate)) return candidate;
    }
    return `${prefix}${Date.now()}`;
}

function getBudget(ns, reserve, budgetPct) {
    const money = ns.getServerMoneyAvailable("home");
    const freeCash = Math.max(0, money - reserve);
    return Math.max(0, freeCash * budgetPct);
}

function normalizeRam(value) {
    const ram = Math.floor(Number(value) || 0);
    if (ram < 2) return 0;
    return (ram & (ram - 1)) === 0 ? ram : 0;
}

function normalizeMaxRam(ns, value) {
    const ram = Math.floor(Number(value) || 0);
    if (ram <= 0) return 0;
    const max = ns.getPurchasedServerMaxRam();
    return Math.min(max, ram);
}

function clampBudget(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0.25;
    return Math.min(1, Math.max(0.01, num));
}
