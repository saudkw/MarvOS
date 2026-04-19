/** @param {NS} ns */
export async function main(ns) {
    const target = String(ns.args[0] ?? "");
    const delayRaw = Number(ns.args[1] ?? 0);

    if (!target) return;

    const delay = Number.isFinite(delayRaw) && delayRaw > 0 ? Math.floor(delayRaw) : 0;
    ns.disableLog("ALL");
    await ns.hack(target, { additionalMsec: delay });
}
