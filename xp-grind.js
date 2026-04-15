import { clearStatus, STATUS_NAMES, writeStatus } from "/MarvOS/lib/status.js";

const GROW_SCRIPT = "grow.js";
const WEAKEN_SCRIPT = "weaken.js";
const XP_EXCLUDE = new Set(["home", "darkweb", "n00dles", "sigma-cosmetics", "nectar-net"]);

/** @param {NS} ns */
export async function main(ns) {
    const options = ns.flags([
        ["target", ""],
        ["home-reserve", 32],
        ["status-interval", 15_000],
        ["retarget-interval", 60_000],
        ["min-money", 1_000_000],
    ]);

    ns.disableLog("ALL");
    ns.atExit(() => clearStatus(ns, STATUS_NAMES.xp));

    for (const file of [GROW_SCRIPT, WEAKEN_SCRIPT]) {
        if (!ns.fileExists(file, "home")) {
            ns.tprint(`Missing ${file} on home`);
            return;
        }
    }

    const ramCosts = {
        grow: ns.getScriptRam(GROW_SCRIPT, "home"),
        weaken: ns.getScriptRam(WEAKEN_SCRIPT, "home"),
    };

    const forcedTarget = String(options.target || "").trim();
    let target = forcedTarget;
    let lastStatusAt = 0;
    let lastTargetAt = 0;
    let workerCursor = 0;
    let action = "starting";
    let latestRanking = [];

    while (true) {
        const workers = collectWorkers(ns, options["home-reserve"], Math.min(ramCosts.grow, ramCosts.weaken));
        await syncWorkerFiles(ns, workers, [GROW_SCRIPT, WEAKEN_SCRIPT]);

        const now = Date.now();
        const shouldRetarget = forcedTarget
            ? !isValidXpTarget(ns, forcedTarget, options["min-money"])
            : (
                !target ||
                !isValidXpTarget(ns, target, options["min-money"]) ||
                now - lastTargetAt >= options["retarget-interval"]
            );

        if (shouldRetarget) {
            latestRanking = rankXpTargets(ns, options["min-money"], ramCosts);
            const next = latestRanking[0]?.host ?? "";
            if (!next) {
                ns.clearLog();
                ns.print("===== XP GRIND =====");
                ns.print("Target      : none");
                ns.print("Action      : No valid XP target found");
                await ns.sleep(10_000);
                continue;
            }

            if (next !== target) {
                killManagedWorkers(ns, workers);
                target = next;
                ns.tprint(`XP TARGET -> ${target}`);
            }
            lastTargetAt = now;
        }

        if (forcedTarget) {
            target = forcedTarget;
            if (latestRanking.length === 0) {
                latestRanking = rankXpTargets(ns, options["min-money"], ramCosts);
            }
        }

        if (!target) {
            await ns.sleep(2_000);
            continue;
        }

        const stats = getTargetStats(ns, target);
        const rotated = rotateWorkers(workers, workerCursor);
        workerCursor += 1;

        killManagedWorkers(ns, workers);

        if (stats.secDiff > 2) {
            const weakenThreads = Math.floor((getTotalFreeRam(ns, workers) * 0.95) / ramCosts.weaken);
            dispatchJob(ns, rotated, WEAKEN_SCRIPT, weakenThreads, ramCosts.weaken, target, "xp:weaken");
            action = `weaken spam | sec=+${stats.secDiff.toFixed(2)}`;
            await ns.sleep(Math.max(1_000, ns.getWeakenTime(target) + 250));
        } else {
            const totalFree = getTotalFreeRam(ns, workers);
            const weakenThreads = Math.floor((totalFree * 0.10) / ramCosts.weaken);
            const remainingRam = Math.max(0, totalFree - weakenThreads * ramCosts.weaken);
            const growThreads = Math.floor((remainingRam * 0.98) / ramCosts.grow);

            if (weakenThreads > 0) {
                dispatchJob(ns, rotated, WEAKEN_SCRIPT, weakenThreads, ramCosts.weaken, target, "xp:w");
            }
            if (growThreads > 0) {
                dispatchJob(ns, rotated, GROW_SCRIPT, growThreads, ramCosts.grow, target, "xp:g");
            }

            action = `grow spam | G=${growThreads} W=${weakenThreads} | sec=+${stats.secDiff.toFixed(2)}`;
            await ns.sleep(Math.max(1_000, Math.min(ns.getGrowTime(target), ns.getWeakenTime(target)) + 250));
        }

        if (now - lastStatusAt >= options["status-interval"]) {
            const live = getTargetStats(ns, target);
            ns.clearLog();
            ns.print("===== XP GRIND =====");
            ns.print(`Target      : ${target}`);
            ns.print(`Hack Level  : ${ns.getHackingLevel()}`);
            ns.print(`Money       : ${live.moneyPct.toFixed(1)}%`);
            ns.print(`Security    : min + ${live.secDiff.toFixed(2)}`);
            ns.print(`Workers     : ${workers.length}`);
            ns.print(`Free RAM    : ${ns.formatRam(getTotalFreeRam(ns, workers), 2)}`);
            ns.print(`Action      : ${action}`);
            if (latestRanking.length > 0) {
                ns.print("Top XP      :");
                for (const row of latestRanking.slice(0, 3)) {
                    ns.print(`  ${row.host} | score=${Math.floor(row.score)} | grow=${Math.round(row.growTime / 1000)}s | xp/t=${row.xpPerThread.toFixed(2)} | growth=${row.growth}`);
                }
            }
            writeStatus(ns, STATUS_NAMES.xp, {
                target,
                action,
                moneyPct: live.moneyPct,
                secDiff: live.secDiff,
                freeRam: getTotalFreeRam(ns, workers),
                workers: workers.length,
                top: latestRanking.slice(0, 3).map((row) => ({
                    host: row.host,
                    score: row.score,
                })),
            });
            lastStatusAt = Date.now();
        }
    }
}

