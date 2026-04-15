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
    buyMode: "passive",
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
        const progress = getProgressSnapshot(ns);
        const decision = resolveMode(ns, options, progress);

        if (decision.mode !== lastMode) {
            ns.tprint(`MarvOS MODE -> ${decision.mode.toUpperCase()} | ${decision.reason}`);
            lastMode = decision.mode;
        }

        const launchNotes = applyMode(ns, options, decision.mode);
        const stockNote = applyStockMode(ns, options, progress);
        maybeRunBuyScript(ns, options, decision.mode);
        writeStatus(ns, STATUS_NAMES.orchestrator, {
            mode: decision.mode,
            requestedMode: options.autoMode ? "auto" : options.selectedMode,
            autoMode: options.autoMode,
            reason: decision.reason,
            notes: [...launchNotes, ...(stockNote ? [stockNote] : [])],
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

function maybeRunBuyScript(ns, options, activeMode) {
    const script = normalizeScriptPath(options.buyScript);
    if (!script) return;
    if (!ns.fileExists(script, "home")) return;
    if (ns.isRunning(script, "home")) return;

    const requiredCore = getCoreScriptForMode(activeMode);
    if (requiredCore && !findProcess(ns, requiredCore)) return;

    const needed = ns.getScriptRam(script, "home");
    const free = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
    if (free < needed + 4) return;

    ns.exec(script, "home", 1, ...buildBuyArgs(options));
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
    const notes = [];
    switch (mode) {
        case "startup":
            notes.push(...ensureRunning(ns, SCRIPTS.startup, buildStartupArgs(options), "startup engine"));
            ensureStopped(ns, SCRIPTS.money);
            ensureStopped(ns, SCRIPTS.xp);
            ensureStopped(ns, SCRIPTS.rep);
            break;
        case "xp":
            ensureStopped(ns, SCRIPTS.startup);
            ensureStopped(ns, SCRIPTS.money);
            notes.push(...ensureRunning(ns, SCRIPTS.xp, buildXpArgs(options), "xp engine"));
            ensureStopped(ns, SCRIPTS.rep);
            break;
        case "rep":
            ensureStopped(ns, SCRIPTS.startup);
            ensureStopped(ns, SCRIPTS.xp);
            notes.push(...ensureRunning(ns, SCRIPTS.money, buildMoneyArgs(options), "money engine"));
            notes.push(...ensureRunning(ns, SCRIPTS.rep, buildRepArgs(options), "rep engine"));
            break;
        case "money":
        default:
            ensureStopped(ns, SCRIPTS.startup);
            ensureStopped(ns, SCRIPTS.xp);
            notes.push(...ensureRunning(ns, SCRIPTS.money, buildMoneyArgs(options), "money engine"));
            ensureStopped(ns, SCRIPTS.rep);
            break;
    }
    return notes;
}

function applyStockMode(ns, options, progress) {
    if (!options.autoTrade || !progress.stock.autoTradeReady) {
        ensureStopped(ns, SCRIPTS.stock);
        return "";
    }

    return ensureRunning(ns, SCRIPTS.stock, [], "stock trader").join(" | ");
}

function ensureRunning(ns, script, args, label) {
    const proc = findProcess(ns, script);
    if (proc) return [];
    if (!ns.fileExists(script, "home")) return [`missing ${label}: ${script}`];

    const pid = ns.exec(script, "home", 1, ...args);
    if (pid === 0) {
        const ram = ns.getScriptRam(script, "home");
        const free = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
        const message = `failed to start ${label} (${ns.formatRam(free, 2)} free / ${ns.formatRam(ram, 2)} needed)`;
        ns.tprint(`MarvOS: ${message}`);
        return [message];
    }

    return [];
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

function buildBuyArgs(options) {
    const args = ["--prefix", "MiniMarv-"];
    if (options.buyMode === "aggressive") {
        args.push("--budget-pct", "0.90", "--reserve", "50_000_000", "--interval", "12000", "--max-ops", "8");
    } else {
        args.push("--budget-pct", "0.25", "--reserve", "250_000_000", "--interval", "20000", "--max-ops", "1");
    }
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

function getCoreScriptForMode(mode) {
    switch (mode) {
        case "startup": return SCRIPTS.startup;
        case "xp": return SCRIPTS.xp;
        case "rep": return SCRIPTS.money;
        case "money":
        default:
            return SCRIPTS.money;
    }
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
