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

    return [...seen];
}

/** @param {NS} ns */
export function getServers(ns) {
    return discoverHosts(ns).map((host) => ns.getServer(host));
}

/** @param {NS} ns */
export function getThreadSummary(ns, options = {}) {
    const {
        homeReserve = 32,
        useHacknet = false,
    } = options;

    let totalThreads = 0;
    let totalFreeRam = 0;
    let totalUsableRam = 0;

    for (const host of discoverHosts(ns)) {
        if (!ns.hasRootAccess(host)) continue;
        if (host.startsWith("hacknet") && !useHacknet) continue;
        const maxRam = ns.getServerMaxRam(host);
        if (maxRam <= 0) continue;

        const reserve = host === "home" ? homeReserve : 0;
        const freeRam = Math.max(0, maxRam - ns.getServerUsedRam(host) - reserve);
        totalFreeRam += freeRam;
        totalUsableRam += Math.max(0, maxRam - reserve);
        totalThreads += Math.floor(freeRam / MONEY_THREAD_RAM);
    }

    return {
        totalThreads,
        totalFreeRam,
        totalUsableRam,
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
export function getGrowThreads(ns, hostname, moneyAvailable, hackDifficulty) {
    const server = ns.getServer(hostname);
    server.moneyAvailable = Math.max(1, Math.min(server.moneyMax, moneyAvailable));
    server.hackDifficulty = Math.max(server.minDifficulty, hackDifficulty);
    return Math.ceil(
        ns.formulas.hacking.growThreads(server, ns.getPlayer(), server.moneyMax, 1),
    );
}

/** @param {NS} ns */
export function getHackP(ns, hostname, batches = -1, threads = -1, startHacks = 1) {
    const server = getPreppedServer(ns, hostname);
    const player = ns.getPlayer();
    const hackChance = ns.formulas.hacking.hackChance(server, player);
    const hackPercent = ns.formulas.hacking.hackPercent(server, player);
    const weakenStrength = ns.weakenAnalyze(1);

    if (!Number.isFinite(hackChance) || hackChance <= 0 || !Number.isFinite(hackPercent) || hackPercent <= 0) {
        return emptyBatchInfo();
    }

    const maxHackThreads = Math.max(1, Math.ceil(1 / hackPercent));
    const start = Math.min(maxHackThreads, Math.max(1, Math.floor(startHacks)));
    const end = Math.max(maxHackThreads, Math.max(1, Math.floor(startHacks)));

    let bestRatio = 0;
    let bestTake = 0;
    let bestH1 = 0;
    let bestW1 = 0;
    let bestG1 = 0;
    let bestW2 = 0;
    let bestType = "HGW";

    for (let hackThreads = start; hackThreads <= end; hackThreads += 1) {
        let moneyToTake = hackPercent * hackThreads >= 1
            ? server.moneyMax - 1
            : hackPercent * server.moneyMax * hackThreads;

        let hybridHackSec = hackThreads * 0.002;
        const hybridW1 = Math.floor(hybridHackSec / weakenStrength);
        hybridHackSec -= hybridW1 * weakenStrength;

        const hgwHackSec = hackThreads * 0.002;

        const hwgwHackSec = hackThreads * 0.002;
        const hwgwW1 = Math.ceil(hwgwHackSec / weakenStrength);

        const hybridG = getGrowThreads(ns, hostname, server.moneyMax - moneyToTake, server.minDifficulty + hybridHackSec);
        const hgwG = getGrowThreads(ns, hostname, server.moneyMax - moneyToTake, server.minDifficulty + hgwHackSec);
        const hwgwG = getGrowThreads(ns, hostname, server.moneyMax - moneyToTake, server.minDifficulty);

        if (![hybridG, hgwG, hwgwG].every((value) => Number.isFinite(value) && value >= 0)) {
            continue;
        }

        moneyToTake *= hackChance;

        const hybridSecGrow = hybridG * 0.004;
        const hgwSecGrow = hgwG * 0.004;
        const hwgwSecGrow = hwgwG * 0.004;

        const hybridW2 = Math.ceil((hybridSecGrow + hybridHackSec) / weakenStrength);
        const hgwW2 = Math.ceil((hgwSecGrow + hgwHackSec) / weakenStrength);
        const hwgwW2 = Math.ceil(hwgwSecGrow / weakenStrength);

        const hybridThreads = hackThreads + hybridW1 + hybridG + hybridW2;
        const hgwThreads = hackThreads + hgwG + hgwW2;
        const hwgwThreads = hackThreads + hwgwW1 + hwgwG + hwgwW2;

        let hybridBatches = 1;
        let hgwBatches = 1;
        let hwgwBatches = 1;

        if (threads > 0) {
            hybridBatches = limitedBatches(threads, hybridThreads, batches);
            hgwBatches = limitedBatches(threads, hgwThreads, batches);
            hwgwBatches = limitedBatches(threads, hwgwThreads, batches);
        }

        const hybridRatio = scoreCandidate(moneyToTake, hybridThreads, hybridBatches, batches, threads);
        const hgwRatio = scoreCandidate(moneyToTake, hgwThreads, hgwBatches, batches, threads);
        const hwgwRatio = scoreCandidate(moneyToTake, hwgwThreads, hwgwBatches, batches, threads);
        const valid = hybridRatio || hgwRatio || hwgwRatio;
        let failed = 0;

        if (hgwRatio > bestRatio || (hackThreads === maxHackThreads && bestRatio === 0)) {
            bestRatio = hgwRatio;
            bestTake = moneyToTake;
            bestH1 = hackThreads;
            bestW1 = 0;
            bestG1 = hgwG;
            bestW2 = hgwW2;
            bestType = "HGW";
        } else {
            failed += 1;
        }

        if (hybridRatio > bestRatio) {
            bestRatio = hybridRatio;
            bestTake = moneyToTake;
            bestH1 = hackThreads;
            bestW1 = hybridW1;
            bestG1 = hybridG;
            bestW2 = hybridW2;
            bestType = "Hybrid";
        } else {
            failed += 1;
        }

        if (hwgwRatio > bestRatio) {
            bestRatio = hwgwRatio;
            bestTake = moneyToTake;
            bestH1 = hackThreads;
            bestW1 = hwgwW1;
            bestG1 = hwgwG;
            bestW2 = hwgwW2;
            bestType = "HWGW";
        } else {
            failed += 1;
        }

        if (failed === 3 && valid) break;
    }

    return {
        H1: bestH1,
        W1: bestW1,
        G1: bestG1,
        W2: bestW2,
        Type: bestType,
        Take: bestTake * getScriptHackMoneyGain(ns),
        HackP: hackPercent,
        Chance: hackChance,
        Threads: bestH1 + bestW1 + bestG1 + bestW2,
    };
}

/** @param {NS} ns */
export function getOptimalTarget(ns, first = false) {
    const servers = getServers(ns);
    const player = ns.getPlayer();
    let bestRatio = 0;
    let bestSec = Infinity;
    let bestHost = "";

    for (const server of servers) {
        if (server.minDifficulty === 100) continue;
        if (server.requiredHackingSkill > player.skills.hacking) continue;
        if (!server.hasAdminRights) continue;
        if (server.hostname === "home") continue;
        if (server.moneyMax === 0) continue;
        if (server.purchasedByPlayer) continue;

        const batchInfo = getHackP(ns, server.hostname, -1, -1, 1);
        if (!batchInfo.H1 || !batchInfo.G1 || !batchInfo.W2) continue;
        const hackChance = ns.formulas.hacking.hackChance(getPreppedServer(ns, server.hostname), player);
        const hackTime = ns.formulas.hacking.hackTime(getPreppedServer(ns, server.hostname), player);
        let weakenTime = hackTime * 4;
        weakenTime = weakenTime === 0 ? 4 : weakenTime;
        const totalThreads = batchInfo.H1 + batchInfo.G1 + batchInfo.W2 + batchInfo.W1;
        const ratio = printProfit(weakenTime, batchInfo.Take, 1, totalThreads, hackChance);

        if (first && server.hackDifficulty - server.minDifficulty < bestSec) {
            bestSec = server.hackDifficulty - server.minDifficulty;
            bestRatio = ratio;
            bestHost = server.hostname;
        } else if (first && server.hackDifficulty - server.minDifficulty === bestSec && ratio > bestRatio) {
            bestSec = server.hackDifficulty - server.minDifficulty;
            bestRatio = ratio;
            bestHost = server.hostname;
        } else if (!first && ratio > bestRatio) {
            bestRatio = ratio;
            bestHost = server.hostname;
        }
    }

    return bestHost;
}

/** @param {NS} ns */
export function getBestXpTarget(ns) {
    const player = ns.getPlayer();
    let bestHost = "";
    let bestTime = Infinity;
    let bestRatio = 0;

    for (const server of getServers(ns)) {
        if (!server.hasAdminRights) continue;
        if (server.hostname === "home") continue;
        if (server.moneyMax === 0) continue;
        if (server.purchasedByPlayer) continue;
        if (server.minDifficulty <= 1) continue;

        const xp = getHackXpGain(ns, player, server);
        const time = ns.formulas.hacking.hackTime(getPreppedServer(ns, server.hostname), player);
        if (!Number.isFinite(time) || time <= 0) continue;

        const ratio = xp / time;
        if (ratio > bestRatio) {
            bestHost = server.hostname;
            bestTime = time;
            bestRatio = ratio;
        }
    }

    return {
        host: bestHost,
        hackTime: bestTime,
        ratio: bestRatio,
    };
}

function emptyBatchInfo() {
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

function limitedBatches(totalThreads, candidateThreads, batches) {
    const count = Math.floor(totalThreads / candidateThreads);
    if (batches < 1) return count;
    return count > batches ? 0 : count;
}

function scoreCandidate(take, totalThreads, totalBatches, batches, threads) {
    if (totalThreads <= 0) return 0;
    if (batches === -1 && threads === -1) {
        return take / totalThreads;
    }
    return (take / totalThreads) * totalBatches;
}

function printProfit(timeMs, take, batches, threads, chance) {
    const seconds = timeMs / 1000;
    if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(take) || take <= 0 || threads <= 0) {
        return 0;
    }
    return ((take / seconds) * batches / threads) * chance;
}

function getScriptHackMoneyGain(ns) {
    try {
        return ns.getBitNodeMultipliers().ScriptHackMoneyGain ?? 1;
    } catch {
        return 1;
    }
}

function getHackXpGain(ns, player, server) {
    const baseDifficulty = server.baseDifficulty;
    if (!baseDifficulty) return 0;
    const expGain = (3 + baseDifficulty * 0.3) * player.mults.hacking_exp;
    try {
        return expGain * (ns.getBitNodeMultipliers().HackExpGain ?? 1);
    } catch {
        return expGain;
    }
}
