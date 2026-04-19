import { clearStatus, STATUS_NAMES, writeStatus } from "/MarvOS/lib/status.js";
import {
    getBestXpTarget,
    getGrowThreads,
    getHackP,
    getLiveTargetStats,
    getOptimalTarget,
    getThreadSummary,
    hasMoneyFormulas,
} from "/MarvOS/lib/sphyx-money.js";

const WORKER_FILES = ["hack.js", "grow.js", "weaken.js"];
const SERVER_RUNNER = "/MarvOS/extras/serverRun.js";

/** @param {NS} ns */
export async function main(ns) {
    const flags = ns.flags([
        ["debug-targets", false],
        ["debug-limit", 5],
        ["home-reserve", 32],
        ["use-hacknet", false],
        ["logging", false],
        ["pad", false],
        ["no-xp-overflow", false],
        ["target-refresh-ms", 120000],
        ["status-interval-ms", 1000],
    ]);

    if (!hasMoneyFormulas(ns)) {
        ns.tprint("Formulas.exe access is required for formulas-batcher.js");
        return;
    }

    for (const file of WORKER_FILES) {
        if (!ns.fileExists(file, "home")) {
            ns.tprint(`Missing ${file} on home`);
            return;
        }
    }
    if (!ns.fileExists(SERVER_RUNNER, "home")) {
        ns.tprint(`Missing ${SERVER_RUNNER} on home`);
        return;
    }

    ns.disableLog("ALL");
    ns.atExit(() => clearStatus(ns, STATUS_NAMES.formulas));

    const config = {
        debugTargets: Boolean(flags["debug-targets"]),
        debugLimit: Math.max(1, Math.floor(Number(flags["debug-limit"]) || 5)),
        homeReserve: Math.max(0, Number(flags["home-reserve"]) || 32),
        useHacknet: Boolean(flags["use-hacknet"]),
        logging: Boolean(flags.logging),
        pad: Boolean(flags.pad),
        xpOverflow: !Boolean(flags["no-xp-overflow"]),
        targetRefreshMs: Math.max(30_000, Number(flags["target-refresh-ms"]) || 120_000),
        statusIntervalMs: Math.max(750, Number(flags["status-interval-ms"]) || 1000),
    };

    await syncWorkerFiles(ns, config, true);

    let target = ns.getHackingLevel() < 10 ? "n00dles" : getOptimalTarget(ns, true);
    let batchInfo = target ? getHackP(ns, target, -1, -1, 1) : emptyBatchInfo();
    let lastPid = 0;
    let recalcGood = false;
    let recalcBad = false;
    let overflowed = false;
    let lastStatusAt = 0;
    let lastSyncAt = Date.now();
    let lastTargetCheckAt = 0;
    let lastHackLevel = ns.getHackingLevel();

    if (target) ns.tprint(`TARGET -> ${target}`);

    while (true) {
        await ns.sleep(4);

        if (Date.now() - lastSyncAt > 300_000) {
            await syncWorkerFiles(ns, config, false);
            lastSyncAt = Date.now();
        }

        if (!target) {
            target = getOptimalTarget(ns, true);
            batchInfo = target ? getHackP(ns, target, -1, -1, 1) : emptyBatchInfo();
            if (!target) {
                maybeWriteStatus(ns, config, {
                    target: "",
                    action: "No viable target",
                    freeRam: getThreadSummary(ns, config).totalFreeRam,
                    usableRam: getThreadSummary(ns, config).totalUsableRam,
                }, () => lastStatusAt, (value) => { lastStatusAt = value; });
                await ns.sleep(1000);
                continue;
            }
            ns.tprint(`TARGET -> ${target}`);
        }

        const targetServer = ns.getServer(target);
        if (!targetServer.hasAdminRights || targetServer.requiredHackingSkill > ns.getHackingLevel()) {
            target = getOptimalTarget(ns, true);
            batchInfo = target ? getHackP(ns, target, -1, -1, 1) : emptyBatchInfo();
            if (target) ns.tprint(`TARGET -> ${target}`);
            continue;
        }

        const weakenStrength = ns.weakenAnalyze(1);
        const hackTime = ns.getHackTime(target);
        const weakenTime = hackTime * 4;
        const summary = getThreadSummary(ns, config);
        let threadsLeft = summary.totalThreads;
        const threadsMax = threadsLeft;

        const prep = {
            W1: 0,
            G1: 0,
            W2: 0,
            H1: 1,
            W3: 0,
            G2: 0,
            W4: 0,
        };

        const waveW1 = Math.ceil((targetServer.hackDifficulty - targetServer.minDifficulty) / weakenStrength);
        const waveG1 = Math.ceil(getGrowThreads(ns, target, targetServer.moneyAvailable, targetServer.minDifficulty));

        if (waveW1 > threadsLeft) {
            prep.W1 = threadsLeft;
            threadsLeft = 0;
        } else {
            prep.W1 = waveW1;
            threadsLeft -= prep.W1;
        }

        if (waveG1 > threadsLeft) {
            prep.W2 = Math.ceil((threadsLeft * 0.004) / weakenStrength);
            prep.G1 = threadsLeft - prep.W2;
            threadsLeft = 0;
        } else {
            prep.W2 = Math.ceil((waveG1 * 0.004) / weakenStrength);
            if (prep.W2 + waveG1 <= threadsLeft) {
                prep.G1 = waveG1;
                threadsLeft -= prep.G1 + prep.W2;
            } else {
                const growP = 0.004 / weakenStrength;
                const remainder = waveG1 + prep.W2 - threadsLeft;
                const weakRemove = Math.floor(remainder * growP);
                const growRemove = remainder - weakRemove;
                prep.G1 = waveG1 - growRemove;
                prep.W2 -= weakRemove;
                threadsLeft = 0;
            }
        }

        if (batchInfo.H1 > threadsLeft) {
            prep.W3 = Math.ceil((threadsLeft * 0.002) / weakenStrength);
            prep.H1 = threadsLeft - prep.W3;
            threadsLeft = 0;
        } else {
            prep.W3 = Math.ceil((batchInfo.H1 * 0.002) / weakenStrength);
            if (prep.W3 + batchInfo.H1 <= threadsLeft) {
                prep.H1 = batchInfo.H1;
                threadsLeft -= prep.H1 + prep.W3;
            } else {
                const hackP = 0.002 / weakenStrength;
                const remainder = batchInfo.H1 + prep.W3 - threadsLeft;
                const weakenRemove = Math.ceil(remainder * hackP);
                const hackRemove = remainder - weakenRemove;
                prep.H1 = batchInfo.H1 - hackRemove;
                prep.W3 -= weakenRemove;
                threadsLeft = 0;
            }
        }

        if (batchInfo.G1 > threadsLeft) {
            prep.W4 = Math.ceil((threadsLeft * 0.004) / weakenStrength);
            prep.G2 = threadsLeft - prep.W4;
            threadsLeft = 0;
        } else {
            prep.W4 = Math.ceil((batchInfo.G1 * 0.004) / weakenStrength);
            if (prep.W4 + batchInfo.G1 <= threadsLeft) {
                prep.G2 = batchInfo.G1;
                threadsLeft -= prep.G2 + prep.W4;
            } else {
                const growP = 0.004 / weakenStrength;
                const remainder = batchInfo.G1 + prep.W4 - threadsLeft;
                const weakRemove = Math.floor(remainder * growP);
                const growRemove = remainder - weakRemove;
                prep.G2 = batchInfo.G1 - growRemove;
                prep.W4 -= weakRemove;
                threadsLeft = 0;
            }
        }

        const tunedBatchInfo = config.pad ? withPadding(ns, batchInfo) : batchInfo;
        const batchThreads = tunedBatchInfo.H1 + tunedBatchInfo.W1 + tunedBatchInfo.G1 + tunedBatchInfo.W2;
        const batchesTotal = batchThreads > 0 ? Math.floor(threadsLeft / batchThreads) : 0;

        const results = await runServerRunner(ns, config, target, prep, tunedBatchInfo, batchesTotal);
        threadsLeft -= batchThreads * (results.batches ?? 0);

        let xpResult = null;
        if (config.xpOverflow && threadsLeft > 0) {
            xpResult = await generateXp(ns, config, threadsLeft);
            threadsLeft = 0;
        }

        if (xpResult?.lastpid) {
            lastPid = xpResult.lastpid;
            recalcBad = false;
        } else {
            lastPid = results.lastpid || 0;
            recalcBad = Boolean(results.recalc);
        }

        const live = getLiveTargetStats(ns, target);
        maybeWriteStatus(ns, config, {
            target,
            action: summarizeAction(prep, tunedBatchInfo, results, xpResult),
            chance: tunedBatchInfo.Chance,
            moneyPct: live.moneyPct,
            secDiff: live.secDiff,
            freeRam: summary.totalFreeRam,
            usableRam: summary.totalUsableRam,
            debug: buildDebugLines(config, target, tunedBatchInfo, prep, threadsMax, threadsLeft, batchesTotal),
            batchPlan: {
                type: tunedBatchInfo.Type,
                hackThreads: tunedBatchInfo.H1,
                weaken1Threads: tunedBatchInfo.W1,
                growThreads: tunedBatchInfo.G1,
                weaken2Threads: tunedBatchInfo.W2,
                take: tunedBatchInfo.Take,
                hackPct: tunedBatchInfo.HackP * tunedBatchInfo.H1,
                launchInterval: Math.round(weakenTime / Math.max(1, results.batches || 1)),
                cycleTime: Math.round(weakenTime),
            },
        }, () => lastStatusAt, (value) => { lastStatusAt = value; });

        if (!lastPid) {
            await ns.sleep(1000);
        } else {
            while (ns.isRunning(lastPid)) {
                const latest = getLiveTargetStats(ns, target);
                maybeWriteStatus(ns, config, {
                    target,
                    action: "Running",
                    chance: tunedBatchInfo.Chance,
                    moneyPct: latest.moneyPct,
                    secDiff: latest.secDiff,
                    freeRam: getThreadSummary(ns, config).totalFreeRam,
                    usableRam: summary.totalUsableRam,
                    debug: buildDebugLines(config, target, tunedBatchInfo, prep, threadsMax, threadsLeft, batchesTotal),
                }, () => lastStatusAt, (value) => { lastStatusAt = value; });
                await ns.sleep(100);
            }
        }

        if (Date.now() - lastTargetCheckAt >= config.targetRefreshMs) {
            const nextTarget = getOptimalTarget(ns, false);
            if (nextTarget && nextTarget !== target) {
                target = nextTarget;
                batchInfo = getHackP(ns, target, -1, -1, 1);
                overflowed = false;
                recalcBad = false;
                recalcGood = false;
                ns.tprint(`TARGET -> ${target}`);
                lastTargetCheckAt = Date.now();
                continue;
            }
            lastTargetCheckAt = Date.now();
        }

        const currentHackLevel = ns.getHackingLevel();
        if (currentHackLevel > lastHackLevel + 10) {
            recalcGood = true;
            lastHackLevel = currentHackLevel;
        }

        if (recalcBad) {
            batchInfo = getHackP(ns, target, Math.max(1, results.batches || 1), threadsMax, Math.max(1, batchInfo.H1));
            recalcBad = false;
            overflowed = true;
        } else if (recalcGood && !overflowed) {
            batchInfo = getHackP(ns, target, -1, -1, 1);
            recalcGood = false;
        } else {
            batchInfo = getHackP(ns, target, -1, -1, Math.max(batchInfo.H1 - 1, 1));
        }
    }
}

