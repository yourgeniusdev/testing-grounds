import { deepFreeze } from "./deep-freeze.js";

export const SQUADRON_MODELS = deepFreeze({
  wasp: {
    id: "wasp",
    displayName: "Оса",
    kind: "squadron",
    craftType: "fighter",
    baseSpeed: 6,
    maneuver: 5,
    initiative: 5,
    stack: 3,
    unitHealth: 5,
    shield: 0,
    armor: 0,
    baseEvasion: 10,
    visualId: "squadron",
    hardpoints: [
      { id: "autocannon", mount: "squadronWeapon", type: "squadronWeapon", firingArc: "forward" }
    ]
  },
  mantis: {
    id: "mantis",
    displayName: "Мантис",
    kind: "squadron",
    craftType: "bomber",
    baseSpeed: 4,
    maneuver: 4,
    initiative: 3,
    stack: 3,
    unitHealth: 5,
    shield: 0,
    armor: 0,
    baseEvasion: 4,
    visualId: "squadron",
    hardpoints: [
      { id: "autocannon", mount: "squadronWeapon", type: "squadronWeapon", firingArc: "forward" },
      { id: "torpedo", mount: "squadronWeapon", type: "squadronWeapon", firingArc: "forward" }
    ]
  }
});
