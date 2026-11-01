import { CAPITAL_HULLS } from "./capital-hulls.js";
import { deepFreeze } from "./deep-freeze.js";
import { PRIMARY_SYSTEMS } from "./primary-systems.js";
import { SHIP_LOADOUTS } from "./ship-loadouts.js";
import { SQUADRON_LOADOUTS } from "./squadron-loadouts.js";
import { SQUADRON_MODELS } from "./squadron-models.js";
import { SYSTEM_ACTIONS } from "./system-actions.js";
import { validateConfig } from "./validate-config.js";
import { VISUALS } from "./visuals.js";
import { WEAPONS, weapon, weaponVariant } from "./weapons.js";

export { CAPITAL_HULLS, PRIMARY_SYSTEMS, SHIP_LOADOUTS, SQUADRON_LOADOUTS, SQUADRON_MODELS, SYSTEM_ACTIONS, validateConfig, VISUALS, WEAPONS, weapon, weaponVariant };

export const CONFIG = deepFreeze({
  capitalHulls: CAPITAL_HULLS,
  squadronModels: SQUADRON_MODELS,
  primarySystems: PRIMARY_SYSTEMS,
  weapons: WEAPONS,
  shipLoadouts: SHIP_LOADOUTS,
  squadronLoadouts: SQUADRON_LOADOUTS,
  systemActions: SYSTEM_ACTIONS,
  visuals: VISUALS
});

const equippedMass = (hull, loadout) => {
  const systemMass = Object.values(loadout.systems).reduce((total, id) => total + PRIMARY_SYSTEMS[id].future.massUnits, 0);
  const weaponMass = Object.values(loadout.weapons).reduce((total, installation) => total + WEAPONS[installation.weaponId].future.massUnits, 0);
  return hull.future.massUnits + systemMass + weaponMass;
};

const runtimeWeapon = (hardpoint, installation) => {
  const catalogWeapon = WEAPONS[installation.weaponId];
  return deepFreeze({
    id: installation.id,
    catalogWeaponId: catalogWeapon.id,
    name: installation.name || catalogWeapon.name,
    mount: hardpoint.mount,
    hardpointType: hardpoint.type,
    ...(hardpoint.orientation ? { orientation: hardpoint.orientation } : {}),
    ...(hardpoint.firingArc ? { firingArc: hardpoint.firingArc } : {}),
    weaponClass: catalogWeapon.weaponClass,
    delivery: catalogWeapon.delivery,
    targetKinds: [...catalogWeapon.targetKinds],
    accuracy: catalogWeapon.accuracy,
    effectiveRange: catalogWeapon.effectiveRange,
    maxRange: catalogWeapon.maxRange,
    shots: catalogWeapon.shots,
    damage: catalogWeapon.damage,
    critChance: catalogWeapon.critChance,
    energyCost: catalogWeapon.energyCost,
    cooldownRounds: catalogWeapon.cooldownRounds,
    ready: true,
    firedThisRound: false,
    cooldownRemaining: 0,
    visual: structuredClone(catalogWeapon.visual),
    ...(catalogWeapon.variantOf ? { variantOf: catalogWeapon.variantOf } : {})
  });
};

export function buildCapitalProfile(loadoutId) {
  const loadout = SHIP_LOADOUTS[loadoutId];
  if (!loadout) throw new Error(`Unknown ship loadout ID "${loadoutId}"`);
  const hull = CAPITAL_HULLS[loadout.hullId];
  const reactor = PRIMARY_SYSTEMS[loadout.systems.reactor];
  return {
    kind: "capital",
    hullId: hull.id,
    hullType: hull.hullType,
    hullClassName: hull.displayName,
    engineId: loadout.systems.engine,
    reactorId: loadout.systems.reactor,
    baseSpeed: hull.baseSpeed,
    currentSpeed: hull.baseSpeed,
    maneuver: hull.maneuver,
    initiative: hull.initiative,
    mass: hull.combatMassUnits,
    equippedMassUnits: equippedMass(hull, loadout),
    shield: hull.shield,
    maxShield: hull.shield,
    armor: hull.armor,
    maxArmor: hull.armor,
    integrity: hull.integrity,
    maxIntegrity: hull.integrity,
    baseEvasion: hull.baseEvasion,
    reactor: { capacity: reactor.capacity, rechargeRate: reactor.rechargePerRound },
    weapons: hull.hardpoints.flatMap(hardpoint => loadout.weapons[hardpoint.id] ? [runtimeWeapon(hardpoint, loadout.weapons[hardpoint.id])] : []),
    glyph: hull.visualId
  };
}

export function buildSquadronProfile(loadoutId) {
  const loadout = SQUADRON_LOADOUTS[loadoutId];
  if (!loadout) throw new Error(`Unknown squadron loadout ID "${loadoutId}"`);
  const model = SQUADRON_MODELS[loadout.modelId];
  const integrity = model.stack * model.unitHealth;
  return {
    kind: "squadron",
    squadronModelId: model.id,
    squadronModelName: model.displayName,
    craftType: model.craftType,
    currentSpeed: model.baseSpeed,
    baseSpeed: model.baseSpeed,
    maneuver: model.maneuver,
    initiative: model.initiative,
    stack: model.stack,
    unitHealth: model.unitHealth,
    shield: model.shield,
    maxShield: model.shield,
    armor: model.armor,
    maxArmor: model.armor,
    integrity,
    maxIntegrity: integrity,
    baseEvasion: model.baseEvasion,
    engagedWith: [],
    weapons: model.hardpoints.flatMap(hardpoint => loadout.weapons[hardpoint.id] ? [runtimeWeapon(hardpoint, loadout.weapons[hardpoint.id])] : []),
    glyph: model.visualId
  };
}

validateConfig(CONFIG);
