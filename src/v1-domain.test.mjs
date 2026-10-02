import test from "node:test";
import assert from "node:assert/strict";
import {
  createBattle,
  deployUnit,
  confirmDeployment,
  decide,
  advanceActivation,
  moveAtomic,
  applyDamagePacket,
  refreshInterception,
  disengage,
  previewAttack,
  ram,
  progress,
  resolveAttack,
  resolveOverwatch,
  planMovement,
  changeHeading
} from "./v1-domain.js";

const bounds = { minCol: 0, maxCol: 3, minRow: 0, maxRow: 1 };
const units = [
  { id: "l-cap", side: "left", kind: "capital", initiative: 4, shield: 0, armor: 0, integrity: 10 },
  { id: "r-cap", side: "right", kind: "capital", initiative: 3, shield: 0, armor: 0, integrity: 10 }
];

function deployedBattle() {
  const state = createBattle({ id: "acceptance", bounds, units });
  assert.equal(deployUnit(state, "l-cap", { q: 0, r: 0 }, 2), true);
  assert.equal(confirmDeployment(state, "left"), true);
  assert.equal(deployUnit(state, "r-cap", { q: 3, r: 0 }, 5), true);
  assert.equal(confirmDeployment(state, "right"), true);
  return state;
}

test("sequential deployment locks each side and starts first decision", () => {
  const state = createBattle({ bounds, units });
  assert.equal(deployUnit(state, "l-cap", { q: 0, r: 0 }, 2), true);
  assert.equal(deployUnit(state, "l-cap", { q: 1, r: 0 }, 2), true);
  assert.equal(confirmDeployment(state, "left"), true);
  assert.equal(state.lifecycle, "DeploymentRight");
  assert.equal(deployUnit(state, "l-cap", { q: 0, r: 1 }, 1), false);
  assert.equal(deployUnit(state, "r-cap", { q: 3, r: 0 }, 5), true);
  assert.equal(confirmDeployment(state, "right"), true);
  assert.equal(state.lifecycle, "WaitDecision");
  assert.equal(state.round, 1);
  assert.equal(state.activeUnitId, "l-cap");
});

test("deployment rejects occupied objects and duplicate hexes", () => {
  const state = createBattle({ bounds, contents: [{ id: "rock", kind: "object", position: { q: 0, r: 0 } }], units });
  assert.equal(deployUnit(state, "l-cap", { q: 0, r: 0 }, 0), false);
  assert.equal(deployUnit(state, "l-cap", { q: 0, r: 1 }, 0), true);
  assert.equal(deployUnit(state, "r-cap", { q: 0, r: 1 }, 0), false);
});

test("wait moves unit once, then activation progresses through stages", () => {
  const state = deployedBattle();
  assert.equal(decide(state, "wait"), true);
  assert.equal(state.lifecycle, "WaitDecision");
  assert.equal(state.activeUnitId, "r-cap");
  assert.equal(decide(state, "continue"), true);
  assert.equal(state.lifecycle, "SystemActions");
  assert.equal(advanceActivation(state, "Maneuver"), true);
  assert.equal(advanceActivation(state, "Attack"), true);
  assert.equal(advanceActivation(state, "EndActivation"), true);
});

test("atomic movement enforces active maneuver ownership", () => {
  const state = deployedBattle();
  assert.equal(moveAtomic(state, "l-cap", [{ q: 1, r: 0 }]).moved, 0);
  state.lifecycle = "Maneuver";
  state.activeUnitId = "r-cap";
  assert.equal(moveAtomic(state, "l-cap", [{ q: 1, r: 0 }]).moved, 0);
  state.activeUnitId = "l-cap";
  const result = moveAtomic(state, "l-cap", [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }]);
  assert.equal(result.status, "blocked");
  assert.equal(result.moved, 2);
  assert.deepEqual(state.units.find(unit => unit.id === "l-cap").position, { q: 2, r: 0 });
});

