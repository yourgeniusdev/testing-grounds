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
      { id: "battery-left", role: "primary", mount: "battery-left", type: "battery" },
      { id: "battery-right", role: "primary", mount: "battery-right", type: "battery" },
      { id: "plasma-turret", role: "auxiliary", mount: "turret", type: "turret" }
    ],
    future: { massUnits: 64 } // Будущая масса корпуса без оснащения.
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
      { id: "kinetic-turret", role: "primary", mount: "turret", type: "turret" },
      { id: "pulse-turret", role: "auxiliary", mount: "turret", type: "turret" }
    ],
    future: { massUnits: 31 } // Будущая масса корпуса без оснащения.
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
      { id: "line", role: "primary", mount: "line", type: "spinal" },
      { id: "battery-left", role: "primary", mount: "battery-left", type: "battery" },
      { id: "battery-right", role: "primary", mount: "battery-right", type: "battery" },
      { id: "pulse-turret", role: "auxiliary", mount: "turret", type: "turret" }
    ],
    future: { massUnits: 135 } // Будущая масса корпуса без оснащения.
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
      { id: "battery-right", role: "primary", mount: "battery-right", type: "battery" },
      { id: "beam-turret", role: "auxiliary", mount: "turret", type: "turret" }
    ],
    future: { massUnits: 53 } // Будущая масса корпуса без оснащения.
  }
});
