import assert from "node:assert/strict";
import test from "node:test";
import { applyAttackStep, confirmWeaponAttackAction, previewWeaponAttack, resolvePostEntryAA } from "./battle.js";
import {
  actionAvailability,
  activationResources,
  activeUnit,
  beginActionPlanning,
  cancelActionPlanning,
  confirmDeployment,

  confirmManeuverAction,
  createBattleState,
  deployUnit,
  endActivation,
  executeManeuverElement,
  offsetToAxial,
  planRoutes,
  unitById
} from "./domain.js";
import { buildManeuverOptions } from "./ui-rules.js";

const alwaysHit = () => 1;
const alwaysMiss = () => 100;
const zeroRandom = () => 0;

function deployAt(state, unitId, col, row) {
  assert.equal(deployUnit(state, unitId, offsetToAxial(col, row)), true);
}

function maneuverOption(state, destination, policy = "safe") {
  const unit = activeUnit(state);
  const route = planRoutes(state, unit, policy).get(destination);
  assert.ok(route, `expected ${unit.id} route to ${destination}`);
  return buildManeuverOptions(unit, route)[0];
}

function confirmManeuver(state, destination, policy = "safe") {
  assert.ok(beginActionPlanning(state, { type: "maneuver", reason: "player-choice" }));
  const plan = confirmManeuverAction(state, maneuverOption(state, destination, policy));
  assert.ok(plan);
  return plan;
}

function resolveManeuver(state, plan, effects = {}) {
  let result;
  for (let index = 0; index < plan.elements.length; index++) {
    result = executeManeuverElement(state, plan, index, effects);
    if (result.status !== "executed") break;
  }
  return result;
}

function attack(state, slotId, targetId, rollD100 = alwaysHit) {
  const attacker = activeUnit(state);
  assert.ok(beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId }));
  const plan = confirmWeaponAttackAction(state, attacker.id, slotId, targetId, rollD100, zeroRandom);
  assert.ok(plan);
  for (let index = 0; index < plan.steps.length; index++) assert.equal(applyAttackStep(state, plan, index).status, "applied");
  return plan;
}

function reactionEffects(rollD100) {
  return {
    resolvePostEntry({ state, unit, plan, elementIndex, causeEventId }) {
      return resolvePostEntryAA(state, unit, { ...plan.actionContext, planId: plan.id, elementIndex, causeEventId }, rollD100, zeroRandom);
    }
  };
}

function battleJournal(state) {
  return state.events.map(event => structuredClone(event));
}

