import { deepFreeze } from "./deep-freeze.js";

export const SQUADRON_MODELS = deepFreeze({
  wasp: {
    id: "wasp",
    displayName: "Оса",
    kind: "squadron",
    craftType: "fighter",
    baseSpeed: 6,
    initiative: 5,
    stack: 3,
    unitHealth: 5,
    shield: 0,
    armor: 0,
    baseEvasion: 10,
    visualId: "squadron",
    hardpoints: [
      { id: "autocannon", mount: "squadronWeapon", type: "squadronWeapon" }
    ]
  },
  mantis: {
    id: "mantis",
    displayName: "Мантис",
    kind: "squadron",
    craftType: "bomber",
    baseSpeed: 4,
    initiative: 3,
    stack: 3,
    unitHealth: 5,
    shield: 0,
    armor: 0,
    baseEvasion: 4,
    visualId: "squadron",
    hardpoints: [
      { id: "autocannon", mount: "squadronWeapon", type: "squadronWeapon" },
      { id: "torpedo", mount: "squadronWeapon", type: "squadronWeapon" }
    ]
  }
});