async function runServerRunner(ns, config, target, prep, batchInfo, batchesTotal) {
    const resultFile = `marvos-serverrun-${Date.now()}-${Math.floor(Math.random() * 1e6)}.txt`;
    const pid = ns.exec(
        SERVER_RUNNER,
        "home",
        1,
        config.logging ? 1 : 0,
        target,
        prep.W1,
        prep.G1,
        prep.W2,
        prep.H1,
        prep.W3,
        prep.G2,
        prep.W4,
        batchInfo.H1,
        batchInfo.W1,
        batchInfo.G1,
        batchInfo.W2,
        batchesTotal,
        config.useHacknet ? 1 : 0,
        config.homeReserve,
        resultFile,
    );

    if (pid === 0) {
        return { lastpid: 0, recalc: true, batches: 0, batching: false, waitTime: 0, weakenTime: ns.getWeakenTime(target) };
    }

    while (ns.isRunning(pid)) {
        await ns.sleep(50);
    }

    try {
        const raw = ns.read(resultFile);
        return raw ? JSON.parse(raw) : { lastpid: 0, recalc: true, batches: 0, batching: false, waitTime: 0, weakenTime: ns.getWeakenTime(target) };
    } finally {
        if (ns.fileExists(resultFile, "home")) ns.rm(resultFile, "home");
    }
}

