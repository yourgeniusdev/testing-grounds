import assert from "node:assert/strict";
import test from "node:test";
import {
  activationResources,
  beginActionPlanning,
  confirmDisengageAction,
  confirmManeuverAction,
  createBattleState,
  currentEvasion,
  disengagePreview,
  endActivation,
  executeManeuverElement,
  planRoutes,
  unitById
} from "./domain.js";
import { buildManeuverOptions } from "./ui-rules.js";

function linkedBattle() {
  const state = createBattleState();
  const actor = unitById(state, "wasps");
  const enemyA = unitById(state, "mantis");
  const enemyB = structuredClone(enemyA);
  const ally = structuredClone(actor);
  enemyB.id = "mantis-b";
  enemyB.name = "Мантисы Б";
  enemyB.stack = 2;
  ally.id = "wasps-b";
  ally.name = "Осы Б";
  actor.position = { q: 0, r: 0 };
  actor.heading = 0;
  enemyA.position = { q: -1, r: 0 };
  enemyB.position = { q: 0, r: -1 };
  ally.position = { q: -1, r: 1 };
  actor.engagedWith = [enemyA.id, enemyB.id];
  enemyA.engagedWith = [actor.id, ally.id];
  enemyB.engagedWith = [actor.id];
  ally.engagedWith = [enemyA.id];
  state.units = [actor, enemyA, enemyB, ally];
  state.scenario.contents = [];
  state.initiativeOrder = [actor.id, enemyA.id, enemyB.id, ally.id];
  state.activeUnitId = actor.id;
  state.lifecycle = "ActionChoice";
  actor.activationStartedThisRound = true;
  actor.activationResourceCounters = true;
  actor.activationId = "activation-test";
  actor.speedSpent = 2;
  actor.speedRemaining = actor.currentSpeed - 2;
  actor.maneuverSpent = 1;
  actor.maneuverRemaining = actor.maneuver - 1;
  actor.disengageEvasionPenalty = 0;
  return { state, actor, enemyA, enemyB, ally };
}

test("disengage preview deterministically covers multiple links and modifiers", () => {
  const { state, actor } = linkedBattle();
  const preview = disengagePreview(state, actor);
  assert.deepEqual(preview.linkedIds, ["mantis", "mantis-b"]);
  assert.deepEqual(preview.allyIds, ["wasps-b"]);
  assert.equal(preview.nearestId, "mantis");
  assert.equal(preview.speedCost, 2);
  assert.equal(preview.chance, 40);
});

test("ally modifier counts only adjacent current reciprocal links to the same enemies", () => {
  const { state, actor, enemyA, ally } = linkedBattle();
  const asymmetric = structuredClone(ally);
  const remote = structuredClone(ally);
  asymmetric.id = "asymmetric";
  asymmetric.engagedWith = [enemyA.id];
  asymmetric.position = { q: -1, r: 1 };
  remote.id = "remote";
  remote.position = { q: 4, r: 0 };
  enemyA.engagedWith.push(remote.id);
  state.units.push(asymmetric, remote);

  assert.deepEqual(disengagePreview(state, actor).allyIds, [ally.id]);

  enemyA.engagedWith.push(asymmetric.id);
  assert.deepEqual(disengagePreview(state, actor).allyIds, [asymmetric.id, ally.id]);
});