test("movement planning reports blocked route reasons", () => {
  const state = deployedBattle();
  state.lifecycle = "Maneuver";
  state.activeUnitId = "l-cap";
  state.contents.push({ id: "rock", kind: "object", position: { q: 1, r: 0 } });
  const plan = planMovement(state, "l-cap", { q: 2, r: 0 });
  assert.equal(plan.valid, false);
  assert.match(plan.reason, /объектом/i);
});

test("movement planning names occupied ships", () => {
  const state = deployedBattle();
  state.lifecycle = "Maneuver";
  state.activeUnitId = "l-cap";
  state.units.find(unit => unit.id === "l-cap").speed = 8;
  const plan = planMovement(state, "l-cap", { q: 7, r: 0 });
  assert.equal(plan.valid, false);
  assert.match(plan.reason, /кораблём/i);
});

test("movement planning returns deterministic route and heading changes during maneuver", () => {
  const state = deployedBattle();
  state.lifecycle = "Maneuver";
  state.activeUnitId = "l-cap";
  state.units.find(unit => unit.id === "l-cap").speed = 2;
  const plan = planMovement(state, "l-cap", { q: 2, r: 0 });
  assert.equal(plan.valid, true);
  assert.deepEqual(plan.steps, [{ q: 1, r: 0 }, { q: 2, r: 0 }]);
  assert.equal(changeHeading(state, "l-cap", 3), true);
  assert.equal(state.units.find(unit => unit.id === "l-cap").heading, 3);
  assert.equal(state.events.at(-1).action, "heading-change");
});

test("movement planning rejects blocked route without mutating state", () => {
  const state = deployedBattle();
  state.lifecycle = "Maneuver";
  state.activeUnitId = "l-cap";
  state.units.find(unit => unit.id === "l-cap").speed = 2;
  state.contents.push({ id: "rock", kind: "object", position: { q: 1, r: 0 } });
  const plan = planMovement(state, "l-cap", { q: 2, r: 0 });
  assert.equal(plan.valid, false);
  assert.deepEqual(state.units.find(unit => unit.id === "l-cap").position, { q: 0, r: 0 });
});

test("damage crosses layers and destruction creates debris and victory", () => {
  const state = deployedBattle();
  const target = state.units.find(unit => unit.id === "r-cap");
  target.shield = 3;
  target.armor = 2;
  target.integrity = 4;
  const result = applyDamagePacket(state, target, { amount: 9, sourceId: "l-cap" });
  assert.equal(result.amount, 9);
  assert.equal(state.lifecycle, "Finished");
  assert.equal(state.winner, "left");
  assert.ok(state.contents.some(item => item.kind === "debris"));
  assert.ok(state.events.some(event => event.action === "unit-destroyed"));
});

test("interception graph blocks engaged squadron movement and disengage clears links", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "squadron", position: { q: 1, r: 0 }, stack: 2, speed: 1 },
    { id: "b", side: "right", kind: "squadron", position: { q: 2, r: 0 }, stack: 1 }
  ] });
  refreshInterception(state);
  assert.deepEqual(state.units[0].engagedWith, ["b"]);
  assert.equal(moveAtomic(state, "a", [{ q: 0, r: 0 }]).moved, 0);
  assert.equal(disengage(state, "a", { random: () => 0 }).success, true);
  assert.deepEqual(state.units[0].engagedWith, []);
});

test("failed disengagement spends speed, preserves links, ends maneuver, and preserves attack", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "squadron", position: { q: 1, r: 0 }, stack: 2, speed: 3 },
    { id: "b", side: "right", kind: "squadron", position: { q: 2, r: 0 }, stack: 1 },
    { id: "target", side: "right", kind: "capital", position: { q: 3, r: 0 }, integrity: 5 }
  ] });
  state.lifecycle = "Maneuver";
  state.activationStage = "Maneuver";
  state.activeUnitId = "a";
  refreshInterception(state);
  const eventCount = state.events.length;
  const result = disengage(state, "a", { random: () => 0.6 });
  assert.deepEqual(result, { success: false, chance: 60, cost: 1 });
  assert.equal(state.units[0].speed, 2);
  assert.equal(state.units[0].evasionPenalty, -10);
  assert.deepEqual(state.units[0].engagedWith, ["b"]);
  assert.deepEqual(state.units[1].engagedWith, ["a"]);
  assert.equal(state.lifecycle, "Attack");
  assert.deepEqual(state.events.at(-2).random, { roll: 60, chance: 60 });
  assert.equal(moveAtomic(state, "a", [{ q: 0, r: 0 }]).moved, 0);
  assert.equal(resolveAttack(state, "a", "target", { arc: "360", maxRange: 3, accuracy: 100, damage: 2 }, { random: () => 0 }).damage, 2);
  assert.deepEqual(state.events.slice(eventCount).map(event => event.action), ["disengage", "activation-stage", "attack-shot", "damage-packet"]);
});

