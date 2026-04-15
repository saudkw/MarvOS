/** @param {NS} ns */
export function rankMoneyTargets(ns, options = {}) {
    const thresholds = getDynamicMoneyThresholds(ns);
    const config = {
        minMoney: options.minMoney ?? thresholds.primary,
        minChance: options.minChance ?? 0.5,
        hackGate: options.hackGate ?? 0.5,
        limit: options.limit ?? 5,
    };

    const purchased = new Set(ns.getPurchasedServers());
    const player = ns.getPlayer();
    const hackThreshold = Math.floor(ns.getHackingLevel() * config.hackGate);
    const rows = [];

    for (const host of discoverHosts(ns)) {
        if (host === "home" || host === "darkweb") continue;
        if (purchased.has(host)) continue;
        if (!ns.hasRootAccess(host)) continue;

        const server = ns.getServer(host);
        if (server.moneyMax < config.minMoney) continue;
        if (server.requiredHackingSkill > hackThreshold) continue;

        const prepped = { ...server, moneyAvailable: server.moneyMax, hackDifficulty: server.minDifficulty };
        const chance = hasFormulas(ns)
            ? ns.formulas.hacking.hackChance(prepped, player)
            : ns.hackAnalyzeChance(host);
        if (chance < config.minChance) continue;

        const hackTime = hasFormulas(ns)
            ? ns.formulas.hacking.hackTime(prepped, player)
            : ns.getHackTime(host);
        const growth = Math.max(1, ns.getServerGrowth(host));
        const levelFactor = Math.max(0.2, 1 - server.requiredHackingSkill / Math.max(ns.getHackingLevel() * 1.2, 1));
        const liveMoneyPct = server.moneyMax > 0 ? server.moneyAvailable / server.moneyMax : 0;
        const secDiff = Math.max(0, server.hackDifficulty - server.minDifficulty);
        const healthFactor = Math.max(0.35, liveMoneyPct) * (1 / (1 + secDiff * 0.5));
        const score = (server.moneyMax * chance * growth * levelFactor * healthFactor) / Math.max(1, hackTime);

        rows.push({
            host,
            score,
            chance,
            growth,
            minSec: Math.max(1, ns.getServerMinSecurityLevel(host)),
            maxMoney: server.moneyMax,
            requiredHack: server.requiredHackingSkill,
            hackTime,
        });
    }

    rows.sort((a, b) => b.score - a.score);
    return rows.slice(0, config.limit);
}

function getDynamicMoneyThresholds(ns) {
    const hack = ns.getHackingLevel();
    if (hack >= 1_000) return { primary: 500_000_000, fallback: 100_000_000 };
    if (hack >= 500) return { primary: 100_000_000, fallback: 50_000_000 };
    if (hack >= 250) return { primary: 50_000_000, fallback: 10_000_000 };
    return { primary: 5_000_000, fallback: 1_000_000 };
}

/** @param {NS} ns */
function discoverHosts(ns) {
    const seen = new Set(["home"]);
    const queue = ["home"];

    while (queue.length > 0) {
        const host = queue.shift();
        for (const next of ns.scan(host)) {
            if (!seen.has(next)) {
                seen.add(next);
                queue.push(next);
            }
        }
    }

    return seen;
}

function hasFormulas(ns) {
    return ns.fileExists("Formulas.exe", "home") && Boolean(ns.formulas?.hacking?.hackChance);
}