async function generateXp(ns, config, threads) {
    const xpTarget = getBestXpTarget(ns);
    if (!xpTarget.host || threads <= 0) return null;

    const server = ns.getServer(xpTarget.host);
    const weakenStrength = ns.weakenAnalyze(1);
    let waveW1 = Math.ceil((server.hackDifficulty - server.minDifficulty) / weakenStrength);
    let waveG1 = Math.ceil(getGrowThreads(ns, xpTarget.host, server.moneyAvailable, server.minDifficulty));
    let waveW2 = 0;

    if (waveW1 > threads) {
        waveW1 = threads;
        threads = 0;
    } else {
        threads -= waveW1;
    }

    if (waveG1 > threads) {
        waveW2 = Math.ceil((threads * 0.004) / weakenStrength);
        waveG1 = threads - waveW2;
        threads = 0;
    } else {
        waveW2 = Math.ceil((waveG1 * 0.004) / weakenStrength);
        if (waveW2 + waveG1 <= threads) {
            threads -= waveG1 + waveW2;
        } else {
            const growP = 0.004 / weakenStrength;
            const weakRemove = Math.ceil(threads * growP);
            const growRemove = threads - weakRemove;
            waveG1 = growRemove;
            waveW2 = weakRemove;
            threads = 0;
        }
    }

    const result = await runServerRunner(
        ns,
        config,
        xpTarget.host,
        { W1: waveW1, G1: waveG1, W2: waveW2, H1: 0, W3: 0, G2: threads, W4: 0 },
        { H1: 0, W1: 0, G1: 0, W2: 0 },
        0,
    );
    return result?.lastpid ? { target: xpTarget.host, lastpid: result.lastpid } : null;
}

