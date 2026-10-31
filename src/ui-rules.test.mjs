import assert from "node:assert/strict";
import test from "node:test";
import { buildManeuverOptions, maneuverResourcePreview, routeConsequenceRows } from "./ui-rules.js";

const signedTurn = (from, to) => {
  let delta = (to - from + 6) % 6;
  if (delta > 3) delta -= 6;
  return delta;
};

function route(overrides = {}) {
  return {
    position: { q: 2, r: -1 },
    heading: 0,
    movementCost: 2,
    turnsSpent: 1,
    steps: [{}, {}],
    path: [],
    consequences: [],
    interception: null,
    ...overrides
  };
}

test("buildManeuverOptions creates one stable option per available final heading", () => {
  const unit = { heading: 0, currentSpeed: 4, maneuver: 3, evasiveManeuver: false };
  const plannedRoute = route();

  const options = buildManeuverOptions(unit, plannedRoute, new Set([5, 0, 1]), signedTurn);

  assert.deepEqual(options.map(option => option.optionId), ["maneuver:2:-1:heading:5", "maneuver:2:-1:heading:0", "maneuver:2:-1:heading:1"]);
  assert.deepEqual(options.map(option => option.finalState), [
    { hex: { q: 2, r: -1 }, heading: 5 },
    { hex: { q: 2, r: -1 }, heading: 0 },
    { hex: { q: 2, r: -1 }, heading: 1 }
  ]);
  assert.ok(options.every(option => option.route === plannedRoute));
  assert.deepEqual(options.map(option => option.resources.maneuver.spent), [2, 1, 2]);
});

test("buildManeuverOptions falls back to a heading-free squadron option", () => {
  const plannedRoute = route({ heading: undefined, movementCost: 3, turnsSpent: 0, interception: "enemy-flight" });
  const options = buildManeuverOptions({ currentSpeed: 5 }, plannedRoute);

  assert.deepEqual(options, [{
    optionId: "maneuver:2:-1",
    finalState: { hex: { q: 2, r: -1 } },
    route: plannedRoute,
    resources: { speed: { spent: 3, remaining: 2, capacity: 5 } },
    consequences: [],
    interceptions: [],
    interception: "enemy-flight"
  }]);
});

test("buildManeuverOptions preserves an explicitly empty set of legal options", () => {
  const plannedRoute = route();

  assert.deepEqual(buildManeuverOptions({ currentSpeed: 5, maneuver: 2 }, plannedRoute, new Set(), signedTurn), []);
});

test("stationary headings spend the full signed turn distance plus evasive maneuver", () => {
  const unit = { heading: 0, currentSpeed: 3, maneuver: 4, evasiveManeuver: true };
  const plannedRoute = route({ position: { q: -3, r: 4 }, heading: 0, movementCost: 0, turnsSpent: 0, steps: [] });

  const [option] = buildManeuverOptions(unit, plannedRoute, new Set([3]), signedTurn);

  assert.deepEqual(option.finalState, { hex: { q: -3, r: 4 }, heading: 3 });
  assert.deepEqual(option.resources, {
    speed: { spent: 0, remaining: 3, capacity: 3 },
    maneuver: { spent: 4, remaining: 0, capacity: 4 }
  });
});

test("options expose route consequences and interception without transforming them", () => {
  const consequences = [{ sourceName: "Debris", probability: 0.5, min: 1, max: 2, effect: "damage" }];
  const plannedRoute = route({ movementCost: 7, consequences, interception: "wasps" });

  const [option] = buildManeuverOptions({ currentSpeed: 5 }, plannedRoute);

  assert.equal(option.consequences, consequences);
  assert.equal(option.interception, "wasps");
  assert.deepEqual(option.resources.speed, { spent: 7, remaining: 0, capacity: 5 });
});

test("options expose the full interception preview plus the temporary deterministic singular adapter", () => {
  const plannedRoute = route({ interceptions: ["enemy-a", "enemy-z"], interception: "enemy-a" });

  const [option] = buildManeuverOptions({ currentSpeed: 5 }, plannedRoute);

  assert.deepEqual(option.interceptions, ["enemy-a", "enemy-z"]);
  assert.equal(option.interception, "enemy-a");
});

