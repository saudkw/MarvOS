import { clearStatus, STATUS_NAMES, writeStatus } from "/MarvOS/lib/status.js";

const EARLY_WORKER = "/quack/early-hack.js";
const FORMULAS_CONTROLLER = "formulas-batcher.js";
const HACKNET_MANAGER = "hacknet-manager.js";
const WORKER_FILES = ["hack.js", "grow.js", "weaken.js"];
const ROOT_SCRIPT_CANDIDATES = [
    "rootall.js",
    "root-all.js",
    "nuke-all.js",
    "nuke.js",
];

/** @param {NS} ns */
export async function main(ns) {
    const options = ns.flags([
        ["root-script", ""],
        ["home-reserve", 24],
        ["retarget-interval", 60_000],
        ["status-interval", 15_000],
        ["root-interval", 60_000],
        ["min-money", 5_000_000],
        ["fallback-min-money", 500_000],
        ["hacknet", true],
    ]);

    ns.disableLog("ALL");
    ns.atExit(() => clearStatus(ns, STATUS_NAMES.startup));

    if (!ns.fileExists(EARLY_WORKER, "home")) {
        ns.tprint(`Missing ${EARLY_WORKER} on home`);
        return;
    }

    let currentTarget = "";
    let lastTargetAt = 0;
    let lastRootAt = 0;
    let lastStatusAt = 0;
    let lastWorkerKey = "";
    let lastAction = "starting";

    while (true) {
        maybeRunRooter(ns, options, Date.now(), () => lastRootAt, value => { lastRootAt = value; });
        maybeRunHacknet(ns, options.hacknet);

        if (canLaunchFormulasBatcher(ns)) {
            const workers = collectWorkers(ns, options["home-reserve"]);
            killEarlyWorkers(ns, workers);
            const pid = ns.run(FORMULAS_CONTROLLER, 1);
            if (pid > 0) {
                ns.tprint(`HANDOFF -> ${FORMULAS_CONTROLLER}`);
                return;
            }
            lastAction = `failed to start ${FORMULAS_CONTROLLER}`;
        }

        const workers = collectWorkers(ns, options["home-reserve"]);
        await syncEarlyWorker(ns, workers);

        const now = Date.now();
        const needsRetarget =
            !currentTarget ||
            now - lastTargetAt >= options["retarget-interval"] ||
            !isHealthyEnough(ns, currentTarget);

        if (needsRetarget) {
            const nextTarget = pickBestTarget(
                ns,
                options["min-money"],
                options["fallback-min-money"]
            );

            if (nextTarget && nextTarget !== currentTarget) {
                currentTarget = nextTarget;
                lastTargetAt = now;
                lastAction = `retargeted -> ${currentTarget}`;
                ns.tprint(`STARTUP TARGET -> ${currentTarget}`);
                killEarlyWorkers(ns, workers);
                deployEarlyWorkers(ns, workers, currentTarget, options["home-reserve"]);
                lastWorkerKey = workersKey(ns, workers, options["home-reserve"]);
            } else if (nextTarget) {
                currentTarget = nextTarget;
                lastTargetAt = now;
            }
        }

        const workerKey = workersKey(ns, workers, options["home-reserve"]);
        if (currentTarget && workerKey !== lastWorkerKey) {
            killEarlyWorkers(ns, workers);
            deployEarlyWorkers(ns, workers, currentTarget, options["home-reserve"]);
            lastWorkerKey = workerKey;
            lastAction = `redeployed -> ${currentTarget}`;
        }

        if (now - lastStatusAt >= options["status-interval"]) {
            const summary = summarizeDeployment(ns, workers, currentTarget);
            ns.clearLog();
            ns.print("===== STARTUP =====");
            ns.print(`Target      : ${currentTarget || "none"}`);
            ns.print(`Workers     : ${workers.length}`);
            ns.print(`Threads     : ${summary.threads}`);
            ns.print(`Servers     : ${summary.servers}`);
            ns.print(`Action      : ${lastAction}`);
            if (currentTarget) {
                const money = ns.getServerMoneyAvailable(currentTarget);
                const maxMoney = ns.getServerMaxMoney(currentTarget);
                const secDiff =
                    ns.getServerSecurityLevel(currentTarget) -
                    ns.getServerMinSecurityLevel(currentTarget);
                const moneyPct = maxMoney > 0 ? (100 * money) / maxMoney : 0;
                ns.print(`Money       : ${moneyPct.toFixed(1)}%`);
                ns.print(`Security    : min + ${secDiff.toFixed(2)}`);
                writeStatus(ns, STATUS_NAMES.startup, {
                    target: currentTarget,
                    action: lastAction,
                    workers: workers.length,
                    threads: summary.threads,
                    servers: summary.servers,
                    moneyPct,
                    secDiff,
                });
            } else {
                writeStatus(ns, STATUS_NAMES.startup, {
                    target: "none",
                    action: lastAction,
                    workers: workers.length,
                    threads: summary.threads,
                    servers: summary.servers,
                });
            }
            lastStatusAt = now;
        }

        await ns.sleep(5_000);
    }
}

function maybeRunRooter(ns, options, now, getLastRootAt, setLastRootAt) {
    if (now - getLastRootAt() < options["root-interval"]) return;

    const rootScript = findRootScript(ns, options["root-script"]);
    if (!rootScript) {
        setLastRootAt(now);
        return;
    }

    if (!ns.isRunning(rootScript, "home")) {
        ns.run(rootScript, 1);
    }

    setLastRootAt(now);
}

