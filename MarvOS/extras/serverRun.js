import { getWorkerPool } from "/MarvOS/lib/money-core.js";

const CONTROLLER_NAME = "formulas-batcher";

/** @param {NS} ns */
export async function main(ns) {
    const target = String(ns.args[0] ?? "");
    const homeReserve = Math.max(0, Number(ns.args[1]) || 32);
    const useHacknet = Boolean(ns.args[2]);
    const logging = Boolean(ns.args[3]);
    const planJson = String(ns.args[4] ?? "");
    const outputFile = String(ns.args[5] ?? "");

    if (!target || !planJson || !outputFile) return;

    const plan = JSON.parse(planJson);
    const workers = getWorkerPool(ns, { homeReserve, useHacknet });
    const hackTime = ns.getHackTime(target);
    const growTime = ns.getGrowTime(target);
    const weakenTime = ns.getWeakenTime(target);
    const startedAt = Date.now();
    const hasPrepWeakens = plan.prep.W1 + plan.prep.W2 + plan.prep.W3 + plan.prep.W4 > 0;
    const waitTime = hasPrepWeakens ? weakenTime : (plan.prep.G1 + plan.prep.G2 > 0 ? growTime : weakenTime);

    let lastPid = 0;
    let chunking = true;

    if (plan.prep.W1) {
        const result = dispatchWork(ns, workers, "weaken.js", target, 0, plan.prep.W1, false, `${CONTROLLER_NAME}:prep:w1`, logging);
        lastPid = result.lastPid || lastPid;
    }
    if (plan.prep.G1) {
        const result = dispatchWork(ns, workers, "grow.js", target, waitTime - growTime, plan.prep.G1, chunking, `${CONTROLLER_NAME}:prep:g1`, logging);
        chunking = result.chunking;
        lastPid = result.lastPid || lastPid;
    }
    if (plan.prep.W2) {
        const result = dispatchWork(ns, workers, "weaken.js", target, 0, plan.prep.W2, false, `${CONTROLLER_NAME}:prep:w2`, logging);
        lastPid = result.lastPid || lastPid;
    }
    if (plan.prep.H1) {
        const result = dispatchWork(ns, workers, "hack.js", target, waitTime - hackTime, plan.prep.H1, chunking, `${CONTROLLER_NAME}:prep:h1`, logging);
        chunking = result.chunking;
        lastPid = result.lastPid || lastPid;
    }
    if (plan.prep.W3) {
        const result = dispatchWork(ns, workers, "weaken.js", target, 0, plan.prep.W3, false, `${CONTROLLER_NAME}:prep:w3`, logging);
        lastPid = result.lastPid || lastPid;
    }
    if (plan.prep.G2) {
        const result = dispatchWork(ns, workers, "grow.js", target, waitTime - growTime, plan.prep.G2, chunking, `${CONTROLLER_NAME}:prep:g2`, logging);
        chunking = result.chunking;
        lastPid = result.lastPid || lastPid;
    }
    if (plan.prep.W4) {
        const result = dispatchWork(ns, workers, "weaken.js", target, 0, plan.prep.W4, false, `${CONTROLLER_NAME}:prep:w4`, logging);
        lastPid = result.lastPid || lastPid;
    }

    let batchesRun = 0;
    let recalc = false;
    const deadline = performance.now() + weakenTime;
    let sliceStart = performance.now();

    for (let i = 0; i < plan.batchesTotal; i += 1) {
        if (performance.now() >= deadline) {
            recalc = true;
            break;
        }
        batchesRun += 1;

        if (plan.batchInfo.H1) {
            const result = dispatchWork(ns, workers, "hack.js", target, weakenTime - hackTime, plan.batchInfo.H1, chunking, `${CONTROLLER_NAME}:${Date.now()}:${i}:h`, logging);
            chunking = result.chunking;
            lastPid = result.lastPid || lastPid;
        }
        if (plan.batchInfo.W1) {
            const result = dispatchWork(ns, workers, "weaken.js", target, 0, plan.batchInfo.W1, false, `${CONTROLLER_NAME}:${Date.now()}:${i}:w1`, logging);
            lastPid = result.lastPid || lastPid;
        }
        if (plan.batchInfo.G1) {
            const result = dispatchWork(ns, workers, "grow.js", target, weakenTime - growTime, plan.batchInfo.G1, chunking, `${CONTROLLER_NAME}:${Date.now()}:${i}:g`, logging);
            chunking = result.chunking;
            lastPid = result.lastPid || lastPid;
        }
        if (plan.batchInfo.W2) {
            const result = dispatchWork(ns, workers, "weaken.js", target, 0, plan.batchInfo.W2, false, `${CONTROLLER_NAME}:${Date.now()}:${i}:w2`, logging);
            lastPid = result.lastPid || lastPid;
        }

        if (performance.now() - sliceStart >= 200) {
            sliceStart = performance.now();
            await ns.sleep(0);
        }
    }

    const result = {
        lastPid,
        startedAt,
        waitTime: Math.max(waitTime, weakenTime),
        weakenTime,
        recalc,
        batchesRun,
        batching: chunking,
        remainingThreads: Math.max(0, getTotalThreads(workers)),
    };

    ns.write(outputFile, JSON.stringify(result), "w");
}

function dispatchWork(ns, workers, script, target, delay, threads, requireChunk, tag, logging) {
    const scriptRam = ns.getScriptRam(script, "home");
    let remaining = Math.max(0, Math.floor(threads));
    let lastPid = 0;
    let chunking = requireChunk;
    const orderedWorkers = rotateWorkers(workers, tag);

    if (remaining <= 0) return { lastPid: 0, chunking };

    if (chunking && remaining <= 8) {
        for (const worker of orderedWorkers) {
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

    const eligibleWorkers = orderedWorkers.filter((worker) => Math.floor(worker.freeRam / scriptRam) > 0);
    if (eligibleWorkers.length > 1 && remaining > 1) {
        const share = Math.max(1, Math.ceil(remaining / eligibleWorkers.length));
        for (const worker of eligibleWorkers) {
            const availableThreads = Math.floor(worker.freeRam / scriptRam);
            if (availableThreads <= 0 || remaining <= 0) continue;
            const runThreads = Math.min(remaining, availableThreads, share);
            if (runThreads <= 0) continue;
            const pid = ns.exec(script, worker.host, runThreads, target, Math.max(0, delay), `${tag}:spread:${runThreads}`);
            if (pid === 0) {
                if (logging) ns.tprint(`Dispatch failed: ${script} on ${worker.host} t=${runThreads} target=${target}`);
                continue;
            }
            worker.freeRam -= runThreads * scriptRam;
            remaining -= runThreads;
            lastPid = pid;
        }
    }

    while (remaining > 0) {
        let progress = false;
        for (const worker of orderedWorkers) {
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

function getTotalThreads(workers) {
    return workers.reduce((sum, worker) => sum + Math.max(0, Math.floor(worker.freeRam / 1.75)), 0);
}

function rotateWorkers(workers, seed) {
    if (workers.length <= 1) return workers;
    const rotation = hashTag(seed) % workers.length;
    return workers.slice(rotation).concat(workers.slice(0, rotation));
}

function hashTag(tag) {
    let hash = 0;
    for (let i = 0; i < tag.length; i += 1) {
        hash = ((hash * 31) + tag.charCodeAt(i)) >>> 0;
    }
    return hash;
}
