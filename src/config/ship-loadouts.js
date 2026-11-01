import { deepFreeze } from "./deep-freeze.js";

export const SHIP_LOADOUTS = deepFreeze({
  atlas: {
    id: "atlas", hullId: "atlasCruiser",
    systems: { engine: "atlasEngine", reactor: "atlasReactor" },
    weapons: {
      "battery-left": { id: "atlas-battery-left", weaponId: "stormKineticBattery" },
      "battery-right": { id: "atlas-battery-right", weaponId: "stormKineticBattery" },
      "forward-emitter": { id: "atlas-forward", weaponId: "focusEmitter" }
    }
  },
  dart: {
    id: "dart", hullId: "dartCorvette",
    systems: { engine: "swiftEngine", reactor: "swiftReactor" },
    weapons: { "aa-turret": { id: "dart-aa", weaponId: "sentinelAutocannon" } }
  },
  swift: {
    id: "swift", hullId: "swiftFrigate",
    systems: { engine: "swiftEngine", reactor: "swiftReactor" },
    weapons: {
      "forward-emitter": { id: "swift-forward", weaponId: "focusEmitter" },
      "laser-turret": { id: "swift-laser", weaponId: "rayAALaser" }
    }
  },
  bastion: {
    id: "bastion", hullId: "bastionBattleship",
    systems: { engine: "bastionEngine", reactor: "bastionReactor" },
    weapons: {
      line: { id: "bastion-line", weaponId: "titanRailgun" },
      "battery-left": { id: "bastion-battery-left", weaponId: "hailMissileBattery" },
      "battery-right": { id: "bastion-battery-right", weaponId: "hailMissileBattery" },
      "plasma-turret": { id: "bastion-aa", weaponId: "sentinelAutocannon" }
    }
  },
  raptor: {
    id: "raptor", hullId: "raptorDestroyer",
    systems: { engine: "raptorEngine", reactor: "raptorReactor" },
    weapons: {
      "forward-emitter": { id: "raptor-forward", weaponId: "focusEmitter" },
      "aft-aa": { id: "raptor-aft-aa", weaponId: "wardAutocannon" },
      "impulse-turret": { id: "raptor-impulse", weaponId: "impulseTurret" }
    }
  }
});
