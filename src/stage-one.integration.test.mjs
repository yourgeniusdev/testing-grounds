import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { applyAttackStep, attackArc, attackPreview, planAttack } from "./battle.js";
import {
  DIRECTIONS,
  activeUnit,
  beginActivation,
  confirmDeployment,
  createBattleState,
  deployUnit,
  endActivation,
  executeManeuverElement,
  key,
  offsetToAxial,
  planManeuver,
  planRoutes,
  unitById
} from "./domain.js";
import { buildManeuverOptions } from "./ui-rules.js";

function deployAt(state, unitId, col, row) {
  assert.equal(deployUnit(state, unitId, offsetToAxial(col, row), 5), true);
}

function executeManeuver(state, route) {
  const option = buildManeuverOptions(activeUnit(state), route)[0];
  const plan = planManeuver(state, option);
  assert.ok(plan);
  let result;
  for (let index = 0; index < plan.elements.length; index++) result = executeManeuverElement(state, plan, index);
  assert.equal(result.status, "completed");
  return plan;
}

test("default right-side confirmation exposes first-unit routes without blocking the UI", () => {
  const state = createBattleState();
  assert.equal(confirmDeployment(state, "azure"), true);
  assert.equal(confirmDeployment(state, "crimson"), true);
  beginActivation(state);

  const started = performance.now();
  const routes = planRoutes(state, activeUnit(state), "risky");
  const elapsed = performance.now() - started;

  assert.equal(activeUnit(state).id, "wasps");
  assert.equal(routes.size, 388);
  assert.ok(elapsed < 1000, `default route planning took ${Math.round(elapsed)}ms`);
});

test("Stage 1 completes deployment, maneuver, legacy salvo, activation, and next-unit transition", () => {
  const state = createBattleState();
  state.scenario.bounds = { minCol: -2, maxCol: 2, minRow: -3, maxRow: 3 };
  state.scenario.contents = [];

  deployAt(state, "atlas", -2, -2);
  deployAt(state, "swift", -2, 2);
  deployAt(state, "wasps", -2, 0);
  assert.equal(confirmDeployment(state, "azure"), true);
  deployAt(state, "bastion", 2, 0);
  deployAt(state, "raptor", 2, -2);
  deployAt(state, "mantis", 2, 2);
  assert.equal(confirmDeployment(state, "crimson"), true);
  assert.deepEqual(state.events.map(event => event.action), [
    "deployment-place",
    "deployment-place",
    "deployment-place",
    "deployment-confirm",
    "deployment-place",
    "deployment-place",
    "deployment-place",
    "deployment-confirm"
  ]);

  beginActivation(state);
  const wasps = activeUnit(state);
  const bastion = unitById(state, "bastion");
  assert.equal(wasps.id, "wasps");
  assert.equal(wasps.heading, 0);
  const route = planRoutes(state, wasps, "safe").get("0,0:0");
  assert.ok(route);
  const maneuverPlan = executeManeuver(state, route);
  assert.deepEqual(maneuverPlan.elements.map(element => element.type), ["move", "move"]);
  assert.deepEqual(wasps.position, { q: 0, r: 0 });
  assert.equal(wasps.heading, 0);
  assert.equal(state.stage, "attack");

  const selection = new Set(wasps.weapons.map(weapon => weapon.id));
  const preview = attackPreview(state, bastion.id, selection);
  assert.equal(preview.canConfirm, true);
  assert.equal(preview.included.length, wasps.weapons.length);
  const attackPlan = planAttack(state, bastion.id, selection, () => 100, () => 0);
  assert.ok(attackPlan);
  assert.equal(attackPlan.steps.length, 6);
  for (let index = 0; index < attackPlan.steps.length; index++) assert.equal(applyAttackStep(state, attackPlan, index).status, "applied");
  assert.equal(wasps.weapons.every(weapon => weapon.firedThisRound), true);

  const activation = endActivation(state);
  assert.deepEqual(activation, { newRound: false });
  assert.equal(wasps.hasActivated, true);
  assert.equal(activeUnit(state).id, "swift");
  assert.equal(activeUnit(state).activationStartedThisRound, true);
  assert.equal(state.lifecycle, "SystemActions");
  assert.equal(state.stage, "system");
});

test("a squadron maneuver final heading controls every weapon slot arc", () => {
  const state = createBattleState();
  const mantis = unitById(state, "mantis");
  const finalForeTarget = unitById(state, "atlas");
  const formerForeTarget = unitById(state, "swift");
  state.scenario.contents = [];
  state.units = [mantis, finalForeTarget, formerForeTarget];
  state.initiativeOrder = [mantis.id, finalForeTarget.id, formerForeTarget.id];
  state.activeUnitId = mantis.id;
  state.lifecycle = "WaitDecision";
  state.stage = "system";
  mantis.position = { q: 0, r: 0 };
  mantis.heading = 3;
  beginActivation(state);

  const route = planRoutes(state, mantis, "safe").get("-1,1:4");
  assert.ok(route);
  const plan = executeManeuver(state, route);
  assert.deepEqual(plan.elements.map(element => element.type), ["turn", "move"]);
  assert.deepEqual(mantis.position, { q: -1, r: 1 });
  assert.equal(mantis.heading, 4);
  assert.equal(state.stage, "attack");

  const [finalDq, finalDr] = DIRECTIONS[mantis.heading];
  const [formerDq, formerDr] = DIRECTIONS[3];
  finalForeTarget.position = { q: mantis.position.q + finalDq * 2, r: mantis.position.r + finalDr * 2 };
  formerForeTarget.position = { q: mantis.position.q + formerDq * 2, r: mantis.position.r + formerDr * 2 };

  for (const weapon of mantis.weapons) {
    const selection = new Set([weapon.id]);
    const arc = attackArc(state, selection);
    assert.equal(arc.has(key(finalForeTarget.position.q, finalForeTarget.position.r)), true, `${weapon.id} final heading`);
    assert.equal(arc.has(key(formerForeTarget.position.q, formerForeTarget.position.r)), false, `${weapon.id} former heading`);
    assert.equal(attackPreview(state, finalForeTarget.id, selection).included.length, 1, `${weapon.id} final heading preview`);
    const formerPreview = attackPreview(state, formerForeTarget.id, selection);
    assert.equal(formerPreview.included.length, 0, `${weapon.id} former heading preview`);
    assert.equal(formerPreview.excluded[0].reason, "Вне сектора");
  }
});
