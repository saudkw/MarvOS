import { stopManagedRuntime } from "/MarvOS/lib/runtime.js";

/** @param {NS} ns */
export async function main(ns) {
    const ui = "/MarvOSBeta/ui/MarvOSBeta.jsx";
    stopManagedRuntime(ns, { includeUi: true, excludePid: ns.pid });
    await ns.sleep(50);

    const pid = ns.exec(ui, "home", 1);
    if (pid === 0) {
        ns.tprint(`Failed to start ${ui}`);
    }
}
