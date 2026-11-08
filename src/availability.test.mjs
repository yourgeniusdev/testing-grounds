import assert from "node:assert/strict";
import test from "node:test";
import { AVAILABILITY_REASON_ORDER, createAvailability } from "./availability-contract.js";
import { confirmWeaponAttackAction, previewWeaponAttack, weaponAttackAvailability } from "./battle.js";
import { actionAvailability, activeUnit, beginActionPlanning, beginActivation, confirmManeuverAction, confirmSystemAction, createBattleState, endActivation, planRoutes, unitById } from "./domain.js";
import { buildManeuverOptions } from "./ui-rules.js";

function activationBattle() {
  const state = createBattleState();
  const atlas = unitById(state, "atlas");
  const bastion = unitById(state, "bastion");
  state.scenario.contents = [];
  state.units = [atlas, bastion];
  state.initiativeOrder = [atlas.id, bastion.id];
  state.activeUnitId = atlas.id;
  state.lifecycle = "WaitDecision";
  atlas.position = { q: 0, r: 0 };
  atlas.heading = 0;
  bastion.position = { q: 2, r: 0 };
  beginActivation(state);
  return { state, atlas, bastion };
}

function codes(result) {
  return result.reasons.map(reason => reason.code);
}

test("all activation choices expose one frozen availability contract", () => {
  const { state, atlas } = activationBattle();
  const requests = [
    { type: "maneuver" },
    { type: "disengage" },
    ...Object.keys({ "evasive-maneuver": true, "reactor-to-engines": true }).map(systemActionId => ({ type: "system-action", systemActionId })),
    ...atlas.weapons.map(weapon => ({ type: "weapon-attack", slotId: weapon.id })),
    { type: "end-activation" }
  ];
  for (const request of requests) {
    const availability = actionAvailability(state, request);
    assert.equal(typeof availability.available, "boolean");
    assert.equal(Object.isFrozen(availability), true);
    assert.deepEqual(availability.resources.speed, { spent: availability.resources.speed.spent, remaining: availability.resources.speed.remaining, capacity: availability.resources.speed.capacity });
    assert.deepEqual(Object.keys(availability.forecast.cost), ["speed", "maneuver", "energy"]);
  }
});

test("availability snapshots caller-owned nested action and option before freezing", () => {
  const option = { route: [{ q: 1, r: undefined }], modifiers: { speed: 2 } };
  const action = { type: "maneuver", option };
  const contract = createAvailability({ action });

  assert.equal(Object.isFrozen(action), false);
  assert.equal(Object.isFrozen(option), false);
  assert.equal(Object.isFrozen(option.route), false);
  assert.equal(Object.isFrozen(option.route[0]), false);
  action.type = "changed";
  option.route[0].q = 9;
  option.modifiers.speed = 3;
  option.route.push({ q: 2, r: 0 });

  assert.notEqual(contract.action, action);
  assert.notEqual(contract.action.option, option);
  assert.notEqual(contract.action.option.route, option.route);
  assert.equal(contract.action.type, "maneuver");
  assert.deepEqual(contract.action.option, { route: [{ q: 1, r: undefined }], modifiers: { speed: 2 } });
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(Object.isFrozen(contract.action), true);
  assert.equal(Object.isFrozen(contract.action.option), true);
  assert.equal(Object.isFrozen(contract.action.option.route), true);
  assert.equal(Object.isFrozen(contract.action.option.route[0]), true);
});

test("stable reason codes are ordered independent of validation discovery", () => {
  const { state, atlas, bastion } = activationBattle();
  const slot = atlas.weapons[0];
  slot.targetKinds = ["squadron"];
  slot.mount = "battery-left";
  slot.maxRange = 1;
  slot.energyCost = 99;
  slot.firedThisRound = true;
  bastion.position = { q: 3, r: 0 };
  const result = weaponAttackAvailability(state, atlas.id, slot.id, bastion.id);
  assert.deepEqual(codes(result), ["action.not-ready", "resource.insufficient", "target.invalid-kind", "target.out-of-arc", "target.out-of-range"]);
  assert.deepEqual(codes(result), [...codes(result)].sort((left, right) => AVAILABILITY_REASON_ORDER.indexOf(left) - AVAILABILITY_REASON_ORDER.indexOf(right)));
  assert.deepEqual(result.reasons.find(reason => reason.code === "resource.insufficient").params, { resource: "energy", required: 99, available: atlas.reactor.currentEnergy });
});

