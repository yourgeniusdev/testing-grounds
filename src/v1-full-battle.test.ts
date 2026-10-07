import { test } from "vitest";
import assert from "node:assert/strict";
import {
  advanceActivation,
  applyDamagePacket,
  confirmDeployment,
  createBattle,
  decide,
  deployUnit,
  disengage,
  moveAtomic,
  progress,
  replayEventLog,
  resolveAttack,
  validateEventLog
} from "./v1-domain.ts";

test("full battle reaches Finished through canonical lifecycle", () => {
  const state = createBattle({ id: "full-battle", bounds: { minCol: 0, maxCol: 3, minRow: 0, maxRow: 0 }, units: [
    { id: "left", side: "left", kind: "capital", integrity: 5, armor: 0, shield: 0 },
    { id: "right", side: "right", kind: "capital", integrity: 5, armor: 0, shield: 0 }
  ] });
  assert.equal(deployUnit(state, "left", { q: 0, r: 0 }, 2), true);
  assert.equal(confirmDeployment(state, "left"), true);
  assert.equal(deployUnit(state, "right", { q: 3, r: 0 }, 5), true);
  assert.equal(confirmDeployment(state, "right"), true);
  assert.equal(state.lifecycle, "WaitDecision");
  applyDamagePacket(state, "right", { amount: 5, sourceId: "left", cause: "acceptance" });
  assert.equal(state.lifecycle, "Finished");
  assert.equal(state.winner, "left");
  assert.equal(state.events.at(-1).action, "victory");
  assert.equal(state.events.some(event => event.action === "unit-destroyed"), true);
  progress(state);
  assert.equal(state.lifecycle, "Finished");
});

