const SHARE_WORKER = "share-worker.js";

/** @param {NS} ns */
export async function main(ns) {
    const flags = ns.flags([
        ["home", false],
        ["purchased", false],
        ["reserve", 64],
        ["interval", 30_000],
    ]);

    if (!ns.fileExists(SHARE_WORKER, "home")) {
        ns.tprint(`Missing ${SHARE_WORKER} on home`);
        return;
    }

    ns.disableLog("ALL");

    while (true) {
        const workers = collectShareWorkers(ns, flags.home, flags.purchased, flags.reserve);
        await syncShareWorker(ns, workers);
        deployShare(ns, workers);
        renderStatus(ns, workers);
        await ns.sleep(flags.interval);
    }
}

function collectShareWorkers(ns, includeHome, includePurchased, homeReserve) {
    const purchased = new Set(ns.getPurchasedServers());
    const hosts = discoverHosts(ns);
    for (const host of purchased) {
        hosts.add(host);
    }

    const workers = [];
    for (const host of hosts) {
        if (!ns.hasRootAccess(host)) continue;
        if (!includeHome && host === "home") continue;
        if (!includePurchased && purchased.has(host)) continue;

        const maxRam = ns.getServerMaxRam(host);
        if (maxRam <= 0) continue;

        const reserve = host === "home" ? homeReserve : 0;
        const usableRam = Math.max(0, maxRam - reserve);
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

async function syncShareWorker(ns, workers) {
    for (const worker of workers) {
        if (worker.host !== "home") {
            await ns.scp(SHARE_WORKER, worker.host, "home");
        }
    }
}

function deployShare(ns, workers) {
    const ramPerThread = ns.getScriptRam(SHARE_WORKER, "home");

    for (const worker of workers) {
        ns.scriptKill(SHARE_WORKER, worker.host);

        const freeRam = Math.max(0, worker.usableRam - ns.getServerUsedRam(worker.host));
        const threads = Math.floor(freeRam / ramPerThread);
        if (threads <= 0) continue;

        ns.exec(SHARE_WORKER, worker.host, threads, "rep-share");
    }
}

function renderStatus(ns, workers) {
    ns.clearLog();
    ns.print("===== REP SHARE =====");
    ns.print(`Workers     : ${workers.length}`);
    ns.print(`Share Power : ${ns.getSharePower().toFixed(3)}`);
    ns.print(`Script      : ${SHARE_WORKER}`);
}
