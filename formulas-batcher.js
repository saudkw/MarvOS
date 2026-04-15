import { clearStatus, STATUS_NAMES, writeStatus } from "/MarvOS/lib/status.js";

const WORKER_FILES = ["hack.js", "grow.js", "weaken.js"];
const CONTROLLER_NAME = "formulas-batcher";

/** @param {NS} ns */
export async function main(ns) {
    const options = ns.flags([
        ["debug-targets", false],
        ["debug-limit", 5],
    ]);

    if (!hasFormulas(ns)) {
        ns.tprint("Formulas.exe access is required for formulas-batcher.js");
        return;
    }

    for (const file of WORKER_FILES) {
        if (!ns.fileExists(file, "home")) {
            ns.tprint(`Missing ${file} on home`);
            return;
        }
    }

    const CONFIG = {
        excludeTargets: new Set([
            "home",
            "darkweb",
            "n00dles",
            "nectar-net",
        ]),
        minTargetMoney: 50_000_000,
        fallbackMinTargetMoney: 5_000_000,
        minChance: 0.50,
        primaryHackGate: 0.50,
        fallbackHackGate: 0.50,
        homeRamReserve: 32,
        ramSafetyFactor: 0.92,
        batchGapMs: 200,
        targetRefreshMs: 120_000,
        switchMargin: 1.20,
        statusIntervalMs: 15_000,
        prepTimeoutMs: 8 * 60 * 1000,
        prepMoneyPct: 0.999,
        prepSecDiff: 0.05,
        liveMoneyPct: 0.92,
        liveSecDiff: 1.0,
        maxHackPct: 0.30,
        minHackPct: 0.005,
        hackPctStep: 0.005,
        maxBatchesBeforePrep: 100,
        targetCooldownMs: 10 * 60 * 1000,
        takeoverWorkersAtStart: true,
        debugTargets: Boolean(options["debug-targets"]),
        debugLimit: Math.max(1, Math.floor(Number(options["debug-limit"]) || 5)),
    };

    ns.disableLog("ALL");
    ns.atExit(() => clearStatus(ns, STATUS_NAMES.formulas));

    const ramCosts = {
        hack: ns.getScriptRam("hack.js", "home"),
        grow: ns.getScriptRam("grow.js", "home"),
        weaken: ns.getScriptRam("weaken.js", "home"),
    };

    let currentTarget = "";
    let lastTargetCheckAt = 0;
    let lastStatusAt = 0;
    let workerCursor = 0;
    let batchesSincePrep = 0;
    let launchFailures = 0;
    let latestDebug = [];
    /** @type {Map<string, number>} */
    const cooldowns = new Map();

    while (true) {
        const workers = collectWorkers(ns, CONFIG.homeRamReserve);
        await syncWorkerFiles(ns, workers, WORKER_FILES);

        if (CONFIG.takeoverWorkersAtStart) {
            killWorkerScripts(ns, workers);
            CONFIG.takeoverWorkersAtStart = false;
        }

        const now = Date.now();
        const totalUsableRam = getTotalUsableRam(workers);
        const totalFreeRam = getTotalFreeRam(ns, workers);

        if (!currentTarget || now - lastTargetCheckAt >= CONFIG.targetRefreshMs) {
            const ranking = rankTargets(ns, CONFIG, totalUsableRam, ramCosts, cooldowns);
            const ranked = ranking.ranked;
            latestDebug = ranking.debug;

            if (ranked.length === 0) {
                maybePrintStatus(
                    ns,
                    CONFIG,
                    {
                        target: "none",
                        action: "No valid targets found",
                        moneyPct: 0,
                        secDiff: 0,
                        chance: 0,
                        freeRam: totalFreeRam,
                        usableRam: totalUsableRam,
                        batchesSincePrep,
                        debug: latestDebug,
                    },
                    now,
                    () => lastStatusAt,
                    value => { lastStatusAt = value; }
                );
                await ns.sleep(10_000);
                continue;
            }

            const best = ranked[0];
            const currentScore = getTargetScore(ranked, currentTarget);
            const shouldSwitch =
                !currentTarget ||
                best.host === currentTarget ||
                best.score >= currentScore * CONFIG.switchMargin;

            if (shouldSwitch && best.host !== currentTarget) {
                currentTarget = best.host;
                batchesSincePrep = 0;
                launchFailures = 0;
                ns.tprint(`TARGET -> ${currentTarget}`);
                killWorkerScripts(ns, workers);

                const prepOk = await prepTarget(ns, workers, currentTarget, ramCosts, CONFIG);
                if (!prepOk) {
                    cooldowns.set(currentTarget, Date.now() + CONFIG.targetCooldownMs);
                    currentTarget = "";
                    await ns.sleep(2_000);
                    continue;
                }
            }

            lastTargetCheckAt = now;
        }

        if (!currentTarget) {
            await ns.sleep(2_000);
            continue;
        }

        if (batchesSincePrep >= CONFIG.maxBatchesBeforePrep) {
            killWorkerScripts(ns, workers);
            const prepOk = await prepTarget(ns, workers, currentTarget, ramCosts, CONFIG);
            if (!prepOk) {
                cooldowns.set(currentTarget, Date.now() + CONFIG.targetCooldownMs);
                currentTarget = "";
            } else {
                batchesSincePrep = 0;
                launchFailures = 0;
            }
            continue;
        }

        const stats = getTargetStats(ns, currentTarget);
        if (
            stats.moneyPct < CONFIG.liveMoneyPct * 100 ||
            stats.secDiff > CONFIG.liveSecDiff
        ) {
            killWorkerScripts(ns, workers);
            const prepOk = await prepTarget(ns, workers, currentTarget, ramCosts, CONFIG);
            if (!prepOk) {
                cooldowns.set(currentTarget, Date.now() + CONFIG.targetCooldownMs);
                currentTarget = "";
            } else {
                batchesSincePrep = 0;
                launchFailures = 0;
            }
            continue;
        }

        const batchPlan = buildBestBatchPlan(ns, currentTarget, totalUsableRam, ramCosts, CONFIG);
        if (!batchPlan.ok) {
            cooldowns.set(currentTarget, Date.now() + CONFIG.targetCooldownMs);
            currentTarget = "";
            await ns.sleep(2_000);
            continue;
        }

        if (totalFreeRam < batchPlan.batchRam) {
            maybePrintStatus(
                ns,
                CONFIG,
                {
                    target: currentTarget,
                    action: `Waiting for RAM (${ns.formatRam(totalFreeRam, 2)} / ${ns.formatRam(batchPlan.batchRam, 2)})`,
                    moneyPct: stats.moneyPct,
                    secDiff: stats.secDiff,
                    chance: stats.chance,
                    freeRam: totalFreeRam,
                    usableRam: totalUsableRam,
                    batchesSincePrep,
                    batchPlan,
                },
                now,
                () => lastStatusAt,
                value => { lastStatusAt = value; }
            );
            await ns.sleep(Math.max(250, Math.floor(batchPlan.launchInterval / 2)));
            continue;
        }

        const maxConcurrent = Math.max(1, Math.floor(batchPlan.cycleTime / batchPlan.launchInterval));
        const batchesThatFit = Math.max(
            1,
            Math.floor((totalFreeRam * CONFIG.ramSafetyFactor) / batchPlan.batchRam)
        );
        const batchesToLaunch = Math.min(maxConcurrent, batchesThatFit);

        let launchedNow = 0;
        let totalHackScheduled = 0;
        let totalGrowScheduled = 0;
        let totalWeaken1Scheduled = 0;
        let totalWeaken2Scheduled = 0;

        for (let i = 0; i < batchesToLaunch; i += 1) {
            if (getTotalFreeRam(ns, workers) < batchPlan.batchRam) break;

            const rotatedWorkers = rotateWorkers(workers, workerCursor);
            const dispatch = dispatchBatch(
                ns,
                rotatedWorkers,
                currentTarget,
                batchPlan,
                `${CONTROLLER_NAME}:${Date.now()}:${batchesSincePrep + launchedNow}`,
                i * batchPlan.launchInterval,
                ramCosts
            );
            workerCursor += 1;

            if (!dispatch.complete) {
                launchFailures += 1;
                break;
            }

            launchedNow += 1;
            totalHackScheduled += dispatch.hack;
            totalGrowScheduled += dispatch.grow;
            totalWeaken1Scheduled += dispatch.weaken1;
            totalWeaken2Scheduled += dispatch.weaken2;
        }

        if (launchedNow === 0) {
            launchFailures += 1;
        } else {
            batchesSincePrep += launchedNow;
            launchFailures = 0;
        }

        if (launchFailures >= getMaxLaunchFailures(ns, currentTarget)) {
            killWorkerScripts(ns, workers);
            const prepOk = await prepTarget(ns, workers, currentTarget, ramCosts, CONFIG);
            if (!prepOk) {
                cooldowns.set(currentTarget, Date.now() + CONFIG.targetCooldownMs);
                currentTarget = "";
            } else {
                batchesSincePrep = 0;
                launchFailures = 0;
            }
            continue;
        }

        maybePrintStatus(
            ns,
            CONFIG,
            {
                target: currentTarget,
                action:
                    `HWGW ${(batchPlan.hackPct * 100).toFixed(2)}% x${launchedNow} | ` +
                    `H=${totalHackScheduled} W1=${totalWeaken1Scheduled} ` +
                    `G=${totalGrowScheduled} W2=${totalWeaken2Scheduled}`,
                moneyPct: stats.moneyPct,
                secDiff: stats.secDiff,
                chance: stats.chance,
                freeRam: getTotalFreeRam(ns, workers),
                usableRam: totalUsableRam,
                batchesSincePrep,
                batchPlan,
                debug: latestDebug,
            },
            now,
            () => lastStatusAt,
            value => { lastStatusAt = value; }
        );

        await ns.sleep(batchPlan.launchInterval);
    }
}

