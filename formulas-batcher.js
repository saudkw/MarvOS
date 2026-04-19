import { clearStatus, STATUS_NAMES, writeStatus } from "/MarvOS/lib/status.js";
import {
    getBatchInfo,
    getBestXpTarget,
    getLiveTargetStats,
    getWorkerPool,
    hasMoneyFormulas,
    rankMoneyTargets,
} from "/MarvOS/lib/money-core.js";

const WORKER_FILES = ["hack.js", "grow.js", "weaken.js"];
const THREAD_RAM = 1.75;
const CONTROLLER_NAME = "formulas-batcher";
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
        ["status-interval-ms", 1500],
        ["switch-margin", 1.12],
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
        debugTargets: Boolean(flags["debug-targets"]),
        debugLimit: Math.max(1, Math.floor(Number(flags["debug-limit"]) || 5)),
        homeReserve: Math.max(0, Number(flags["home-reserve"]) || 32),
        useHacknet: Boolean(flags["use-hacknet"]),
        logging: Boolean(flags.logging),
        pad: Boolean(flags.pad),
        xpOverflow: !Boolean(flags["no-xp-overflow"]),
        targetRefreshMs: Math.max(30_000, Number(flags["target-refresh-ms"]) || 120_000),
        statusIntervalMs: Math.max(750, Number(flags["status-interval-ms"]) || 1500),
        switchMargin: Math.max(1.01, Number(flags["switch-margin"]) || 1.12),
        minChance: 0.45,
    };

    let currentTarget = "";
    let currentScore = 0;
    let lastRetargetAt = 0;
    let lastStatusAt = 0;
    let lastSyncAt = 0;
    let cachedRanking = [];
    let cachedRankingAt = 0;
    let batchInfo = null;
    let lastHackThreads = 1;

    await syncWorkerFiles(ns, config, true);
    lastSyncAt = Date.now();

    while (true) {
        if (Date.now() - lastSyncAt > 300_000) {
            await syncWorkerFiles(ns, config, false);
            lastSyncAt = Date.now();
        }

        if (!currentTarget || Date.now() - cachedRankingAt > config.targetRefreshMs) {
            cachedRanking = rankMoneyTargets(ns, {
                limit: Math.max(10, config.debugLimit + 2),
                minChance: config.minChance,
                hackGate: 1.0,
            });
            cachedRankingAt = Date.now();
        }
        const ranking = cachedRanking;

        const choice = chooseTarget(ranking, currentTarget, currentScore, lastRetargetAt, config);
        if (choice.switched) {
            currentTarget = choice.target;
            currentScore = choice.score;
            batchInfo = null;
            lastHackThreads = 1;
            lastRetargetAt = Date.now();
            if (currentTarget) ns.tprint(`TARGET -> ${currentTarget}`);
        } else if (choice.target) {
            currentScore = choice.score;
        }

        if (!currentTarget) {
            maybeWriteStatus(ns, config, {
                target: "",
                action: "No viable target",
                chance: 0,
                moneyPct: 0,
                secDiff: 0,
                freeRam: getTotalFreeRam(getWorkerPool(ns, config)),
                usableRam: getTotalUsableRam(getWorkerPool(ns, config)),
                debug: buildDebugLines(ranking, config),
            }, () => lastStatusAt, (value) => { lastStatusAt = value; });
            await ns.sleep(1000);
            continue;
        }

        const workers = getWorkerPool(ns, {
            homeReserve: config.homeReserve,
            useHacknet: config.useHacknet,
        });
        const totalThreads = getTotalThreads(workers);
        const totalFreeRam = getTotalFreeRam(workers);
        const totalUsableRam = getTotalUsableRam(workers);
        const live = getLiveTargetStats(ns, currentTarget);

        if (!batchInfo || batchInfo.H1 <= 0) {
            batchInfo = getBatchInfo(ns, currentTarget, -1, -1, lastHackThreads);
            lastHackThreads = Math.max(1, batchInfo.H1 || 1);
        }

        const tunedBatchInfo = tuneBatchInfo(batchInfo, config, ns);
        const plan = buildExecutionPlan(ns, currentTarget, live, tunedBatchInfo, totalThreads, workers.length);
        const dispatch = await executePlan(ns, currentTarget, plan, config);

        let xpResult = null;
        if (config.xpOverflow && dispatch.remainingThreads > 0) {
            xpResult = runXpOverflow(ns, workers, dispatch.remainingThreads, config);
        }

        const finalPid = xpResult?.lastPid || dispatch.lastPid;
        const summary = summarizeAction(plan, dispatch, xpResult);
        maybeWriteStatus(ns, config, {
            target: currentTarget,
            action: summary,
            chance: tunedBatchInfo.Chance,
            moneyPct: live.moneyPct,
            secDiff: live.secDiff,
            freeRam: totalFreeRam,
            usableRam: totalUsableRam,
            batchPlan: {
                type: tunedBatchInfo.Type,
                hackThreads: tunedBatchInfo.H1,
                weaken1Threads: tunedBatchInfo.W1,
                growThreads: tunedBatchInfo.G1,
                weaken2Threads: tunedBatchInfo.W2,
                take: tunedBatchInfo.Take,
                hackPct: tunedBatchInfo.HackP * tunedBatchInfo.H1,
                launchInterval: Math.round(Math.max(dispatch.weakenTime / Math.max(1, dispatch.batchesRun || 1), 200)),
                cycleTime: Math.round(dispatch.weakenTime),
            },
            debug: buildDebugLines(ranking, config),
        }, () => lastStatusAt, (value) => { lastStatusAt = value; });

        if (!finalPid) {
            batchInfo = getBatchInfo(ns, currentTarget, -1, -1, Math.max(1, tunedBatchInfo.H1 || 1));
            lastHackThreads = Math.max(1, batchInfo.H1 || 1);
            await ns.sleep(750);
            continue;
        }

        while (ns.isRunning(finalPid)) {
            const latest = getLiveTargetStats(ns, currentTarget);
            maybeWriteStatus(ns, config, {
                target: currentTarget,
                action: `${summary} | countdown=${formatTime(Math.max(0, dispatch.waitTime - (Date.now() - dispatch.startedAt)))}`,
                chance: tunedBatchInfo.Chance,
                moneyPct: latest.moneyPct,
                secDiff: latest.secDiff,
                freeRam: getTotalFreeRam(getWorkerPool(ns, config)),
                usableRam: totalUsableRam,
                batchPlan: {
                    type: tunedBatchInfo.Type,
                    hackThreads: tunedBatchInfo.H1,
                    weaken1Threads: tunedBatchInfo.W1,
                    growThreads: tunedBatchInfo.G1,
                    weaken2Threads: tunedBatchInfo.W2,
                    take: tunedBatchInfo.Take,
                    hackPct: tunedBatchInfo.HackP * tunedBatchInfo.H1,
                    launchInterval: Math.round(Math.max(dispatch.weakenTime / Math.max(1, dispatch.batchesRun || 1), 200)),
                    cycleTime: Math.round(dispatch.weakenTime),
                },
                debug: buildDebugLines(ranking, config),
            }, () => lastStatusAt, (value) => { lastStatusAt = value; });
            await ns.sleep(500);
        }

        if (dispatch.recalc || dispatch.batchesRun <= 1) {
            batchInfo = getBatchInfo(ns, currentTarget, dispatch.batchesRun, plan.totalThreads, Math.max(1, tunedBatchInfo.H1 || 1));
        } else {
            batchInfo = getBatchInfo(ns, currentTarget, -1, -1, Math.max(1, tunedBatchInfo.H1 - 1));
        }
        lastHackThreads = Math.max(1, batchInfo.H1 || 1);
    }
}

