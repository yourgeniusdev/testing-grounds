import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCapitalProfile,
  buildSquadronProfile,
  CAPITAL_HULLS,
  CONFIG,
  PRIMARY_SYSTEMS,
  validateConfig,
  VISUALS,
  WEAPONS
} from "./config/index.js";

const cloneConfig = () => structuredClone(CONFIG);

const legacyCapitals = {
  atlas: { baseSpeed: 3, currentSpeed: 3, maneuver: 2, initiative: 3, mass: 92, shield: 35, maxShield: 35, armor: 35, maxArmor: 35, integrity: 120, maxIntegrity: 120, baseEvasion: 6, reactor: { capacity: 6, rechargeRate: 2 } },
  swift: { baseSpeed: 5, currentSpeed: 5, maneuver: 3, initiative: 5, mass: 48, shield: 20, maxShield: 20, armor: 15, maxArmor: 15, integrity: 75, maxIntegrity: 75, baseEvasion: 10, reactor: { capacity: 5, rechargeRate: 2 } },
  bastion: { baseSpeed: 2, currentSpeed: 2, maneuver: 1, initiative: 1, mass: 188, shield: 50, maxShield: 50, armor: 60, maxArmor: 60, integrity: 180, maxIntegrity: 180, baseEvasion: 2, reactor: { capacity: 8, rechargeRate: 2 } },
  raptor: { baseSpeed: 3, currentSpeed: 3, maneuver: 2, initiative: 3, mass: 76, shield: 25, maxShield: 25, armor: 25, maxArmor: 25, integrity: 100, maxIntegrity: 100, baseEvasion: 7, reactor: { capacity: 6, rechargeRate: 2 } }
};

const legacyWeapons = {
  atlas: [
    ["atlas-battery-left", "Левая кинетическая батарея", "primary", "battery-left", "kinetic", 75, 3, 5, 4, 4, 8, 0],
    ["atlas-battery-right", "Правая кинетическая батарея", "primary", "battery-right", "kinetic", 75, 3, 5, 4, 4, 8, 0],
    ["atlas-plasma", "Плазменный разряд", "auxiliary", "turret", "energy", 90, 2, 3, 1, 13, 12, 3]
  ],
  swift: [
    ["swift-turret", "Кинетическая башня", "primary", "turret", "kinetic", 75, 3, 4, 3, 3, 6, 0],
    ["swift-pulse", "Энергетический импульс", "auxiliary", "turret", "energy", 90, 2, 3, 1, 7, 6, 2]
  ],
  bastion: [
    ["bastion-line", "Линейная кинетическая пушка", "primary", "line", "kinetic", 75, 5, 7, 1, 18, 20, 0],
    ["bastion-battery-left", "Левая взрывная батарея", "primary", "battery-left", "explosive", 80, 3, 5, 2, 7, 15, 0],
    ["bastion-battery-right", "Правая взрывная батарея", "primary", "battery-right", "explosive", 80, 3, 5, 2, 7, 15, 0],
    ["bastion-pulse", "Энергетический импульс", "auxiliary", "turret", "energy", 90, 3, 4, 1, 12, 10, 3]
  ],
  raptor: [
    ["raptor-battery-right", "Правая взрывная батарея", "primary", "battery-right", "explosive", 80, 3, 5, 2, 6, 15, 0],
    ["raptor-beam", "Энергетический луч", "auxiliary", "turret", "energy", 90, 3, 4, 1, 9, 8, 2]
  ]
};

const weaponTuple = weapon => [weapon.id, weapon.name, weapon.role, weapon.mount, weapon.weaponClass, weapon.accuracy, weapon.effectiveRange, weapon.maxRange, weapon.shots, weapon.damage, weapon.critChance, weapon.energyCost];

