import assert from "node:assert/strict";
import test from "node:test";
import { applyAttackStep, confirmWeaponAttackAction, previewWeaponAttack } from "./battle.js";
import { activeUnit, beginActionPlanning, beginActivation, confirmManeuverAction, createBattleState, endActivation, executeManeuverElement, planManeuver, planRoutes, unitById } from "./domain.js";
import { buildManeuverOptions } from "./ui-rules.js";

function resolvePlan(state, plan) {
  for (let index = 0; index < plan.steps.length; index++) assert.equal(applyAttackStep(state, plan, index).status, "applied");
}

test("Stage 3 executes maneuver, slot A at X, slot B at Y, then explicit activation end", () => {
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
  beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
  const maneuver = confirmManeuverAction(state, buildManeuverOptions(attacker, route)[0]);
  assert.equal(executeManeuverElement(state, maneuver, 0).status, "completed");
  assert.equal(state.stage, "action-choice");

  assert.equal(planManeuver(state, buildManeuverOptions(attacker, route)[0]), null);
  const slotA = attacker.weapons.find(weapon => weapon.id === "atlas-battery-left");
  const slotB = attacker.weapons.find(weapon => weapon.id === "atlas-battery-right");
  assert.equal(previewWeaponAttack(state, attacker.id, slotA.id, targetX.id).canConfirm, true);
  beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: slotA.id });
  resolvePlan(state, confirmWeaponAttackAction(state, attacker.id, slotA.id, targetX.id, () => 100, () => 0));
  assert.equal(state.stage, "action-choice");
  assert.equal(previewWeaponAttack(state, attacker.id, slotA.id, targetX.id).canConfirm, false);
  assert.equal(previewWeaponAttack(state, attacker.id, slotB.id, targetY.id).canConfirm, true);
  beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: slotB.id });
  resolvePlan(state, confirmWeaponAttackAction(state, attacker.id, slotB.id, targetY.id, () => 100, () => 0));
  assert.equal(state.stage, "action-choice");
  assert.equal(activeUnit(state), attacker);

  const result = endActivation(state);
  assert.deepEqual(result, { newRound: false });
  assert.equal(activeUnit(state), targetX);
});
