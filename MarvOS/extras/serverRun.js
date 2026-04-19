const WORKER_FILES = ["hack.js", "grow.js", "weaken.js"];
const THREAD_RAM = 1.75;

let servers = [];
let chunkSwitch = true;
let logging = false;
let maxRamSeen = 0;
let homeReserve = 32;

/** @param {NS} ns */
export async function main(ns) {
    logging = Boolean(ns.args[0]);
    const target = String(ns.args[1] ?? "");
    const w1 = Math.max(0, Number(ns.args[2]) || 0);
    const g1 = Math.max(0, Number(ns.args[3]) || 0);
    const w2 = Math.max(0, Number(ns.args[4]) || 0);
    const h1 = Math.max(0, Number(ns.args[5]) || 0);
    const w3 = Math.max(0, Number(ns.args[6]) || 0);
    const g2 = Math.max(0, Number(ns.args[7]) || 0);
    const w4 = Math.max(0, Number(ns.args[8]) || 0);
    const batchH1 = Math.max(0, Number(ns.args[9]) || 0);
    const batchW1 = Math.max(0, Number(ns.args[10]) || 0);
    const batchG1 = Math.max(0, Number(ns.args[11]) || 0);
    const batchW2 = Math.max(0, Number(ns.args[12]) || 0);
    const batches = Math.max(0, Number(ns.args[13]) || 0);
    const useHacknet = Boolean(ns.args[14]);
    homeReserve = Math.max(0, Number(ns.args[15]) || 32);
    const outputFile = String(ns.args[16] ?? "");

    if (!target || !outputFile) return;

    servers = getServers(ns, useHacknet);
    const hackTime = ns.getHackTime(target);
    const growTime = ns.getGrowTime(target);
    const weakenTime = ns.getWeakenTime(target);
    const startedAt = Date.now();
    let waitTime = w1 + w2 + w3 + w4 > 0 ? weakenTime : growTime;
    let recalc = false;
    chunkSwitch = true;

    let results = 0;
    const startTime = performance.now();
    if (w1) results = runItLocal(ns, "weaken.js", [target, 0, w1, false, useHacknet]);
    if (g1) results = runItLocal(ns, "grow.js", [target, waitTime - growTime, g1, chunkSwitch, useHacknet]);
    if (w2) results = runItLocal(ns, "weaken.js", [target, 0, w2, false, useHacknet]);
    if (h1) results = runItLocal(ns, "hack.js", [target, waitTime - hackTime, h1, chunkSwitch, useHacknet]);
    if (w3) results = runItLocal(ns, "weaken.js", [target, 0, w3, false, useHacknet]);
    if (g2) results = runItLocal(ns, "grow.js", [target, waitTime - growTime, g2, chunkSwitch, useHacknet]);
    if (w4) results = runItLocal(ns, "weaken.js", [target, 0, w4, false, useHacknet]);

    let batchesRun = 0;
    let sliceStart = performance.now();
    for (let i = 1; i <= Math.min(batches, 99999); i += 1) {
        if (startTime + weakenTime <= performance.now()) {
            recalc = true;
            break;
        }
        if (i === 99999) recalc = true;

        batchesRun += 1;
        if (batchH1) results = runItLocal(ns, "hack.js", [target, weakenTime - hackTime, batchH1, chunkSwitch, useHacknet]);
        if (batchW1) results = runItLocal(ns, "weaken.js", [target, 0, batchW1, false, useHacknet]);
        if (batchG1) results = runItLocal(ns, "grow.js", [target, weakenTime - growTime, batchG1, chunkSwitch, useHacknet]);
        if (batchW2) results = runItLocal(ns, "weaken.js", [target, 0, batchW2, false, useHacknet]);

        if (performance.now() - sliceStart >= 200) {
            sliceStart = performance.now();
            await ns.sleep(0);
        }
    }

    const record = {
        lastpid: results,
        recalc,
        batches: batchesRun,
        batching: chunkSwitch,
        startedAt,
        waitTime,
        weakenTime,
    };
    ns.write(outputFile, JSON.stringify(record), "w");
}

/** @param {NS} ns */
function runItLocal(ns, script, args) {
    const target = args[0];
    const sleepTime = args[1];
    let threads = args[2];
    const chunks = args[3];
    const useHacknet = args[4];
    let thisPid = 0;
    const remove = [];
    const helperRam = ns.getScriptRam("/MarvOS/extras/serverRun.js", "home");

    for (let i = 0; i < servers.length; i += 1) {
        const [server, rawFreeRam] = servers[i];
        if (server.startsWith("hacknet") && !useHacknet) continue;

        let freeRam = rawFreeRam;
        if (server === "home") {
            freeRam = Math.max(freeRam - homeReserve + helperRam, 0);
        }

        const threadsOnServer = Math.floor(freeRam / THREAD_RAM);
        if (threadsOnServer <= 0) {
            remove.push(server);
            continue;
        }

        if (chunks) {
            if (threadsOnServer >= threads) {
                thisPid = ns.exec(script, server, { threads, temporary: true }, target, Math.max(0, sleepTime), "QUIET");
                if (logging && thisPid === 0) ns.tprint(`Failed to run: ${script} on ${server} threads:${threads} target:${target}`);
                servers[i][1] -= threads * THREAD_RAM;
                threads = 0;
                break;
            }
        } else if (threadsOnServer >= threads) {
            thisPid = ns.exec(script, server, { threads, temporary: true }, target, Math.max(0, sleepTime), "QUIET");
            if (logging && thisPid === 0) ns.tprint(`Failed to run: ${script} on ${server} threads:${threads} target:${target}`);
            servers[i][1] -= threads * THREAD_RAM;
            threads = 0;
            break;
        } else {
            thisPid = ns.exec(script, server, { threads: threadsOnServer, temporary: true }, target, Math.max(0, sleepTime), "QUIET");
            if (logging && thisPid === 0) ns.tprint(`Failed to run: ${script} on ${server} threads:${threadsOnServer} target:${target}`);
            servers[i][1] -= threadsOnServer * THREAD_RAM;
            threads -= threadsOnServer;
            i = 0;
        }
    }

    if (threads > 0 && chunks) {
        chunkSwitch = false;
        thisPid = runItLocal(ns, script, [target, sleepTime, threads, false, useHacknet]);
    } else if (threads > 0 && logging) {
        ns.tprint(`Failed to allocate all ${script} threads. ${threads} left. Chunk: ${chunks}`);
    }

    servers = servers.filter(([host]) => !remove.includes(host));
    return thisPid;
}

/** @param {NS} ns */
function getServers(ns, useHacknet) {
    const serverList = new Set(["home"]);
    for (const server of serverList) {
        for (const connection of ns.scan(server)) {
            serverList.add(connection);
        }
    }

    const details = [];
    for (const host of serverList) {
        if (!ns.hasRootAccess(host) || ns.getServerMaxRam(host) <= 0) continue;
        if (host.startsWith("hacknet") && !useHacknet) continue;
        const missing = WORKER_FILES.some((file) => !ns.fileExists(file, host));
        if (host !== "home" && missing) {
            ns.scp(WORKER_FILES, host, "home");
        }
        const freeRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
        details.push([host, freeRam]);
        maxRamSeen = Math.max(maxRamSeen, freeRam);
    }

    details.sort((a, b) => a[1] - b[1]);
    return details;
}
