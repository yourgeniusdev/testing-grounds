import { deepFreeze } from "./deep-freeze.js";

const capitalWeapon = (id, name, compatibleHardpointTypes, weaponClass, accuracy, effectiveRange, maxRange, shots, damage, critChance, energyCost, massUnits) => ({
  id,
  name,
  compatibleHardpointTypes,
  weaponClass,
  accuracy,
  effectiveRange, // Справочная эффективная дальность: механика пока её не использует.
  maxRange,
  shots,
  damage,
  critChance,
  energyCost,
  future: { massUnits } // Будущая масса корабельного орудия.
});

export const WEAPONS = deepFreeze({
  atlasKineticBattery: capitalWeapon("atlasKineticBattery", "Кинетическая батарея", ["battery"], "kinetic", 75, 3, 5, 4, 4, 8, 0, 2),
  atlasPlasma: capitalWeapon("atlasPlasma", "Плазменный разряд", ["turret"], "energy", 90, 2, 3, 1, 13, 12, 3, 9),
  swiftKineticTurret: capitalWeapon("swiftKineticTurret", "Кинетическая башня", ["turret"], "kinetic", 75, 3, 4, 3, 3, 6, 0, 2),
  swiftPulse: capitalWeapon("swiftPulse", "Энергетический импульс", ["turret"], "energy", 90, 2, 3, 1, 7, 6, 2, 4),
  bastionLineCannon: capitalWeapon("bastionLineCannon", "Линейная кинетическая пушка", ["spinal"], "kinetic", 75, 5, 7, 1, 18, 20, 0, 12),
  bastionExplosiveBattery: capitalWeapon("bastionExplosiveBattery", "Взрывная батарея", ["battery"], "explosive", 80, 3, 5, 2, 7, 15, 0, 4),
  bastionPulse: capitalWeapon("bastionPulse", "Энергетический импульс", ["turret"], "energy", 90, 3, 4, 1, 12, 10, 3, 4),
  raptorExplosiveBattery: capitalWeapon("raptorExplosiveBattery", "Взрывная батарея", ["battery"], "explosive", 80, 3, 5, 2, 6, 15, 0, 4),
  raptorBeam: capitalWeapon("raptorBeam", "Энергетический луч", ["turret"], "energy", 90, 3, 4, 1, 9, 8, 2, 6),
  squadronKinetic: {
    id: "squadronKinetic",
    name: "Фронтальная кинетическая атака",
    compatibleHardpointTypes: ["squadronWeapon"],
    weaponClass: "kinetic",
    accuracy: 70,
    effectiveRange: 1, // Справочная эффективная дальность: механика пока её не использует.
    maxRange: 1,
    shots: 1,
    damage: 1,
    critChance: 2,
    energyCost: 0
  }
});
