const PORT_OPENERS = [
    "BruteSSH.exe",
    "FTPCrack.exe",
    "relaySMTP.exe",
    "HTTPWorm.exe",
    "SQLInject.exe",
];

const MILESTONES = [
    { name: "CSEC", faction: "CyberSec" },
    { name: "avmnite-02h", faction: "NiteSec" },
    { name: "I.I.I.I", faction: "The Black Hand" },
    { name: "run4theh111z", faction: "BitRunners" },
    { name: "fulcrumassets", faction: "Fulcrum Secret Technologies" },
];

/** @param {NS} ns */
export function getProgressSnapshot(ns) {
    const player = ns.getPlayer();
    const portOpeners = PORT_OPENERS.filter((file) => ns.fileExists(file, "home")).length;
    const milestones = MILESTONES.map((item) => {
        const exists = serverExists(ns, item.name);
        const server = exists ? ns.getServer(item.name) : null;
        return {
            ...item,
            exists,
            requiredHack: server?.requiredHackingSkill ?? null,
            rooted: Boolean(server?.hasAdminRights),
            backdoored: Boolean(server?.backdoorInstalled),
            joined: player.factions.includes(item.faction),
        };
    });

    const modePlan = planSuggestedMode(ns, player, milestones);

    return {
        hacking: ns.getHackingLevel(),
        money: ns.getServerMoneyAvailable("home"),
        factions: player.factions,
        tor: hasTorRouter(ns, player),
        formulas: ns.fileExists("Formulas.exe", "home"),
        portOpeners,
        stock: getStockState(ns),
        milestones,
        suggestedMode: modePlan.mode,
        suggestionReason: modePlan.reason,
        nextHackGoal: modePlan.nextHackGoal ?? null,
        recommendation: modePlan.recommendation,
    };
}

function planSuggestedMode(ns, player, milestones) {
    if (!ns.fileExists("Formulas.exe", "home")) {
        return {
            mode: "startup",
            reason: "Formulas.exe missing",
            recommendation: "Rebuy Formulas.exe and hand control back to formulas-batcher.",
        };
    }

    const bitrunners = milestones.find((m) => m.name === "run4theh111z");
    if (bitrunners && !bitrunners.joined) {
        if (!bitrunners.rooted) {
            return {
                mode: "money",
                reason: "BitRunners server not rooted yet",
                recommendation: "Root run4theh111z, then connect and backdoor it.",
            };
        }
        if (!bitrunners.backdoored) {
            if ((bitrunners.requiredHack ?? Infinity) > ns.getHackingLevel()) {
                return {
                    mode: "xp",
                    reason: `Need ${bitrunners.requiredHack} hacking for run4theh111z`,
                    nextHackGoal: bitrunners.requiredHack,
                    recommendation: `Grind hacking XP to ${bitrunners.requiredHack} for run4theh111z.`,
                };
            }
            return {
                mode: "money",
                reason: "Ready to backdoor run4theh111z",
                recommendation: "Connect to run4theh111z and install the backdoor.",
            };
        }
        return {
            mode: "money",
            reason: "BitRunners invite should be available",
            recommendation: "Check messages and join BitRunners.",
        };
    }

    if (!player.factions.includes("Sector-12")) {
        return {
            mode: "money",
            reason: "Still progressing city factions",
            recommendation: "Travel/join Sector-12 if you still need its augmentation line.",
        };
    }

    return {
        mode: "money",
        reason: "Mainline progression favors money now",
        recommendation: "Push faction rep and buy a stronger augment package before the next install.",
    };
}

/** @param {NS} ns */
function serverExists(ns, target) {
    const seen = new Set(["home"]);
    const queue = ["home"];

    while (queue.length > 0) {
        const host = queue.shift();
        if (host === target) return true;
        for (const next of ns.scan(host)) {
            if (!seen.has(next)) {
                seen.add(next);
                queue.push(next);
            }
        }
    }

    return false;
}

function hasTorRouter(ns, player) {
    if (Boolean(player.tor) || Boolean(player.hasTorRouter)) return true;
    return serverExists(ns, "darkweb");
}

function getStockState(ns) {
    const stock = ns.stock;
    if (!stock) {
        return {
            wse: false,
            tix: false,
            fourSigma: false,
            fourSigmaApi: false,
            autoTradeReady: false,
            level: "none",
        };
    }

    let wse = false;
    let tix = false;
    let fourSigma = false;
    let fourSigmaApi = false;

    try { wse = stock.hasWSEAccount(); } catch {}
    try { tix = stock.hasTIXAPIAccess(); } catch {}
    try { fourSigma = stock.has4SData(); } catch {}
    try { fourSigmaApi = stock.has4SDataTIXAPI(); } catch {}

    let level = "none";
    if (wse && !tix) level = "manual";
    if (wse && tix && !fourSigmaApi) level = "pre-4s";
    if (wse && tix && fourSigmaApi) level = "4s";

    return {
        wse,
        tix,
        fourSigma,
        fourSigmaApi,
        autoTradeReady: wse && tix,
        level,
    };
}
