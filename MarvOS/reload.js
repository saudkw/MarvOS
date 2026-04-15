const OS_SCRIPTS = [
    "/MarvOS/ui/MarvOS.jsx",
    "/MarvOS/orchestrator.js",
];

const ENGINE_SCRIPTS = [
    "/startup.js",
    "/formulas-batcher.js",
    "/xp-grind.js",
    "/hacknet-manager.js",
    "/rep-share.js",
    "/stock-trader.js",
];

/** @param {NS} ns */
export async function main(ns) {
    const flags = ns.flags([
        ["full", false],
        ["delay", 100],
    ]);

    const targets = flags.full ? [...OS_SCRIPTS, ...ENGINE_SCRIPTS] : OS_SCRIPTS;
    let stopped = 0;

    for (const proc of ns.ps("home")) {
        if (targets.some((script) => matchesScript(proc.filename, script))) {
            ns.kill(proc.pid);
            stopped += 1;
        }
    }

    const delay = Math.max(0, Math.floor(Number(flags.delay) || 0));
    ns.tprint(`[MarvOS] Reloading${flags.full ? " (full)" : ""}; stopped ${stopped} script${stopped === 1 ? "" : "s"}`);
    if (delay > 0) await ns.sleep(delay);

    ns.spawn("/MarvOS/Loader.js", 1);
}

function matchesScript(actual, expected) {
    return actual === expected || actual === expected.slice(1);
}
