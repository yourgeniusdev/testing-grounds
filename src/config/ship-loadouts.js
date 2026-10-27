import { deepFreeze } from "./deep-freeze.js";

export const SHIP_LOADOUTS = deepFreeze({
  atlas: {
    id: "atlas", hullId: "atlasCruiser",
    systems: { engine: "atlasEngine", reactor: "atlasReactor" },
    weapons: {
      "battery-left": { id: "atlas-battery-left", weaponId: "atlasKineticBattery", name: "Левая кинетическая батарея" },
      "battery-right": { id: "atlas-battery-right", weaponId: "atlasKineticBattery", name: "Правая кинетическая батарея" },
      "plasma-turret": { id: "atlas-plasma", weaponId: "atlasPlasma" }
    }
  },
  swift: {
    id: "swift", hullId: "swiftFrigate",
    systems: { engine: "swiftEngine", reactor: "swiftReactor" },
    weapons: {
      "kinetic-turret": { id: "swift-turret", weaponId: "swiftKineticTurret" },
      "pulse-turret": { id: "swift-pulse", weaponId: "swiftPulse" }
    }
  },
  bastion: {
    id: "bastion", hullId: "bastionBattleship",
    systems: { engine: "bastionEngine", reactor: "bastionReactor" },
    weapons: {
      line: { id: "bastion-line", weaponId: "bastionLineCannon" },
      "battery-left": { id: "bastion-battery-left", weaponId: "bastionExplosiveBattery", name: "Левая взрывная батарея" },
      "battery-right": { id: "bastion-battery-right", weaponId: "bastionExplosiveBattery", name: "Правая взрывная батарея" },
      "pulse-turret": { id: "bastion-pulse", weaponId: "bastionPulse" }
    }
  },
  raptor: {
    id: "raptor", hullId: "raptorDestroyer",
    systems: { engine: "raptorEngine", reactor: "raptorReactor" },
    weapons: {
      "battery-right": { id: "raptor-battery-right", weaponId: "raptorExplosiveBattery", name: "Правая взрывная батарея" },
      "beam-turret": { id: "raptor-beam", weaponId: "raptorBeam" }
    }
  }
});
