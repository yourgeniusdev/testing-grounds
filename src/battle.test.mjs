import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAttackStep,
  availableWeaponAttackTargets,
  confirmWeaponAttack,
  previewWeaponAttack,
  resolvePostEntryAA,
  supercoverLine,
  weaponAttackArc
} from "./battle.js";
import {
  advanceWeaponRound,
  beginWeaponCooldown,
  createBattleState,
  endActivation,
  initializeWeaponState,
  resetUnitWeaponsForNewRound,
  weaponReadiness
} from "./domain.js";

function weapon(overrides = {}) {
  return {
    id: "slot-a",
    weaponId: "catalog-a",
    slotOrder: 0,
    name: "Орудие A",
    mount: "turret",
    orientation: null,
    weaponClass: "kinetic",
    delivery: "projectile",
    targetKinds: ["capital"],
    accuracy: 80,
    effectiveRange: 3,
    maxRange: 6,
    shots: 1,
    damage: 4,
    critChance: 0,
    energyCost: 0,
    cooldownRounds: 0,
    firedThisRound: false,
    cooldownRemaining: 0,
    overwatch: false,
    visual: { projectile: "tracer", color: "#fff", size: 0.1, speedHexesPerSecond: 5, launchIntervalMs: 100, trail: "short", impact: "spark", impactRadius: 0.1 },
    ...overrides
  };
}

function unit(overrides = {}) {
  return {
    id: "attacker",
    name: "Атакующий",
    sideId: "azure",
    kind: "capital",
    position: { q: 0, r: 0 },
    heading: 0,
    shield: 0,
    armor: 0,
    integrity: 20,
    maxShield: 0,
    maxArmor: 0,
    maxIntegrity: 20,
    baseEvasion: 0,
    movementEvasion: 0,
    criticals: [],
    stack: 1,
    weapons: [],
    reactor: null,
    ...overrides
  };
}

function battle(weapons, targetOverrides = {}) {
  const attacker = unit({ weapons });
  const target = unit({ id: "target", name: "Цель", sideId: "crimson", position: { q: 2, r: 0 }, shield: 8, armor: 8, integrity: 12, maxShield: 8, maxArmor: 8, maxIntegrity: 12, ...targetOverrides });
  const state = {
    scenario: { id: "test", bounds: { minCol: -8, maxCol: 8, minRow: -8, maxRow: 8 }, contents: [] },
    units: [attacker, target],
    activeUnitId: attacker.id,
    initiativeOrder: [attacker.id, target.id],
    stage: "attack",
    lifecycle: "Attack",
    roundNumber: 1,
    winner: null,
    log: [],
    events: [],
    sequence: 0
  };
  return { state, attacker, target };
}

function applyPlan(state, plan) {
  for (let index = 0; index < plan.steps.length; index++) assert.equal(applyAttackStep(state, plan, index).status, "applied");
}

test("weapon readiness is derived and shared by manual fire and overwatch", () => {
  const slot = initializeWeaponState(weapon({ cooldownRounds: 1 }), 3);
  assert.deepEqual(weaponReadiness(slot), { ready: true, reason: null });
  assert.equal(beginWeaponCooldown(slot), true);
  assert.deepEqual(weaponReadiness(slot), { ready: false, reason: "Уже стреляло в этом раунде" });
  assert.equal(slot.overwatch, false);
  advanceWeaponRound(slot);
  assert.deepEqual(weaponReadiness(slot), { ready: false, reason: "Перезарядка: 1" });
  advanceWeaponRound(slot);
  assert.deepEqual(weaponReadiness(slot), { ready: true, reason: null });
  resetUnitWeaponsForNewRound({ weapons: [slot] });
  assert.equal("ready" in slot, false);
});

test("single-slot preview is pure and exposes domain reasons", () => {
  const gun = weapon({ energyCost: 2 });
  const { state, attacker, target } = battle([gun]);
  attacker.reactor = { capacity: 4, currentEnergy: 4, rechargeRate: 1 };
  const before = structuredClone(state);
  const preview = previewWeaponAttack(state, attacker.id, gun.id, target.id);
  assert.equal(preview.canConfirm, true);
  assert.deepEqual(preview.reasons, []);
  assert.deepEqual({ shots: preview.shots, effectiveRange: preview.effectiveRange, maxRange: preview.maxRange }, { shots: 1, effectiveRange: 3, maxRange: 6 });
  assert.deepEqual(state, before);
  assert.deepEqual(previewWeaponAttack(state, "missing", gun.id, target.id).reasons, ["Атакующий отсутствует"]);
  assert.deepEqual(previewWeaponAttack(state, attacker.id, "missing", target.id).reasons, ["Оружейный слот отсутствует"]);
  assert.deepEqual(previewWeaponAttack(state, attacker.id, gun.id, "missing").reasons, ["Цель отсутствует"]);
  target.position = { q: 7, r: 0 };
  assert.deepEqual(previewWeaponAttack(state, attacker.id, gun.id, target.id).reasons, ["Вне дальности"]);
});