async function syncWorkerFiles(ns, config, aggressive) {
    const hosts = new Set(["home"]);
    for (const host of hosts) {
        for (const next of ns.scan(host)) hosts.add(next);
    }
    for (const host of hosts) {
        if (host === "home") continue;
        if (!ns.hasRootAccess(host)) continue;
        if (host.startsWith("hacknet") && !config.useHacknet) continue;
        const missing = WORKER_FILES.some((file) => !ns.fileExists(file, host));
        if (aggressive || missing) {
            await ns.scp(WORKER_FILES, host, "home");
        }
    }
}

function maybeWriteStatus(ns, config, payload, getLastStatusAt, setLastStatusAt) {
    const now = Date.now();
    if (now - getLastStatusAt() < config.statusIntervalMs) return;
    writeStatus(ns, STATUS_NAMES.formulas, payload);
    setLastStatusAt(now);
}

function summarizeAction(prep, batchInfo, results, xpResult) {
    const parts = [];
    const prepParts = [];
    if (prep.W1) prepParts.push(`W${prep.W1}`);
    if (prep.G1) prepParts.push(`G${prep.G1}`);
    if (prep.W2) prepParts.push(`W${prep.W2}`);
    if (prep.H1) prepParts.push(`H${prep.H1}`);
    if (prep.W3) prepParts.push(`W${prep.W3}`);
    if (prep.G2) prepParts.push(`G${prep.G2}`);
    if (prep.W4) prepParts.push(`W${prep.W4}`);
    parts.push(prepParts.length ? `prep=${prepParts.join("/")}` : "prep=clean");
    if (batchInfo.H1 || batchInfo.G1 || batchInfo.W1 || batchInfo.W2) {
        parts.push(`${batchInfo.Type} x${results?.batches ?? 0}`);
    }
    if (xpResult?.target) parts.push(`xp=${xpResult.target}`);
    return parts.join(" | ");
}

function withPadding(ns, batchInfo) {
    const weakenStrength = ns.weakenAnalyze(1);
    const growThreads = batchInfo.G1 + Math.ceil(batchInfo.G1 * 0.15);
    const weaken2 = Math.ceil((((growThreads * 0.004) + Math.max(((batchInfo.H1 * 0.002) / weakenStrength) - (batchInfo.W1 * weakenStrength), 0)) / weakenStrength));
    return {
        ...batchInfo,
        G1: growThreads,
        W2: weaken2,
        Threads: batchInfo.H1 + batchInfo.W1 + growThreads + weaken2,
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

function buildDebugLines(config, target, batchInfo, prep, threadsMax, threadsLeft, batchesTotal) {
    if (!config.debugTargets) return [];
    const lines = [
        `target=${target}`,
        `type=${batchInfo.Type} H=${batchInfo.H1} W1=${batchInfo.W1} G=${batchInfo.G1} W2=${batchInfo.W2}`,
        `prep=W${prep.W1}/G${prep.G1}/W${prep.W2}/H${prep.H1}/W${prep.W3}/G${prep.G2}/W${prep.W4}`,
        `threads max=${threadsMax} left=${threadsLeft} batches=${batchesTotal}`,
        `take=${formatCompactNumber(batchInfo.Take)} chance=${((batchInfo.Chance || 0) * 100).toFixed(1)}%`,
    ];
    return lines.slice(0, config.debugLimit);
}

function formatCompactNumber(value) {
    if (value >= 1e15) return `${(value / 1e15).toFixed(2)}q`;
    if (value >= 1e12) return `${(value / 1e12).toFixed(2)}t`;
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)}b`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(2)}m`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(2)}k`;
    return `${Math.round(value)}`;
}
