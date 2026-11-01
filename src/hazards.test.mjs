import assert from "node:assert/strict";
import test from "node:test";
import { createBattleState, resolveHazardConsequences, unitById } from "./domain.js";

const mine = { sourceId: "mines-a", sourceName: "Минное поле", probability: 1, min: 8, max: 8, effect: "урон целостности" };

test("nonlethal hazard damage recalculates squadron stack", () => {
  const state = createBattleState();
  const squadron = unitById(state, "wasps");
  const outcomes = resolveHazardConsequences(state, squadron, [mine], () => 0);
  assert.equal(squadron.integrity, 7);
  assert.equal(squadron.stack, 2);
  assert.equal(state.units.includes(squadron), true);
  assert.deepEqual(outcomes, [{ consequence: mine, hit: true, damage: 8, destroyed: false, winner: null }]);
  assert.deepEqual(state.events.map(event => event.action), ["damage"]);
  assert.equal(state.events[0].cause, "hazard:mines-a");
});

test("hazard destruction of the last enemy unit declares victory", () => {
  const state = createBattleState();
  const squadron = unitById(state, "wasps");
  const survivor = unitById(state, "mantis");
  state.units = [squadron, survivor];
  state.initiativeOrder = [squadron.id, survivor.id];
  squadron.integrity = 8;
  squadron.stack = 2;

  const [outcome] = resolveHazardConsequences(state, squadron, [mine], () => 0);

  assert.equal(outcome.destroyed, true);
  assert.equal(outcome.winner, survivor.sideId);
  assert.equal(state.winner, survivor.sideId);
  assert.equal(state.lifecycle, "Finished");
  assert.equal(state.activeUnitId, null);
  assert.equal(state.events.at(-1).action, "victory");
});

test("lethal hazard damage destroys squadron after setting stack to zero", () => {
  const state = createBattleState();
  const squadron = unitById(state, "wasps");
  state.units = state.units.filter(unit => unit.sideId === "azure" || unit.id === "mantis");
  state.initiativeOrder = state.units.map(unit => unit.id);
  squadron.integrity = 8;
  squadron.stack = 2;
  const outcomes = resolveHazardConsequences(state, squadron, [mine], () => 0);
  assert.equal(squadron.integrity, 0);
  assert.equal(squadron.stack, 0);
  assert.equal(state.units.includes(squadron), false);
  assert.equal(state.initiativeOrder.includes(squadron.id), false);
  assert.equal(state.scenario.contents.some(content => content.id.startsWith("debris-wasps-")), true);
  assert.deepEqual(state.events.map(event => event.action), ["damage", "destroy", "debris-create"]);
  assert.equal(outcomes[0].destroyed, true);
});
