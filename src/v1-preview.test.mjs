import test from "node:test";
import assert from "node:assert/strict";
import { createBattle } from "./v1-domain.js";
import { formatAttackPreview, getAttackPreview } from "./v1-preview.js";

test("attack preview exposes complete salvo details", () => {
  const state = createBattle({ contents: [{ kind: "terrain", cover: "nebula", position: { q: 3, r: 0 } }], units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, weapons: [{ id: "battery", accuracy: 80, damage: 2, shots: 2, minRange: 1, maxRange: 5 }] },
    { id: "b", side: "right", kind: "capital", position: { q: 3, r: 0 } }
  ] });
  const preview = getAttackPreview(state, "a", "b");
  assert.equal(preview.totalDamage, 4);
  assert.match(formatAttackPreview(preview), /2 выстр\./);
  assert.match(formatAttackPreview(preview), /укрытие −15%/);
});
