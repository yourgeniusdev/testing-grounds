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
  resolveOverwatch
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
    { id: "a", side: "left", kind: "squadron", position: { q: 1, r: 0 }, stack: 2 },
    { id: "b", side: "right", kind: "squadron", position: { q: 2, r: 0 }, stack: 1 }
  ] });
  refreshInterception(state);
  assert.deepEqual(state.units[0].engagedWith, ["b"]);
  assert.equal(moveAtomic(state, "a", [{ q: 0, r: 0 }]).moved, 0);
  assert.equal(disengage(state, "a", { random: () => 0 }).success, true);
  assert.deepEqual(state.units[0].engagedWith, []);
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

test("explicit ramming can enter an enemy capital hex", () => {
  const state = createBattle({ bounds: { minCol: 0, maxCol: 2, minRow: 0, maxRow: 0 }, units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, mass: 3, integrity: 10 },
    { id: "b", side: "right", kind: "capital", position: { q: 2, r: 0 }, mass: 1, integrity: 10 }
  ] });
  assert.equal(ram(state, "a", "b", [{ q: 1, r: 0 }]).success, true);
});

test("overwatch arms, fires once per slot and target, and records deterministic damage", () => {
  const state = createBattle({ id: "aa", round: 1, units: [
    { id: "cap", side: "left", kind: "capital", initiative: 5, position: { q: 0, r: 0 }, weapons: [{ id: "aa", ready: true, ammo: 2, maxRange: 3, damage: 3, accuracy: 100 }] },
    { id: "squad", side: "right", kind: "squadron", position: { q: 2, r: 0 }, integrity: 5 }
  ] });
  state.lifecycle = "EndActivation"; state.activeUnitId = "cap"; progress(state);
  assert.equal(state.units[0].weapons[0].overwatch, true);
  const first = resolveOverwatch(state, "squad", { random: () => 0.1 });
  assert.equal(first[0].damage, 3);
  assert.equal(state.units[0].weapons[0].ready, false);
  assert.deepEqual(resolveOverwatch(state, "squad", { random: () => 0 }), []);
  assert.ok(state.events.some(event => event.action === "overwatch-shot" && event.random));
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