function runBattle() {
  const state = createBattleState();
  const wasps = unitById(state, "wasps");
  const swift = unitById(state, "swift");
  swift.weapons[0] = { ...structuredClone(unitById(state, "dart").weapons[0]), id: "swift-autocannon" };
  const mantis = unitById(state, "mantis");
  const guard = structuredClone(swift);
  const sentinel = structuredClone(swift);
  const mantisB = structuredClone(mantis);

  guard.id = "guard";
  guard.name = "Фрегат «Дозор»";
  guard.initiative = 4;
  guard.weapons[0].damage = 2;
  sentinel.id = "sentinel";
  sentinel.name = "Фрегат «Часовой»";
  sentinel.sideId = "crimson";
  sentinel.initiative = 11;
  sentinel.shield = 0;
  sentinel.armor = 0;
  sentinel.integrity = 1;
  sentinel.maxIntegrity = 1;
  sentinel.weapons = [{ ...sentinel.weapons[0], id: "sentinel-aa", shots: 1, damage: 1 }];
  mantis.integrity = 1;
  mantis.stack = 1;
  mantisB.id = "mantis-b";
  mantisB.name = "Эскадрилья «Мантисы Б»";
  mantisB.initiative = 10;
  mantisB.integrity = 1;
  mantisB.stack = 1;
  mantisB.weapons = [];

  state.units = [wasps, swift, guard, sentinel, mantis, mantisB];
  state.scenario.bounds = { minCol: -2, maxCol: 2, minRow: -3, maxRow: 3 };
  state.scenario.contents = [{
    id: "test-mines",
    kind: "hazard",
    type: "minefield",
    label: "Контрольное минное поле",
    position: { q: -1, r: 0 },
    hazard: { probability: 1, min: 1, max: 1, effect: "урон целостности" }
  }];
  state.rng = zeroRandom;

  deployAt(state, wasps.id, -2, 0);
  deployAt(state, swift.id, -2, -1);
  deployAt(state, guard.id, -2, 2);
  assert.equal(confirmDeployment(state, "azure"), true);
  deployAt(state, sentinel.id, 1, 2);
  deployAt(state, mantis.id, 1, -1);
  deployAt(state, mantisB.id, 1, 1);
  assert.equal(confirmDeployment(state, "crimson"), true);
  assert.equal(activeUnit(state), sentinel);
  assert.equal(state.events.filter(event => event.action === "activation-start" && event.actorId === sentinel.id).length, 1);

  assert.deepEqual(endActivation(state), { newRound: false });
  assert.equal(sentinel.weapons[0].overwatch, true);
  assert.equal(activeUnit(state), mantisB);
  assert.deepEqual(endActivation(state), { newRound: false });
  assert.equal(activeUnit(state), wasps);

  const previewBefore = structuredClone({ ...state, rng: null });
  assert.ok(planRoutes(state, wasps, "risky").get("1,0:0"));
  assert.equal(previewWeaponAttack(state, wasps.id, wasps.weapons[0].id, sentinel.id).canConfirm, false);
  assert.ok(beginActionPlanning(state, { type: "maneuver", reason: "player-choice" }));
  assert.equal(cancelActionPlanning(state), true);
  assert.deepEqual({ ...state, rng: null }, previewBefore);

  const interceptionPlan = confirmManeuver(state, "1,0:0", "risky");
  const interceptionResult = resolveManeuver(state, interceptionPlan, reactionEffects(alwaysMiss));
  assert.equal(interceptionResult.status, "completed");
  assert.deepEqual(wasps.engagedWith, []);
  assert.deepEqual(mantis.engagedWith, [wasps.id]);
  assert.deepEqual(mantisB.engagedWith, [wasps.id]);
  assert.equal(wasps.integrity, wasps.maxIntegrity - 1);
  assert.equal(wasps.speedSpent, 3);
  assert.equal(sentinel.weapons[0].firedThisRound, true);
  assert.equal(state.events.filter(event => event.action === "aa-reaction-declare" && event.slotId === "sentinel-aa").length, 1);

  const firstMove = state.events.find(event => event.action === "maneuver-move" && event.planId === interceptionPlan.id && event.elementIndex === 0);
  const hazard = state.events.find(event => event.action === "hazard-check" && event.planId === interceptionPlan.id);
  const aa = state.events.find(event => event.action === "aa-reaction-declare" && event.planId === interceptionPlan.id);
  const continuedMove = state.events.find(event => event.action === "maneuver-move" && event.planId === interceptionPlan.id && event.elementIndex === 1);
  assert.equal(hazard.causeEventId, firstMove.eventId);
  assert.equal(aa.causeEventId, firstMove.eventId);
  assert.ok(hazard.eventOrder < aa.eventOrder && aa.eventOrder < continuedMove.eventOrder);

  wasps.currentSpeed = 5;
  assert.deepEqual(activationResources(wasps).speed, { spent: 3, remaining: 2, capacity: 5 });
  assert.equal(beginActionPlanning(state, { type: "disengage", reason: "player-choice" }), null);
  assert.deepEqual(wasps.engagedWith, []);
  assert.deepEqual(activationResources(wasps).speed, { spent: 3, remaining: 2, capacity: 5 });
  assert.equal(actionAvailability(state, { type: "maneuver" }).available, true);
  assert.equal(planRoutes(state, wasps, "safe").size > 0, true);

  wasps.currentSpeed = 6;
  assert.deepEqual(activationResources(wasps).speed, { spent: 3, remaining: 3, capacity: 6 });
  const remainingBudgetPlan = confirmManeuver(state, "0,0:3");
  assert.deepEqual(remainingBudgetPlan.costs, { speed: 1, maneuver: 3 });
  assert.equal(resolveManeuver(state, remainingBudgetPlan).status, "completed");
  assert.deepEqual({ position: wasps.position, speedSpent: wasps.speedSpent, maneuverSpent: wasps.maneuverSpent }, {
    position: { q: 0, r: 0 }, speedSpent: 4, maneuverSpent: 3
  });
  assert.deepEqual(endActivation(state), { newRound: false });
  assert.equal(activeUnit(state), swift);

  const autocannon = swift.weapons.find(weapon => weapon.id === "swift-autocannon");
  const laser = swift.weapons.find(weapon => weapon.id === "swift-laser");
  laser.targetKinds = ["capital", "squadron"];
  assert.equal(previewWeaponAttack(state, swift.id, autocannon.id, mantis.id).canConfirm, true);
  assert.equal(previewWeaponAttack(state, swift.id, laser.id, sentinel.id).canConfirm, false);
  attack(state, autocannon.id, mantis.id);
  assert.equal(unitById(state, mantis.id), undefined);

  const rangeChangePlan = confirmManeuver(state, "0,-1:0");
  assert.equal(resolveManeuver(state, rangeChangePlan).status, "completed");
  assert.equal(previewWeaponAttack(state, swift.id, laser.id, sentinel.id).canConfirm, true);
  attack(state, laser.id, sentinel.id);
  assert.equal(unitById(state, sentinel.id), undefined);
  assert.deepEqual(endActivation(state), { newRound: false });
  assert.equal(activeUnit(state), guard);

  assert.deepEqual(endActivation(state), { newRound: true });
  assert.equal(activeUnit(state), mantisB);
  assert.equal(guard.weapons.every(weapon => weapon.overwatch), true);
  const lethalPlan = confirmManeuver(state, "0,1:3", "risky");
  const lethalResult = executeManeuverElement(state, lethalPlan, 0, reactionEffects(alwaysHit));
  assert.equal(lethalResult.status, "destroyed");
  assert.equal(lethalResult.reason, "reaction");
  assert.equal(state.winner, "azure");
  assert.equal(state.lifecycle, "Finished");
  assert.equal(state.activeUnitId, null);
  assert.equal(state.activeAction, null);
  assert.equal(state.maneuverApplication, null);
  assert.equal(state.attackApplication, null);
  assert.equal(guard.weapons[0].firedThisRound, true);
  assert.equal(guard.weapons[1].firedThisRound, false);
  assert.equal(executeManeuverElement(state, lethalPlan, 1, reactionEffects(alwaysHit)).status, "invalid");
  assert.equal(state.events.some(event => event.action === "maneuver-move" && event.planId === lethalPlan.id && event.elementIndex === 1), false);
  assert.equal(state.events.some(event => event.action === "interception-create" && event.planId === lethalPlan.id), false);

  const destruction = state.events.find(event => event.action === "destroy" && event.subjectIds.includes(mantisB.id));
  const stop = state.events.find(event => event.action === "maneuver-stop" && event.planId === lethalPlan.id);
  const debris = state.events.find(event => event.action === "debris-create" && event.subjectIds.includes(`debris-${mantisB.id}-2`));
  const victory = state.events.find(event => event.action === "victory");
  assert.equal(stop.causeEventId, destruction.eventId);
  assert.equal(debris.causeEventId, stop.eventId);
  assert.equal(victory.causeEventId, debris.eventId);

  const eventIndex = new Map(state.events.map((event, index) => [event.eventId, index]));
  assert.equal(state.events.every((event, index) => event.eventOrder === index + 1), true);
  assert.equal(state.events.every((event, index) => index === 0 || event.journalOrder > state.events[index - 1].journalOrder), true);
  assert.equal(state.events.every(event => !event.causeEventId || eventIndex.get(event.causeEventId) < eventIndex.get(event.eventId)), true);
  assert.equal(state.events.filter(event => event.action === "activation-action-confirm").every(event => event.actionId && event.activationId && event.actionReason === "player-choice"), true);

  return state;
}

test("resilient battle completes deterministically through free-order actions and mid-reaction victory", () => {
  const first = runBattle();
  const second = runBattle();
  assert.deepEqual(battleJournal(second), battleJournal(first));
});
