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
    visualId: "bomber",
    hardpoints: [
      { id: "autocannon", mount: "squadronWeapon", type: "squadronWeapon", firingArc: "forward" },
      { id: "torpedo", mount: "squadronWeapon", type: "squadronWeapon", firingArc: "forward" }
    ]
  },
  kiro: {
    id: "kiro",
    displayName: "Киро",
    kind: "squadron",
    craftType: "gunship",
    baseSpeed: 3,
    maneuver: 2,
    initiative: 2,
    stack: 1,
    unitHealth: 18,
    shield: 10,
    armor: 2,
    baseEvasion: 2,
    visualId: "gunship",
    hardpoints: [
      { id: "beam-turret", mount: "turret", type: "turret" }
    ]
  }
});
