import assert from "node:assert/strict";
import test from "node:test";
import { applyAttackStep, confirmWeaponAttackAction, previewWeaponAttack } from "./battle.js";
import { resolvePostEntryInterceptions, activeUnit, beginActionPlanning, beginActivation, confirmManeuverAction, createBattleState, endActivation, executeManeuverElement, planManeuver, planRoutes, unitById } from "./domain.js";
import { buildManeuverOptions } from "./ui-rules.js";

test("held squadrons cannot attack outsiders while Kiro creates outgoing interception", () => {
  const state = createBattleState();
  const attacker = unitById(state, "wasps");
  const holder = unitById(state, "kiro");
  const outsider = unitById(state, "mantis");
  state.units = [attacker, holder, outsider];
  state.scenario.contents = [];
  attacker.position = { q: 0, r: 0 };
  attacker.heading = 0;
  holder.position = { q: 1, r: 0 };
  outsider.position = { q: 2, r: 0 };
  resolvePostEntryInterceptions(state, attacker);
  const slot = attacker.weapons[0];
  assert.equal(previewWeaponAttack(state, attacker.id, slot.id, holder.id).canConfirm, true);
  assert.equal(previewWeaponAttack(state, attacker.id, slot.id, outsider.id).canConfirm, false);
  holder.position = { q: 4, r: 0 };
  assert.equal(previewWeaponAttack(state, attacker.id, slot.id, outsider.id).canConfirm, true);
});

test("specialist AA rejects capitals and Needle cannot pierce their armor", () => {
  for (const [id, slotIndex] of [["dart", 0], ["swift", 1], ["raptor", 1]]) {
    const state = createBattleState();
    const actor = unitById(state, id);
    const target = unitById(state, "bastion");
    state.units = [actor, target];
    state.scenario.contents = [];
    state.activeUnitId = actor.id;
    state.lifecycle = "WaitDecision";
    beginActivation(state);
    actor.position = { q: 0, r: 0 };
    target.position = { q: 1, r: 0 };
    const slot = actor.weapons[slotIndex];
    beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: slot.id });
    const before = JSON.stringify(state);
    assert.ok(previewWeaponAttack(state, actor.id, slot.id, target.id).reasonCodes.includes("target.invalid-kind"));
    assert.equal(confirmWeaponAttackAction(state, actor.id, slot.id, target.id), null);
    assert.equal(JSON.stringify(state), before);
  }
  const state = createBattleState();
  const actor = unitById(state, "wasps");
  const target = unitById(state, "bastion");
  state.units = [actor, target];
  state.scenario.contents = [];
  actor.position = { q: 0, r: 0 };
  actor.heading = 0;
  target.position = { q: 1, r: 0 };
  target.shield = 150;
  const slot = actor.weapons[0];
  assert.deepEqual(previewWeaponAttack(state, actor.id, slot.id, target.id).potentialDamageByLayer, { shield: 150, armor: 0, integrity: 0 });
});

test("shield absorbs a whole shot and subsequent hits subtract constant armor exactly", () => {
  const state = createBattleState();
  const attacker = unitById(state, "atlas");
  const target = unitById(state, "bastion");
  state.units = [attacker, target];
  state.scenario.contents = [];
  state.activeUnitId = attacker.id;
  state.lifecycle = "WaitDecision";
  attacker.position = { q: 0, r: 0 };
  target.position = { q: 0, r: -1 };
  target.shield = 1;
  target.armor = 100;
  target.integrity = 2000;
  const slot = attacker.weapons[0];
  slot.damage = 301;
  slot.weaponClass = "explosive";
  slot.critChance = 0;
  beginActivation(state);
  const preview = previewWeaponAttack(state, attacker.id, slot.id, target.id);
  assert.equal(preview.canConfirm, true);
  assert.deepEqual(preview.potentialDamageByLayer, { shield: 1, armor: 0, integrity: 753.75 });
  beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: slot.id });
  resolvePlan(state, confirmWeaponAttackAction(state, attacker.id, slot.id, target.id, () => 1, () => 100));
  assert.equal(target.shield, 0);
  assert.equal(target.armor, 100);
  assert.equal(target.integrity, 1246.25);
});

function resolvePlan(state, plan) {
  for (let index = 0; index < plan.steps.length; index++) assert.equal(applyAttackStep(state, plan, index).status, "applied");
}

test("free-order activation executes maneuver, slot A at X, slot B at Y, then explicit activation end", () => {
  const state = createBattleState();
  const attacker = unitById(state, "atlas");
  const targetX = unitById(state, "bastion");
  const targetY = unitById(state, "raptor");
  state.scenario.contents = [];
  state.units = [attacker, targetX, targetY];
  state.initiativeOrder = [attacker.id, targetX.id, targetY.id];
  state.activeUnitId = attacker.id;
  state.lifecycle = "WaitDecision";
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
  assert.equal(state.lifecycle, "ActionChoice");

  assert.equal(planManeuver(state, buildManeuverOptions(attacker, route)[0]), null);
  const slotA = attacker.weapons.find(weapon => weapon.id === "atlas-battery-left");
  const slotB = attacker.weapons.find(weapon => weapon.id === "atlas-battery-right");
  assert.equal(previewWeaponAttack(state, attacker.id, slotA.id, targetX.id).canConfirm, true);
  beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: slotA.id });
  resolvePlan(state, confirmWeaponAttackAction(state, attacker.id, slotA.id, targetX.id, () => 100, () => 0));
  assert.equal(state.lifecycle, "ActionChoice");
  assert.equal(previewWeaponAttack(state, attacker.id, slotA.id, targetX.id).canConfirm, false);
  assert.equal(previewWeaponAttack(state, attacker.id, slotB.id, targetY.id).canConfirm, true);
  beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: slotB.id });
  resolvePlan(state, confirmWeaponAttackAction(state, attacker.id, slotB.id, targetY.id, () => 100, () => 0));
  assert.equal(state.lifecycle, "ActionChoice");
  assert.equal(activeUnit(state), attacker);

  const result = endActivation(state);
  assert.deepEqual(result, { newRound: false });
  assert.equal(activeUnit(state), targetX);
});