function maybeRunHacknet(ns, enabled) {
    if (!enabled) return;
    if (!ns.fileExists(HACKNET_MANAGER, "home")) return;
    if (!ns.isRunning(HACKNET_MANAGER, "home")) {
        ns.run(HACKNET_MANAGER, 1);
    }
}

function canLaunchFormulasBatcher(ns) {
    if (!ns.fileExists(FORMULAS_CONTROLLER, "home")) return false;
    if (!ns.fileExists("Formulas.exe", "home")) return false;
    if (ns.isRunning(FORMULAS_CONTROLLER, "home")) return false;

    for (const file of WORKER_FILES) {
        if (!ns.fileExists(file, "home")) return false;
    }

    return true;
}

function findRootScript(ns, preferred) {
    const names = preferred ? [preferred, ...ROOT_SCRIPT_CANDIDATES] : ROOT_SCRIPT_CANDIDATES;
    for (const name of names) {
        if (name && ns.fileExists(name, "home")) return name;
    }
    return "";
}

function collectWorkers(ns, homeReserve) {
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

    for (const host of ns.getPurchasedServers()) {
        seen.add(host);
    }

    return [...seen]
        .filter((host) => ns.hasRootAccess(host) && getUsableRam(ns, host, homeReserve) >= ns.getScriptRam(EARLY_WORKER, "home"))
        .sort((a, b) => getUsableRam(ns, b, homeReserve) - getUsableRam(ns, a, homeReserve));
}

async function syncEarlyWorker(ns, workers) {
    for (const host of workers) {
        if (host !== "home") {
            await ns.scp(EARLY_WORKER, host, "home");
        }
    }
}

function pickBestTarget(ns, minMoney, fallbackMinMoney) {
    const ranked = rankTargets(ns, minMoney);
    if (ranked.length > 0) return ranked[0].host;

    const fallback = rankTargets(ns, fallbackMinMoney);
    return fallback[0]?.host ?? "";
}

function rankTargets(ns, minMoney) {
    const seen = new Set(["home"]);
    const queue = ["home"];
    const purchased = new Set(ns.getPurchasedServers());
    const rows = [];
    const hackLevel = ns.getHackingLevel();

    while (queue.length > 0) {
        const host = queue.shift();
        for (const next of ns.scan(host)) {
            if (!seen.has(next)) {
                seen.add(next);
                queue.push(next);
            }
        }
    }

    for (const host of seen) {
        if (host === "home" || host === "darkweb") continue;
        if (purchased.has(host)) continue;
        if (!ns.hasRootAccess(host)) continue;

        const maxMoney = ns.getServerMaxMoney(host);
        if (maxMoney < minMoney) continue;

        const required = ns.getServerRequiredHackingLevel(host);
        if (required > hackLevel) continue;

        const chance = ns.hackAnalyzeChance(host);
        if (chance < 0.20) continue;

        const growth = Math.max(1, ns.getServerGrowth(host));
        const hackTime = Math.max(1, ns.getHackTime(host));
        const secDiff = Math.max(0, ns.getServerSecurityLevel(host) - ns.getServerMinSecurityLevel(host));
        const moneyPct = maxMoney > 0 ? ns.getServerMoneyAvailable(host) / maxMoney : 0;
        const healthPenalty = Math.max(0.2, moneyPct) * (1 / (1 + secDiff * 0.25));
        const levelFactor = Math.max(0.2, 1 - required / Math.max(1, hackLevel * 1.2));
        const score = (maxMoney * chance * growth * healthPenalty * levelFactor) / hackTime;

        rows.push({ host, score });
    }

    rows.sort((a, b) => b.score - a.score);
    return rows;
}

function deployEarlyWorkers(ns, workers, target, homeReserve) {
    for (const host of workers) {
        const threads = Math.floor(getFreeRam(ns, host, homeReserve) / ns.getScriptRam(EARLY_WORKER, "home"));
        if (threads <= 0) continue;
        ns.exec(EARLY_WORKER, host, threads, target);
    }
}

function killEarlyWorkers(ns, workers) {
    for (const host of workers) {
        ns.scriptKill(EARLY_WORKER, host);
    }
}

function summarizeDeployment(ns, workers, target) {
    let servers = 0;
    let threads = 0;

    for (const host of workers) {
        for (const proc of ns.ps(host)) {
            if (proc.filename !== EARLY_WORKER) continue;
            if (String(proc.args[0] ?? "") !== target) continue;
            servers += 1;
            threads += proc.threads;
        }
    }

    return { servers, threads };
}

function workersKey(ns, workers, homeReserve) {
    return workers
        .map((host) => `${host}:${Math.floor(getFreeRam(ns, host, homeReserve))}`)
        .join("|");
}

function getUsableRam(ns, host, homeReserve) {
    const max = ns.getServerMaxRam(host);
    if (host === "home") return Math.max(0, max - homeReserve);
    return max;
}

function getFreeRam(ns, host, homeReserve = 0) {
    const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
    if (host === "home") return Math.max(0, free - homeReserve);
    return Math.max(0, free);
}

function isHealthyEnough(ns, target) {
    if (!target) return false;
    const maxMoney = ns.getServerMaxMoney(target);
    if (maxMoney <= 0) return false;

    const moneyPct = ns.getServerMoneyAvailable(target) / maxMoney;
    const secDiff = ns.getServerSecurityLevel(target) - ns.getServerMinSecurityLevel(target);

    return moneyPct >= 0.35 && secDiff <= 10;
}