function hasFormulas(ns) {
    return !!ns.formulas?.hacking?.growThreads;
}

function collectWorkers(ns, homeRamReserve) {
    const purchased = new Set(ns.getPurchasedServers());
    const hosts = discoverHosts(ns);
    for (const host of purchased) {
        hosts.add(host);
    }

    const workers = [];
    for (const host of hosts) {
        if (!ns.hasRootAccess(host)) continue;
        const maxRam = ns.getServerMaxRam(host);
        if (maxRam <= 0) continue;

        const usableRam = Math.max(0, maxRam - (host === "home" ? homeRamReserve : 0));
        if (usableRam <= 0) continue;

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

function killWorkerScripts(ns, workers) {
    for (const worker of workers) {
        for (const file of WORKER_FILES) {
            ns.scriptKill(file, worker.host);
        }
    }
}

function rankTargets(ns, config, totalUsableRam, ramCosts, cooldowns) {
    const thresholds = getTargetMoneyThresholds(ns, config);
    const primary = rankTargetsAtThreshold(
        ns,
        config,
        totalUsableRam,
        ramCosts,
        cooldowns,
        thresholds.primary,
        config.primaryHackGate
    );
    if (primary.ranked.length > 0) return primary;

    return rankTargetsAtThreshold(
        ns,
        config,
        totalUsableRam,
        ramCosts,
        cooldowns,
        thresholds.fallback,
        config.fallbackHackGate
    );
}

function rankTargetsAtThreshold(ns, config, totalUsableRam, ramCosts, cooldowns, minMoneyThreshold, hackGate) {
    const purchased = new Set(ns.getPurchasedServers());
    const player = ns.getPlayer();
    const hackThreshold = Math.floor(ns.getHackingLevel() * hackGate);
    const ranked = [];
    const rejected = [];

    for (const host of discoverHosts(ns)) {
        if (config.excludeTargets.has(host)) {
            pushDebugReject(config, rejected, host, "excluded");
            continue;
        }
        if (purchased.has(host)) {
            pushDebugReject(config, rejected, host, "purchased");
            continue;
        }
        if (!ns.hasRootAccess(host)) {
            pushDebugReject(config, rejected, host, "no root");
            continue;
        }
        if ((cooldowns.get(host) ?? 0) > Date.now()) {
            pushDebugReject(config, rejected, host, "cooldown");
            continue;
        }

        const server = ns.getServer(host);
        if (server.requiredHackingSkill > hackThreshold) {
            pushDebugReject(config, rejected, host, `hack gate ${server.requiredHackingSkill}>${hackThreshold}`);
            continue;
        }
        if (server.moneyMax < minMoneyThreshold) {
            pushDebugReject(config, rejected, host, `money ${formatCompactNumber(server.moneyMax)}<${formatCompactNumber(minMoneyThreshold)}`);
            continue;
        }

        const prepped = getPreppedServer(ns, host);
        const chance = ns.formulas.hacking.hackChance(prepped, player);
        if (chance < config.minChance) {
            pushDebugReject(config, rejected, host, `chance ${(chance * 100).toFixed(1)}%<${(config.minChance * 100).toFixed(1)}%`);
            continue;
        }

        const batchPlan = buildBestBatchPlan(ns, host, totalUsableRam, ramCosts, config);
        if (!batchPlan.ok) {
            pushDebugReject(config, rejected, host, "no viable batch");
            continue;
        }

        const live = getTargetStats(ns, host);
        const moneyPenalty = Math.max(0.35, live.moneyPct / 100);
        const securityPenalty = 1 / (1 + Math.max(0, live.secDiff) * 0.5);
        const healthPenalty = moneyPenalty * securityPenalty;
        const score = batchPlan.incomePerSecond * healthPenalty;

        ranked.push({
            host,
            score,
            debug: `${host} | score=${Math.floor(score)} | raw=${Math.floor(batchPlan.incomePerSecond)} | money=${live.moneyPct.toFixed(1)}% | sec=+${live.secDiff.toFixed(2)} | chance=${(chance * 100).toFixed(1)}% | batch=${ns.formatRam(batchPlan.batchRam, 2)}`,
        });
    }

    ranked.sort((a, b) => b.score - a.score);
    return {
        ranked,
        debug: buildDebugLines(config, minMoneyThreshold, hackThreshold, ranked, rejected),
    };
}

function getTargetMoneyThresholds(ns, config) {
    const hack = ns.getHackingLevel();
    if (hack >= 1_000) {
        return { primary: 500_000_000, fallback: 100_000_000 };
    }
    if (hack >= 500) {
        return { primary: 100_000_000, fallback: 50_000_000 };
    }
    if (hack >= 250) {
        return { primary: 50_000_000, fallback: 10_000_000 };
    }
    return { primary: config.minTargetMoney, fallback: config.fallbackMinTargetMoney };
}

function getTargetScore(ranked, target) {
    const match = ranked.find(row => row.host === target);
    return match ? match.score : 0;
}

function getTargetStats(ns, target) {
    const money = ns.getServerMoneyAvailable(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const minSec = ns.getServerMinSecurityLevel(target);
    const sec = ns.getServerSecurityLevel(target);

    return {
        money,
        maxMoney,
        moneyPct: (money / Math.max(1, maxMoney)) * 100,
        secDiff: sec - minSec,
        chance: ns.hackAnalyzeChance(target),
    };
}

function getPreppedServer(ns, target) {
    const server = ns.getServer(target);
    server.hackDifficulty = server.minDifficulty;
    server.moneyAvailable = server.moneyMax;
    return server;
}

function buildBestBatchPlan(ns, target, availableRam, ramCosts, config) {
    const player = ns.getPlayer();
    const prepped = getPreppedServer(ns, target);
    const hackPctPerThread = ns.formulas.hacking.hackPercent(prepped, player);
    const chance = ns.formulas.hacking.hackChance(prepped, player);
    const hackTime = ns.formulas.hacking.hackTime(prepped, player);
    const growTime = ns.formulas.hacking.growTime(prepped, player);
    const weakenTime = ns.formulas.hacking.weakenTime(prepped, player);

    if (!Number.isFinite(hackPctPerThread) || hackPctPerThread <= 0) {
        return { ok: false };
    }

    let best = null;

    for (
        let requestedHackPct = config.maxHackPct;
        requestedHackPct >= config.minHackPct;
        requestedHackPct -= config.hackPctStep
    ) {
        const hackThreads = Math.max(1, Math.floor(requestedHackPct / hackPctPerThread));
        const actualHackPct = hackThreads * hackPctPerThread;
        if (!Number.isFinite(actualHackPct) || actualHackPct <= 0 || actualHackPct >= 0.9) {
            continue;
        }

        const hacked = { ...prepped };
        hacked.moneyAvailable = Math.max(1, prepped.moneyMax * (1 - actualHackPct));
        hacked.hackDifficulty = prepped.minDifficulty + ns.hackAnalyzeSecurity(hackThreads, target);

        const growThreadsRaw = ns.formulas.hacking.growThreads(hacked, player, prepped.moneyMax);
        if (!Number.isFinite(growThreadsRaw) || growThreadsRaw <= 0) {
            continue;
        }

        const growThreads = Math.ceil(growThreadsRaw);
        const weaken1Threads = Math.max(
            1,
            Math.ceil(ns.hackAnalyzeSecurity(hackThreads, target) / ns.weakenAnalyze(1))
        );
        const weaken2Threads = Math.max(
            1,
            Math.ceil(ns.growthAnalyzeSecurity(growThreads, target) / ns.weakenAnalyze(1))
        );

        const batchRam =
            hackThreads * ramCosts.hack +
            growThreads * ramCosts.grow +
            (weaken1Threads + weaken2Threads) * ramCosts.weaken;

        const maxConcurrent = Math.floor((availableRam * config.ramSafetyFactor) / batchRam);
        if (maxConcurrent < 1) continue;

        const cycleTime = weakenTime + config.batchGapMs * 4 + 50;
        const launchInterval = Math.max(
            config.batchGapMs,
            Math.ceil(cycleTime / maxConcurrent)
        );
        const expectedMoneyPerBatch = prepped.moneyMax * actualHackPct * chance;
        const incomePerSecond = expectedMoneyPerBatch / (launchInterval / 1000);

        const plan = {
            ok: true,
            hackPct: actualHackPct,
            chance,
            hackThreads,
            growThreads,
            weaken1Threads,
            weaken2Threads,
            batchRam,
            launchInterval,
            cycleTime,
            incomePerSecond,
            // Completion order is H -> W1 -> G -> W2.
            delays: {
                hack: Math.max(0, weakenTime - hackTime),
                weaken1: config.batchGapMs,
                grow: Math.max(0, weakenTime + config.batchGapMs * 2 - growTime),
                weaken2: config.batchGapMs * 3,
            },
        };

        if (!best || plan.incomePerSecond > best.incomePerSecond) {
            best = plan;
        }
    }

    return best ?? { ok: false };
}

async function prepTarget(ns, workers, target, ramCosts, config) {
    const start = Date.now();

    while (Date.now() - start < config.prepTimeoutMs) {
        const stats = getTargetStats(ns, target);
        if (
            stats.moneyPct >= config.prepMoneyPct * 100 &&
            stats.secDiff <= config.prepSecDiff
        ) {
            return true;
        }

        if (stats.secDiff > config.prepSecDiff) {
            const weakenThreads = Math.floor(
                (getTotalUsableRam(workers) * config.ramSafetyFactor) / ramCosts.weaken
            );
            if (weakenThreads <= 0) {
                await ns.sleep(1_000);
                continue;
            }

            dispatchSingleJob(
                ns,
                workers,
                "weaken.js",
                weakenThreads,
                ramCosts.weaken,
                target,
                0,
                `${CONTROLLER_NAME}:prep-w:${Date.now()}`
            );
            await ns.sleep(ns.getWeakenTime(target) + 250);
            continue;
        }

        const prepPlan = buildPrepGrowPlan(ns, target, getTotalUsableRam(workers), ramCosts, config);
        if (!prepPlan.ok) {
            await ns.sleep(1_000);
            continue;
        }

        dispatchSingleJob(
            ns,
            workers,
            "weaken.js",
            prepPlan.weakenThreads,
            ramCosts.weaken,
            target,
            0,
            `${CONTROLLER_NAME}:prep-gw:${Date.now()}`
        );

        dispatchSingleJob(
            ns,
            workers,
            "grow.js",
            prepPlan.growThreads,
            ramCosts.grow,
            target,
            prepPlan.growDelay,
            `${CONTROLLER_NAME}:prep-g:${Date.now()}`
        );

        await ns.sleep(ns.getWeakenTime(target) + config.batchGapMs * 3);
    }

    ns.tprint(`Prep timeout -> ${target}`);
    return false;
}

function buildPrepGrowPlan(ns, target, availableRam, ramCosts, config) {
    const player = ns.getPlayer();
    const current = ns.getServer(target);
    current.moneyAvailable = Math.max(1, current.moneyAvailable);

    let growThreads = Math.ceil(
        ns.formulas.hacking.growThreads(current, player, current.moneyMax)
    );
    if (!Number.isFinite(growThreads) || growThreads <= 0) {
        return { ok: false };
    }

    const weakenEffect = ns.weakenAnalyze(1);
    const weakenTime = ns.formulas.hacking.weakenTime(getPreppedServer(ns, target), player);
    const growTime = ns.formulas.hacking.growTime(getPreppedServer(ns, target), player);
    let weakenThreads = Math.ceil(
        ns.growthAnalyzeSecurity(growThreads, target) / weakenEffect
    );

    while (growThreads > 0) {
        const ramNeed = growThreads * ramCosts.grow + weakenThreads * ramCosts.weaken;
        if (ramNeed <= availableRam * config.ramSafetyFactor) {
            return {
                ok: true,
                growThreads,
                weakenThreads,
                growDelay: Math.max(0, weakenTime - growTime - config.batchGapMs),
            };
        }

        growThreads = Math.floor(growThreads * 0.90);
        if (growThreads <= 0) break;
        weakenThreads = Math.ceil(
            ns.growthAnalyzeSecurity(growThreads, target) / weakenEffect
        );
    }

    return { ok: false };
}

function dispatchBatch(ns, workers, target, plan, tagBase, batchOffset, ramCosts) {
    const hack = dispatchSingleJob(
        ns,
        workers,
        "hack.js",
        plan.hackThreads,
        ramCosts.hack,
        target,
        batchOffset + plan.delays.hack,
        `${tagBase}:h`
    );
    const weaken1 = dispatchSingleJob(
        ns,
        workers,
        "weaken.js",
        plan.weaken1Threads,
        ramCosts.weaken,
        target,
        batchOffset + plan.delays.weaken1,
        `${tagBase}:w1`
    );
    const grow = dispatchSingleJob(
        ns,
        workers,
        "grow.js",
        plan.growThreads,
        ramCosts.grow,
        target,
        batchOffset + plan.delays.grow,
        `${tagBase}:g`
    );
    const weaken2 = dispatchSingleJob(
        ns,
        workers,
        "weaken.js",
        plan.weaken2Threads,
        ramCosts.weaken,
        target,
        batchOffset + plan.delays.weaken2,
        `${tagBase}:w2`
    );

    return {
        complete:
            hack.scheduled === plan.hackThreads &&
            grow.scheduled === plan.growThreads &&
            weaken1.scheduled === plan.weaken1Threads &&
            weaken2.scheduled === plan.weaken2Threads,
        hack: hack.scheduled,
        grow: grow.scheduled,
        weaken1: weaken1.scheduled,
        weaken2: weaken2.scheduled,
    };
}

function dispatchSingleJob(ns, workers, file, threads, ramPerThread, target, delay, tag) {
    let remaining = threads;
    let scheduled = 0;
    const eligible = workers.filter(worker => Math.floor(getWorkerFreeRam(ns, worker) / ramPerThread) > 0);

    if (eligible.length === 0) {
        return { scheduled, requested: threads };
    }

    const firstPassCap = Math.max(1, Math.ceil(threads / eligible.length));

    for (const worker of eligible) {
        if (remaining <= 0) break;

        const capacity = Math.floor(getWorkerFreeRam(ns, worker) / ramPerThread);
        if (capacity <= 0) continue;

        const runThreads = Math.min(remaining, capacity, firstPassCap);
        const pid = ns.exec(file, worker.host, runThreads, target, delay, tag);
        if (pid === 0) continue;

        remaining -= runThreads;
        scheduled += runThreads;
    }

    for (const worker of eligible) {
        if (remaining <= 0) break;

        const capacity = Math.floor(getWorkerFreeRam(ns, worker) / ramPerThread);
        if (capacity <= 0) continue;

        const runThreads = Math.min(remaining, capacity);
        const pid = ns.exec(file, worker.host, runThreads, target, delay, tag);
        if (pid === 0) continue;

        remaining -= runThreads;
        scheduled += runThreads;
    }

    return { scheduled, requested: threads };
}

function rotateWorkers(workers, offset) {
    if (workers.length === 0) return workers;
    const index = ((offset % workers.length) + workers.length) % workers.length;
    if (index === 0) return workers;
    return workers.slice(index).concat(workers.slice(0, index));
}

function getMaxLaunchFailures(ns, target) {
    return Math.max(10, Math.ceil(ns.getWeakenTime(target) / 1000 * 1.2));
}

function maybePrintStatus(ns, config, snapshot, now, getLastStatusAt, setLastStatusAt) {
    if (now - getLastStatusAt() < config.statusIntervalMs) return;

    ns.clearLog();
    ns.print("===== FORMULAS BATCHER =====");
    ns.print(`Target      : ${snapshot.target}`);
    ns.print(`Money       : ${snapshot.moneyPct.toFixed(1)}%`);
    ns.print(`Security    : min + ${snapshot.secDiff.toFixed(2)}`);
    ns.print(`Chance      : ${(snapshot.chance * 100).toFixed(1)}%`);
    ns.print(`Free RAM    : ${ns.formatRam(snapshot.freeRam, 2)} / ${ns.formatRam(snapshot.usableRam, 2)}`);
    ns.print(`Since Prep  : ${snapshot.batchesSincePrep}`);
    if (snapshot.batchPlan?.ok) {
        ns.print(
            `Plan        : HWGW ${(snapshot.batchPlan.hackPct * 100).toFixed(2)}% every ${Math.round(snapshot.batchPlan.launchInterval)}ms`
        );
    }
    ns.print(`Action      : ${snapshot.action}`);
    if (config.debugTargets && snapshot.debug?.length > 0) {
        for (const line of snapshot.debug) {
            ns.print(line);
        }
    }

    writeStatus(ns, STATUS_NAMES.formulas, {
        target: snapshot.target,
        action: snapshot.action,
        moneyPct: snapshot.moneyPct,
        secDiff: snapshot.secDiff,
        chance: snapshot.chance,
        freeRam: snapshot.freeRam,
        usableRam: snapshot.usableRam,
        batchesSincePrep: snapshot.batchesSincePrep,
        batchPlan: snapshot.batchPlan?.ok
            ? {
                hackPct: snapshot.batchPlan.hackPct,
                launchInterval: snapshot.batchPlan.launchInterval,
                batchRam: snapshot.batchPlan.batchRam,
            }
            : null,
    });

    setLastStatusAt(now);
}

function pushDebugReject(config, rejected, host, reason) {
    if (!config.debugTargets) return;
    rejected.push(`${host} | ${reason}`);
}

function buildDebugLines(config, minMoneyThreshold, hackThreshold, ranked, rejected) {
    if (!config.debugTargets) return [];

    const lines = [
        `Debug       : minMoney=${formatCompactNumber(minMoneyThreshold)} | hackGate=${hackThreshold}`,
    ];

    if (ranked.length > 0) {
        lines.push("Accepted    :");
        for (const row of ranked.slice(0, config.debugLimit)) {
            lines.push(`  ${row.debug}`);
        }
    } else {
        lines.push("Accepted    : none");
    }

    if (rejected.length > 0) {
        lines.push("Rejected    :");
        for (const row of rejected.slice(0, config.debugLimit)) {
            lines.push(`  ${row}`);
        }
    }

    return lines;
}

function formatCompactNumber(value) {
    if (value >= 1e9) return `${(value / 1e9).toFixed(3)}b`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(3)}m`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(3)}k`;
    return String(Math.round(value));
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

function getTotalUsableRam(workers) {
    let total = 0;
    for (const worker of workers) {
        total += worker.usableRam;
    }
    return total;
}
