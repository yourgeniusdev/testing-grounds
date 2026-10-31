import assert from "node:assert/strict";
import test from "node:test";
import { applyAttackStep, confirmWeaponAttack, previewWeaponAttack } from "./battle.js";
import { activeUnit, beginActivation, createBattleState, endActivation, executeManeuverElement, planManeuver, planRoutes, unitById } from "./domain.js";
import { buildManeuverOptions } from "./ui-rules.js";

function resolvePlan(state, plan) {
  for (let index = 0; index < plan.steps.length; index++) assert.equal(applyAttackStep(state, plan, index).status, "applied");
}

test("Stage 2 executes maneuver, slot A at X, slot B at Y, then explicit activation end", () => {
  const state = createBattleState();
  const attacker = unitById(state, "atlas");
  const targetX = unitById(state, "bastion");
  const targetY = unitById(state, "raptor");
  state.scenario.contents = [];
  state.units = [attacker, targetX, targetY];
  state.initiativeOrder = [attacker.id, targetX.id, targetY.id];
  state.activeUnitId = attacker.id;
  state.lifecycle = "WaitDecision";
  state.stage = "system";
  attacker.position = { q: 0, r: 0 };
  attacker.heading = 0;
  attacker.currentSpeed = 0;
  targetX.position = { q: -2, r: 0 };
  targetY.position = { q: 2, r: 0 };
  beginActivation(state);

  const route = planRoutes(state, attacker, "safe").get("0,0:1");
  const maneuver = planManeuver(state, buildManeuverOptions(attacker, route)[0]);
  assert.equal(executeManeuverElement(state, maneuver, 0).status, "completed");
  assert.equal(state.stage, "attack");

  assert.equal(planManeuver(state, buildManeuverOptions(attacker, route)[0]), null);
  const slotA = attacker.weapons.find(weapon => weapon.id === "atlas-battery-left");
  const slotB = attacker.weapons.find(weapon => weapon.id === "atlas-battery-right");
  assert.equal(previewWeaponAttack(state, attacker.id, slotA.id, targetX.id).canConfirm, true);
  resolvePlan(state, confirmWeaponAttack(state, attacker.id, slotA.id, targetX.id, () => 100, () => 0));
  assert.equal(state.stage, "attack");
  assert.equal(previewWeaponAttack(state, attacker.id, slotA.id, targetX.id).canConfirm, false);
  assert.equal(previewWeaponAttack(state, attacker.id, slotB.id, targetY.id).canConfirm, true);
  resolvePlan(state, confirmWeaponAttack(state, attacker.id, slotB.id, targetY.id, () => 100, () => 0));
  assert.equal(state.stage, "attack");
  assert.equal(activeUnit(state), attacker);

  const result = endActivation(state);
  assert.deepEqual(result, { newRound: false });
  assert.equal(activeUnit(state), targetX);
});
