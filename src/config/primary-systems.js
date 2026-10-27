import { deepFreeze } from "./deep-freeze.js";

export const PRIMARY_SYSTEMS = deepFreeze({
  atlasEngine: {
    id: "atlasEngine", displayName: "Двигатель крейсера «Атлас»", type: "engine",
    future: { massUnits: 8, powerDrawUnits: 2, thrustUnits: 3 } // Будущие масса, энергопотребление и тяга.
  },
  swiftEngine: {
    id: "swiftEngine", displayName: "Двигатель фрегата «Стриж»", type: "engine",
    future: { massUnits: 6, powerDrawUnits: 2, thrustUnits: 5 } // Будущие масса, энергопотребление и тяга.
  },
  bastionEngine: {
    id: "bastionEngine", displayName: "Двигатель линкора «Бастион»", type: "engine",
    future: { massUnits: 15, powerDrawUnits: 4, thrustUnits: 2 } // Будущие масса, энергопотребление и тяга.
  },
  raptorEngine: {
    id: "raptorEngine", displayName: "Двигатель эсминца «Раптор»", type: "engine",
    future: { massUnits: 7, powerDrawUnits: 2, thrustUnits: 3 } // Будущие масса, энергопотребление и тяга.
  },
  atlasReactor: {
    id: "atlasReactor", displayName: "Реактор крейсера «Атлас»", type: "reactor", capacity: 6, rechargePerRound: 2,
    future: { massUnits: 7 } // Будущая масса реактора.
  },
  swiftReactor: {
    id: "swiftReactor", displayName: "Реактор фрегата «Стриж»", type: "reactor", capacity: 5, rechargePerRound: 2,
    future: { massUnits: 5 } // Будущая масса реактора.
  },
  bastionReactor: {
    id: "bastionReactor", displayName: "Реактор линкора «Бастион»", type: "reactor", capacity: 8, rechargePerRound: 2,
    future: { massUnits: 14 } // Будущая масса реактора.
  },
  raptorReactor: {
    id: "raptorReactor", displayName: "Реактор эсминца «Раптор»", type: "reactor", capacity: 6, rechargePerRound: 2,
    future: { massUnits: 6 } // Будущая масса реактора.
  }
});
