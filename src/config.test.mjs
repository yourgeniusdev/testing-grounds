import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCapitalProfile,
  buildSquadronProfile,
  CAPITAL_HULLS,
  CONFIG,
  PRIMARY_SYSTEMS,
  SYSTEM_ACTIONS,
  validateConfig,
  VISUALS,
  WEAPONS,
  weapon,
  weaponVariant
} from "./config/index.js";

const cloneConfig = () => structuredClone(CONFIG);

const assertDeepFrozen = value => {
  if (!value || typeof value !== "object") return;
  assert.ok(Object.isFrozen(value));
  Object.values(value).forEach(assertDeepFrozen);
};

const runtimeFields = ["catalogWeaponId", "delivery", "targetKinds", "cooldownRounds", "ready", "firedThisRound", "cooldownRemaining", "visual"];

test("independent weapon catalog has neutral IDs, complete combat data and no ship-specific models", () => {
  assert.deepEqual(Object.keys(WEAPONS), [
    "wardAutocannon", "needleAutocannon", "twinNeedleAutocannon", "sentinelAutocannon", "rayAALaser", "lanceBeam", "torchPlasmaCannon", "stormKineticBattery",
    "hailMissileBattery", "titanRailgun", "focusEmitter", "spearMissile", "impulseTurret", "hammerTorpedo"
  ]);
  for (const entry of Object.values(WEAPONS)) {
    for (const field of ["delivery", "targetKinds", "effectiveRange", "maxRange", "cooldownRounds", "visual"]) assert.ok(field in entry, `${entry.id}.${field}`);
    assert.doesNotMatch(entry.id, /atlas|swift|bastion|raptor/i);
  }
  assert.equal(validateConfig(CONFIG), true);
});

test("system action catalog is part of the validated frozen configuration graph", () => {
  assert.equal(CONFIG.systemActions, SYSTEM_ACTIONS);
  assertDeepFrozen(SYSTEM_ACTIONS);
  const cases = [
    [config => { config.systemActions["reactor-to-engines"].id = "forged"; }, /expected "reactor-to-engines"/],
    [config => { config.systemActions["reactor-to-engines"].cost.energy = -1; }, /nonnegative integer/],
    [config => { config.systemActions["reactor-to-engines"].effect = "unknown"; }, /unknown system action effect/],
    [config => { config.systemActions["reactor-to-engines"].oncePerActivation = "yes"; }, /expected a boolean/]
  ];
  for (const [mutate, expected] of cases) {
    const config = cloneConfig();
    mutate(config);
    assert.throws(() => validateConfig(config), expected);
  }
});

test("weapon variants deep-merge visuals, retain provenance and materialize independent frozen objects", () => {
  const base = weapon({
    id: "base", name: "Base", compatibleHardpointTypes: ["turret"], weaponClass: "energy", delivery: "beam", targetKinds: ["capital"],
    accuracy: 50, effectiveRange: 1, maxRange: 2, shots: 1, damage: 1, critChance: 0, energyCost: 0, cooldownRounds: 0,
    visual: { projectile: "beam", color: "#fff", size: 0.1, speedHexesPerSecond: 10, launchIntervalMs: 0, trail: "none", impact: "spark", impactRadius: 0.1 },
    future: { massUnits: 1 }
  });
  const variant = weaponVariant(base, { id: "variant", name: "Variant", shots: 2, visual: { color: "#000" } });
  assert.equal(variant.variantOf, "base");
  assert.equal(variant.visual.projectile, "beam");
  assert.equal(variant.visual.color, "#000");
  assert.notEqual(variant.visual, base.visual);
  assertDeepFrozen(variant);
  assert.throws(() => weaponVariant(variant, { id: "chain", name: "Chain" }), /cannot derive/);
  assert.throws(() => weaponVariant(base, { id: "changed", name: "Changed", weaponClass: "kinetic" }), /weaponClass/);
  assert.throws(() => weaponVariant(base, { id: "changed", name: "Changed", delivery: "projectile" }), /delivery/);
  assert.throws(() => weaponVariant(base, { id: "changed", name: "Changed", compatibleHardpointTypes: ["forward"] }), /compatibleHardpointTypes/);
  assert.throws(() => weaponVariant(base, { id: "changed", name: "Changed", future: { massUnits: 2 } }), /cannot override future/);
  assert.throws(() => weaponVariant(base, { id: "changed", name: "Changed", variantOf: "other" }), /cannot override variantOf/);
  assert.equal(weapon({ id: "default-cooldown" }).cooldownRounds, 0);
});

