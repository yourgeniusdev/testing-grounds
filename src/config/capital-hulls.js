import { deepFreeze } from "./deep-freeze.js";

export const CAPITAL_HULLS = deepFreeze({
  atlasCruiser: {
    id: "atlasCruiser",
    kind: "capital",
    hullType: "cruiser",
    displayName: "Атлас",
    baseSpeed: 3,
    maneuver: 2,
    initiative: 2,
    crewRequirement: 140,
    combatMassUnits: 92,
    shield: 32,
    armor: 32,
    integrity: 65,
    baseEvasion: 6,
    visualId: "cruiser",
    systemSlots: [
      { id: "engine", type: "engine", required: true },
      { id: "reactor", type: "reactor", required: true }
    ],
    hardpoints: [
      { id: "battery-left", mount: "battery-left", type: "battery" },
      { id: "battery-right", mount: "battery-right", type: "battery" },
      { id: "forward-emitter", mount: "forward", type: "forward", orientation: "fore" }
    ],
    future: { massUnits: 64 }
  },
  dartCorvette: {
    id: "dartCorvette",
    kind: "capital",
    hullType: "corvette",
    displayName: "Дротик",
    baseSpeed: 6,
    maneuver: 4,
    initiative: 5,
    crewRequirement: 50,
    combatMassUnits: 37,
    shield: 11,
    armor: 8,
    integrity: 30,
    baseEvasion: 14,
    visualId: "corvette",
    systemSlots: [
      { id: "engine", type: "engine", required: true },
      { id: "reactor", type: "reactor", required: true }
    ],
    hardpoints: [
      { id: "aa-turret", mount: "turret", type: "turret" }
    ],
    future: { massUnits: 24 }
  },
  swiftFrigate: {
    id: "swiftFrigate",
    kind: "capital",
    hullType: "frigate",
    displayName: "Стриж",
    baseSpeed: 5,
    maneuver: 3,
    initiative: 5,
    crewRequirement: 70,
    combatMassUnits: 55,
    shield: 18,
    armor: 14,
    integrity: 45,
    baseEvasion: 10,
    visualId: "frigate",
    systemSlots: [
      { id: "engine", type: "engine", required: true },
      { id: "reactor", type: "reactor", required: true }
    ],
    hardpoints: [
      { id: "forward-emitter", mount: "forward", type: "forward", orientation: "fore" },
      { id: "laser-turret", mount: "turret", type: "turret" }
    ],
    future: { massUnits: 31 }
  },
  bastionBattleship: {
    id: "bastionBattleship",
    kind: "capital",
    hullType: "battleship",
    displayName: "Бастион",
    baseSpeed: 2,
    maneuver: 1,
    initiative: 1,
    crewRequirement: 200,
    combatMassUnits: 186,
    shield: 46,
    armor: 55,
    integrity: 100,
    baseEvasion: 2,
    visualId: "battleship",
    systemSlots: [
      { id: "engine", type: "engine", required: true },
      { id: "reactor", type: "reactor", required: true }
    ],
    hardpoints: [
      { id: "line", mount: "line", type: "spinal" },
      { id: "battery-left", mount: "battery-left", type: "battery" },
      { id: "battery-right", mount: "battery-right", type: "battery" },
      { id: "plasma-turret", mount: "turret", type: "turret" }
    ],
    future: { massUnits: 135 }
  },
  raptorDestroyer: {
    id: "raptorDestroyer",
    kind: "capital",
    hullType: "destroyer",
    displayName: "Раптор",
    baseSpeed: 3,
    maneuver: 2,
    initiative: 4,
    crewRequirement: 100,
    combatMassUnits: 83,
    shield: 23,
    armor: 23,
    integrity: 60,
    baseEvasion: 7,
    visualId: "destroyer",
    systemSlots: [
      { id: "engine", type: "engine", required: true },
      { id: "reactor", type: "reactor", required: true }
    ],
    hardpoints: [
      { id: "forward-emitter", mount: "forward", type: "forward", orientation: "fore" },
      { id: "aft-aa", mount: "forward", type: "forward", orientation: "aft" },
      { id: "impulse-turret", mount: "turret", type: "turret" }
    ],
    future: { massUnits: 53 }
  }
});
