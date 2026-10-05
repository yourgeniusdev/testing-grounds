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
  assert.match(formatAttackPreview(preview), /65% в цель/);
  assert.match(formatAttackPreview(preview), /35% промах/);
  assert.match(formatAttackPreview(preview), /2 урон\/попадание/);
  assert.match(formatAttackPreview(preview), /4 макс\. урон/);
  assert.match(formatAttackPreview(preview), /укрытие −15%/);
});

test("attack preview exposes friendly-fire blocker distribution without mutation", () => {
  const state = createBattle({ contents: [{ kind: "terrain", cover: "nebula", position: { q: 3, r: 0 } }], units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, weapons: [{ accuracy: 80, damage: 2, shots: 2, maxRange: 5 }] },
    { id: "ally", side: "left", kind: "capital", size: "medium", position: { q: 1, r: 0 }, integrity: 5 },
    { id: "b", side: "right", kind: "capital", position: { q: 3, r: 0 }, integrity: 5 }
  ] });
  const before = structuredClone(state);
  const text = formatAttackPreview(getAttackPreview(state, "a", "b"));
  assert.match(text, /15% в цель/);
  assert.match(text, /50% в ally/);
  assert.match(text, /35% промах/);
  assert.match(text, /friendly fire: ally/);
  assert.deepEqual(state, before);
});

test("attack preview labels enemy obstruction and a fully blocked target", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, weapons: [{ accuracy: 80, damage: 2, maxRange: 5 }] },
    { id: "screen", side: "right", kind: "capital", size: "large", position: { q: 1, r: 0 } },
    { id: "b", side: "right", kind: "capital", position: { q: 3, r: 0 } }
  ] });
  const preview = getAttackPreview(state, "a", "b");
  assert.equal(preview.canAttack, true);
  assert.match(formatAttackPreview(preview), /0% в цель/);
  assert.match(formatAttackPreview(preview), /80% в screen/);
  assert.match(formatAttackPreview(preview), /20% промах/);
  assert.match(formatAttackPreview(preview), /перекрытие: screen/);
});

test("attack preview uses a selected weapon slot and explains unavailable targets", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, weaponSlots: [
      { weapon: { id: "short", accuracy: 90, damage: 1, shots: 1, maxRange: 1 } },
      { weapon: { id: "long", accuracy: 70, damage: 3, shots: 2, maxRange: 5 } }
    ] },
    { id: "b", side: "right", kind: "capital", position: { q: 3, r: 0 } }
  ] });
  const preview = getAttackPreview(state, "a", "b", 1);
  assert.equal(preview.weaponId, "long");
  assert.equal(preview.totalDamage, 6);
  assert.equal(formatAttackPreview(getAttackPreview(state, "a", "b", 0)), "Цель недоступна для этого оружия");
  assert.equal(formatAttackPreview(null), "Выберите доступную цель");
});

test("attack preview rejects an unavailable weapon slot", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", position: { q: 0, r: 0 }, weaponSlots: [{ ready: false, weapon: { id: "spent", damage: 5, maxRange: 5 } }] },
    { id: "b", side: "right", position: { q: 1, r: 0 } }
  ] });
  assert.equal(getAttackPreview(state, "a", "b"), null);
});