test("catalog validation enforces classes, delivery, targets, ranges, cooldowns, visuals and AA mounts", () => {
  const cases = [
    [config => { config.weapons.focusEmitter.weaponClass = "unknown"; }, /unknown weapon class/],
    [config => { config.weapons.focusEmitter.delivery = "torpedo"; }, /requires explosive weapon class/],
    [config => { config.weapons.focusEmitter.targetKinds = []; }, /expected a nonempty array/],
    [config => { config.weapons.focusEmitter.targetKinds = ["station"]; }, /unknown target kind/],
    [config => { config.weapons.focusEmitter.shots = 0; }, /positive integer/],
    [config => { config.weapons.focusEmitter.damage = 1.5; }, /positive integer/],
    [config => { config.weapons.focusEmitter.accuracy = 101; }, /0 to 100/],
    [config => { config.weapons.focusEmitter.critChance = -1; }, /0 to 100/],
    [config => { config.weapons.focusEmitter.effectiveRange = 4; }, /cannot exceed maxRange/],
    [config => { config.weapons.focusEmitter.cooldownRounds = -1; }, /nonnegative integer/],
    [config => { config.weapons.focusEmitter.visual.trail = "long"; }, /unknown trail/],
    [config => { config.weapons.focusEmitter.visual.size = 2; }, /at most 1 hex/],
    [config => { config.weapons.titanRailgun.targetKinds.push("squadron"); }, /AA targeting is only valid/]
  ];
  for (const [mutate, expected] of cases) {
    const config = cloneConfig();
    mutate(config);
    assert.throws(() => validateConfig(config), expected);
  }
});

test("compatible hardpoint arrays structurally support several known types", () => {
  const config = cloneConfig();
  config.weapons.impulseTurret.compatibleHardpointTypes.push("forward");
  assert.equal(validateConfig(config), true);
});

test("variant validation verifies parent existence, depth and immutable model properties", () => {
  const missing = cloneConfig();
  missing.weapons.twinNeedleAutocannon.variantOf = "missing";
  assert.throws(() => validateConfig(missing), /unknown weapon parent ID/);

  const chained = cloneConfig();
  chained.weapons.needleAutocannon.variantOf = "twinNeedleAutocannon";
  assert.throws(() => validateConfig(chained), /variant chains deeper than one level/);

  const incompatible = cloneConfig();
  incompatible.weapons.twinNeedleAutocannon.compatibleHardpointTypes = ["turret"];
  assert.throws(() => validateConfig(incompatible), /cannot change compatibleHardpointTypes/);

  const changedDelivery = cloneConfig();
  changedDelivery.weapons.needleAutocannon.weaponClass = "explosive";
  changedDelivery.weapons.needleAutocannon.delivery = "missile";
  changedDelivery.weapons.needleAutocannon.visual.projectile = "missile";
  changedDelivery.weapons.twinNeedleAutocannon.weaponClass = "explosive";
  changedDelivery.weapons.twinNeedleAutocannon.delivery = "torpedo";
  changedDelivery.weapons.twinNeedleAutocannon.visual.projectile = "torpedo";
  assert.throws(() => validateConfig(changedDelivery), /variant cannot change delivery/);

  const changedTargetKinds = cloneConfig();
  changedTargetKinds.weapons.twinNeedleAutocannon.targetKinds = ["capital"];
  assert.equal(validateConfig(changedTargetKinds), true);
});

test("real capital loadouts use reusable weapons in stable hardpoint order and Atlas has a fore weapon", () => {
  const atlas = buildCapitalProfile("atlas");
  assert.deepEqual(atlas.weapons.map(entry => entry.catalogWeaponId), ["stormKineticBattery", "stormKineticBattery", "focusEmitter"]);
  assert.deepEqual(atlas.weapons.map(entry => entry.id), ["atlas-battery-left", "atlas-battery-right", "atlas-forward"]);
  assert.deepEqual({ mount: atlas.weapons[2].mount, orientation: atlas.weapons[2].orientation }, { mount: "forward", orientation: "fore" });
  assert.deepEqual(buildCapitalProfile("swift").weapons.map(entry => entry.catalogWeaponId), ["focusEmitter", "rayAALaser"]);
  const corvette = buildCapitalProfile("dart");
  assert.deepEqual(corvette.weapons.map(entry => entry.catalogWeaponId), ["sentinelAutocannon"]);
  assert.deepEqual({ hullType: corvette.hullType, speed: corvette.baseSpeed, maneuver: corvette.maneuver, integrity: corvette.integrity }, { hullType: "corvette", speed: 6, maneuver: 4, integrity: 30 });
  assert.ok(corvette.integrity < buildCapitalProfile("swift").integrity);
  assert.deepEqual(buildCapitalProfile("bastion").weapons.map(entry => entry.catalogWeaponId), ["titanRailgun", "hailMissileBattery", "hailMissileBattery", "sentinelAutocannon"]);
  assert.deepEqual(buildCapitalProfile("raptor").weapons.map(entry => entry.catalogWeaponId), ["focusEmitter", "wardAutocannon", "impulseTurret"]);
  for (const profile of [atlas, buildCapitalProfile("dart"), buildCapitalProfile("swift"), buildCapitalProfile("bastion"), buildCapitalProfile("raptor")]) {
    for (const entry of profile.weapons) {
      assert.equal("role" in entry, false);
      for (const field of runtimeFields) assert.ok(field in entry, `${entry.id}.${field}`);
      assertDeepFrozen(entry);
    }
  }
});

