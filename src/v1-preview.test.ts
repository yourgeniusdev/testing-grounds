import { test } from "vitest";
import assert from "node:assert/strict";
import { createBattle, previewManeuverRoute } from "./v1-domain.ts";
import { formatAttackPreview, getAttackPreview } from "./v1-preview.ts";

test("attack preview exposes complete salvo details", () => {
  const state = createBattle({ contents: [{ kind: "terrain", cover: "nebula", position: { q: 3, r: 0 } }], units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, weapons: [{ id: "battery", accuracy: 80, damage: 2, shots: 2, minRange: 1, maxRange: 5 }] },
    { id: "b", side: "right", kind: "squadron", position: { q: 3, r: 0 } }
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
    { id: "b", side: "right", kind: "squadron", position: { q: 3, r: 0 }, integrity: 5 }
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

test("maneuver preview exposes readable route failure reasons", () => {
  const state = createBattle({ units: [{ id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, heading: 0, currentSpeed: 1, maneuver: 0 }] });
  assert.equal(previewManeuverRoute(state, "missing", []).reason, "Нет исходной позиции");
  const preview = previewManeuverRoute(state, "a", [{ q: 0, r: 1 }]);
  assert.equal(preview.valid, false);
  assert.equal(preview.reason, "Маршрут нарушает ограничения движения");
  assert.equal(/[Р][ Ў]/.test(preview.reason), false);
});

test("maneuver preview reports costs, turns, deterministic effects, AA risks, and remains pure", () => {
  const state = createBattle({ units: [
    { id: "fighter", side: "left", kind: "squadron", position: { q: 0, r: 0 }, currentSpeed: 4, evasion: 10, integrity: 5 },
    { id: "aa", side: "right", kind: "capital", position: { q: 3, r: 0 }, weapons: [{ id: "flak", ready: true, overwatchEligible: true, overwatch: true, overwatchRound: 1, accuracy: 70, damage: 2, shots: 1, maxRange: 3 }] }
  ], contents: [{ id: "cloud", kind: "terrain", position: { q: 1, r: 0 }, movementCost: 2, onEnterEffects: [{ type: "modify-unit", field: "evasion", amount: 5 }, { type: "damage", amount: 1 }] }] });
  state.round = 1;
  const before = structuredClone(state);
  const preview = previewManeuverRoute(state, "fighter", [{ q: 1, r: 0 }, { q: 2, r: 0 }]);
  assert.equal(preview.movementCost, 3);
  assert.equal(preview.speedRemaining, 1);
  assert.deepEqual(preview.entries[0].effects, [{ sourceId: "cloud", type: "modify-unit", field: "evasion", amount: 5 }, { sourceId: "cloud", type: "damage", amount: 1 }]);
  assert.deepEqual(preview.entries[0].aaRisks, [{ ownerId: "aa", slotId: "flak", accuracy: 70, damage: 2, shots: 1 }]);
  assert.deepEqual(preview.entries[1].aaRisks, []);
  assert.equal(preview.stopLegal, true);
  assert.deepEqual(state, before);
});

test("maneuver preview applies speed effects, rejects illegal steps and lethal continuations", () => {
  const state = createBattle({ bounds: { minCol: 0, maxCol: 3, minRow: 0, maxRow: 1 }, units: [
    { id: "a", side: "left", kind: "squadron", position: { q: 0, r: 0 }, currentSpeed: 2, integrity: 2 },
    { id: "b", side: "right", kind: "capital", position: { q: 3, r: 1 } }
  ], contents: [{ id: "drag", kind: "terrain", position: { q: 1, r: 0 }, onEnterEffects: [{ type: "modify-unit", field: "currentSpeed", amount: -1 }] }] });
  const slowed = previewManeuverRoute(state, "a", [{ q: 1, r: 0 }, { q: 2, r: 0 }]);
  assert.equal(slowed.valid, false);
  assert.equal(slowed.entries[0].speedRemaining, 0);
  assert.equal(slowed.entries[1].reachable, false);
  assert.equal(previewManeuverRoute(state, "a", [{ q: 2, r: 0 }]).valid, false);
  assert.equal(previewManeuverRoute(state, "a", [{ q: -1, r: 0 }]).valid, false);
  state.contents[0] = { id: "mine", kind: "hazard", position: { q: 1, r: 0 }, onEnterDamage: 2 };
  const lethal = previewManeuverRoute(state, "a", [{ q: 1, r: 0 }, { q: 2, r: 0 }]);
  assert.equal(lethal.entries[0].lethal, true);
  assert.equal(lethal.entries[1].reachable, false);
});

test("maneuver preview identifies an enemy destination as requiring explicit ram", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, heading: 0, currentSpeed: 2, maneuver: 1 },
    { id: "b", side: "right", kind: "capital", position: { q: 2, r: 0 } }
  ] });
  const preview = previewManeuverRoute(state, "a", [{ q: 1, r: 0 }, { q: 2, r: 0 }]);
  assert.equal(preview.ramRequired, true);
  assert.equal(preview.ramTargetId, "b");
  assert.equal(preview.stopLegal, false);
  assert.equal(preview.finalHeading, 0);
  assert.equal(previewManeuverRoute(state, "a", [{ q: 1, r: 0 }], { heading: 3 }).valid, false);
});

test("attack preview rejects unavailable and overwatch weapon slots without mutation", () => {
  for (const slot of [
    { ready: false, weapon: { id: "spent", damage: 5, maxRange: 5 } },
    { ready: true, ammo: 0, weapon: { id: "empty", damage: 5, maxRange: 5 } },
    { ready: true, ammo: 1, overwatch: true, weapon: { id: "armed", damage: 5, maxRange: 5 } }
  ]) {
    const state = createBattle({ units: [
      { id: "a", side: "left", position: { q: 0, r: 0 }, weaponSlots: [slot] },
      { id: "b", side: "right", position: { q: 1, r: 0 } }
    ] });
    const before = structuredClone(state);
    assert.equal(getAttackPreview(state, "a", "b"), null);
    assert.deepEqual(state, before);
  }
});