test("successful disengage removes every reciprocal link and preserves activation state for a remaining-budget maneuver", () => {
  const { state, actor, enemyA, enemyB } = linkedBattle();
  const before = { position: { ...actor.position }, heading: actor.heading, maneuverSpent: actor.maneuverSpent, activationId: actor.activationId };

  assert.ok(beginActionPlanning(state, { type: "disengage", reason: "player-choice" }));
  const result = confirmDisengageAction(state, () => 40);

  assert.equal(result.success, true);
  assert.deepEqual(actor.engagedWith, []);
  assert.equal(enemyA.engagedWith.includes(actor.id), false);
  assert.equal(enemyB.engagedWith.includes(actor.id), false);
  assert.deepEqual({ position: actor.position, heading: actor.heading, maneuverSpent: actor.maneuverSpent, activationId: actor.activationId }, before);
  assert.deepEqual(activationResources(actor).speed, { spent: 4, remaining: 2, capacity: 6 });
  assert.equal(currentEvasion(actor), actor.baseEvasion - 10);
  assert.equal(state.lifecycle, "ActionChoice");

  assert.ok(beginActionPlanning(state, { type: "maneuver", reason: "player-choice" }));
  const route = planRoutes(state, actor, "safe").get("2,0:0");
  const plan = confirmManeuverAction(state, buildManeuverOptions(actor, route)[0]);
  for (let index = 0; index < plan.elements.length; index++) executeManeuverElement(state, plan, index);

  assert.deepEqual({ position: actor.position, heading: actor.heading, speedSpent: actor.speedSpent, maneuverSpent: actor.maneuverSpent }, {
    position: { q: 2, r: 0 }, heading: 0, speedSpent: 6, maneuverSpent: 1
  });
  assert.equal(plan.actionContext.activationId, actor.activationId);
  const resolve = state.events.find(event => event.action === "disengage-resolve");
  const maneuverConfirm = state.events.find(event => event.action === "activation-action-confirm" && event.actionType === "maneuver");
  assert.equal(resolve.activationId, actor.activationId);
  assert.equal(maneuverConfirm.activationId, actor.activationId);
  assert.equal(maneuverConfirm.causeEventId, resolve.eventId);
  assert.deepEqual(resolve.before.position, { q: 0, r: 0 });
  assert.equal(resolve.after.speedSpent, 4);
  assert.equal("disengageContinuationEventId" in actor, false);
});

test("activation end clears an unused disengage continuation", () => {
  const { state, actor } = linkedBattle();
  beginActionPlanning(state, { type: "disengage", reason: "player-choice" });
  assert.equal(confirmDisengageAction(state, () => 1).success, true);
  assert.ok(actor.disengageContinuationEventId);

  assert.ok(endActivation(state));
  assert.equal("disengageContinuationEventId" in actor, false);
});

test("failed disengage spends Speed, applies Evasion penalty, retains links, and leaves attack choice open", () => {
  const { state, actor, enemyA, enemyB } = linkedBattle();
  beginActionPlanning(state, { type: "disengage", reason: "player-choice" });
  const result = confirmDisengageAction(state, () => 41);

  assert.equal(result.success, false);
  assert.deepEqual(actor.engagedWith, [enemyA.id, enemyB.id]);
  assert.equal(enemyA.engagedWith.includes(actor.id), true);
  assert.equal(enemyB.engagedWith.includes(actor.id), true);
  assert.equal(actor.speedSpent, 4);
  assert.equal(currentEvasion(actor), actor.baseEvasion - 10);
  assert.equal(state.lifecycle, "ActionChoice");
  assert.equal(planRoutes(state, actor, "safe").size, 0);
});

test("disengage confirmation rejects forged and stale commands without mutation", () => {
  const { state, actor, enemyA } = linkedBattle();
  beginActionPlanning(state, { type: "disengage", reason: "player-choice" });
  const before = structuredClone({ actor, enemyA, events: state.events });
  enemyA.engagedWith = [];

  assert.equal(confirmDisengageAction(state, () => 1), null);
  assert.equal(actor.speedSpent, before.actor.speedSpent);
  assert.equal(actor.disengageEvasionPenalty, before.actor.disengageEvasionPenalty);
  assert.equal(state.events.length, before.events.length);

  enemyA.engagedWith = [actor.id];
  state.activeUnitId = enemyA.id;
  assert.equal(confirmDisengageAction(state, () => 1), null);
  assert.equal(actor.speedSpent, before.actor.speedSpent);
});