function chooseTarget(ranking, currentTarget, currentScore, lastRetargetAt, config) {
    const best = ranking[0] ?? null;
    const current = ranking.find((row) => row.host === currentTarget) ?? null;
    if (!best) return { target: "", score: 0, switched: false };
    if (!currentTarget) return { target: best.host, score: best.score, switched: true };
    if (!current) return { target: best.host, score: best.score, switched: true };
    if (best.host === currentTarget) return { target: currentTarget, score: best.score, switched: false };
    if (Date.now() - lastRetargetAt < config.targetRefreshMs) return { target: currentTarget, score: current.score, switched: false };
    if (best.score < current.score * config.switchMargin) return { target: currentTarget, score: current.score, switched: false };
    return { target: best.host, score: best.score, switched: true };
}

function tuneBatchInfo(batchInfo, config, ns) {
    if (!config.pad || batchInfo.G1 <= 0) return batchInfo;
    const growThreads = batchInfo.G1 + Math.ceil(batchInfo.G1 * 0.15);
    const weakenStrength = ns.weakenAnalyze(1);
    return {
        ...batchInfo,
        G1: growThreads,
        W2: Math.ceil((growThreads * 0.004) / weakenStrength),
        Threads: batchInfo.H1 + batchInfo.W1 + growThreads + Math.ceil((growThreads * 0.004) / weakenStrength),
    };
}

