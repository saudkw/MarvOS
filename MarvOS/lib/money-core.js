const DEFAULT_EXCLUDES = new Set([
    "home",
    "darkweb",
    "n00dles",
    "nectar-net",
]);

export const MONEY_THREAD_RAM = 1.75;

/** @param {NS} ns */
export function hasMoneyFormulas(ns) {
    return ns.fileExists("Formulas.exe", "home") && Boolean(ns.formulas?.hacking?.growThreads);
}

/** @param {NS} ns */
export function discoverHosts(ns) {
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

/** @param {NS} ns */
export function getWorkerPool(ns, options = {}) {
    const {
        homeReserve = 32,
        useHacknet = false,
    } = options;

    const purchased = new Set(ns.getPurchasedServers());
    const workers = [];
    for (const host of discoverHosts(ns)) {
        if (!ns.hasRootAccess(host)) continue;
        if (host.startsWith("hacknet") && !useHacknet) continue;

        const maxRam = ns.getServerMaxRam(host);
        if (maxRam <= 0) continue;

        const reserve = host === "home" ? homeReserve : 0;
        const freeRam = Math.max(0, maxRam - ns.getServerUsedRam(host) - reserve);
        const maxUsableRam = Math.max(0, maxRam - reserve);
        if (maxUsableRam <= 0) continue;

        workers.push({
            host,
            freeRam,
            maxUsableRam,
            type: host === "home" ? "home" : purchased.has(host) ? "purchased" : "rooted",
        });
    }

    workers.sort((a, b) => a.freeRam - b.freeRam);
    return workers;
}

/** @param {NS} ns */
export function getAvailableThreads(ns, options = {}) {
    const workers = getWorkerPool(ns, options);
    let totalThreads = 0;
    for (const worker of workers) {
        totalThreads += Math.max(0, Math.floor(worker.freeRam / MONEY_THREAD_RAM));
    }
    return {
        workers,
        totalThreads,
        totalFreeRam: workers.reduce((sum, worker) => sum + worker.freeRam, 0),
        totalUsableRam: workers.reduce((sum, worker) => sum + worker.maxUsableRam, 0),
    };
}

/** @param {NS} ns */
export function getPreppedServer(ns, hostname) {
    const server = ns.getServer(hostname);
    server.hackDifficulty = server.minDifficulty;
    server.moneyAvailable = server.moneyMax;
    return server;
}

/** @param {NS} ns */
export function getLiveTargetStats(ns, hostname) {
    const server = ns.getServer(hostname);
    return {
        host: hostname,
        money: server.moneyAvailable,
        maxMoney: server.moneyMax,
        moneyPct: server.moneyMax > 0 ? (server.moneyAvailable / server.moneyMax) * 100 : 0,
        sec: server.hackDifficulty,
        minSec: server.minDifficulty,
        secDiff: server.hackDifficulty - server.minDifficulty,
        chance: hasMoneyFormulas(ns)
            ? ns.formulas.hacking.hackChance(getPreppedServer(ns, hostname), ns.getPlayer())
            : ns.hackAnalyzeChance(hostname),
    };
}

/** @param {NS} ns */
export function getDynamicMoneyThresholds(ns) {
    const hack = ns.getHackingLevel();
    if (hack >= 2_500) return { primary: 50_000_000_000, fallback: 10_000_000_000 };
    if (hack >= 1_500) return { primary: 10_000_000_000, fallback: 2_000_000_000 };
    if (hack >= 1_000) return { primary: 2_000_000_000, fallback: 500_000_000 };
    if (hack >= 500) return { primary: 100_000_000, fallback: 25_000_000 };
    if (hack >= 250) return { primary: 50_000_000, fallback: 10_000_000 };
    return { primary: 5_000_000, fallback: 1_000_000 };
}

/** @param {NS} ns */
export function rankMoneyTargets(ns, options = {}) {
    const thresholds = getDynamicMoneyThresholds(ns);
    const rows = rankMoneyTargetsAtThreshold(ns, {
        ...options,
        minMoney: options.minMoney ?? 0,
        fallbackMoney: options.fallbackMoney ?? thresholds.fallback,
    });
    return rows.slice(0, options.limit ?? 5);
}

/** @param {NS} ns */
export function rankMoneyTargetsAtThreshold(ns, options = {}) {
    const purchased = new Set(ns.getPurchasedServers());
    const excludes = new Set([...(options.excludeTargets ?? DEFAULT_EXCLUDES)]);
    const player = ns.getPlayer();
    const minMoney = options.minMoney ?? 0;
    const fallbackMoney = options.fallbackMoney ?? 0;
    const minChance = options.minChance ?? 0.5;
    const hackGate = options.hackGate ?? 1.0;
    const hackThreshold = Math.floor(ns.getHackingLevel() * hackGate);
    const rows = [];

    for (const host of discoverHosts(ns)) {
        if (excludes.has(host)) continue;
        if (purchased.has(host)) continue;
        if (!ns.hasRootAccess(host)) continue;

        const server = ns.getServer(host);
        if (server.moneyMax <= 0) continue;
        if (server.moneyMax < minMoney && server.moneyMax < fallbackMoney) continue;
        if (server.requiredHackingSkill > ns.getHackingLevel()) continue;
        if (server.requiredHackingSkill > hackThreshold) continue;

        const batchInfo = getBatchInfo(ns, host, -1, -1, 1);
        if (!batchInfo || batchInfo.H1 <= 0 || batchInfo.G1 <= 0 || batchInfo.W2 <= 0) continue;

        const prepped = getPreppedServer(ns, host);
        const chance = hasMoneyFormulas(ns)
            ? ns.formulas.hacking.hackChance(prepped, player)
            : ns.hackAnalyzeChance(host);
        if (chance < minChance) continue;

        const hackTime = hasMoneyFormulas(ns)
            ? ns.formulas.hacking.hackTime(prepped, player)
            : ns.getHackTime(host);
        const weakenTime = Number.isFinite(hackTime) ? hackTime * 4 : Infinity;
        const totalThreads = batchInfo.H1 + batchInfo.W1 + batchInfo.G1 + batchInfo.W2;
        const score = printProfit(weakenTime, batchInfo.Take, 1, totalThreads, chance);

        rows.push({
            host,
            score,
            chance,
            growth: server.serverGrowth,
            minSec: server.minDifficulty,
            maxMoney: server.moneyMax,
            requiredHack: server.requiredHackingSkill,
            hackTime,
            weakenTime,
            batchInfo,
        });
    }

    rows.sort((a, b) => b.score - a.score);
    return rows;
}

/** @param {NS} ns */
export function getBatchInfo(ns, hostname, maxBatches = -1, availableThreads = -1, startHackThreads = 1) {
    const server = getPreppedServer(ns, hostname);
    const player = ns.getPlayer();
    const weakenStrength = ns.weakenAnalyze(1);
    const hackChance = ns.formulas.hacking.hackChance(server, player);
    const hackPercent = ns.formulas.hacking.hackPercent(server, player);

    if (!Number.isFinite(hackPercent) || hackPercent <= 0 || !Number.isFinite(hackChance) || hackChance <= 0) {
        return {
            H1: 0,
            W1: 0,
            G1: 0,
            W2: 0,
            Type: "NONE",
            Take: 0,
            HackP: 0,
            Chance: 0,
            Threads: 0,
        };
    }

    const maxHackThreads = Math.max(1, Math.ceil(1 / hackPercent));
    const start = Math.min(maxHackThreads, Math.max(1, startHackThreads));
    const end = maxHackThreads;

    let bestRatio = 0;
    let bestTake = 0;
    let bestHackThreads = 0;
    let bestWeaken1Threads = 0;
    let bestGrowThreads = 0;
    let bestWeaken2Threads = 0;
    let bestType = "HGW";

    for (let hackThreads = start; hackThreads <= end; hackThreads += 1) {
        const rawTake = hackPercent * hackThreads >= 1
            ? server.moneyMax - 1
            : hackPercent * server.moneyMax * hackThreads;
        const effectiveTake = rawTake * hackChance;

        let hybridHackSec = hackThreads * 0.002;
        const hybridWeaken1 = Math.floor(hybridHackSec / weakenStrength);
        hybridHackSec -= hybridWeaken1 * weakenStrength;

        const hgwHackSec = hackThreads * 0.002;

        const hwgwHackSec = hackThreads * 0.002;
        const hwgwWeaken1 = Math.ceil(hwgwHackSec / weakenStrength);

        const hybridGrowThreads = Math.ceil(
            ns.formulas.hacking.growThreads(
                withMoneySec(server, server.moneyMax - rawTake, server.minDifficulty + hybridHackSec),
                player,
                server.moneyMax,
                1
            )
        );
        const hgwGrowThreads = Math.ceil(
            ns.formulas.hacking.growThreads(
                withMoneySec(server, server.moneyMax - rawTake, server.minDifficulty + hgwHackSec),
                player,
                server.moneyMax,
                1
            )
        );
        const hwgwGrowThreads = Math.ceil(
            ns.formulas.hacking.growThreads(
                withMoneySec(server, server.moneyMax - rawTake, server.minDifficulty),
                player,
                server.moneyMax,
                1
            )
        );

        if (![hybridGrowThreads, hgwGrowThreads, hwgwGrowThreads].every((x) => Number.isFinite(x) && x >= 0)) {
            continue;
        }

        const hybridGrowSec = hybridGrowThreads * 0.004;
        const hgwGrowSec = hgwGrowThreads * 0.004;
        const hwgwGrowSec = hwgwGrowThreads * 0.004;

        const hybridWeaken2 = Math.ceil((hybridGrowSec + hybridHackSec) / weakenStrength);
        const hgwWeaken2 = Math.ceil((hgwGrowSec + hgwHackSec) / weakenStrength);
        const hwgwWeaken2 = Math.ceil(hwgwGrowSec / weakenStrength);

        const hybridThreads = hackThreads + hybridWeaken1 + hybridGrowThreads + hybridWeaken2;
        const hgwThreads = hackThreads + hgwGrowThreads + hgwWeaken2;
        const hwgwThreads = hackThreads + hwgwWeaken1 + hwgwGrowThreads + hwgwWeaken2;

        let hybridBatches = 1;
        let hgwBatches = 1;
        let hwgwBatches = 1;
        if (availableThreads > 0) {
            hybridBatches = threadLimitedBatches(availableThreads, hybridThreads, maxBatches);
            hgwBatches = threadLimitedBatches(availableThreads, hgwThreads, maxBatches);
            hwgwBatches = threadLimitedBatches(availableThreads, hwgwThreads, maxBatches);
        }

        const hybridRatio = scoreCandidate(effectiveTake, hybridThreads, hybridBatches, maxBatches, availableThreads);
        const hgwRatio = scoreCandidate(effectiveTake, hgwThreads, hgwBatches, maxBatches, availableThreads);
        const hwgwRatio = scoreCandidate(effectiveTake, hwgwThreads, hwgwBatches, maxBatches, availableThreads);
        const hasValid = hybridRatio > 0 || hgwRatio > 0 || hwgwRatio > 0;
        let failed = 0;

        if (hgwRatio > bestRatio || (hackThreads === maxHackThreads && bestRatio === 0)) {
            bestRatio = hgwRatio;
            bestTake = effectiveTake;
            bestHackThreads = hackThreads;
            bestWeaken1Threads = 0;
            bestGrowThreads = hgwGrowThreads;
            bestWeaken2Threads = hgwWeaken2;
            bestType = "HGW";
        } else {
            failed += 1;
        }

        if (hybridRatio > bestRatio) {
            bestRatio = hybridRatio;
            bestTake = effectiveTake;
            bestHackThreads = hackThreads;
            bestWeaken1Threads = hybridWeaken1;
            bestGrowThreads = hybridGrowThreads;
            bestWeaken2Threads = hybridWeaken2;
            bestType = "Hybrid";
        } else {
            failed += 1;
        }

        if (hwgwRatio > bestRatio) {
            bestRatio = hwgwRatio;
            bestTake = effectiveTake;
            bestHackThreads = hackThreads;
            bestWeaken1Threads = hwgwWeaken1;
            bestGrowThreads = hwgwGrowThreads;
            bestWeaken2Threads = hwgwWeaken2;
            bestType = "HWGW";
        } else {
            failed += 1;
        }

        if (failed === 3 && hasValid) break;
    }

    return {
        H1: bestHackThreads,
        W1: bestWeaken1Threads,
        G1: bestGrowThreads,
        W2: bestWeaken2Threads,
        Type: bestType,
        Take: bestTake * getScriptHackMoneyGain(ns),
        HackP: hackPercent,
        Chance: hackChance,
        Threads: bestHackThreads + bestWeaken1Threads + bestGrowThreads + bestWeaken2Threads,
    };
}

/** @param {NS} ns */
export function getBestXpTarget(ns) {
    const player = ns.getPlayer();
    let bestHost = "";
    let bestTime = Infinity;
    let bestRatio = 0;

    for (const host of discoverHosts(ns)) {
        const server = ns.getServer(host);
        if (!server.hasAdminRights) continue;
        if (server.hostname === "home") continue;
        if (server.purchasedByPlayer) continue;
        if (server.moneyMax <= 0) continue;
        if (server.minDifficulty <= 1) continue;

        const xp = getHackXpGain(player, server, ns);
        const time = ns.formulas.hacking.hackTime(getPreppedServer(ns, host), player);
        if (!Number.isFinite(time) || time <= 0) continue;

        const ratio = xp / time;
        if (ratio > bestRatio) {
            bestRatio = ratio;
            bestTime = time;
            bestHost = host;
        }
    }

    return {
        host: bestHost,
        hackTime: bestTime,
        ratio: bestRatio,
    };
}

function withMoneySec(server, moneyAvailable, hackDifficulty) {
    const next = { ...server };
    next.moneyAvailable = Math.max(1, Math.min(server.moneyMax, moneyAvailable));
    next.hackDifficulty = Math.max(server.minDifficulty, hackDifficulty);
    return next;
}

function threadLimitedBatches(availableThreads, candidateThreads, maxBatches) {
    const count = Math.floor(availableThreads / candidateThreads);
    if (maxBatches < 1) return count;
    if (count > maxBatches) return 0;
    return count;
}

function scoreCandidate(effectiveTake, totalThreads, totalBatches, maxBatches, availableThreads) {
    if (totalThreads <= 0) return 0;
    if (maxBatches === -1 && availableThreads === -1) {
        return effectiveTake / totalThreads;
    }
    return (effectiveTake / totalThreads) * totalBatches;
}

function getScriptHackMoneyGain(ns) {
    try {
        return ns.getBitNodeMultipliers().ScriptHackMoneyGain ?? 1;
    } catch {
        return 1;
    }
}

function getHackXpGain(player, server, ns) {
    const baseDifficulty = server.baseDifficulty;
    if (!baseDifficulty) return 0;
    const baseExpGain = 3;
    const diffFactor = 0.3;
    const expGain = (baseExpGain + baseDifficulty * diffFactor) * player.mults.hacking_exp;
    try {
        return expGain * (ns.getBitNodeMultipliers().HackExpGain ?? 1);
    } catch {
        return expGain;
    }
}

function printProfit(timeMs, take, batches, threads, chance) {
    const seconds = timeMs / 1000;
    if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(take) || take <= 0 || threads <= 0) {
        return 0;
    }
    return ((take / seconds) * batches / threads) * chance;
}
