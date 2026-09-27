import test from "node:test";
import assert from "node:assert/strict";
import {
  createBattle,
  deployUnit,
  confirmDeployment,
  decide,
  advanceActivation,
  moveAtomic,
  applyDamagePacket
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

test("atomic movement blocks incompatible capital passage", () => {
  const state = deployedBattle();
  state.lifecycle = "Maneuver";
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
