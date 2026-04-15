import { loadOptions } from "/MarvOS/lib/options.js";
import { getProgressSnapshot } from "/MarvOS/lib/progression.js";
import { clearStatus, STATUS_NAMES, writeStatus } from "/MarvOS/lib/status.js";

const SCRIPTS = {
    startup: "/startup.js",
    money: "/formulas-batcher.js",
    xp: "/xp-grind.js",
    rep: "/rep-share.js",
    stock: "/stock-trader.js",
};

const DEFAULT_OPTIONS = {
    rootScript: "/rootall.js",
    buyScript: "/buyservers.js",
    xpTarget: "",
    formulasDebug: false,
    homeReserve: 32,
    shareHome: false,
    sharePurchased: false,
    shareReserve: 32,
    helper: true,
    autoMode: true,
    selectedMode: "money",
    autoTor: true,
    autoTrade: false,
};

/** @param {NS} ns */
export async function main(ns) {
    const flags = ns.flags([
        ["interval", 3000],
    ]);

    ns.disableLog("ALL");
    ns.atExit(() => clearStatus(ns, STATUS_NAMES.orchestrator));

    let lastMode = "";

    while (true) {
        const options = loadOptions(ns, DEFAULT_OPTIONS);
        maybeBuyTor(ns, options);
        maybeRunBuyScript(ns, options);
        const progress = getProgressSnapshot(ns);
        const decision = resolveMode(ns, options, progress);

        if (decision.mode !== lastMode) {
            ns.tprint(`MarvOS MODE -> ${decision.mode.toUpperCase()} | ${decision.reason}`);
            lastMode = decision.mode;
        }

        applyMode(ns, options, decision.mode);
        applyStockMode(ns, options, progress);
        writeStatus(ns, STATUS_NAMES.orchestrator, {
            mode: decision.mode,
            requestedMode: options.autoMode ? "auto" : options.selectedMode,
            autoMode: options.autoMode,
            reason: decision.reason,
            recommendation: progress.recommendation,
            hacking: progress.hacking,
            nextHackGoal: progress.nextHackGoal,
            running: getRunningModes(ns),
            stockReady: progress.stock.autoTradeReady,
            stockLevel: progress.stock.level,
        });

        await ns.sleep(Math.max(1000, Number(flags.interval) || 3000));
    }
}

function maybeBuyTor(ns, options) {
    if (!options.autoTor) return;
    const player = ns.getPlayer();
    if (Boolean(player.tor) || Boolean(player.hasTorRouter)) return;

    try {
        ns.singularity.purchaseTor();
    } catch {
        // Ignore when Singularity access is unavailable.
    }
}

function maybeRunBuyScript(ns, options) {
    const script = normalizeScriptPath(options.buyScript);
    if (!script) return;
    if (!ns.fileExists(script, "home")) return;
    if (ns.isRunning(script, "home")) return;
    ns.exec(script, "home", 1);
}

function resolveMode(ns, options, progress) {
    if (!options.autoMode) {
        const requested = normalizeMode(options.selectedMode);
        if ((requested === "money" || requested === "rep") && !progress.formulas) {
            return {
                mode: "startup",
                reason: "Manual money/rep mode requested but Formulas.exe is missing",
            };
        }
        return {
            mode: requested,
            reason: `Manual mode: ${requested}`,
        };
    }

    if (progress.suggestedMode === "startup") {
        return {
            mode: "startup",
            reason: progress.suggestionReason,
        };
    }

    if (progress.suggestedMode === "xp") {
        return {
            mode: "xp",
            reason: progress.suggestionReason,
        };
    }

    return {
        mode: "money",
        reason: progress.suggestionReason,
    };
}

function applyMode(ns, options, mode) {
    switch (mode) {
        case "startup":
            ensureRunning(ns, SCRIPTS.startup, buildStartupArgs(options));
            ensureStopped(ns, SCRIPTS.money);
            ensureStopped(ns, SCRIPTS.xp);
            ensureStopped(ns, SCRIPTS.rep);
            break;
        case "xp":
            ensureStopped(ns, SCRIPTS.startup);
            ensureStopped(ns, SCRIPTS.money);
            ensureRunning(ns, SCRIPTS.xp, buildXpArgs(options));
            ensureStopped(ns, SCRIPTS.rep);
            break;
        case "rep":
            ensureStopped(ns, SCRIPTS.startup);
            ensureStopped(ns, SCRIPTS.xp);
            ensureRunning(ns, SCRIPTS.money, buildMoneyArgs(options));
            ensureRunning(ns, SCRIPTS.rep, buildRepArgs(options));
            break;
        case "money":
        default:
            ensureStopped(ns, SCRIPTS.startup);
            ensureStopped(ns, SCRIPTS.xp);
            ensureRunning(ns, SCRIPTS.money, buildMoneyArgs(options));
            ensureStopped(ns, SCRIPTS.rep);
            break;
    }
}

function applyStockMode(ns, options, progress) {
    if (!options.autoTrade || !progress.stock.autoTradeReady) {
        ensureStopped(ns, SCRIPTS.stock);
        return;
    }

    ensureRunning(ns, SCRIPTS.stock, []);
}

function ensureRunning(ns, script, args) {
    const proc = findProcess(ns, script);
    if (proc) return;
    if (!ns.fileExists(script, "home")) return;
    ns.exec(script, "home", 1, ...args);
}

function ensureStopped(ns, script) {
    for (const proc of ns.ps("home")) {
        if (matchesScript(proc.filename, script)) {
            ns.kill(proc.pid);
        }
    }
}

function findProcess(ns, script) {
    return ns.ps("home").find((proc) => matchesScript(proc.filename, script));
}

function buildStartupArgs(options) {
    return [
        "--root-script",
        normalizeScriptPath(options.rootScript),
        "--home-reserve",
        String(options.homeReserve),
    ];
}

function buildMoneyArgs(options) {
    const args = [];
    if (options.formulasDebug) args.push("--debug-targets");
    return args;
}

function buildXpArgs(options) {
    const args = [];
    if (options.xpTarget) args.push("--target", options.xpTarget);
    args.push("--home-reserve", String(options.homeReserve));
    return args;
}

function buildRepArgs(options) {
    const args = ["--reserve", String(options.shareReserve)];
    if (options.shareHome) args.push("--home");
    if (options.sharePurchased) args.push("--purchased");
    return args;
}

function getRunningModes(ns) {
    return {
        startup: Boolean(findProcess(ns, SCRIPTS.startup)),
        money: Boolean(findProcess(ns, SCRIPTS.money)),
        xp: Boolean(findProcess(ns, SCRIPTS.xp)),
        rep: Boolean(findProcess(ns, SCRIPTS.rep)),
        stock: Boolean(findProcess(ns, SCRIPTS.stock)),
    };
}

function normalizeMode(mode) {
    return ["startup", "money", "xp", "rep"].includes(mode) ? mode : "money";
}

function normalizeScriptPath(script) {
    if (!script) return "";
    return script.startsWith("/") ? script : `/${script}`;
}

function matchesScript(actual, expected) {
    const normalized = normalizeScriptPath(expected);
    return actual === normalized || actual === normalized.slice(1);
}