test("disengagement is unavailable without full Speed payment", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "squadron", position: { q: 1, r: 0 }, stack: 2, speed: 1 },
    { id: "b", side: "right", kind: "squadron", position: { q: 2, r: 0 }, stack: 1 },
    { id: "c", side: "right", kind: "squadron", position: { q: 1, r: 1 }, stack: 1 }
  ] });
  state.lifecycle = "Maneuver";
  state.activeUnitId = "a";
  refreshInterception(state);
  const snapshot = structuredClone(state);
  let rolls = 0;
  assert.deepEqual(disengage(state, "a", { random: () => { rolls += 1; return 0; } }), { success: false, chance: 0, cost: 2 });
  assert.equal(rolls, 0);
  assert.deepEqual(state, snapshot);
});

test("attack preview applies endpoint cover and weapon range", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, heading: 2 },
    { id: "b", side: "right", kind: "capital", position: { q: 3, r: 0 } }
  ], contents: [{ kind: "terrain", cover: "nebula", position: { q: 3, r: 0 } }] });
  const result = previewAttack(state, "a", "b", { accuracy: 80, arc: "linear", minRange: 3, maxRange: 5 });
  assert.equal(result.canAttack, true);
  assert.equal(result.accuracy, 65);
});

test("an attack outside the weapon line of fire is rejected without rolling or damage", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, heading: 2 },
    { id: "b", side: "right", kind: "capital", position: { q: 0, r: 3 }, integrity: 5 }
  ] });
  let rolls = 0;
  const eventCount = state.events.length;
  const weapon = { accuracy: 100, damage: 3, arc: "linear", minRange: 3, maxRange: 5 };
  assert.equal(previewAttack(state, "a", "b", weapon).canAttack, false);
  assert.equal(resolveAttack(state, "a", "b", weapon, { random: () => { rolls += 1; return 0; } }).damage, 0);
  assert.equal(rolls, 0);
  assert.equal(state.units[1].integrity, 5);
  assert.equal(state.events.length, eventCount);
});

test("weapon arcs cover their complete heading-relative geometry", () => {
  const source = { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 } };
  const cases = [
    { heading: 2, arc: "turret", target: { q: -2, r: 0 }, expected: true },
    { heading: 2, arc: "battery-left", target: { q: 1, r: -2 }, expected: true },
    { heading: 2, arc: "battery-left", target: { q: 1, r: 1 }, expected: false },
    { heading: 2, arc: "battery-right", target: { q: 1, r: 1 }, expected: true },
    { heading: 2, arc: "battery-right", target: { q: 1, r: -2 }, expected: false },
    { heading: 2, arc: "linear", target: { q: 3, r: 0 }, expected: true },
    { heading: 2, arc: "linear", target: { q: 2, r: 0 }, expected: false },
    { heading: 2, arc: "linear", target: { q: 6, r: 0 }, expected: false },
    { heading: 4, arc: "linear", target: { q: 0, r: -4 }, expected: true },
    { heading: 2, arc: "forward", target: { q: 2, r: -1 }, expected: true },
    { heading: 2, arc: "forward", target: { q: -2, r: 0 }, expected: false },
    { heading: 5, arc: "forward", target: { q: -2, r: 1 }, expected: true },
    { heading: 5, arc: "forward", target: { q: -4, r: 2 }, expected: false }
  ];
  for (const entry of cases) {
    const state = createBattle({ units: [{ ...source, heading: entry.heading }, { id: "b", side: "right", kind: "capital", position: entry.target }] });
    assert.equal(previewAttack(state, "a", "b", { arc: entry.arc }).canAttack, entry.expected, JSON.stringify(entry));
  }
  for (let heading = 0; heading < 6; heading += 1) {
    const direction = [{ q: -1, r: 1 }, { q: 0, r: 1 }, { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }][heading];
    for (const range of [3, 4, 5]) {
      const target = { q: direction.q * range, r: direction.r * range };
      const state = createBattle({ units: [{ ...source, heading }, { id: "b", side: "right", kind: "capital", position: target }] });
      assert.equal(previewAttack(state, "a", "b", { arc: "linear" }).canAttack, true, `heading ${heading}, range ${range}`);
    }
  }
});

