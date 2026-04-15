/** @param {NS} ns */
export async function main(ns) {
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

    for (const host of seen) {
        if (host === "home") continue;
        if (ns.hasRootAccess(host)) continue;

        try { if (ns.fileExists("BruteSSH.exe", "home")) ns.brutessh(host); } catch {}
        try { if (ns.fileExists("FTPCrack.exe", "home")) ns.ftpcrack(host); } catch {}
        try { if (ns.fileExists("relaySMTP.exe", "home")) ns.relaysmtp(host); } catch {}
        try { if (ns.fileExists("HTTPWorm.exe", "home")) ns.httpworm(host); } catch {}
        try { if (ns.fileExists("SQLInject.exe", "home")) ns.sqlinject(host); } catch {}

        try { ns.nuke(host); } catch {}

        if (ns.hasRootAccess(host)) {
            ns.tprint(`ROOTED: ${host}`);
        }
    }
}