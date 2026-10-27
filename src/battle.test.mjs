import assert from "node:assert/strict";
import {
  attackPreview,
  attackAnimationPlan,
  attackArc,
  availableAttackTargets,
  resolveAttack,
  skipAttack
} from "./battle.js";
import { confirmDeployment, createBattleState, deployUnit, deploymentZone, unitById } from "./domain.js";

function battleAt(attackerId, targetId) {
  const state = createBattleState();
  state.activeUnitId = attackerId;
  state.stage = "attack";
  const attacker = unitById(state, attackerId);
  const target = unitById(state, targetId);
  return { state, attacker, target };
}

{
  const { state, attacker } = battleAt("atlas", "bastion");
  attacker.position = { q: 0, r: 0 };
  attacker.heading = 0;
  const arc = attackArc(state, "primary");
  assert.equal(arc.has("0,3"), true);
  assert.equal(arc.has("3,0"), false);
}

{
  const { state, attacker, target } = battleAt("swift", "raptor");
  attacker.position = { q: 0, r: 0 };
  target.position = { q: 1, r: 0 };
  assert.deepEqual(attackAnimationPlan(state, target.id, "auxiliary").map(step => step.weaponClass), ["energy"]);
}

{
  const { state, attacker, target } = battleAt("atlas", "bastion");
  attacker.position = { q: 0, r: 0 };
  attacker.heading = 0;
  target.position = { q: 0, r: 3 };
  const preview = attackPreview(state, target.id, "primary");
  assert.deepEqual(preview.included.map(item => item.id), ["atlas-battery-right"]);
  assert.equal(preview.hitChance, 73);
}

{
  const { state, attacker, target } = battleAt("bastion", "atlas");
  attacker.position = { q: 0, r: 0 };
  attacker.heading = 0;
  target.position = { q: 0, r: 2 };
  target.shield = 5;
  target.armor = 20;
  const rolls = [1, 1];
  resolveAttack(state, target.id, "primary", () => rolls.shift() ?? 100, () => 0);
  assert.equal(target.shield, 0);
  assert.equal(target.armor, 10);
  assert.equal(attacker.primaryReady, false);
}

{
  const { state, attacker, target } = battleAt("swift", "raptor");
  attacker.position = { q: 0, r: 0 };
  target.position = { q: 1, r: 0 };
  attacker.reactor.currentEnergy = 2;
  const primaryWasReady = attacker.primaryReady;
  resolveAttack(state, target.id, "auxiliary", () => 1, () => 0);
  assert.equal(attacker.reactor.currentEnergy, 0);
  assert.equal(attacker.auxiliaryReady, false);
  assert.equal(attacker.primaryReady, primaryWasReady);
}

{
  const { state, attacker, target } = battleAt("swift", "raptor");
  attacker.position = { q: 0, r: 0 };
  target.position = { q: 1, r: 0 };
  target.shield = 0;
  target.armor = 0;
  target.integrity = 1;
  resolveAttack(state, target.id, "primary", () => 1, () => 0);
  assert.equal(state.units.some(unit => unit.id === target.id), false);
  assert.equal(state.initiativeOrder.includes(target.id), false);
  assert.equal(state.scenario.contents.some(content => content.type === "debrisField" && content.position.q === 1), true);
}

{
  const { state, attacker } = battleAt("atlas", "bastion");
  attacker.position = { q: 0, r: 0 };
  unitById(state, "bastion").position = { q: -3, r: 0 };
  assert.equal(availableAttackTargets(state, "primary").some(unit => unit.id === "bastion"), false);
  skipAttack(state);
  assert.equal(attacker.primaryReady, true);
}

{
  const { state, attacker, target } = battleAt("wasps", "mantis");
  attacker.position = { q: 0, r: 0 };
  target.position = { q: -1, r: 0 };
  assert.equal(attacker.weapons[0].mount, "squadronWeapon");
  assert.equal(attackPreview(state, target.id, "primary").included.length, 1);
}

{
  const state = createBattleState();
  const left = deploymentZone(state, "azure");
  assert.equal(left.length > 0, true);
  for (const unit of state.units.filter(item => item.sideId === "azure")) assert.equal(deployUnit(state, unit.id, left.shift(), unit.heading), true);
  assert.equal(confirmDeployment(state, "azure"), true);
  assert.equal(state.lifecycle, "DeploymentRight");
  const right = deploymentZone(state, "crimson");
  for (const unit of state.units.filter(item => item.sideId === "crimson")) assert.equal(deployUnit(state, unit.id, right.shift(), unit.heading), true);
  assert.equal(confirmDeployment(state, "crimson"), true);
  assert.equal(state.lifecycle, "WaitDecision");
  assert.equal(state.initiativeOrder.length, 6);
  assert.equal(deployUnit(state, "atlas", { q: 0, r: 0 }), false);
}

console.log("battle checks passed");
