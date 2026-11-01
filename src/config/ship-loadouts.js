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
      "autocannon-turret": { id: "swift-autocannon", weaponId: "sentinelAutocannon" },
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
      "plasma-turret": { id: "bastion-plasma", weaponId: "torchPlasmaCannon" }
    }
  },
  raptor: {
    id: "raptor", hullId: "raptorDestroyer",
    systems: { engine: "raptorEngine", reactor: "raptorReactor" },
    weapons: {
      "battery-right": { id: "raptor-battery-right", weaponId: "hailMissileBattery" },
      "impulse-turret": { id: "raptor-impulse", weaponId: "impulseTurret" }
    }
  }
});