function buildExecutionPlan(ns, target, live, batchInfo, totalThreads, workerCount) {
    const server = ns.getServer(target);
    const player = ns.getPlayer();
    const weakenStrength = ns.weakenAnalyze(1);
    let threadsLeft = totalThreads;

    const prep = {
        W1: 0,
        G1: 0,
        W2: 0,
        H1: 0,
        W3: 0,
        G2: 0,
        W4: 0,
    };

    const waveW1 = Math.ceil(Math.max(0, live.secDiff) / weakenStrength);
    prep.W1 = Math.min(waveW1, threadsLeft);
    threadsLeft -= prep.W1;

    if (threadsLeft > 0) {
        const growWave = Math.ceil(
            ns.formulas.hacking.growThreads(server, player, server.moneyMax, 1)
        );
        const pair = fitGrowWeakenPair(growWave, threadsLeft, weakenStrength);
        prep.G1 = pair.grow;
        prep.W2 = pair.weaken;
        threadsLeft -= prep.G1 + prep.W2;
    }

    if (threadsLeft > 0) {
        const pair = fitHackWeakenPair(batchInfo.H1, threadsLeft, weakenStrength);
        prep.H1 = pair.hack;
        prep.W3 = pair.weaken;
        threadsLeft -= prep.H1 + prep.W3;
    }

    if (threadsLeft > 0) {
        const pair = fitGrowWeakenPair(batchInfo.G1, threadsLeft, weakenStrength);
        prep.G2 = pair.grow;
        prep.W4 = pair.weaken;
        threadsLeft -= prep.G2 + prep.W4;
    }

    const batchThreads = Math.max(0, batchInfo.Threads || (batchInfo.H1 + batchInfo.W1 + batchInfo.G1 + batchInfo.W2));
    const rawBatchesTotal = batchThreads > 0 ? Math.floor(threadsLeft / batchThreads) : 0;
    const batchesTotal = Math.max(0, Math.min(rawBatchesTotal, getBatchCap(workerCount, rawBatchesTotal)));
    const remainingThreads = Math.max(0, threadsLeft - batchesTotal * batchThreads);

    return {
        prep,
        batchInfo,
        batchThreads,
        batchesTotal,
        totalThreads,
        remainingThreads,
    };
}

async function executePlan(ns, target, plan, config) {
    if (!ns.fileExists(SERVER_RUNNER, "home")) {
        if (config.logging) ns.tprint(`Missing ${SERVER_RUNNER}`);
        return {
            lastPid: 0,
            startedAt: Date.now(),
            waitTime: 0,
            weakenTime: ns.getWeakenTime(target),
            recalc: true,
            batchesRun: 0,
            batching: false,
            remainingThreads: 0,
        };
    }

    const resultFile = `marvos-serverrun-${Date.now()}-${Math.floor(Math.random() * 1e6)}.txt`;
    const pid = ns.exec(
        SERVER_RUNNER,
        "home",
        1,
        target,
        config.homeReserve,
        config.useHacknet,
        config.logging ? 1 : 0,
        JSON.stringify(plan),
        resultFile,
    );

    if (pid === 0) {
        if (config.logging) ns.tprint(`Failed to start ${SERVER_RUNNER}`);
        return {
            lastPid: 0,
            startedAt: Date.now(),
            waitTime: 0,
            weakenTime: ns.getWeakenTime(target),
            recalc: true,
            batchesRun: 0,
            batching: false,
            remainingThreads: 0,
        };
    }

    while (ns.isRunning(pid)) {
        await ns.sleep(50);
    }

    let record = null;
    try {
        const raw = ns.read(resultFile);
        if (raw) record = JSON.parse(raw);
    } catch {
        record = null;
    } finally {
        if (ns.fileExists(resultFile, "home")) ns.rm(resultFile, "home");
    }

    return record ?? {
        lastPid: 0,
        startedAt: Date.now(),
        waitTime: 0,
        weakenTime: ns.getWeakenTime(target),
        recalc: true,
        batchesRun: 0,
        batching: false,
        remainingThreads: 0,
    };
}