test("route consequence rows visibly describe hazards, AA, guaranteed effects, and every interception", () => {
  const routePreview = route({
    previewConsequences: [
      { kind: "hazard", sourceId: "mines", sourceName: "Minefield", effect: "integrity damage", probability: 0.5, min: 2, max: 6, expectedHarm: 2, guaranteed: false },
      { kind: "aa", sourceId: "escort", sourceName: "Escort", slotId: "aa", effect: "AA reaction", probability: 0.4, min: 0, max: 4, expectedHarm: 1.6, guaranteed: false },
      { kind: "effect", sourceId: "gravity", sourceName: "Gravity Well", effect: "speed lock", probability: 1, min: 0, max: 0, expectedHarm: 0, guaranteed: true },
      { kind: "interception", sourceId: "enemy-a", sourceName: "Enemy A", effect: "Interception", probability: 1, min: 0, max: 0, expectedHarm: 0, guaranteed: true },
      { kind: "interception", sourceId: "enemy-z", sourceName: "Enemy Z", effect: "Interception", probability: 1, min: 0, max: 0, expectedHarm: 0, guaranteed: true }
    ]
  });

  assert.deepEqual(routeConsequenceRows(routePreview), [
    { kind: "hazard", title: "Minefield", detail: "50% · 2–6 · integrity damage · expected harm 2" },
    { kind: "aa", title: "AA · Escort", detail: "40% · 0–4 · AA reaction · expected harm 1.6" },
    { kind: "effect", title: "Gravity Well", detail: "Guaranteed · speed lock" },
    { kind: "interception", title: "Interception · Enemy A", detail: "Guaranteed · Interception" },
    { kind: "interception", title: "Interception · Enemy Z", detail: "Guaranteed · Interception" }
  ]);
});

test("maneuverResourcePreview uses the hovered preview option before the selected option", () => {
  const unit = { speedSpent: 1, maneuverSpent: 1 };
  const option = {
    resources: {
      speed: { spent: 3, remaining: 1, capacity: 4 },
      maneuver: { spent: 2, remaining: 1, capacity: 3 }
    }
  };
  const previewOption = {
    resources: {
      speed: { spent: 4, remaining: 0, capacity: 4 },
      maneuver: { spent: 3, remaining: 0, capacity: 3 }
    }
  };

  assert.deepEqual(maneuverResourcePreview(unit, { option, previewOption }, "movement", signedTurn), {
    speedSpent: 1,
    speedPreview: 3,
    maneuverSpent: 1,
    maneuverPreview: 2
  });
  assert.deepEqual(maneuverResourcePreview(unit, { option }, "movement", signedTurn), {
    speedSpent: 1,
    speedPreview: 2,
    maneuverSpent: 1,
    maneuverPreview: 1
  });
  assert.deepEqual(maneuverResourcePreview(unit, { previewOption: { resources: { speed: 4, maneuver: 3 } } }, "movement", signedTurn), {
    speedSpent: 1,
    speedPreview: 3,
    maneuverSpent: 1,
    maneuverPreview: 2
  });
});

test("maneuverResourcePreview keeps legacy route selections and suppresses attack previews", () => {
  const unit = { heading: 0, speedSpent: 1, maneuverSpent: 1, evasiveManeuver: true };
  const selected = { heading: 2, route: route({ heading: 1, movementCost: 4, turnsSpent: 1 }) };

  assert.deepEqual(maneuverResourcePreview(unit, selected, "movement", signedTurn), {
    speedSpent: 1,
    speedPreview: 3,
    maneuverSpent: 1,
    maneuverPreview: 2
  });
  assert.deepEqual(maneuverResourcePreview(unit, { option: { resources: { speed: { spent: 4, remaining: 0, capacity: 4 } } } }, "attack", signedTurn), {
    speedSpent: 1,
    speedPreview: 0,
    maneuverSpent: 1,
    maneuverPreview: 0
  });
});
