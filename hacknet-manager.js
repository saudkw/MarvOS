import { clearStatus, STATUS_NAMES, writeStatus } from "/MarvOS/lib/status.js";

/** @param {NS} ns */
export async function main(ns) {
    const options = ns.flags([
        ["reserve", 50_000_000],
        ["budget-pct", 0.10],
        ["max-payoff", 7_200],
        ["interval", 5_000],
        ["status-interval", 30_000],
        ["max-actions", 20],
    ]);

    ns.disableLog("ALL");
    ns.atExit(() => clearStatus(ns, STATUS_NAMES.hacknet));

    let lastStatusAt = 0;
    let lastAction = "none";

    while (true) {
        let actionsThisCycle = 0;

        while (actionsThisCycle < options["max-actions"]) {
            const budget = getSpendBudget(ns, options.reserve, options["budget-pct"]);
            if (budget <= 0) break;

            const best = findBestAction(ns, budget, options["max-payoff"]);
            if (!best) break;

            const success = executeAction(ns, best);
            if (!success) break;

            lastAction = `${best.label} | cost=${ns.formatNumber(best.cost, 2)} | payoff=${formatSeconds(best.payoffSeconds)}`;
            actionsThisCycle += 1;
        }

        if (Date.now() - lastStatusAt >= options["status-interval"]) {
            const budget = getSpendBudget(ns, options.reserve, options["budget-pct"]);
            const next = findBestAction(ns, budget, options["max-payoff"]);
            const summary = summarizeFarm(ns);

            ns.clearLog();
            ns.print("===== HACKNET MANAGER =====");
            ns.print(`Nodes        : ${summary.nodes}/${ns.hacknet.maxNumNodes()}`);
            ns.print(`Production   : ${ns.formatNumber(summary.production, 2)}/s`);
            ns.print(`Available    : ${ns.formatNumber(summary.money, 2)}`);
            ns.print(`Spend budget : ${ns.formatNumber(budget, 2)}`);
            ns.print(`Last action  : ${lastAction}`);
            ns.print(`Next action  : ${next ? `${next.label} | cost=${ns.formatNumber(next.cost, 2)} | payoff=${formatSeconds(next.payoffSeconds)}` : "none worth buying"}`);
            writeStatus(ns, STATUS_NAMES.hacknet, {
                target: "hacknet",
                action: lastAction,
                nodes: summary.nodes,
                production: summary.production,
                money: summary.money,
                budget,
                nextAction: next ? next.label : "",
            });
            lastStatusAt = Date.now();
        }

        await ns.sleep(options.interval);
    }
}

function getSpendBudget(ns, reserve, budgetPct) {
    const money = ns.getServerMoneyAvailable("home");
    const spendable = Math.max(0, money - Math.max(0, reserve));
    return Math.min(spendable, money * clamp(budgetPct, 0.01, 1));
}