test("multi-unit battle exercises reactions, degradation, disengagement, and victory", () => {
  const state = createBattle({ id: "multi-unit-battle", bounds: { minCol: 0, maxCol: 8, minRow: 0, maxRow: 2 }, units: [
    { id: "left-cap", side: "left", kind: "capital", initiative: 40, integrity: 12, armor: 4, shield: 4, weapons: [
      { id: "aa", ready: true, ammo: 1, accuracy: 100, damage: 11, minRange: 1, maxRange: 3, overwatchEligible: true },
      { id: "battery", ready: true, ammo: 1, accuracy: 100, damage: 9, minRange: 1, maxRange: 10, arc: "360", overwatchEligible: false }
    ] },
    { id: "left-fighter", side: "left", kind: "squadron", initiative: 20, speed: 3, integrity: 30, unitHealth: 10, stack: 3, weapons: [
      { id: "guns", accuracy: 100, damage: 14, minRange: 1, maxRange: 3, arc: "360", overwatchEligible: false }
    ] },
    { id: "right-fighter", side: "right", kind: "squadron", initiative: 30, speed: 5, integrity: 25, unitHealth: 10, stack: 3 },
    { id: "right-cap", side: "right", kind: "capital", initiative: 10, integrity: 4, armor: 3, shield: 2 }
  ] });

  assert.equal(deployUnit(state, "left-cap", { q: 0, r: 0 }, 2), true);
  assert.equal(deployUnit(state, "left-fighter", { q: 1, r: 1 }), true);
  assert.equal(confirmDeployment(state, "left"), true);
  assert.equal(deployUnit(state, "right-fighter", { q: 7, r: 1 }), true);
  assert.equal(deployUnit(state, "right-cap", { q: 8, r: 0 }, 5), true);
  assert.equal(confirmDeployment(state, "right"), true);
  assert.deepEqual(state.queue, ["left-cap", "right-fighter", "left-fighter", "right-cap"]);

  assert.equal(decide(state), true);
  assert.equal(advanceActivation(state, "Maneuver"), true);
  assert.equal(advanceActivation(state, "Attack"), true);
  assert.equal(advanceActivation(state, "EndActivation"), true);
  assert.equal(progress(state), "WaitDecision");

  assert.equal(decide(state), true);
  assert.equal(advanceActivation(state, "Maneuver"), true);
  const reactionStart = state.events.length;
  assert.deepEqual(moveAtomic(state, "right-fighter", [
    { q: 6, r: 1 }, { q: 5, r: 1 }, { q: 4, r: 1 }, { q: 3, r: 1 }, { q: 2, r: 1 }
  ], { random: () => 0.25 }), { status: "moved", moved: 5 });
  const rightFighter = state.units.find(unit => unit.id === "right-fighter");
  assert.equal(rightFighter.integrity, 14);
  assert.equal(state.units.find(unit => unit.id === "left-cap").weapons[0].ammo, 0);
  assert.equal(rightFighter.stack, 2);
  assert.deepEqual(rightFighter.engagedWith, ["left-fighter"]);
  assert.deepEqual(state.events.slice(reactionStart).map(event => event.action), [
    "entry-attempt", "movement-step", "hex-entered", "entry-attempt", "movement-step", "hex-entered", "entry-attempt", "movement-step", "hex-entered",
    "entry-attempt", "movement-step", "hex-entered", "entry-attempt", "movement-step", "hex-entered", "overwatch-declared", "action-paid", "overwatch-shot",
    "line-of-fire-check", "accuracy-check", "attack-shot", "damage-packet", "squadron-craft-lost", "overwatch-result", "interception-link-created", "maneuver-completed"
  ]);
  assert.equal(advanceActivation(state, "Attack"), true);
  assert.equal(advanceActivation(state, "EndActivation"), true);
  assert.equal(progress(state), "WaitDecision");

  assert.equal(decide(state), true);
  assert.equal(advanceActivation(state, "Maneuver"), true);
  assert.deepEqual(moveAtomic(state, "left-fighter", [{ q: 1, r: 0 }]), { status: "blocked", moved: 0 });
  assert.deepEqual(disengage(state, "left-fighter", { random: () => 0.5 }), { success: false, chance: 50, cost: 1 });
  assert.equal(state.lifecycle, "Attack");
  assert.deepEqual(moveAtomic(state, "left-fighter", [{ q: 1, r: 0 }]), { status: "blocked", moved: 0 });
  assert.equal(advanceActivation(state, "EndActivation"), true);
  assert.equal(progress(state), "WaitDecision");

  assert.equal(decide(state), true);
  assert.equal(advanceActivation(state, "Maneuver"), true);
  assert.equal(advanceActivation(state, "Attack"), true);
  assert.equal(advanceActivation(state, "EndActivation"), true);
  assert.equal(progress(state), "RoundEnd");
  assert.equal(progress(state), "RoundStart");
  assert.equal(progress(state), "WaitDecision");

  assert.equal(decide(state), true);
  assert.equal(advanceActivation(state, "Maneuver"), true);
  assert.equal(advanceActivation(state, "Attack"), true);
  const leftCap = state.units.find(unit => unit.id === "left-cap");
  const capitalAttack = resolveAttack(state, leftCap, "right-cap", leftCap.weapons[1], { random: () => 0 });
  assert.equal(capitalAttack.destroyed, true);
  assert.equal(state.attackSpentBy, "left-cap");
  assert.equal(leftCap.weapons[1].ammo, 0);
  assert.equal(state.lifecycle, "Attack");
  assert.equal(state.winner, null);
  assert.equal(advanceActivation(state, "EndActivation"), true);
  assert.equal(progress(state), "WaitDecision");

  assert.equal(decide(state), true);
  assert.equal(advanceActivation(state, "Maneuver"), true);
  assert.deepEqual(moveAtomic(state, "right-fighter", [{ q: 3, r: 1 }]), { status: "blocked", moved: 0 });
  assert.equal(advanceActivation(state, "Attack"), true);
  assert.equal(advanceActivation(state, "EndActivation"), true);
  assert.equal(progress(state), "WaitDecision");

  assert.equal(decide(state), true);
  assert.equal(advanceActivation(state, "Maneuver"), true);
  assert.deepEqual(disengage(state, "left-fighter", { random: () => 0.49 }), { success: true, chance: 50, cost: 1 });
  assert.deepEqual(moveAtomic(state, "left-fighter", [{ q: 1, r: 0 }]), { status: "moved", moved: 1 });
  assert.equal(advanceActivation(state, "Attack"), true);
  const leftFighter = state.units.find(unit => unit.id === "left-fighter");
  const finalAttack = resolveAttack(state, leftFighter, "right-fighter", leftFighter.weapons[0], { random: () => 0 });
  assert.equal(finalAttack.destroyed, true);
  assert.equal(state.lifecycle, "Finished");
  assert.equal(state.winner, "left");
  assert.deepEqual(state.events.slice(-11).map(event => event.action), ["action-declared", "action-paid", "line-of-fire-check", "accuracy-check", "attack-shot", "damage-packet", "squadron-craft-lost", "unit-destroyed", "debris-created", "victory-check", "victory"]);
  assert.equal(state.contents.filter(item => item.kind === "debris").length, 2);
  assert.deepEqual(state.events.map(event => event.action), [
    "deployment-start", "deployment-place", "deployment-place", "deployment-confirm", "deployment-complete",
    "deployment-start", "deployment-place", "deployment-place", "deployment-confirm", "deployment-complete", "round-start",
    "activation-start", "activation-stage", "activation-stage", "activation-stage", "activation-stage", "overwatch-armed", "activation-end",
    "activation-start", "activation-stage", "activation-stage",
    "entry-attempt", "movement-step", "hex-entered", "entry-attempt", "movement-step", "hex-entered", "entry-attempt", "movement-step", "hex-entered",
    "entry-attempt", "movement-step", "hex-entered", "entry-attempt", "movement-step", "hex-entered", "overwatch-declared", "action-paid", "overwatch-shot",
    "line-of-fire-check", "accuracy-check", "attack-shot", "damage-packet", "squadron-craft-lost", "overwatch-result", "interception-link-created", "maneuver-completed",
    "activation-stage", "activation-stage", "activation-end",
    "activation-start", "activation-stage", "activation-stage", "disengagement-declared", "disengagement-paid", "evasion-modifier-applied", "disengagement-check", "disengagement-failed", "activation-stage", "activation-stage", "activation-end",
    "activation-start", "activation-stage", "activation-stage", "activation-stage", "activation-stage", "activation-end", "round-end", "round-start",
    "activation-start", "activation-stage", "activation-stage", "activation-stage", "action-declared", "action-paid", "line-of-fire-check", "accuracy-check", "attack-shot", "damage-packet", "unit-destroyed", "debris-created", "victory-check", "activation-stage", "activation-end",
    "activation-start", "activation-stage", "activation-stage", "activation-stage", "activation-stage", "activation-end",
    "activation-start", "activation-stage", "activation-stage", "disengagement-declared", "disengagement-paid", "evasion-modifier-applied", "disengagement-check", "disengagement-succeeded", "interception-link-removed",
    "entry-attempt", "movement-step", "hex-entered", "maneuver-completed", "activation-stage", "action-declared", "action-paid", "line-of-fire-check", "accuracy-check", "attack-shot", "damage-packet", "squadron-craft-lost", "unit-destroyed", "debris-created", "victory-check", "victory"
  ]);
  assert.equal(validateEventLog(state.events, state.id), true);
  assert.deepEqual(state.events.map(event => event.sequence), Array.from({ length: state.events.length }, (_, index) => index + 1));
  assert.equal(new Set(state.events.map(event => event.eventId)).size, state.events.length);
  const replayed = replayEventLog(state.events, state.id);
  for (const field of ["lifecycle", "deployment", "round", "queue", "activeUnitId", "activationStage", "attackSpentBy", "winner", "units", "contents", "interceptionLinks"])
    assert.deepEqual(replayed[field], state[field]);
  assert.deepEqual(state.events.filter(event => event.action === "disengagement-check").map(event => event.random), [
    { roll: 50, chance: 50 }, { roll: 49, chance: 50 }
  ]);
  assert.deepEqual(state.events.filter(event => event.action === "attack-shot").map(event => event.random), [
    { roll: 25, hitBlocker: 0, hitMain: 100, miss: 0 },
    { roll: 0, hitBlocker: 0, hitMain: 100, miss: 0 },
    { roll: 0, hitBlocker: 0, hitMain: 100, miss: 0 }
  ]);
  const terminalSnapshot = structuredClone({ lifecycle: state.lifecycle, deployment: state.deployment, round: state.round, queue: state.queue, activeUnitId: state.activeUnitId, activationStage: state.activationStage, attackSpentBy: state.attackSpentBy, winner: state.winner, units: state.units, contents: state.contents, interceptionLinks: state.interceptionLinks });
  const eventCount = state.events.length;
  const forbiddenRandom = () => { throw new Error("RNG called after Finished"); };
  assert.equal(progress(state), "Finished");
  assert.equal(decide(state), false);
  assert.equal(advanceActivation(state, "EndActivation"), false);
  assert.deepEqual(moveAtomic(state, "left-fighter", [{ q: 2, r: 0 }], { random: forbiddenRandom }), { status: "blocked", moved: 0 });
  assert.deepEqual(disengage(state, "left-fighter", { random: forbiddenRandom }), { success: false, chance: 0, cost: 0 });
  assert.equal(resolveAttack(state, leftCap, leftFighter, leftCap.weapons[0], { random: forbiddenRandom }).hits, 0);
  assert.deepEqual(applyDamagePacket(state, "left-cap", { amount: 1, critChance: 100, random: forbiddenRandom }), { amount: 0, destroyed: false, layers: [] });
  assert.deepEqual({ lifecycle: state.lifecycle, deployment: state.deployment, round: state.round, queue: state.queue, activeUnitId: state.activeUnitId, activationStage: state.activationStage, attackSpentBy: state.attackSpentBy, winner: state.winner, units: state.units, contents: state.contents, interceptionLinks: state.interceptionLinks }, terminalSnapshot);
  assert.equal(state.events.length, eventCount);
});
