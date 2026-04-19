const ENGINE_SCRIPTS = [
    "/MarvOS/orchestrator.js",
    "/startup.js",
    "/formulas-batcher.js",
    "/xp-grind.js",
    "/hacknet-manager.js",
    "/rep-share.js",
    "/stock-trader.js",
    "/buyservers.js",
    "/MarvOS/extras/serverRun.js",
];

const UI_SCRIPTS = [
    "/MarvOS/ui/MarvOS.jsx",
    "/MarvOSBeta/ui/MarvOSBeta.jsx",
    "/MarvOS/Loader.js",
    "/MarvOSBeta/Loader.js",
];

const WORKER_SCRIPTS = [
    "hack.js",
    "grow.js",
    "weaken.js",
    "share-worker.js",
];

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
export function stopManagedRuntime(ns, options = {}) {
    const includeUi = Boolean(options.includeUi);
    const excludePid = Number(options.excludePid) || 0;
    const scripts = includeUi ? [...ENGINE_SCRIPTS, ...UI_SCRIPTS] : ENGINE_SCRIPTS;
    let stopped = 0;

    for (const proc of ns.ps("home")) {
        if (excludePid > 0 && proc.pid === excludePid) continue;
        if (scripts.some((script) => matchesScript(proc.filename, script))) {
            if (ns.kill(proc.pid)) stopped += 1;
        }
    }

    for (const host of discoverHosts(ns)) {
        if (!ns.hasRootAccess(host)) continue;
        for (const script of WORKER_SCRIPTS) {
            if (ns.scriptKill(script, host)) stopped += 1;
        }
    }

    return stopped;
}

/** @param {NS} ns */
export function isScriptRunningOnHome(ns, script) {
    return ns.ps("home").some((proc) => matchesScript(proc.filename, script));
}

function matchesScript(actual, expected) {
    const normalized = expected.startsWith("/") ? expected : `/${expected}`;
    return actual === normalized || actual === normalized.slice(1);
}
