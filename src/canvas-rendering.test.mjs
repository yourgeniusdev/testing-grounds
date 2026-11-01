import assert from "node:assert/strict";
import test from "node:test";
import { maneuverZoneRenderCommands } from "./canvas-rendering.js";
import { planRoutes } from "./domain.js";

function squadron(overrides = {}) {
  return {
    id: "mover",
    name: "Mover",
    sideId: "azure",
    kind: "squadron",
    position: { q: 0, r: 0 },
    currentSpeed: 2,
    speedSpent: 0,
    speedRemaining: 2,
    heading: 0,
    maneuver: 0,
    maneuverSpent: 0,
    maneuverRemaining: 0,
    baseEvasion: 0,
    integrity: 10,
    engagedWith: [],
    weapons: [],
    ...overrides
  };
}

function aaOwner() {
  return {
    id: "aa-owner",
    name: "AA Owner",
    sideId: "crimson",
    kind: "capital",
    position: { q: 0, r: 1 },
    heading: 0,
    integrity: 20,
    weapons: [{
      id: "aa",
      slotOrder: 0,
      mount: "turret",
      weaponClass: "kinetic",
      targetKinds: ["squadron"],
      accuracy: 60,
      maxRange: 2,
      shots: 1,
      damage: 1,
      energyCost: 0,
      firedThisRound: false,
      cooldownRemaining: 0,
      overwatch: true
    }]
  };
}

function stateWithKnownThreats() {
  const mover = squadron();
  return {
    mover,
    state: {
      scenario: { bounds: { minCol: -2, maxCol: 2, minRow: -2, maxRow: 2 }, contents: [] },
      units: [mover, aaOwner(), squadron({ id: "interceptor", name: "Interceptor", sideId: "crimson", position: { q: 2, r: 0 } })],
      initiativeOrder: ["mover", "aa-owner", "interceptor"],
      events: [],
      sequence: 0,
      randomState: { seed: 1 }
    }
  };
}

test("squadron maneuver planning emits distinct muted canvas commands for known AA and Interception zones", () => {
  const { state, mover } = stateWithKnownThreats();
  const route = planRoutes(state, mover, "risky").get("1,0");
  const position = { q: 1, r: 0 };
  const event = {
    hazards: [],
    interceptors: (route.interceptions || []).map(id => state.units.find(unit => unit.id === id)).filter(Boolean)
  };

  assert.deepEqual(route.previewConsequences.map(({ kind, sourceId }) => ({ kind, sourceId })), [
    { kind: "aa", sourceId: "aa-owner" },
    { kind: "interception", sourceId: "interceptor" }
  ]);
  assert.deepEqual(maneuverZoneRenderCommands({ plannedRoutes: new Map([["1,0", route]]), selectedRoute: null, position, event }), {
    base: {
      fillStyle: "rgba(179,76,88,.14)",
      strokeStyle: "rgba(211,125,84,.92)",
      lineWidth: 2.5,
      lineDash: [5, 4]
    },
    outlines: [
      { kind: "aa", inset: 6, strokeStyle: "rgba(196,92,104,.86)", lineWidth: 2, lineDash: [2, 3] },
      { kind: "interception", inset: 3, strokeStyle: "rgba(211,137,83,.92)", lineWidth: 2.5, lineDash: [7, 4] }
    ]
  });
});
