import test from "node:test";
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
  resolveAttack
} from "./v1-domain.js";

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
  ]), { status: "moved", moved: 5 });
  const rightFighter = state.units.find(unit => unit.id === "right-fighter");
  assert.equal(rightFighter.integrity, 14);
  assert.equal(rightFighter.stack, 2);
  assert.deepEqual(rightFighter.engagedWith, ["left-fighter"]);
  assert.deepEqual(state.events.slice(reactionStart).map(event => event.action), [
    "entry-attempt", "movement-step", "entry-attempt", "movement-step", "entry-attempt", "movement-step",
    "entry-attempt", "movement-step", "entry-attempt", "movement-step", "overwatch-declared", "overwatch-shot",
    "attack-shot", "damage-packet", "squadron-craft-lost", "interception-link-created"
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
  assert.deepEqual(state.events.slice(-6).map(event => event.action), ["attack-shot", "damage-packet", "squadron-craft-lost", "unit-destroyed", "debris-created", "victory"]);
  assert.equal(state.contents.filter(item => item.kind === "debris").length, 2);
  const eventCount = state.events.length;
  assert.equal(progress(state), "Finished");
  assert.equal(state.events.length, eventCount);
  assert.equal(decide(state), false);
});
