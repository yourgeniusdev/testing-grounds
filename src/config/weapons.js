import { deepFreeze } from "./deep-freeze.js";

const VARIANT_OVERRIDE_FIELDS = new Set(["id", "name", "accuracy", "effectiveRange", "maxRange", "shots", "damage", "critChance", "energyCost", "cooldownRounds", "targetKinds", "visual"]);

export const weapon = definition => deepFreeze(structuredClone({ cooldownRounds: 0, ...definition }));

export const weaponVariant = (base, overrides) => {
  if (base.variantOf) throw new Error("Weapon variants cannot derive from another variant");
  if (!overrides?.id || overrides.id === base.id) throw new Error("Weapon variant requires a unique overridden id");
  if (!overrides?.name || overrides.name === base.name) throw new Error("Weapon variant requires a unique overridden name");
  for (const field of Object.keys(overrides)) if (!VARIANT_OVERRIDE_FIELDS.has(field)) throw new Error(`Weapon variant cannot override ${field}`);
  return weapon({
    ...base,
    ...overrides,
    compatibleHardpointTypes: [...base.compatibleHardpointTypes],
    targetKinds: overrides.targetKinds ? [...overrides.targetKinds] : [...base.targetKinds],
    visual: { ...base.visual, ...overrides.visual },
    variantOf: base.id
  });
};

const visual = (projectile, color, size, speedHexesPerSecond, launchIntervalMs, trail, impact, impactRadius) => ({
  projectile,
  color,
  size,
  speedHexesPerSecond,
  launchIntervalMs,
  trail,
  impact,
  impactRadius
});

const needleAutocannon = weapon({
  id: "needleAutocannon",
  name: "Автопушка «Игла»",
  compatibleHardpointTypes: ["squadronWeapon"],
  weaponClass: "kinetic",
  delivery: "projectile",
  targetKinds: ["capital", "squadron"],
  accuracy: 72,
  effectiveRange: 1,
  maxRange: 2,
  shots: 1,
  damage: 1,
  critChance: 2,
  energyCost: 0,
  cooldownRounds: 0,
  visual: visual("tracer", "#ffd37a", 0.05, 12, 90, "short", "spark", 0.06)
});

const twinNeedleAutocannon = weaponVariant(needleAutocannon, {
  id: "twinNeedleAutocannon",
  name: "Спаренная автопушка «Игла»",
  shots: 2
});

const sentinelAutocannon = weapon({
  id: "sentinelAutocannon",
  name: "Зенитная автопушка «Страж»",
  compatibleHardpointTypes: ["turret"],
  weaponClass: "kinetic",
  delivery: "projectile",
  targetKinds: ["capital", "squadron"],
  accuracy: 88,
  effectiveRange: 2,
  maxRange: 3,
  shots: 4,
  damage: 2,
  critChance: 4,
  energyCost: 0,
  cooldownRounds: 0,
  future: { massUnits: 2 },
  visual: visual("tracer", "#ffd37a", 0.06, 13, 80, "short", "spark", 0.07)
});

const rayAALaser = weapon({
  id: "rayAALaser",
  name: "Зенитный лазер «Луч»",
  compatibleHardpointTypes: ["turret"],
  weaponClass: "energy",
  delivery: "beam",
  targetKinds: ["capital", "squadron"],
  accuracy: 92,
  effectiveRange: 2,
  maxRange: 3,
  shots: 1,
  damage: 6,
  critChance: 5,
  energyCost: 2,
  cooldownRounds: 0,
  future: { massUnits: 4 },
  visual: visual("beam", "#77eaff", 0.05, 30, 0, "none", "spark", 0.08)
});

const torchPlasmaCannon = weapon({
  id: "torchPlasmaCannon",
  name: "Плазменное орудие «Факел»",
  compatibleHardpointTypes: ["turret"],
  weaponClass: "energy",
  delivery: "projectile",
  targetKinds: ["capital"],
  accuracy: 82,
  effectiveRange: 2,
  maxRange: 4,
  shots: 1,
  damage: 14,
  critChance: 12,
  energyCost: 3,
  cooldownRounds: 1,
  future: { massUnits: 4 },
  visual: visual("tracer", "#8dffea", 0.12, 7, 0, "short", "smallExplosion", 0.16)
});