function dispatchWork(ns, workers, script, target, delay, threads, requireChunk, tag, logging) {
    const scriptRam = ns.getScriptRam(script, "home");
    let remaining = Math.max(0, Math.floor(threads));
    let lastPid = 0;
    let chunking = requireChunk;

    if (remaining <= 0) {
        return { lastPid: 0, chunking };
    }

    if (chunking) {
        for (const worker of workers) {
            const availableThreads = Math.floor(worker.freeRam / scriptRam);
            if (availableThreads < remaining) continue;
            const pid = ns.exec(script, worker.host, remaining, target, Math.max(0, delay), tag);
            if (pid > 0) {
                worker.freeRam -= remaining * scriptRam;
                return { lastPid: pid, chunking: true };
            }
        }
        chunking = false;
    }

    while (remaining > 0) {
        let progress = false;
        for (const worker of workers) {
            const availableThreads = Math.floor(worker.freeRam / scriptRam);
            if (availableThreads <= 0) continue;
            const runThreads = Math.min(remaining, availableThreads);
            const pid = ns.exec(script, worker.host, runThreads, target, Math.max(0, delay), `${tag}:${runThreads}`);
            if (pid === 0) {
                if (logging) ns.tprint(`Dispatch failed: ${script} on ${worker.host} t=${runThreads} target=${target}`);
                continue;
            }
            worker.freeRam -= runThreads * scriptRam;
            remaining -= runThreads;
            lastPid = pid;
            progress = true;
            if (remaining <= 0) break;
        }
        if (!progress) break;
    }

    if (remaining > 0 && logging) {
        ns.tprint(`Failed to allocate all threads for ${script}. ${remaining} left.`);
    }

    return { lastPid, chunking };
}

function runXpOverflow(ns, workers, threads, config) {
    const xpTarget = getBestXpTarget(ns);
    if (!xpTarget.host || threads <= 0) return null;

    const server = ns.getServer(xpTarget.host);
    const weakenStrength = ns.weakenAnalyze(1);
    let weakenThreads = Math.min(Math.ceil(Math.max(0, server.hackDifficulty - server.minDifficulty) / weakenStrength), threads);
    let remaining = Math.max(0, threads - weakenThreads);
    let growThreads = 0;
    let growWeakens = 0;

    if (remaining > 0) {
        const neededGrow = Math.ceil(
            ns.formulas.hacking.growThreads(server, ns.getPlayer(), server.moneyMax, 1)
        );
        const pair = fitGrowWeakenPair(neededGrow, remaining, weakenStrength);
        growThreads = pair.grow;
        growWeakens = pair.weaken;
    }

    let lastPid = 0;
    const waitTime = ns.getWeakenTime(xpTarget.host);
    if (weakenThreads > 0) {
        lastPid = dispatchWork(ns, workers, "weaken.js", xpTarget.host, 0, weakenThreads, false, `${CONTROLLER_NAME}:xp:w`, config.logging).lastPid || lastPid;
    }
    if (growThreads > 0) {
        lastPid = dispatchWork(ns, workers, "grow.js", xpTarget.host, waitTime - ns.getGrowTime(xpTarget.host), growThreads, false, `${CONTROLLER_NAME}:xp:g`, config.logging).lastPid || lastPid;
    }
    if (growWeakens > 0) {
        lastPid = dispatchWork(ns, workers, "weaken.js", xpTarget.host, 0, growWeakens, false, `${CONTROLLER_NAME}:xp:w2`, config.logging).lastPid || lastPid;
    }

    return lastPid > 0 ? { target: xpTarget.host, lastPid } : null;
}

