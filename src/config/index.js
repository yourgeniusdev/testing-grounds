import { CAPITAL_HULLS } from "./capital-hulls.js";
import { PRIMARY_SYSTEMS } from "./primary-systems.js";
import { SHIP_LOADOUTS } from "./ship-loadouts.js";
import { SQUADRON_LOADOUTS } from "./squadron-loadouts.js";
import { SQUADRON_MODELS } from "./squadron-models.js";
import { validateConfig } from "./validate-config.js";
import { VISUALS } from "./visuals.js";
import { WEAPONS } from "./weapons.js";

export { CAPITAL_HULLS, PRIMARY_SYSTEMS, SHIP_LOADOUTS, SQUADRON_LOADOUTS, SQUADRON_MODELS, validateConfig, VISUALS, WEAPONS };

export const CONFIG = Object.freeze({
  capitalHulls: CAPITAL_HULLS,
  squadronModels: SQUADRON_MODELS,
  primarySystems: PRIMARY_SYSTEMS,
  weapons: WEAPONS,
  shipLoadouts: SHIP_LOADOUTS,
  squadronLoadouts: SQUADRON_LOADOUTS,
  visuals: VISUALS
});

const equippedMass = (hull, loadout) => {
  const systemMass = Object.values(loadout.systems).reduce((total, id) => total + PRIMARY_SYSTEMS[id].future.massUnits, 0);
  const weaponMass = Object.values(loadout.weapons).reduce((total, installation) => total + WEAPONS[installation.weaponId].future.massUnits, 0);
  return hull.future.massUnits + systemMass + weaponMass;
};

const runtimeWeapon = (hardpoint, installation) => {
  const weapon = WEAPONS[installation.weaponId];
  return {
    id: installation.id,
    name: installation.name || weapon.name,
    role: hardpoint.role,
    mount: hardpoint.mount,
    ...(hardpoint.orientation ? { orientation: hardpoint.orientation } : {}),
    weaponClass: weapon.weaponClass,
    accuracy: weapon.accuracy,
    effectiveRange: weapon.effectiveRange,
    maxRange: weapon.maxRange,
    shots: weapon.shots,
    damage: weapon.damage,
    critChance: weapon.critChance,
    energyCost: weapon.energyCost
  };
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
    initiative: model.initiative,
    stack: model.stack,
    unitHealth: model.unitHealth,
    shield: model.shield,
    maxShield: model.shield,
    armor: model.armor,
    maxArmor: model.armor,
    integrity,
    maxIntegrity: integrity,
    engagedWith: [],
    weapons: model.hardpoints.flatMap(hardpoint => loadout.weapons[hardpoint.id] ? [runtimeWeapon(hardpoint, loadout.weapons[hardpoint.id])] : []),
    glyph: model.visualId
  };
}

validateConfig(CONFIG);