const stormKineticBattery = weapon({
  id: "stormKineticBattery",
  name: "Кинетическая батарея «Шторм»",
  compatibleHardpointTypes: ["battery"],
  weaponClass: "kinetic",
  delivery: "projectile",
  targetKinds: ["capital"],
  accuracy: 75,
  effectiveRange: 3,
  maxRange: 5,
  shots: 4,
  damage: 4,
  critChance: 8,
  energyCost: 0,
  cooldownRounds: 0,
  future: { massUnits: 2 },
  visual: visual("tracer", "#ffe29a", 0.08, 11, 110, "short", "spark", 0.09)
});

const hailMissileBattery = weapon({
  id: "hailMissileBattery",
  name: "Ракетная батарея «Град»",
  compatibleHardpointTypes: ["battery"],
  weaponClass: "explosive",
  delivery: "missile",
  targetKinds: ["capital"],
  accuracy: 78,
  effectiveRange: 3,
  maxRange: 5,
  shots: 3,
  damage: 6,
  critChance: 14,
  energyCost: 0,
  cooldownRounds: 0,
  future: { massUnits: 4 },
  visual: visual("missile", "#ffb067", 0.12, 6, 150, "smoke", "smallExplosion", 0.22)
});

const titanRailgun = weapon({
  id: "titanRailgun",
  name: "Линейный рельсотрон «Титан»",
  compatibleHardpointTypes: ["spinal"],
  weaponClass: "kinetic",
  delivery: "projectile",
  targetKinds: ["capital"],
  accuracy: 74,
  effectiveRange: 5,
  maxRange: 7,
  shots: 1,
  damage: 20,
  critChance: 20,
  energyCost: 0,
  cooldownRounds: 1,
  future: { massUnits: 12 },
  visual: visual("tracer", "#fff0bd", 0.13, 16, 0, "short", "largeExplosion", 0.28)
});

const focusEmitter = weapon({
  id: "focusEmitter",
  name: "Курсовой излучатель «Фокус»",
  compatibleHardpointTypes: ["forward"],
  weaponClass: "energy",
  delivery: "beam",
  targetKinds: ["capital"],
  accuracy: 86,
  effectiveRange: 2,
  maxRange: 3,
  shots: 1,
  damage: 9,
  critChance: 8,
  energyCost: 2,
  cooldownRounds: 0,
  future: { massUnits: 9 },
  visual: visual("beam", "#77eaff", 0.07, 30, 0, "none", "spark", 0.1)
});

const spearMissile = weapon({
  id: "spearMissile",
  name: "Курсовая ракета «Копьё»",
  compatibleHardpointTypes: ["forward"],
  weaponClass: "explosive",
  delivery: "missile",
  targetKinds: ["capital"],
  accuracy: 68,
  effectiveRange: 3,
  maxRange: 5,
  shots: 1,
  damage: 13,
  critChance: 18,
  energyCost: 0,
  cooldownRounds: 1,
  future: { massUnits: 6 },
  visual: visual("missile", "#ff9b5f", 0.12, 6, 0, "smoke", "smallExplosion", 0.22)
});

const impulseTurret = weapon({
  id: "impulseTurret",
  name: "Энергетическая башня «Импульс»",
  compatibleHardpointTypes: ["turret"],
  weaponClass: "energy",
  delivery: "beam",
  targetKinds: ["capital"],
  accuracy: 86,
  effectiveRange: 2,
  maxRange: 4,
  shots: 1,
  damage: 8,
  critChance: 7,
  energyCost: 2,
  cooldownRounds: 0,
  future: { massUnits: 6 },
  visual: visual("beam", "#8eeeff", 0.06, 30, 0, "none", "spark", 0.09)
});

const hammerTorpedo = weapon({
  id: "hammerTorpedo",
  name: "Противокорабельная торпеда «Молот»",
  compatibleHardpointTypes: ["squadronWeapon"],
  weaponClass: "explosive",
  delivery: "torpedo",
  targetKinds: ["capital"],
  accuracy: 62,
  effectiveRange: 2,
  maxRange: 3,
  shots: 1,
  damage: 8,
  critChance: 16,
  energyCost: 0,
  cooldownRounds: 1,
  visual: visual("torpedo", "#ff765f", 0.18, 4, 180, "smoke", "largeExplosion", 0.33)
});

export const WEAPONS = deepFreeze(Object.fromEntries([
  needleAutocannon,
  twinNeedleAutocannon,
  sentinelAutocannon,
  rayAALaser,
  torchPlasmaCannon,
  stormKineticBattery,
  hailMissileBattery,
  titanRailgun,
  focusEmitter,
  spearMissile,
  impulseTurret,
  hammerTorpedo
].map(entry => [entry.id, entry])));