test("ramming applies mass damage and resets attacker evasion", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, mass: 3, evasion: 12, integrity: 10 },
    { id: "b", side: "right", kind: "capital", position: { q: 2, r: 0 }, mass: 2, integrity: 10 }
  ] });
  const result = ram(state, "a", "b", [{ q: 1, r: 0 }]);
  assert.equal(result.success, true);
  assert.equal(state.units.find(unit => unit.id === "a").evasion, 0);
  assert.equal(state.units.find(unit => unit.id === "b").integrity, 4);
  assert.ok(state.events.some(event => event.action === "ramming"));
});

test("successful ramming consumes attack only for the current round", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, mass: 2, integrity: 20 },
    { id: "b", side: "right", kind: "capital", position: { q: 2, r: 0 }, mass: 1, integrity: 20 }
  ] });
  state.round = 1;
  state.lifecycle = "Maneuver";
  state.activeUnitId = "a";
  assert.equal(ram(state, "a", "b", [{ q: 1, r: 0 }]).success, true);
  state.lifecycle = "Attack";
  let rolls = 0;
  const eventCount = state.events.length;
  assert.equal(previewAttack(state, "a", "b", { arc: "360" }).canAttack, false);
  assert.equal(resolveAttack(state, "a", "b", { arc: "360", accuracy: 100, damage: 2 }, { random: () => { rolls += 1; return 0; } }).damage, 0);
  assert.equal(rolls, 0);
  assert.equal(state.events.length, eventCount);
  state.lifecycle = "RoundEnd";
  progress(state);
  progress(state);
  assert.equal(resolveAttack(state, "a", "b", { arc: "360", accuracy: 100, damage: 2 }, { random: () => 0 }).damage, 2);
});

test("explicit ramming can enter an enemy capital hex", () => {
  const state = createBattle({ bounds: { minCol: 0, maxCol: 2, minRow: 0, maxRow: 0 }, units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, mass: 3, integrity: 10 },
    { id: "b", side: "right", kind: "capital", position: { q: 2, r: 0 }, mass: 1, integrity: 10 }
  ] });
  assert.equal(ram(state, "a", "b", [{ q: 1, r: 0 }]).success, true);
});

test("ramming destroys a large object through the damage lifecycle", () => {
  const state = createBattle({
    units: [{ id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, mass: 3, integrity: 10 }],
    contents: [{ id: "station", side: "neutral", kind: "object", size: "large", position: { q: 2, r: 0 }, mass: 2, integrity: 5 }]
  });
  state.lifecycle = "Maneuver";
  state.activeUnitId = "a";
  const result = ram(state, "a", "station", [{ q: 1, r: 0 }]);
  assert.deepEqual(result, { success: true, damage: 5, targetDestroyed: true });
  assert.equal(state.contents.some(item => item.id === "station"), false);
  assert.ok(state.contents.some(item => item.kind === "debris" && item.position.q === 2));
  assert.deepEqual(state.events.slice(-4).map(event => event.action), ["damage-packet", "object-destroyed", "damage-packet", "ramming"]);
});