function collectWorkers(ns, homeReserve, minRamNeeded) {
    const seen = discoverHosts(ns);
    for (const host of ns.getPurchasedServers()) {
        seen.add(host);
    }

    const workers = [];
    for (const host of seen) {
        if (!ns.hasRootAccess(host)) continue;
        const maxRam = ns.getServerMaxRam(host);
        if (maxRam <= 0) continue;

        const usableRam = Math.max(0, maxRam - (host === "home" ? homeReserve : 0));
        if (usableRam < minRamNeeded) continue;

        workers.push({ host, usableRam });
    }

    workers.sort((a, b) => b.usableRam - a.usableRam);
    return workers;
}

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

async function syncWorkerFiles(ns, workers, files) {
    for (const worker of workers) {
        if (worker.host !== "home") {
            await ns.scp(files, worker.host, "home");
        }
    }
}

function rankXpTargets(ns, minMoney, ramCosts) {
    const candidates = [];
    const myHack = ns.getHackingLevel();

    for (const host of discoverHosts(ns)) {
        if (!isValidXpTarget(ns, host, minMoney)) continue;

        const growth = Math.max(1, ns.getServerGrowth(host));
        const growTime = Math.max(1, ns.getGrowTime(host));
        const minSec = Math.max(1, ns.getServerMinSecurityLevel(host));
        const moneyMax = Math.max(1, ns.getServerMaxMoney(host));
        const reqHack = Math.max(1, ns.getServerRequiredHackingLevel(host));

        // Approximate XP per thread. Higher security gives a little more XP,
        // but short cycle time still matters much more.
        const xpPerThread = 3 + minSec * 0.3;
        const weakenTax = ns.growthAnalyzeSecurity(1, host) / Math.max(0.0001, ns.weakenAnalyze(1));
        const effectiveRam = ramCosts.grow + weakenTax * ramCosts.weaken;

        // Mild stability factors so tiny trash servers do not dominate just
        // because they are fast, while still favoring short grow cycles.
        const growthFactor = 1 + Math.log2(1 + growth) / 4;
        const moneyFactor = 1 + Math.log10(moneyMax) / 8;
        const levelFactor = Math.max(0.60, 1 - reqHack / Math.max(myHack * 2, 1));
        const score = (xpPerThread * growthFactor * moneyFactor * levelFactor * 1000) / (growTime * effectiveRam);

        candidates.push({
            host,
            score,
            xpPerThread,
            growTime,
            growth,
            moneyMax,
            reqHack,
        });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates;
}

function isValidXpTarget(ns, host, minMoney) {
    if (XP_EXCLUDE.has(host)) return false;
    if (ns.getPurchasedServers().includes(host)) return false;
    if (!ns.hasRootAccess(host)) return false;
    if (ns.getServerRequiredHackingLevel(host) > ns.getHackingLevel()) return false;
    if (ns.getServerMaxMoney(host) < minMoney) return false;
    return true;
}

function getTargetStats(ns, target) {
    const money = ns.getServerMoneyAvailable(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const sec = ns.getServerSecurityLevel(target);
    const minSec = ns.getServerMinSecurityLevel(target);

    return {
        moneyPct: maxMoney > 0 ? (money / maxMoney) * 100 : 0,
        secDiff: sec - minSec,
    };
}

function dispatchJob(ns, workers, script, threads, ramPerThread, target, tag) {
    let remaining = threads;
    if (!Number.isFinite(remaining) || remaining <= 0) return 0;

    let scheduled = 0;
    const eligible = workers.filter((worker) => Math.floor(getWorkerFreeRam(ns, worker) / ramPerThread) > 0);
    if (eligible.length === 0) return 0;

    const firstPassCap = Math.max(1, Math.ceil(threads / eligible.length));

    for (const worker of eligible) {
        if (remaining <= 0) break;
        const capacity = Math.floor(getWorkerFreeRam(ns, worker) / ramPerThread);
        if (capacity <= 0) continue;

        const runThreads = Math.min(remaining, capacity, firstPassCap);
        const pid = ns.exec(script, worker.host, runThreads, target, 0, `${tag}:${Date.now()}`);
        if (pid === 0) continue;

        remaining -= runThreads;
        scheduled += runThreads;
    }

    for (const worker of eligible) {
        if (remaining <= 0) break;
        const capacity = Math.floor(getWorkerFreeRam(ns, worker) / ramPerThread);
        if (capacity <= 0) continue;

        const runThreads = Math.min(remaining, capacity);
        const pid = ns.exec(script, worker.host, runThreads, target, 0, `${tag}:fill:${Date.now()}`);
        if (pid === 0) continue;

        remaining -= runThreads;
        scheduled += runThreads;
    }

    return scheduled;
}

function killManagedWorkers(ns, workers) {
    for (const worker of workers) {
        for (const proc of ns.ps(worker.host)) {
            if (proc.filename !== GROW_SCRIPT && proc.filename !== WEAKEN_SCRIPT) continue;
            const tag = String(proc.args[2] ?? "");
            if (!tag.startsWith("xp:")) continue;
            ns.kill(proc.pid);
        }
    }
}

function rotateWorkers(workers, offset) {
    if (workers.length === 0) return workers;
    const index = ((offset % workers.length) + workers.length) % workers.length;
    if (index === 0) return workers;
    return workers.slice(index).concat(workers.slice(0, index));
}

function getWorkerFreeRam(ns, worker) {
    return Math.max(0, worker.usableRam - ns.getServerUsedRam(worker.host));
}

function getTotalFreeRam(ns, workers) {
    let total = 0;
    for (const worker of workers) {
        total += getWorkerFreeRam(ns, worker);
    }
    return total;
}