test("capital builders preserve legacy flat combat profiles", () => {
  for (const [id, expected] of Object.entries(legacyCapitals)) {
    const profile = buildCapitalProfile(id);
    for (const [field, value] of Object.entries(expected)) assert.deepEqual(profile[field], value, `${id}.${field}`);
    assert.deepEqual(profile.weapons.map(weaponTuple), legacyWeapons[id]);
    for (const absent of ["id", "name", "sideId", "color", "position", "heading", "currentEnergy"]) assert.equal(absent in profile, false, `${id}.${absent}`);
    assert.equal("currentEnergy" in profile.reactor, false);
  }
});

test("squadron builders preserve values and use squadronWeapon mount", () => {
  for (const id of ["wasps", "mantis"]) {
    const profile = buildSquadronProfile(id);
    assert.deepEqual({ kind: profile.kind, baseSpeed: profile.baseSpeed, currentSpeed: profile.currentSpeed, initiative: profile.initiative, stack: profile.stack, unitHealth: profile.unitHealth, integrity: profile.integrity }, { kind: "squadron", baseSpeed: 6, currentSpeed: 6, initiative: 4, stack: 3, unitHealth: 5, integrity: 15 });
    assert.deepEqual(weaponTuple(profile.weapons[0]), [`${id === "wasps" ? "wasps" : "mantis"}-front`, "Фронтальная кинетическая атака", "primary", "squadronWeapon", "kinetic", 70, 1, 1, 1, 1, 2, 0]);
  }
});

test("capital hulls require universal engine and reactor slots", () => {
  for (const hull of Object.values(CAPITAL_HULLS)) {
    assert.ok(hull.systemSlots.some(slot => slot.type === "engine" && slot.required));
    assert.ok(hull.systemSlots.some(slot => slot.type === "reactor" && slot.required));
  }
  const config = cloneConfig();
  config.capitalHulls.atlasCruiser.systemSlots = config.capitalHulls.atlasCruiser.systemSlots.filter(slot => slot.type !== "engine");
  assert.throws(() => validateConfig(config), /capitalHulls\.atlasCruiser\.systemSlots: missing required engine slot/);
});

test("validator reports broken references and type incompatibility", () => {
  const missingReference = cloneConfig();
  missingReference.shipLoadouts.atlas.systems.reactor = "missing";
  assert.throws(() => validateConfig(missingReference), /shipLoadouts\.atlas\.systems\.reactor: unknown primary system ID "missing"/);

  const wrongSystemType = cloneConfig();
  wrongSystemType.shipLoadouts.atlas.systems.engine = "atlasReactor";
  assert.throws(() => validateConfig(wrongSystemType), /has type "reactor", expected "engine"/);

  const incompatibleWeapon = cloneConfig();
  incompatibleWeapon.shipLoadouts.atlas.weapons["battery-left"].weaponId = "atlasPlasma";
  assert.throws(() => validateConfig(incompatibleWeapon), /incompatible with battery hardpoint "battery-left"/);

  const unknownMount = cloneConfig();
  unknownMount.capitalHulls.atlasCruiser.hardpoints[0].mount = "typo";
  assert.throws(() => validateConfig(unknownMount), /hardpoint requires role, supported mount and supported type/);

  const incompatibleForwardWeapon = cloneConfig();
  incompatibleForwardWeapon.capitalHulls.swiftFrigate.hardpoints[0] = { id: "kinetic-turret", role: "primary", mount: "forward", type: "forward", orientation: "fore" };
  assert.throws(() => validateConfig(incompatibleForwardWeapon), /incompatible with forward hardpoint "kinetic-turret"/);
});