test("ramming rejects ineligible actors and targets without side effects", () => {
  const cases = [
    [
      { id: "a", side: "left", kind: "squadron", position: { q: 0, r: 0 }, integrity: 5 },
      { id: "b", side: "right", kind: "capital", position: { q: 2, r: 0 }, integrity: 5 }
    ],
    [
      { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, integrity: 5 },
      { id: "b", side: "left", kind: "capital", position: { q: 2, r: 0 }, integrity: 5 }
    ],
    [
      { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, integrity: 5 },
      { id: "b", side: "right", kind: "object", size: "small", position: { q: 2, r: 0 }, integrity: 5 }
    ]
  ];
  for (const units of cases) {
    const state = createBattle({ units });
    state.lifecycle = "Maneuver";
    state.activeUnitId = "a";
    const snapshot = structuredClone(state);
    assert.deepEqual(ram(state, "a", "b", [{ q: 1, r: 0 }]), { success: false, damage: 0 });
    assert.deepEqual(state, snapshot);
  }
});

test("movement refreshes interception and stops after lethal overwatch", () => {
  const state = createBattle({ id: "movement-reaction", round: 1, units: [
    { id: "cap", side: "left", kind: "capital", position: { q: 0, r: 0 }, weapons: [{ id: "aa", ready: true, ammo: 1, maxRange: 3, damage: 5, accuracy: 100, overwatchEligible: true }] },
    { id: "squad", side: "right", kind: "squadron", position: { q: 3, r: 0 }, integrity: 5, interceptRange: 1, speed: 3 }
  ] });
  state.lifecycle = "Maneuver";
  refreshInterception(state);
  state.round = 1;
  state.activeUnitId = "squad";
  state.units[0].weapons[0].overwatch = true;
  state.units[0].weapons[0].overwatchRound = 1;
  const result = moveAtomic(state, "squad", [{ q: 2, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 0 }], { });
  assert.equal(result.moved, 1);
  assert.equal(state.units.some(unit => unit.id === "squad"), false);
  assert.equal(state.events.filter(event => event.action === "movement-step").length, 1);
});

test("an AA slot cannot trigger again against the same squadron in one round", () => {
  const state = createBattle({ id: "aa", round: 1, units: [
    { id: "cap", side: "left", kind: "capital", initiative: 5, position: { q: 0, r: 0 }, weapons: [{ id: "aa", ready: true, ammo: 2, maxRange: 3, damage: 3, accuracy: 0, overwatchEligible: true }] },
    { id: "squad", side: "right", kind: "squadron", position: { q: 2, r: 0 }, integrity: 5 }
  ] });
  state.lifecycle = "EndActivation"; state.activeUnitId = "cap"; progress(state);
  assert.equal(state.units[0].weapons[0].overwatch, true);
  const first = resolveOverwatch(state, "squad", { random: () => 0.1 });
  assert.equal(first[0].damage, 0);
  const slot = state.units[0].weapons[0];
  assert.equal(slot.ready, false);
  assert.equal(slot.overwatch, false);
  assert.deepEqual(slot.overwatchTargets, ["squad"]);
  assert.deepEqual(state.events.slice(-2).map(event => event.action), ["overwatch-declared", "overwatch-shot"]);
  assert.deepEqual(state.events.at(-1).random, { roll: 10, accuracy: 0 });
  const counts = Object.fromEntries(["overwatch-declared", "overwatch-shot", "attack-shot", "damage-packet"].map(action => [action, state.events.filter(event => event.action === action).length]));
  slot.ready = true;
  slot.overwatch = true;
  assert.deepEqual(resolveOverwatch(state, "squad", { random: () => 0 }), []);
  for (const [action, count] of Object.entries(counts)) assert.equal(state.events.filter(event => event.action === action).length, count);
});

test("memory store persists and notifies domain snapshots", async () => {
  const { createMemoryPersistence, createBattleStore } = await import("./v1-store.js");
  const persistence = createMemoryPersistence();
  const store = createBattleStore({ persistence, initial: { id: "stored", bounds, units } });
  let notifications = 0;
  store.subscribe(() => { notifications += 1; });
  store.transact(state => { state.round = 7; return state.round; });
  assert.equal(store.getState().round, 7);
  assert.equal(notifications, 1);
  assert.equal(persistence.load().round, 7);
});
