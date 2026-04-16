/** @param {NS} ns */
export async function main(ns) {
    const ui = "/MarvOSBeta/ui/MarvOSBeta.jsx";
    killIfRunning(ns, "/MarvOS/ui/MarvOS.jsx");
    killIfRunning(ns, ui);
    await ns.sleep(50);

    const pid = ns.exec(ui, "home", 1);
    if (pid === 0) {
        ns.tprint(`Failed to start ${ui}`);
    }
}

function killIfRunning(ns, script) {
    const running = ns.ps("home").find((proc) => proc.filename === script || proc.filename === script.slice(1));
    if (running) {
        ns.kill(running.pid);
    }
}