test("squadron models and loadouts have agreed stats and stack-scalable base weapons", () => {
  const wasps = buildSquadronProfile("wasps");
  assert.deepEqual({ speed: wasps.baseSpeed, maneuver: wasps.maneuver, initiative: wasps.initiative, evasion: wasps.baseEvasion, stack: wasps.stack, unitHealth: wasps.unitHealth }, { speed: 6, maneuver: 5, initiative: 5, evasion: 10, stack: 3, unitHealth: 5 });
  assert.ok(wasps.maneuver > buildCapitalProfile("swift").maneuver);
  assert.deepEqual(wasps.weapons.map(entry => [entry.catalogWeaponId, entry.shots * wasps.stack]), [["twinNeedleAutocannon", 6]]);
  const mantis = buildSquadronProfile("mantis");
  assert.deepEqual({ speed: mantis.baseSpeed, maneuver: mantis.maneuver, initiative: mantis.initiative, evasion: mantis.baseEvasion, stack: mantis.stack, unitHealth: mantis.unitHealth }, { speed: 3, maneuver: 4, initiative: 3, evasion: 2, stack: 3, unitHealth: 8 });
  assert.ok(mantis.maneuver > buildCapitalProfile("raptor").maneuver);
  assert.deepEqual(mantis.weapons.map(entry => [entry.catalogWeaponId, entry.shots * mantis.stack]), [["needleAutocannon", 3], ["hammerTorpedo", 3]]);
  assert.deepEqual(mantis.weapons.map(entry => entry.targetKinds), [["capital", "squadron"], ["capital"]]);
  const kiro = buildSquadronProfile("kiro");
  assert.deepEqual(
    { craftType: kiro.craftType, speed: kiro.baseSpeed, maneuver: kiro.maneuver, initiative: kiro.initiative, stack: kiro.stack, unitHealth: kiro.unitHealth, shield: kiro.shield, armor: kiro.armor, integrity: kiro.integrity },
    { craftType: "assaultCraft", speed: 5, maneuver: 4, initiative: 5, stack: 1, unitHealth: 18, shield: 10, armor: 0, integrity: 18 }
  );
  assert.ok(kiro.unitHealth > wasps.unitHealth);
  assert.deepEqual(
    [wasps.baseSpeed - kiro.baseSpeed, wasps.maneuver - kiro.maneuver, wasps.initiative - kiro.initiative],
    [1, 1, 1]
  );
  assert.deepEqual(kiro.weapons.map(entry => [entry.catalogWeaponId, entry.mount, entry.targetKinds, entry.damage]), [["lanceBeam", "turret", ["capital", "squadron"], 10]]);
});

test("all current squadron slots use forward firing geometry without changing compatibility", () => {
  for (const loadoutId of ["wasps", "mantis"]) {
    const profile = buildSquadronProfile(loadoutId);
    for (const entry of profile.weapons) {
      assert.equal(entry.hardpointType, "squadronWeapon");
      assert.equal(entry.mount, "squadronWeapon");
      assert.equal(entry.firingArc, "forward");
    }
  }
});

test("squadron firing geometry is validated separately from hardpoint compatibility", () => {
  const missing = cloneConfig();
  delete missing.squadronModels.wasp.hardpoints[0].firingArc;
  assert.throws(() => validateConfig(missing), /firingArc.*expected/);

  const unknown = cloneConfig();
  unknown.squadronModels.mantis.hardpoints[0].firingArc = "squadronWeapon";
  assert.throws(() => validateConfig(unknown), /unknown firing arc/);

  const capital = cloneConfig();
  capital.capitalHulls.swiftFrigate.hardpoints[0].firingArc = "forward";
  assert.throws(() => validateConfig(capital), /only valid on squadronWeapon hardpoints/);
});