function findBestAction(ns, budget, maxPayoffSeconds) {
    const candidates = [];
    const productionMult = getProductionMultiplier(ns);
    const nodes = ns.hacknet.numNodes();

    const purchaseCost = ns.hacknet.getPurchaseNodeCost();
    if (nodes < ns.hacknet.maxNumNodes() && Number.isFinite(purchaseCost) && purchaseCost > 0) {
        const delta = estimateNodeProduction(ns, 1, 1, 1, productionMult);
        pushCandidate(candidates, {
            kind: "purchase",
            node: -1,
            cost: purchaseCost,
            deltaProduction: delta,
            label: "buy node",
        });
    }

    for (let i = 0; i < nodes; i++) {
        const stats = ns.hacknet.getNodeStats(i);
        const current = Math.max(0, stats.production);

        const levelCost = ns.hacknet.getLevelUpgradeCost(i, 1);
        if (Number.isFinite(levelCost) && levelCost > 0) {
            const next = estimateNodeProduction(ns, stats.level + 1, stats.ram, stats.cores, productionMult);
            pushCandidate(candidates, {
                kind: "level",
                node: i,
                cost: levelCost,
                deltaProduction: Math.max(0, next - current),
                label: `node ${i} level -> ${stats.level + 1}`,
            });
        }

        const ramCost = ns.hacknet.getRamUpgradeCost(i, 1);
        if (Number.isFinite(ramCost) && ramCost > 0) {
            const next = estimateNodeProduction(ns, stats.level, stats.ram * 2, stats.cores, productionMult);
            pushCandidate(candidates, {
                kind: "ram",
                node: i,
                cost: ramCost,
                deltaProduction: Math.max(0, next - current),
                label: `node ${i} ram -> ${stats.ram * 2}GB`,
            });
        }

        const coreCost = ns.hacknet.getCoreUpgradeCost(i, 1);
        if (Number.isFinite(coreCost) && coreCost > 0) {
            const next = estimateNodeProduction(ns, stats.level, stats.ram, stats.cores + 1, productionMult);
            pushCandidate(candidates, {
                kind: "core",
                node: i,
                cost: coreCost,
                deltaProduction: Math.max(0, next - current),
                label: `node ${i} cores -> ${stats.cores + 1}`,
            });
        }
    }

    const viable = candidates
        .filter((candidate) =>
            candidate.cost <= budget &&
            candidate.deltaProduction > 0 &&
            Number.isFinite(candidate.payoffSeconds) &&
            candidate.payoffSeconds <= maxPayoffSeconds
        )
        .sort((a, b) => {
            if (a.payoffSeconds !== b.payoffSeconds) return a.payoffSeconds - b.payoffSeconds;
            return b.deltaProduction - a.deltaProduction;
        });

    return viable[0] ?? null;
}

function pushCandidate(candidates, candidate) {
    const payoffSeconds = candidate.cost / candidate.deltaProduction;
    candidates.push({ ...candidate, payoffSeconds });
}

function executeAction(ns, action) {
    switch (action.kind) {
        case "purchase":
            return ns.hacknet.purchaseNode() >= 0;
        case "level":
            return ns.hacknet.upgradeLevel(action.node, 1);
        case "ram":
            return ns.hacknet.upgradeRam(action.node, 1);
        case "core":
            return ns.hacknet.upgradeCore(action.node, 1);
        default:
            return false;
    }
}

function summarizeFarm(ns) {
    const nodes = ns.hacknet.numNodes();
    let production = 0;

    for (let i = 0; i < nodes; i++) {
        production += Math.max(0, ns.hacknet.getNodeStats(i).production);
    }

    return {
        nodes,
        production,
        money: ns.getServerMoneyAvailable("home"),
    };
}

function getProductionMultiplier(ns) {
    const nodes = ns.hacknet.numNodes();

    for (let i = 0; i < nodes; i++) {
        const stats = ns.hacknet.getNodeStats(i);
        const base = baseHacknetProduction(stats.level, stats.ram, stats.cores);
        if (base > 0 && stats.production > 0) {
            return stats.production / base;
        }
    }

    return 1;
}

function estimateNodeProduction(ns, level, ram, cores, productionMult) {
    const formulasValue = estimateWithFormulas(ns, level, ram, cores, productionMult);
    if (Number.isFinite(formulasValue) && formulasValue > 0) {
        return formulasValue;
    }

    return baseHacknetProduction(level, ram, cores) * productionMult;
}

function estimateWithFormulas(ns, level, ram, cores, productionMult) {
    try {
        return ns.formulas.hacknetNodes.moneyGainRate(level, ram, cores, productionMult);
    } catch {
        return NaN;
    }
}

function baseHacknetProduction(level, ram, cores) {
    return level * 1.5 * Math.pow(1.035, Math.max(0, ram - 1)) * ((cores + 5) / 6);
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function formatSeconds(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "n/a";

    const rounded = Math.round(seconds);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const secs = rounded % 60;

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
}