function fitGrowWeakenPair(growThreadsWanted, threadsAvailable, weakenStrength) {
    let growThreads = Math.max(0, Math.floor(growThreadsWanted));
    if (growThreads <= 0 || threadsAvailable <= 0) return { grow: 0, weaken: 0 };

    let weakenThreads = Math.ceil((growThreads * 0.004) / weakenStrength);
    if (growThreads + weakenThreads <= threadsAvailable) {
        return { grow: growThreads, weaken: weakenThreads };
    }

    const growRatio = 0.004 / weakenStrength;
    const weakenBudget = Math.ceil(threadsAvailable * growRatio);
    growThreads = Math.max(0, threadsAvailable - weakenBudget);
    weakenThreads = Math.max(0, Math.min(threadsAvailable - growThreads, Math.ceil((growThreads * 0.004) / weakenStrength)));
    return { grow: growThreads, weaken: weakenThreads };
}

function fitHackWeakenPair(hackThreadsWanted, threadsAvailable, weakenStrength) {
    let hackThreads = Math.max(0, Math.floor(hackThreadsWanted));
    if (hackThreads <= 0 || threadsAvailable <= 0) return { hack: 0, weaken: 0 };

    let weakenThreads = Math.ceil((hackThreads * 0.002) / weakenStrength);
    if (hackThreads + weakenThreads <= threadsAvailable) {
        return { hack: hackThreads, weaken: weakenThreads };
    }

    const weakenRatio = 0.002 / weakenStrength;
    const weakenBudget = Math.ceil(threadsAvailable * weakenRatio);
    hackThreads = Math.max(0, threadsAvailable - weakenBudget);
    weakenThreads = Math.max(0, Math.min(threadsAvailable - hackThreads, Math.ceil((hackThreads * 0.002) / weakenStrength)));
    return { hack: hackThreads, weaken: weakenThreads };
}

async function syncWorkerFiles(ns, config, aggressive) {
    const workers = getWorkerPool(ns, {
        homeReserve: config.homeReserve,
        useHacknet: config.useHacknet,
    });
    for (const worker of workers) {
        if (worker.host !== "home") {
            const missing = WORKER_FILES.some((file) => !ns.fileExists(file, worker.host));
            if (aggressive || missing) {
                await ns.scp(WORKER_FILES, worker.host, "home");
            }
        }
    }
}

function getTotalThreads(workers) {
    return workers.reduce((sum, worker) => sum + Math.max(0, Math.floor(worker.freeRam / THREAD_RAM)), 0);
}

function getTotalFreeRam(workers) {
    return workers.reduce((sum, worker) => sum + worker.freeRam, 0);
}

function getTotalUsableRam(workers) {
    return workers.reduce((sum, worker) => sum + worker.maxUsableRam, 0);
}

function getBatchCap(workerCount, rawBatches) {
    if (rawBatches <= 0) return 0;
    const floor = Math.max(24, workerCount * 3);
    const ceiling = Math.max(floor, Math.min(512, workerCount * 24));
    return Math.min(rawBatches, ceiling);
}

function summarizeAction(plan, dispatch, xpResult) {
    const prepSummary = summarizePrep(plan.prep);
    const batchSummary = `${plan.batchInfo.Type} x${dispatch.batchesRun}`;
    const xpSummary = xpResult?.target ? `xp=${xpResult.target}` : "";
    return [prepSummary, batchSummary, xpSummary].filter(Boolean).join(" | ");
}

function summarizePrep(prep) {
    const parts = [];
    if (prep.W1) parts.push(`W${prep.W1}`);
    if (prep.G1) parts.push(`G${prep.G1}`);
    if (prep.W2) parts.push(`W${prep.W2}`);
    if (prep.H1) parts.push(`H${prep.H1}`);
    if (prep.W3) parts.push(`W${prep.W3}`);
    if (prep.G2) parts.push(`G${prep.G2}`);
    if (prep.W4) parts.push(`W${prep.W4}`);
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

function formatTime(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "0ms";
    if (ms >= 60_000) return `${(ms / 60_000).toFixed(2)}m`;
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
    return `${Math.round(ms)}ms`;
}