test("squadron maneuver and renderable stack are validated", () => {
  const missing = cloneConfig();
  delete missing.squadronModels.wasp.maneuver;
  assert.throws(() => validateConfig(missing), /maneuver.*finite number/);
  const negative = cloneConfig();
  negative.squadronModels.mantis.maneuver = -1;
  assert.throws(() => validateConfig(negative), /maneuver.*nonnegative/);
  for (const stack of [0, 4, 1.5]) {
    const invalid = cloneConfig();
    invalid.squadronModels.kiro.stack = stack;
    assert.throws(() => validateConfig(invalid), /stack.*integer from 1 to 3/);
  }
});

test("roles are rejected in hardpoints and installations", () => {
  const hardpoint = cloneConfig();
  hardpoint.capitalHulls.atlasCruiser.hardpoints[0].role = "primary";
  assert.throws(() => validateConfig(hardpoint), /weapon roles are not supported/);
  const installation = cloneConfig();
  installation.shipLoadouts.atlas.weapons["battery-left"].role = "primary";
  assert.throws(() => validateConfig(installation), /weapon roles are not supported/);
});

test("validator reports broken references, mounts, orientations and squadron-only mounts", () => {
  const missingReference = cloneConfig();
  missingReference.shipLoadouts.atlas.systems.reactor = "missing";
  assert.throws(() => validateConfig(missingReference), /unknown primary system ID "missing"/);

  const unknownMount = cloneConfig();
  unknownMount.capitalHulls.atlasCruiser.hardpoints[0].mount = "typo";
  assert.throws(() => validateConfig(unknownMount), /unknown hardpoint mount/);

  const missingOrientation = cloneConfig();
  delete missingOrientation.capitalHulls.atlasCruiser.hardpoints[2].orientation;
  assert.throws(() => validateConfig(missingOrientation), /expected "fore" or "aft"/);

  const capitalSquadronWeapon = cloneConfig();
  capitalSquadronWeapon.capitalHulls.swiftFrigate.hardpoints[0] = { id: "autocannon-turret", mount: "squadronWeapon", type: "squadronWeapon" };
  assert.throws(() => validateConfig(capitalSquadronWeapon), /squadronWeapon hardpoints require a squadron owner/);
});

test("balance invariants distinguish spinal, batteries, AA, torpedo and missiles", () => {
  const titan = WEAPONS.titanRailgun;
  assert.equal(titan.maxRange, Math.max(...Object.values(WEAPONS).map(entry => entry.maxRange)));
  assert.equal(titan.damage, Math.max(...Object.values(WEAPONS).map(entry => entry.damage)));
  for (const entry of Object.values(WEAPONS).filter(entry => entry.compatibleHardpointTypes.includes("battery"))) {
    assert.ok(entry.shots * entry.damage >= 16);
    assert.deepEqual(entry.targetKinds, ["capital"]);
  }
  for (const id of ["sentinelAutocannon", "rayAALaser"]) {
    assert.ok(WEAPONS[id].accuracy >= 88);
    assert.ok(WEAPONS[id].maxRange <= 3);
    assert.ok(WEAPONS[id].damage < titan.damage);
  }
  const torpedo = WEAPONS.hammerTorpedo;
  assert.equal(torpedo.delivery, "torpedo");
  assert.deepEqual(torpedo.targetKinds, ["capital"]);
  assert.ok(torpedo.accuracy < WEAPONS.needleAutocannon.accuracy);
  assert.ok(torpedo.damage > WEAPONS.needleAutocannon.damage);
  assert.ok(torpedo.visual.speedHexesPerSecond < WEAPONS.hailMissileBattery.visual.speedHexesPerSecond);
  assert.ok(Math.abs(torpedo.visual.size / WEAPONS.hailMissileBattery.visual.size - 1.5) < 0.01);
  assert.ok(Math.abs(torpedo.visual.impactRadius / WEAPONS.hailMissileBattery.visual.impactRadius - 1.5) < 0.01);
  assert.equal(WEAPONS.spearMissile.shots, 1);
  assert.equal(WEAPONS.hailMissileBattery.shots, 3);
});

