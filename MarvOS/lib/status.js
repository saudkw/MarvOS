export const STATUS_NAMES = {
    orchestrator: "marvos-orchestrator",
    formulas: "formulas-batcher",
    startup: "startup",
    xp: "xp-grind",
    hacknet: "hacknet-manager",
    stock: "stock-trader",
};

export const MARVOS_SOURCE_PATH = "/MarvOS/data/source.txt";

const BASE = "/MarvOS/data";

export function statusPath(name) {
    return `${BASE}/${name}-status.txt`;
}

/** @param {NS} ns */
export function writeStatus(ns, name, payload) {
    const record = {
        ...payload,
        updatedAt: Date.now(),
    };
    ns.write(statusPath(name), JSON.stringify(record), "w");
}

/** @param {NS} ns */
export function clearStatus(ns, name) {
    ns.write(statusPath(name), "", "w");
}

/** @param {NS} ns */
export function readStatus(ns, name) {
    const path = statusPath(name);
    if (!ns.fileExists(path, "home")) return null;
    const raw = ns.read(path).trim();
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}
