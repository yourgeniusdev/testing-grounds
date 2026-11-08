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
    unitHealth: 300,
    shield: 0,
    armor: 0,
    baseEvasion: 10,
    crewRequirement: 20,
    overwatchHardpointIds: [],
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
    baseSpeed: 3,
    maneuver: 4,
    initiative: 3,
    stack: 3,
    unitHealth: 500,
    shield: 0,
    armor: 0,
    baseEvasion: 2,
    crewRequirement: 25,
    overwatchHardpointIds: [],
    visualId: "bomber",
    hardpoints: [
      { id: "autocannon", mount: "squadronWeapon", type: "squadronWeapon", firingArc: "forward" },
      { id: "torpedo", mount: "squadronWeapon", type: "squadronWeapon", firingArc: "forward" }
    ]
  },
  hornet: {
    id: "hornet",
    displayName: "Шершень",
    kind: "squadron",
    craftType: "interceptor",
    baseSpeed: 6,
    maneuver: 6,
    initiative: 6,
    stack: 2,
    unitHealth: 300,
    shield: 0,
    armor: 0,
    baseEvasion: 16,
    crewRequirement: 30,
    overwatchHardpointIds: ["left-autocannon", "right-autocannon"],
    visualId: "interceptor",
    hardpoints: [
      { id: "left-autocannon", mount: "squadronWeapon", type: "squadronWeapon", firingArc: "forward" },
      { id: "right-autocannon", mount: "squadronWeapon", type: "squadronWeapon", firingArc: "forward" }
    ]
  },
  kiro: {
    id: "kiro",
    displayName: "Киро",
    kind: "squadron",
    craftType: "assaultCraft",
    baseSpeed: 5,
    maneuver: 4,
    initiative: 5,
    stack: 1,
    unitHealth: 1000,
    shield: 300,
    armor: 0,
    baseEvasion: 10,
    crewRequirement: 30,
    overwatchHardpointIds: [],
    visualId: "assaultCraft",
    hardpoints: [
      { id: "beam-turret", mount: "turret", type: "turret" }
    ]
  }
});