test("forward hardpoints require fore or aft orientation", () => {
  for (const orientation of ["fore", "aft"]) {
    const config = cloneConfig();
    config.capitalHulls.swiftFrigate.hardpoints[0] = { id: "kinetic-turret", role: "primary", mount: "forward", type: "forward", orientation };
    config.weapons.swiftKineticTurret.compatibleHardpointTypes.push("forward");
    assert.equal(validateConfig(config), true);
  }

  const missingOrientation = cloneConfig();
  missingOrientation.capitalHulls.swiftFrigate.hardpoints[0] = { id: "kinetic-turret", role: "primary", mount: "forward", type: "forward" };
  assert.throws(() => validateConfig(missingOrientation), /orientation: expected "fore" or "aft"/);

  const mismatchedType = cloneConfig();
  mismatchedType.capitalHulls.swiftFrigate.hardpoints[0] = { id: "kinetic-turret", role: "primary", mount: "turret", type: "forward", orientation: "fore" };
  assert.throws(() => validateConfig(mismatchedType), /mount: mount "turret" is incompatible with forward hardpoint type/);

  const capitalSquadronWeapon = cloneConfig();
  capitalSquadronWeapon.capitalHulls.swiftFrigate.hardpoints[0] = { id: "kinetic-turret", role: "primary", mount: "squadronWeapon", type: "squadronWeapon" };
  assert.throws(() => validateConfig(capitalSquadronWeapon), /squadronWeapon hardpoints require a squadron owner/);
});

test("validator reports paths for required builder and UI fields", () => {
  const missingInstallationId = cloneConfig();
  delete missingInstallationId.shipLoadouts.atlas.weapons["battery-left"].id;
  assert.throws(() => validateConfig(missingInstallationId), /shipLoadouts\.atlas\.weapons\.battery-left\.id: expected a nonempty string/);

  const missingEngineThrust = cloneConfig();
  delete missingEngineThrust.primarySystems.atlasEngine.future.thrustUnits;
  assert.throws(() => validateConfig(missingEngineThrust), /primarySystems\.atlasEngine\.future\.thrustUnits: expected a finite number/);

  const missingFormationOffsets = cloneConfig();
  delete missingFormationOffsets.visuals.squadron.formationOffsets[2];
  assert.throws(() => validateConfig(missingFormationOffsets), /visuals\.squadron\.formationOffsets\.2: expected an array/);
});

test("equipped mass is computed from future component masses and remains near combat mass", () => {
  for (const id of Object.keys(legacyCapitals)) {
    const profile = buildCapitalProfile(id);
    assert.ok(Math.abs(profile.equippedMassUnits - profile.mass) <= 1, id);
    assert.equal(profile.mass, legacyCapitals[id].mass);
  }
  for (const system of Object.values(PRIMARY_SYSTEMS)) assert.ok(Number.isFinite(system.future.massUnits));
  for (const weapon of Object.values(WEAPONS)) {
    if (!weapon.compatibleHardpointTypes.includes("squadronWeapon")) assert.ok(Number.isFinite(weapon.future.massUnits));
    else assert.equal("future" in weapon, false);
  }
});

const assertDeepFrozen = value => {
  if (!value || typeof value !== "object") return;
  assert.ok(Object.isFrozen(value));
  Object.values(value).forEach(assertDeepFrozen);
};

test("configuration graph is deeply frozen", () => {
  assertDeepFrozen(CONFIG);
  assert.throws(() => { CONFIG.capitalHulls.atlasCruiser.hardpoints[0].mount = "changed"; }, TypeError);
});

test("visuals preserve every entity SVG, size and squadron formations", () => {
  assert.deepEqual(Object.keys(VISUALS), ["cruiser", "frigate", "destroyer", "battleship", "squadron", "asteroidField", "debrisField", "nebula", "minefield", "largeAsteroid", "station"]);
  for (const visual of Object.values(VISUALS)) {
    assert.match(visual.svg, /<(?:path|circle)/);
    assert.ok([35, 39, 42].includes(visual.size));
  }
  assert.deepEqual(Object.keys(VISUALS.squadron.formationOffsets), ["1", "2", "3"]);
  for (const [count, offsets] of Object.entries(VISUALS.squadron.formationOffsets)) assert.equal(offsets.length, Number(count));
});
