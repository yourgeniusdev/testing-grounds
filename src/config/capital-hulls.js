import { deepFreeze } from "./deep-freeze.js";

export const CAPITAL_HULLS = deepFreeze({
  atlasCruiser: {
    id: "atlasCruiser",
    kind: "capital",
    hullType: "cruiser",
    displayName: "Атлас",
    baseSpeed: 3,
    maneuver: 2,
    initiative: 3,
    combatMassUnits: 92,
    shield: 35,
    armor: 35,
    integrity: 120,
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
    combatMassUnits: 37,
    shield: 12,
    armor: 8,
    integrity: 48,
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
    combatMassUnits: 48,
    shield: 20,
    armor: 15,
    integrity: 75,
    baseEvasion: 10,
    visualId: "frigate",
    systemSlots: [
      { id: "engine", type: "engine", required: true },
      { id: "reactor", type: "reactor", required: true }
    ],
    hardpoints: [
      { id: "autocannon-turret", mount: "turret", type: "turret" },
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
    combatMassUnits: 188,
    shield: 50,
    armor: 60,
    integrity: 180,
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
    initiative: 3,
    combatMassUnits: 76,
    shield: 25,
    armor: 25,
    integrity: 100,
    baseEvasion: 7,
    visualId: "destroyer",
    systemSlots: [
      { id: "engine", type: "engine", required: true },
      { id: "reactor", type: "reactor", required: true }
    ],
    hardpoints: [
      { id: "battery-right", mount: "battery-right", type: "battery" },
      { id: "impulse-turret", mount: "turret", type: "turret" }
    ],
    future: { massUnits: 53 }
  }
});
