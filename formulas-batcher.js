import { clearStatus, STATUS_NAMES, writeStatus } from "/MarvOS/lib/status.js";
import {
    getAvailableThreads,
    getBatchInfo,
    getBestXpTarget,
    getLiveTargetStats,
    getPreppedServer,
    hasMoneyFormulas,
    rankMoneyTargets,
} from "/MarvOS/lib/money-core.js";

const WORKER_FILES = ["hack.js", "grow.js", "weaken.js"];
const CONTROLLER_NAME = "formulas-batcher";

/** @param {NS} ns */
export async function main(ns) {
    const options = ns.flags([
        ["debug-targets", false],
        ["debug-limit", 5],
        ["home-reserve", 32],
        ["use-hacknet", false],
        ["logging", false],
        ["pad", false],
        ["no-xp-overflow", false],
        ["target-refresh-ms", 120000],
        ["status-interval-ms", 500],
        ["switch-margin", 1.15],
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

    ns.disableLog("ALL");
    ns.atExit(() => clearStatus(ns, STATUS_NAMES.formulas));

    const config = {
        debugTargets: Boolean(options["debug-targets"]),
        debugLimit: Math.max(1, Math.floor(Number(options["debug-limit"]) || 5)),
        homeReserve: Math.max(0, Number(options["home-reserve"]) || 32),
        useHacknet: Boolean(options["use-hacknet"]),
        logging: Boolean(options.logging),
        pad: Boolean(options.pad),
        xpOverflow: !Boolean(options["no-xp-overflow"]),
        targetRefreshMs: Math.max(30_000, Number(options["target-refresh-ms"]) || 120_000),
        statusIntervalMs: Math.max(250, Number(options["status-interval-ms"]) || 500),
        switchMargin: Math.max(1.01, Number(options["switch-margin"]) || 1.15),
        minChance: 0.45,
    };

    let currentTarget = "";
    let targetScore = 0;
    let lastTargetRefresh = 0;
    let lastStatusAt = 0;
    let batchInfo = null;
    let lastBatchHackThreads = 1;

    await syncWorkerFiles(ns, config);
    killManagedWorkers(ns, config);

    while (true) {
        await syncWorkerFiles(ns, config);

        const capacity = getAvailableThreads(ns, {
            homeReserve: config.homeReserve,
            useHacknet: config.useHacknet,
        });

        const ranking = rankMoneyTargets(ns, {
            limit: Math.max(8, config.debugLimit),
            minChance: config.minChance,
            hackGate: 1.0,
        });

        const now = Date.now();
        const best = ranking[0] ?? null;
        const currentRow = ranking.find((row) => row.host === currentTarget);
        if (best && (
            !currentTarget ||
            !currentRow ||
            currentTarget === best.host ||
            now - lastTargetRefresh >= config.targetRefreshMs ||
            best.score >= targetScore * config.switchMargin
        )) {
            if (best.host !== currentTarget) {
                currentTarget = best.host;
                targetScore = best.score;
                batchInfo = best.batchInfo;
                lastBatchHackThreads = Math.max(1, batchInfo?.H1 ?? 1);
                ns.tprint(`TARGET -> ${currentTarget}`);
            } else {
                targetScore = best.score;
            }
            lastTargetRefresh = now;
        }

        if (!currentTarget) {
            maybeWriteStatus(
                ns,
                config,
                {
                    target: "",
                    action: "No viable target",
                    chance: 0,
                    moneyPct: 0,
                    secDiff: 0,
                    freeRam: capacity.totalFreeRam,
                    usableRam: capacity.totalUsableRam,
                    debug: buildDebugLines(ranking, config),
                },
                () => lastStatusAt,
                (value) => { lastStatusAt = value; }
            );
            await ns.sleep(1000);
            continue;
        }

        const live = getLiveTargetStats(ns, currentTarget);
        if (!batchInfo || batchInfo.H1 <= 0) {
            batchInfo = getBatchInfo(ns, currentTarget, -1, -1, lastBatchHackThreads);
            lastBatchHackThreads = Math.max(1, batchInfo.H1 || 1);
        }

        const hackTime = ns.formulas.hacking.hackTime(getPreppedServer(ns, currentTarget), ns.getPlayer());
        const weakenTime = hackTime * 4;
        const growTime = hackTime * 3.2;

        let threadsLeft = capacity.totalThreads;
        let prepW1 = 0;
        let prepG1 = 0;
        let prepW2 = 0;
        let prepH1 = 0;
        let prepW3 = 0;
        let prepG2 = 0;
        let prepW4 = 0;

        if (live.secDiff > 0 && threadsLeft > 0) {
            const waveW1 = Math.ceil(live.secDiff / ns.weakenAnalyze(1));
            prepW1 = Math.min(waveW1, threadsLeft);
            threadsLeft -= prepW1;
        }

        if (threadsLeft > 0) {
            const growWave = Math.ceil(
                ns.formulas.hacking.growThreads(
                    ns.getServer(currentTarget),
                    ns.getPlayer(),
                    ns.getServerMaxMoney(currentTarget),
                    1
                )
            );
            const paired = fitGrowWeakenPair(growWave, threadsLeft, ns.weakenAnalyze(1));
            prepG1 = paired.grow;
            prepW2 = paired.weaken;
            threadsLeft -= prepG1 + prepW2;
        }

        if (threadsLeft > 0 && batchInfo.H1 > 0) {
            const paired = fitHackWeakenPair(batchInfo.H1, threadsLeft, ns.weakenAnalyze(1));
            prepH1 = paired.hack;
            prepW3 = paired.weaken;
            threadsLeft -= prepH1 + prepW3;
        }

        if (threadsLeft > 0 && batchInfo.G1 > 0) {
            const paired = fitGrowWeakenPair(batchInfo.G1, threadsLeft, ns.weakenAnalyze(1));
            prepG2 = paired.grow;
            prepW4 = paired.weaken;
            threadsLeft -= prepG2 + prepW4;
        }

        let adjustedBatchInfo = batchInfo;
        if (config.pad && adjustedBatchInfo.G1 > 0) {
            adjustedBatchInfo = {
                ...adjustedBatchInfo,
                G1: adjustedBatchInfo.G1 + Math.ceil(adjustedBatchInfo.G1 * 0.15),
            };
            adjustedBatchInfo.W2 = Math.ceil(
                (
                    adjustedBatchInfo.G1 * 0.004 +
                    Math.max(((adjustedBatchInfo.H1 * 0.002) / ns.weakenAnalyze(1)) - (adjustedBatchInfo.W1 * ns.weakenAnalyze(1)), 0)
                ) / ns.weakenAnalyze(1)
            );
            adjustedBatchInfo.Threads = adjustedBatchInfo.H1 + adjustedBatchInfo.W1 + adjustedBatchInfo.G1 + adjustedBatchInfo.W2;
        }

        const batchesTotal = adjustedBatchInfo.Threads > 0
            ? Math.max(0, Math.floor(threadsLeft / adjustedBatchInfo.Threads))
            : 0;

        const prepAction = summarizePrep(prepW1, prepG1, prepW2, prepH1, prepW3, prepG2, prepW4);
        const dispatch = runServerPlan(
            ns,
            currentTarget,
            {
                prepW1,
                prepG1,
                prepW2,
                prepH1,
                prepW3,
                prepG2,
                prepW4,
            },
            adjustedBatchInfo,
            batchesTotal,
            config
        );

        let threadsRemaining = Math.max(0, threadsLeft - adjustedBatchInfo.Threads * dispatch.batchesRun);
        let xpResult = null;
        if (config.xpOverflow && threadsRemaining > 0) {
            xpResult = runXpOverflow(ns, threadsRemaining, config);
            threadsRemaining = 0;
        }

        const lastPid = xpResult?.lastPid || dispatch.lastPid;
        const waitTime = xpResult?.waitTime || dispatch.waitTime || weakenTime;
        const actionSummary = [
            `type=${adjustedBatchInfo.Type}`,
            prepAction,
            `batches=${dispatch.batchesRun}`,
            `take=$${formatMoney(ns, adjustedBatchInfo.Take * dispatch.batchesRun)}`,
            xpResult?.target ? `xp=${xpResult.target}` : "",
        ].filter(Boolean).join(" | ");

        maybeWriteStatus(
            ns,
            config,
            {
                target: currentTarget,
                action: actionSummary,
                chance: batchInfo.Chance,
                moneyPct: live.moneyPct,
                secDiff: live.secDiff,
                freeRam: capacity.totalFreeRam,
                usableRam: capacity.totalUsableRam,
                batchPlan: {
                    type: adjustedBatchInfo.Type,
                    hackThreads: adjustedBatchInfo.H1,
                    weaken1Threads: adjustedBatchInfo.W1,
                    growThreads: adjustedBatchInfo.G1,
                    weaken2Threads: adjustedBatchInfo.W2,
                    take: adjustedBatchInfo.Take,
                    hackPct: adjustedBatchInfo.HackP * adjustedBatchInfo.H1,
                    launchInterval: Math.round(Math.max(hackTime / Math.max(1, dispatch.batchesRun || 1), 200)),
                    cycleTime: Math.round(weakenTime),
                },
                debug: buildDebugLines(ranking, config),
            },
            () => lastStatusAt,
            (value) => { lastStatusAt = value; }
        );

        if (!lastPid) {
            maybeWriteStatus(
                ns,
                config,
                {
                    target: currentTarget,
                    action: "Waiting for RAM",
                    chance: batchInfo.Chance,
                    moneyPct: live.moneyPct,
                    secDiff: live.secDiff,
                    freeRam: capacity.totalFreeRam,
                    usableRam: capacity.totalUsableRam,
                    batchPlan: {
                        type: adjustedBatchInfo.Type,
                        hackThreads: adjustedBatchInfo.H1,
                        weaken1Threads: adjustedBatchInfo.W1,
                        growThreads: adjustedBatchInfo.G1,
                        weaken2Threads: adjustedBatchInfo.W2,
                        take: adjustedBatchInfo.Take,
                        hackPct: adjustedBatchInfo.HackP * adjustedBatchInfo.H1,
                        launchInterval: Math.round(Math.max(hackTime / Math.max(1, dispatch.batchesRun || 1), 200)),
                        cycleTime: Math.round(weakenTime),
                    },
                    debug: buildDebugLines(ranking, config),
                },
                () => lastStatusAt,
                (value) => { lastStatusAt = value; }
            );
            batchInfo = getBatchInfo(ns, currentTarget, -1, -1, Math.max(1, adjustedBatchInfo.H1 || 1));
            lastBatchHackThreads = Math.max(1, batchInfo.H1 || 1);
            await ns.sleep(1000);
            continue;
        }

        while (ns.isRunning(lastPid)) {
            const latest = getLiveTargetStats(ns, currentTarget);
            maybeWriteStatus(
                ns,
                config,
                {
                    target: currentTarget,
                    action: `${actionSummary} | countdown=${formatTime(Math.max(0, waitTime - (Date.now() - dispatch.startedAt)))}`,
                    chance: batchInfo.Chance,
                    moneyPct: latest.moneyPct,
                    secDiff: latest.secDiff,
                    freeRam: getAvailableThreads(ns, {
                        homeReserve: config.homeReserve,
                        useHacknet: config.useHacknet,
                    }).totalFreeRam,
                    usableRam: capacity.totalUsableRam,
                    batchPlan: {
                        type: adjustedBatchInfo.Type,
                        hackThreads: adjustedBatchInfo.H1,
                        weaken1Threads: adjustedBatchInfo.W1,
                        growThreads: adjustedBatchInfo.G1,
                        weaken2Threads: adjustedBatchInfo.W2,
                        take: adjustedBatchInfo.Take,
                        hackPct: adjustedBatchInfo.HackP * adjustedBatchInfo.H1,
                        launchInterval: Math.round(Math.max(hackTime / Math.max(1, dispatch.batchesRun || 1), 200)),
                        cycleTime: Math.round(weakenTime),
                    },
                    debug: buildDebugLines(ranking, config),
                },
                () => lastStatusAt,
                (value) => { lastStatusAt = value; }
            );
            await ns.sleep(50);
        }

        if (dispatch.recalc || dispatch.batchesRun <= 1) {
            batchInfo = getBatchInfo(ns, currentTarget, dispatch.batchesRun, capacity.totalThreads, Math.max(1, adjustedBatchInfo.H1));
            lastBatchHackThreads = Math.max(1, batchInfo.H1 || 1);
        } else {
            batchInfo = getBatchInfo(ns, currentTarget, -1, -1, Math.max(1, adjustedBatchInfo.H1 - 1));
            lastBatchHackThreads = Math.max(1, batchInfo.H1 || 1);
        }
    }
}

function runXpOverflow(ns, threads, config) {
    const xpTarget = getBestXpTarget(ns);
    if (!xpTarget.host || threads <= 0) return null;

    const server = ns.getServer(xpTarget.host);
    const weakenStrength = ns.weakenAnalyze(1);
    let weakenThreads = Math.ceil(Math.max(0, server.hackDifficulty - server.minDifficulty) / weakenStrength);
    weakenThreads = Math.min(weakenThreads, threads);
    let remaining = Math.max(0, threads - weakenThreads);

    let growThreads = 0;
    let growWeakenThreads = 0;
    if (remaining > 0) {
        const neededGrow = Math.ceil(
            ns.formulas.hacking.growThreads(server, ns.getPlayer(), server.moneyMax, 1)
        );
        const pair = fitGrowWeakenPair(neededGrow, remaining, weakenStrength);
        growThreads = pair.grow;
        growWeakenThreads = pair.weaken;
    }

    if (weakenThreads + growThreads + growWeakenThreads <= 0) return null;

    const result = runServerPlan(
        ns,
        xpTarget.host,
        {
            prepW1: weakenThreads,
            prepG1: growThreads,
            prepW2: growWeakenThreads,
            prepH1: 0,
            prepW3: 0,
            prepG2: 0,
            prepW4: 0,
        },
        {
            H1: 0,
            W1: 0,
            G1: 0,
            W2: 0,
            Type: "XP",
            Take: 0,
            HackP: 0,
            Chance: 1,
            Threads: 0,
        },
        0,
        config
    );

    const waitTime = weakenThreads > 0 || growWeakenThreads > 0
        ? ns.getWeakenTime(xpTarget.host)
        : ns.getGrowTime(xpTarget.host);

    return {
        target: xpTarget.host,
        lastPid: result.lastPid,
        waitTime,
    };
}

function runServerPlan(ns, target, prep, batchInfo, batches, config) {
    const hackTime = ns.getHackTime(target);
    const growTime = ns.getGrowTime(target);
    const weakenTime = ns.getWeakenTime(target);
    const workers = getWorkerPoolSorted(ns, config);
    let lastPid = 0;
    let recalc = false;
    const startedAt = Date.now();

    const waitTime = prep.prepW1 + prep.prepW2 + prep.prepW3 + prep.prepW4 > 0 ? weakenTime :
        (prep.prepG1 + prep.prepG2 > 0 ? growTime : weakenTime);

    if (prep.prepW1) lastPid = dispatchThreads(ns, workers, "weaken.js", target, 0, prep.prepW1, false, config.logging) || lastPid;
    if (prep.prepG1) lastPid = dispatchThreads(ns, workers, "grow.js", target, waitTime - growTime, prep.prepG1, true, config.logging) || lastPid;
    if (prep.prepW2) lastPid = dispatchThreads(ns, workers, "weaken.js", target, 0, prep.prepW2, false, config.logging) || lastPid;
    if (prep.prepH1) lastPid = dispatchThreads(ns, workers, "hack.js", target, waitTime - hackTime, prep.prepH1, true, config.logging) || lastPid;
    if (prep.prepW3) lastPid = dispatchThreads(ns, workers, "weaken.js", target, 0, prep.prepW3, false, config.logging) || lastPid;
    if (prep.prepG2) lastPid = dispatchThreads(ns, workers, "grow.js", target, waitTime - growTime, prep.prepG2, true, config.logging) || lastPid;
    if (prep.prepW4) lastPid = dispatchThreads(ns, workers, "weaken.js", target, 0, prep.prepW4, false, config.logging) || lastPid;

    let batchesRun = 0;
    const cycleDeadline = performance.now() + weakenTime;
    for (let i = 1; i <= Math.min(batches, 99_999); i += 1) {
        if (performance.now() >= cycleDeadline) {
            recalc = true;
            break;
        }

        batchesRun += 1;
        if (batchInfo.H1) lastPid = dispatchThreads(ns, workers, "hack.js", target, weakenTime - hackTime, batchInfo.H1, true, config.logging, `${CONTROLLER_NAME}:${i}:h`) || lastPid;
        if (batchInfo.W1) lastPid = dispatchThreads(ns, workers, "weaken.js", target, 0, batchInfo.W1, false, config.logging, `${CONTROLLER_NAME}:${i}:w1`) || lastPid;
        if (batchInfo.G1) lastPid = dispatchThreads(ns, workers, "grow.js", target, weakenTime - growTime, batchInfo.G1, true, config.logging, `${CONTROLLER_NAME}:${i}:g`) || lastPid;
        if (batchInfo.W2) lastPid = dispatchThreads(ns, workers, "weaken.js", target, 0, batchInfo.W2, false, config.logging, `${CONTROLLER_NAME}:${i}:w2`) || lastPid;
    }

    return {
        lastPid,
        recalc,
        batchesRun,
        waitTime: Math.max(waitTime, weakenTime),
        startedAt,
    };
}

function dispatchThreads(ns, workers, script, target, delay, threads, requireChunk, logging, tag = "") {
    if (!Number.isFinite(threads) || threads <= 0) return 0;

    let remaining = Math.max(0, Math.floor(threads));
    let lastPid = 0;
    const scriptRam = ns.getScriptRam(script, "home");

    if (requireChunk) {
        for (const worker of workers) {
            const availableThreads = Math.floor(worker.freeRam / scriptRam);
            if (availableThreads < remaining) continue;

            const pid = ns.exec(script, worker.host, remaining, target, Math.max(0, delay), tag || `${Date.now()}:${remaining}`);
            if (pid > 0) {
                worker.freeRam -= remaining * scriptRam;
                return pid;
            }
        }
        return dispatchThreads(ns, workers, script, target, delay, remaining, false, logging, tag);
    }

    const toRemove = new Set();
    for (let i = 0; i < workers.length && remaining > 0; i += 1) {
        const worker = workers[i];
        const availableThreads = Math.floor(worker.freeRam / scriptRam);
        if (availableThreads <= 0) {
            toRemove.add(worker.host);
            continue;
        }

        const runThreads = Math.min(remaining, availableThreads);
        const pid = ns.exec(script, worker.host, runThreads, target, Math.max(0, delay), tag || `${Date.now()}:${runThreads}:${i}`);
        if (pid === 0) {
            if (logging) {
                ns.tprint(`Dispatch failed: ${script} on ${worker.host} t=${runThreads} target=${target}`);
            }
            continue;
        }

        worker.freeRam -= runThreads * scriptRam;
        remaining -= runThreads;
        lastPid = pid;
        if (remaining > 0) i = -1;
    }

    for (const host of toRemove) {
        const index = workers.findIndex((worker) => worker.host === host);
        if (index >= 0) workers.splice(index, 1);
    }

    if (remaining > 0 && logging) {
        ns.tprint(`Failed to allocate all threads for ${script}. ${remaining} left.`);
    }
    return lastPid;
}

function fitGrowWeakenPair(growThreadsWanted, threadsAvailable, weakenStrength) {
    let growThreads = Math.max(0, Math.floor(growThreadsWanted));
    if (growThreads <= 0 || threadsAvailable <= 0) {
        return { grow: 0, weaken: 0 };
    }

    let weakenThreads = Math.ceil((growThreads * 0.004) / weakenStrength);
    if (growThreads + weakenThreads <= threadsAvailable) {
        return { grow: growThreads, weaken: weakenThreads };
    }

    const growRatio = 0.004 / weakenStrength;
    const weakenThreadsFromBudget = Math.ceil(threadsAvailable * growRatio);
    growThreads = Math.max(0, threadsAvailable - weakenThreadsFromBudget);
    weakenThreads = Math.max(0, Math.min(threadsAvailable - growThreads, Math.ceil((growThreads * 0.004) / weakenStrength)));
    return { grow: growThreads, weaken: weakenThreads };
}

function fitHackWeakenPair(hackThreadsWanted, threadsAvailable, weakenStrength) {
    let hackThreads = Math.max(0, Math.floor(hackThreadsWanted));
    if (hackThreads <= 0 || threadsAvailable <= 0) {
        return { hack: 0, weaken: 0 };
    }

    let weakenThreads = Math.ceil((hackThreads * 0.002) / weakenStrength);
    if (hackThreads + weakenThreads <= threadsAvailable) {
        return { hack: hackThreads, weaken: weakenThreads };
    }

    const weakenRatio = 0.002 / weakenStrength;
    const weakenThreadsFromBudget = Math.ceil(threadsAvailable * weakenRatio);
    hackThreads = Math.max(0, threadsAvailable - weakenThreadsFromBudget);
    weakenThreads = Math.max(0, Math.min(threadsAvailable - hackThreads, Math.ceil((hackThreads * 0.002) / weakenStrength)));
    return { hack: hackThreads, weaken: weakenThreads };
}

function getWorkerPoolSorted(ns, config) {
    const workers = getAvailableThreads(ns, {
        homeReserve: config.homeReserve,
        useHacknet: config.useHacknet,
    }).workers;

    workers.sort((a, b) => {
        const rankA = workerRank(a.type);
        const rankB = workerRank(b.type);
        if (rankA !== rankB) return rankA - rankB;
        return a.freeRam - b.freeRam;
    });
    return workers;
}

function workerRank(type) {
    switch (type) {
        case "purchased": return 0;
        case "rooted": return 1;
        case "home": return 2;
        default: return 3;
    }
}

async function syncWorkerFiles(ns, config) {
    const workers = getWorkerPoolSorted(ns, config);
    for (const worker of workers) {
        if (worker.host !== "home") {
            await ns.scp(WORKER_FILES, worker.host, "home");
        }
    }
}

function killManagedWorkers(ns, config) {
    const workers = getWorkerPoolSorted(ns, config);
    for (const worker of workers) {
        for (const file of WORKER_FILES) {
            ns.scriptKill(file, worker.host);
        }
    }
}

function summarizePrep(w1, g1, w2, h1, w3, g2, w4) {
    const parts = [];
    if (w1) parts.push(`W${w1}`);
    if (g1) parts.push(`G${g1}`);
    if (w2) parts.push(`W${w2}`);
    if (h1) parts.push(`H${h1}`);
    if (w3) parts.push(`W${w3}`);
    if (g2) parts.push(`G${g2}`);
    if (w4) parts.push(`W${w4}`);
    return parts.length > 0 ? `prep=${parts.join("/")}` : "prep=clean";
}

function maybeWriteStatus(ns, config, payload, getLastStatusAt, setLastStatusAt) {
    const now = Date.now();
    if (now - getLastStatusAt() < config.statusIntervalMs) return;
    writeStatus(ns, STATUS_NAMES.formulas, payload);
    setLastStatusAt(now);
}

function buildDebugLines(ranking, config) {
    if (!config.debugTargets) return [];
    return ranking.slice(0, config.debugLimit).map((row) => (
        `${row.host} | score=${Math.floor(row.score)} | type=${row.batchInfo?.Type ?? "?"} | ` +
        `H=${row.batchInfo?.H1 ?? 0} W1=${row.batchInfo?.W1 ?? 0} G=${row.batchInfo?.G1 ?? 0} W2=${row.batchInfo?.W2 ?? 0} | ` +
        `take=${formatCompactNumber(row.batchInfo?.Take ?? 0)} | chance=${((row.chance ?? 0) * 100).toFixed(1)}%`
    ));
}

function formatCompactNumber(value) {
    if (value >= 1e15) return `${(value / 1e15).toFixed(2)}q`;
    if (value >= 1e12) return `${(value / 1e12).toFixed(2)}t`;
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)}b`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(2)}m`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(2)}k`;
    return `${Math.round(value)}`;
}

function formatMoney(ns, value) {
    return ns.formatNumber(value, 2);
}

function formatTime(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "0ms";
    if (ms >= 60_000) return `${(ms / 60_000).toFixed(2)}m`;
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
    return `${Math.round(ms)}ms`;
}