test("contract distinguishes interception, readiness, target kind, arc, range, line of fire, and resolving", () => {
  const { state, atlas, bastion } = activationBattle();
  const squadron = unitById(createBattleState(), "wasps");
  state.units.push(squadron);
  squadron.engagedWith = ["enemy"];
  state.activeUnitId = squadron.id;
  assert.deepEqual(codes(actionAvailability(state, { type: "maneuver" })), []);

  state.activeUnitId = atlas.id;
  const slot = atlas.weapons[0];
  slot.firedThisRound = true;
  assert.ok(codes(actionAvailability(state, { type: "weapon-attack", slotId: slot.id })).includes("action.not-ready"));
  slot.firedThisRound = false;
  slot.targetKinds = ["squadron"];
  slot.mount = "battery-left";
  slot.maxRange = 1;
  slot.requiresClearLineOfFire = true;
  state.units.push({ ...bastion, id: "blocker", position: { q: 1, r: 0 }, mass: 200 });
  const target = weaponAttackAvailability(state, atlas.id, slot.id, bastion.id);
  assert.ok(codes(target).includes("target.invalid-kind"));
  assert.ok(codes(target).includes("target.out-of-arc"));
  assert.ok(codes(target).includes("target.out-of-range"));
  assert.ok(codes(target).includes("target.line-of-fire-blocked"));
  state.attackApplication = { planId: "busy" };
  assert.equal(codes(actionAvailability(state, { type: "end-activation" }))[0], "action.another-resolving");
});

test("weapon preview cost and charged cost are identical", () => {
  const { state, atlas, bastion } = activationBattle();
  const slot = atlas.weapons.find(weapon => weapon.id === "atlas-forward");
  slot.mount = "turret";
  slot.energyCost = 2;
  beginActionPlanning(state, { type: "weapon-attack", slotId: slot.id, reason: "player-choice" });
  const preview = previewWeaponAttack(state, atlas.id, slot.id, bastion.id);
  const before = atlas.energySpent;
  const plan = confirmWeaponAttackAction(state, atlas.id, slot.id, bastion.id, () => 100, () => 0);
  assert.ok(plan);
  assert.equal(atlas.energySpent - before, preview.availability.forecast.cost.energy);
  assert.deepEqual(preview.availability.forecast.resources.energy, { capacity: preview.availability.resources.energy.capacity, spent: before + 2, remaining: preview.availability.resources.energy.remaining - 2 });
});

test("confirmations reject stale and forged availability input without mutation", async t => {
  await t.test("maneuver", () => {
    const { state, atlas } = activationBattle();
    beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
    const option = buildManeuverOptions(atlas, planRoutes(state, atlas, "safe").get("1,0:0"))[0];
    const forged = structuredClone(option);
    forged.resources.speed.spent = 0;
    const before = structuredClone({ atlas, events: state.events });
    assert.equal(confirmManeuverAction(state, forged), null);
    assert.deepEqual({ atlas, events: state.events }, before);
  });
  await t.test("system action", () => {
    const { state, atlas } = activationBattle();
    beginActionPlanning(state, { type: "system-action", systemActionId: "evasive-maneuver", reason: "player-choice" });
    atlas.maneuverSpent = atlas.maneuver;
    atlas.maneuverRemaining = 0;
    const before = structuredClone({ atlas, events: state.events });
    assert.equal(confirmSystemAction(state, { available: true, forecast: { cost: { maneuver: 0 } } }), null);
    assert.deepEqual({ atlas, events: state.events }, before);
  });
  await t.test("end activation while resolving", () => {
    const { state } = activationBattle();
    state.attackApplication = { planId: "forged-busy" };
    const before = structuredClone({ state: { ...state, rng: null } });
    assert.equal(endActivation(state), null);
    assert.deepEqual({ state: { ...state, rng: null } }, before);
    assert.equal(activeUnit(state).hasActivated, false);
  });
});
