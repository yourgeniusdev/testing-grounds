import test from "node:test";
import assert from "node:assert/strict";
import { applyDamagePacket, confirmDeployment, createBattle, deployUnit, progress } from "./v1-domain.js";

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
