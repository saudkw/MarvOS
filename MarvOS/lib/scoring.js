import { rankMoneyTargets as rankTargetsFromCore } from "/MarvOS/lib/money-core.js";

/** @param {NS} ns */
export function rankMoneyTargets(ns, options = {}) {
    return rankTargetsFromCore(ns, options);
}