test("equipped mass remains near combat mass", () => {
  for (const id of ["atlas", "dart", "swift", "bastion", "raptor"]) {
    const profile = buildCapitalProfile(id);
    assert.ok(Math.abs(profile.equippedMassUnits - profile.mass) <= 1, id);
  }
  for (const system of Object.values(PRIMARY_SYSTEMS)) assert.ok(Number.isFinite(system.future.massUnits));
});

test("approved profiles, crew metadata and overwatch references are exact", () => {
  for (const [id, shield, armor, integrity, crew, initiative] of [["dart", 11, 8, 30, 50, 5], ["swift", 18, 14, 45, 70, 5], ["raptor", 23, 23, 60, 100, 4], ["atlas", 32, 32, 65, 140, 2], ["bastion", 46, 55, 100, 200, 1]]) {
    const profile = buildCapitalProfile(id);
    assert.deepEqual([profile.shield, profile.armor, profile.integrity, profile.crewRequirement, profile.initiative], [shield, armor, integrity, crew, initiative]);
    assert.equal(profile.mass, profile.equippedMassUnits);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(WEAPONS).map(([id, entry]) => [id, entry.accuracy])), {
    wardAutocannon: 90, needleAutocannon: 80, twinNeedleAutocannon: 80, sentinelAutocannon: 92, rayAALaser: 95, lanceBeam: 90, torchPlasmaCannon: 88, stormKineticBattery: 82, hailMissileBattery: 85, titanRailgun: 80, focusEmitter: 91, spearMissile: 76, impulseTurret: 91, hammerTorpedo: 70
  });
  assert.deepEqual([WEAPONS.titanRailgun.damage, WEAPONS.titanRailgun.energyCost, WEAPONS.titanRailgun.cooldownRounds], [30, 4, 2]);
  assert.equal(WEAPONS.hailMissileBattery.cooldownRounds, 1);
  assert.deepEqual([WEAPONS.lanceBeam.energyCost, WEAPONS.lanceBeam.cooldownRounds], [0, 0]);
  const hornet = buildSquadronProfile("hornet");
  assert.deepEqual([hornet.stack, hornet.unitHealth, hornet.shield, hornet.armor, hornet.baseSpeed, hornet.maneuver, hornet.initiative, hornet.baseEvasion, hornet.crewRequirement], [2, 4, 0, 0, 6, 6, 6, 16, 30]);
  assert.deepEqual(hornet.weapons.map(slot => slot.catalogWeaponId), ["twinNeedleAutocannon", "twinNeedleAutocannon"]);
  for (const [id, crew] of [["wasps", 20], ["mantis", 25], ["kiro", 30]]) {
    const profile = buildSquadronProfile(id);
    assert.equal(profile.crewRequirement, crew);
    assert.deepEqual(profile.overwatchHardpointIds, []);
  }
  assert.equal(buildSquadronProfile("kiro").baseEvasion, 10);
  for (const ids of [["missing"], ["autocannon", "autocannon"]]) {
    const config = cloneConfig();
    config.squadronModels.wasp.overwatchHardpointIds = ids;
    assert.throws(() => validateConfig(config), /hardpoint ID/);
  }
  const forward = cloneConfig();
  forward.weapons.focusEmitter.targetKinds.push("squadron");
  assert.equal(validateConfig(forward), true);
  const battery = cloneConfig();
  battery.weapons.stormKineticBattery.targetKinds.push("squadron");
  assert.throws(() => validateConfig(battery), /AA targeting/);
});

test("configuration graph is deeply frozen", () => {
  assertDeepFrozen(CONFIG);
  assert.throws(() => { CONFIG.capitalHulls.atlasCruiser.hardpoints[0].mount = "changed"; }, TypeError);
});

test("visuals preserve every entity SVG, class scale and squadron formations", () => {
  assert.deepEqual(Object.keys(VISUALS), ["cruiser", "corvette", "frigate", "destroyer", "battleship", "squadron", "interceptor", "bomber", "assaultCraft", "asteroidField", "debrisField", "nebula", "minefield", "largeAsteroid", "station"]);
  for (const visual of Object.values(VISUALS)) {
    assert.match(visual.svg, /<(?:path|circle)/);
    assert.ok(Number.isFinite(visual.size) && visual.size > 0);
  }
  assert.deepEqual(
    Object.fromEntries(["squadron", "bomber", "assaultCraft", "corvette", "frigate", "destroyer", "cruiser", "battleship"].map(id => [id, VISUALS[id].size])),
    { squadron: 25, bomber: 25, assaultCraft: 27, corvette: 29, frigate: 34, destroyer: 38, cruiser: 56, battleship: 68 }
  );
});
