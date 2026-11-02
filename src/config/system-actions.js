import { deepFreeze } from "./deep-freeze.js";

export const SYSTEM_ACTIONS = deepFreeze({
  dispersion: {
    id: "dispersion",
    name: "Рассеивание",
    cost: {},
    effect: "dispersion",
    accuracyPenalty: 15,
    oncePerActivation: true
  },
  "interceptor-boost": {
    id: "interceptor-boost",
    name: "Форсаж",
    cost: {},
    preview: { speedCapacity: 1 },
    effect: "engineBoost",
    cooldownRounds: 1,
    oncePerActivation: true
  },
  "evasive-maneuver": {
    id: "evasive-maneuver",
    name: "Манёвр уклонения",
    cost: { maneuver: 1 },
    effect: "evasiveManeuver"
  },
  "reactor-to-engines": {
    id: "reactor-to-engines",
    name: "Форсаж двигателя",
    cost: { energy: 1 },
    preview: { speedCapacity: 1 },
    effect: "engineBoost",
    oncePerActivation: true
  }
});
