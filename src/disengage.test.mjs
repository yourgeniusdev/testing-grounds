import assert from "node:assert/strict";
import test from "node:test";
import { actionAvailability, beginActionPlanning, createBattleState, destroyUnit, planRoutes, unitById } from "./domain.js";

test("removed disengage rejects availability and public action planning without mutation", () => {
  const state = createBattleState();
  const actor = unitById(state, "wasps");
  state.activeUnitId = actor.id;
  state.lifecycle = "ActionChoice";
  const before = JSON.stringify(state);
  assert.equal(actionAvailability(state, { type: "disengage" }).available, false);
  assert.equal(beginActionPlanning(state, { type: "disengage", reason: "player-choice" }), null);
  assert.equal(JSON.stringify(state), before);
});

test("multiple incoming holders release movement only after the final holder dies", () => {
  const state = createBattleState();
  const actor = unitById(state, "mantis");
  const first = unitById(state, "wasps");
  const second = unitById(state, "hornet-azure");
  state.units = [actor, first, second];
  state.scenario.contents = [];
  state.activeUnitId = actor.id;
  state.lifecycle = "ActionChoice";
  actor.position = { q: 0, r: 0 };
  actor.heading = 0;
  first.position = { q: -1, r: 0 };
  second.position = { q: 0, r: -1 };
  const canMove = () => [...planRoutes(state, actor, "risky").values()].some(route => route.steps.length);
  assert.equal(canMove(), false);
  destroyUnit(state, first);
  assert.equal(canMove(), false);
  destroyUnit(state, second);
  assert.equal(canMove(), true);
});