test("squadron preview scales shots from its surviving stack", () => {
  const gun = weapon({ targetKinds: ["capital", "squadron"], shots: 2 });
  const { state, attacker, target } = battle([gun]);
  attacker.kind = "squadron";
  attacker.stack = 3;
  assert.equal(previewWeaponAttack(state, attacker.id, gun.id, target.id).shots, 6);
});

test("confirming one slot spends it and energy exactly once before resolution", () => {
  const gun = weapon({ shots: 2, energyCost: 2, cooldownRounds: 1 });
  const reserve = weapon({ id: "reserve", slotOrder: 1 });
  const { state, attacker, target } = battle([gun, reserve]);
  attacker.reactor = { capacity: 5, currentEnergy: 5, rechargeRate: 1 };
  const plan = confirmWeaponAttack(state, attacker.id, gun.id, target.id, () => 100, () => 0);
  assert.ok(plan);
  assert.equal(plan.slotId, gun.id);
  assert.equal(plan.steps.length, 2);
  assert.equal(Object.isFrozen(plan.steps[0]), true);
  assert.equal(attacker.reactor.currentEnergy, 3);
  assert.equal(gun.firedThisRound, true);
  assert.equal(reserve.firedThisRound, false);
  assert.equal(confirmWeaponAttack(state, attacker.id, reserve.id, target.id, () => 1, () => 0), null);
  assert.equal(endActivation(state), null);
  applyPlan(state, plan);
  assert.equal(attacker.reactor.currentEnergy, 3);
  assert.equal(state.stage, "attack");
});

test("applyAttackStep rejects forged and stale plans without replacing confirmed progress", () => {
  const gun = weapon({ shots: 2 });
  const { state, attacker, target } = battle([gun]);
  const plan = confirmWeaponAttack(state, attacker.id, gun.id, target.id, () => 1, () => 0);
  const forged = structuredClone(plan);
  forged.id = "forged-plan";
  const copied = structuredClone(plan);
  const progress = state.attackApplication;
  const before = structuredClone({ progress, target, events: state.events, log: state.log });
  assert.deepEqual(applyAttackStep(state, forged, 0), { status: "invalid" });
  assert.deepEqual(applyAttackStep(state, copied, 0), { status: "invalid" });
  assert.equal(state.attackApplication, progress);
  assert.deepEqual({ progress: state.attackApplication, target, events: state.events, log: state.log }, before);
  applyPlan(state, plan);
  const completed = structuredClone({ target, events: state.events, log: state.log });
  assert.deepEqual(applyAttackStep(state, plan, 0), { status: "invalid" });
  assert.equal(state.attackApplication, null);
  assert.deepEqual({ target, events: state.events, log: state.log }, completed);
});

test("manual damage events retain the confirmed attack action and plan context", () => {
  const gun = weapon({ damage: 40 });
  const { state, attacker, target } = battle([gun], { shield: 0, armor: 0, integrity: 30 });
  const survivor = unit({ id: "survivor", sideId: "crimson", position: { q: 4, r: 0 } });
  state.units.push(survivor);
  state.initiativeOrder.push(survivor.id);
  const plan = confirmWeaponAttack(state, attacker.id, gun.id, target.id, () => 1, () => 0);
  const declaration = state.events.find(event => event.action === "weapon-attack-confirm");
  applyPlan(state, plan);
  const damage = state.events.find(event => event.action === "damage");
  const destruction = state.events.find(event => event.action === "destroy");
  assert.equal(plan.actionId, declaration.eventId);
  assert.deepEqual(
    { planId: damage.planId, actionId: damage.actionId, causeEventId: damage.causeEventId },
    { planId: plan.id, actionId: declaration.eventId, causeEventId: declaration.eventId }
  );
  assert.deepEqual(
    { planId: destruction.planId, actionId: destruction.actionId, causeEventId: destruction.causeEventId },
    { planId: plan.id, actionId: declaration.eventId, causeEventId: damage.eventId }
  );
});

test("sequential attacks have distinct action contexts and may choose different targets", () => {
  const first = weapon({ id: "first" });
  const second = weapon({ id: "second", slotOrder: 1 });
  const { state, attacker, target } = battle([first, second]);
  const other = unit({ id: "other", sideId: "crimson", position: { q: 3, r: 0 }, shield: 8, armor: 8, integrity: 12 });
  state.units.push(other);
  const firstPlan = confirmWeaponAttack(state, attacker.id, first.id, target.id, () => 100, () => 0);
  applyPlan(state, firstPlan);
  const secondPlan = confirmWeaponAttack(state, attacker.id, second.id, other.id, () => 100, () => 0);
  applyPlan(state, secondPlan);
  assert.notEqual(firstPlan.id, secondPlan.id);
  assert.equal(state.stage, "attack");
  assert.equal(state.activeUnitId, attacker.id);
});

test("blocker cover remains probabilistic and can absorb a shot", () => {
  const gun = weapon({ accuracy: 100 });
  const { state, attacker, target } = battle([gun]);
  const blocker = unit({ id: "blocker", sideId: "crimson", position: { q: 1, r: 0 }, mass: 200, shield: 0, armor: 0, integrity: 10 });
  state.units.push(blocker);
  const preview = previewWeaponAttack(state, attacker.id, gun.id, target.id);
  assert.equal(preview.canConfirm, true);
  assert.equal(preview.cover, 100);
  assert.equal(preview.blocker.id, blocker.id);
  const plan = confirmWeaponAttack(state, attacker.id, gun.id, target.id, () => 1, () => 0);
  assert.equal(plan.steps[0].outcome, "blocked");
  applyPlan(state, plan);
  assert.equal(blocker.integrity < 10, true);
});

test("single-slot arc and targets use the same domain validation", () => {
  const gun = weapon({ mount: "battery-left" });
  const { state, attacker, target } = battle([gun]);
  target.position = { q: 0, r: -2 };
  assert.equal(weaponAttackArc(state, attacker.id, gun.id).has("0,-2"), true);
  assert.deepEqual(availableWeaponAttackTargets(state, attacker.id, gun.id).map(candidate => candidate.id), [target.id]);
  assert.deepEqual(supercoverLine({ q: 0, r: 0 }, { q: 2, r: -1 }), [{ q: 0, r: 0 }, { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 2, r: -1 }]);
});

test("manual AA fire consumes the readiness needed for a later reaction", () => {
  const aa = weapon({ targetKinds: ["capital", "squadron"] });
  const { state, attacker, target } = battle([aa], { kind: "squadron", stack: 2, unitHealth: 5 });
  applyPlan(state, confirmWeaponAttack(state, attacker.id, aa.id, target.id, () => 100, () => 0));
  assert.equal(resolvePostEntryAA(state, target, {}, () => 100, () => 0).length, 0);
});

test("an unused AA slot enters overwatch at explicit activation end and reaction consumes it", () => {
  const aa = weapon({ targetKinds: ["squadron"] });
  const owner = unit({ id: "owner", sideId: "crimson", weapons: [aa] });
  const target = unit({ id: "fighter", kind: "squadron", sideId: "azure", position: { q: 1, r: 0 }, stack: 2, unitHealth: 5 });
  const ally = unit({ id: "ally", sideId: "crimson", position: { q: -2, r: 0 }, weapons: [] });
  const state = battle([]).state;
  state.units = [owner, ally, target];
  state.activeUnitId = owner.id;
  state.initiativeOrder = [owner.id, ally.id, target.id];
  endActivation(state);
  assert.equal(aa.overwatch, true);
  state.activeUnitId = target.id;
  state.stage = "system";
  const outcomes = resolvePostEntryAA(state, target, { planId: "maneuver-plan", elementIndex: 2, causeEventId: "move" }, () => 1, () => 0);
  assert.equal(outcomes.length, 1);
  assert.equal(state.attackApplication, null);
  assert.equal(aa.firedThisRound, true);
  assert.equal(aa.overwatch, false);
  const damage = state.events.find(event => event.action === "damage");
  assert.deepEqual({ planId: damage.planId, elementIndex: damage.elementIndex }, { planId: "maneuver-plan", elementIndex: 2 });
});

test("winner prevents activation end from mutating queue or round", () => {
  const { state, attacker } = battle([]);
  state.winner = attacker.sideId;
  const before = structuredClone(state);
  assert.equal(endActivation(state), null);
  assert.deepEqual(state, before);
});

test("runtime state has no salvo readiness flag", () => {
  const state = createBattleState();
  assert.equal(state.units.every(candidate => !("salvoCommitted" in candidate)), true);
});
