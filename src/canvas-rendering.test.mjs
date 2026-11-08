import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { battlefieldGeometry, maneuverTargetPosition, maneuverZoneRenderCommands } from "./canvas-rendering.js";
import { planRoutes } from "./domain.js";

test("canvas reserves complete maneuver targets above and below outer hexes without changing side padding", () => {
  for (const [width, height] of [[440, 300], [800, 500], [1200, 900]]) {
    const geometry = battlefieldGeometry(width, height, 2);
    const radius = 20;
    assert.equal(geometry.cy, height / 2);
    assert.equal(geometry.size, Math.min(44, (height - 50) / 18, (width - 32) / (Math.sqrt(3) * 14)));
    assert.ok(geometry.cy - 9 * geometry.size - radius >= 4);
    assert.ok(geometry.cy + 9 * geometry.size + radius <= height);
    assert.equal(geometry.cx, width / 2);
    assert.ok(geometry.size <= (width - 32) / (Math.sqrt(3) * 14));
    assert.equal(geometry.dpr, 2);
    for (const sign of [-1, 1]) {
      const target = { x: geometry.cx, y: geometry.cy + sign * 7.5 * geometry.size };
      const neighbor = { x: target.x, y: target.y + sign * 1.5 * geometry.size };
      const marker = maneuverTargetPosition(target, neighbor, width, height);
      assert.ok(marker.y - marker.radius >= 4);
      assert.equal(marker.y, neighbor.y);
      assert.ok(Math.abs(marker.y - target.y) > geometry.size);
      assert.ok(marker.y + marker.radius <= height);
      assert.ok(marker.x - marker.radius >= 0 && marker.x + marker.radius <= width);
      assert.ok(marker.radius >= (16 + 2.5 / 2) * 1.14);
    }
  }
});

test("activation status and coordinates live in the header rather than over the battlefield", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const header = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)[1];
  for (const id of ["modeLabel", "coordinates"]) {
    assert.ok(header.includes(`id="${id}"`));
    assert.equal(html.split(`id="${id}"`).length - 1, 1);
  }
  assert.ok(!html.includes('class="canvas-toolbar"'));
});

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
      units: [mover, aaOwner(), squadron({ id: "interceptor", canIntercept: true, name: "Interceptor", sideId: "crimson", position: { q: 2, r: 0 } })],
      initiativeOrder: ["mover", "aa-owner", "interceptor"],
      events: [],
      sequence: 0,
      randomState: { seed: 1 }
    }
  };
}

const position = { q: 1, r: 0 };

function routeWith(...kinds) {
  return { previewConsequences: kinds.map(kind => ({ kind, position })) };
}

const aaCommand = { kind: "aa", inset: 6, strokeStyle: "rgba(196,92,104,.86)", lineWidth: 2, lineDash: [2, 3] };
const interceptionCommand = { kind: "interception", inset: 3, strokeStyle: "rgba(211,137,83,.92)", lineWidth: 2.5, lineDash: [7, 4] };

function renderCommands(plannedRoutes, selectedRoute = null, event = null) {
  return maneuverZoneRenderCommands({ plannedRoutes, selectedRoute, position, event });
}

test("squadron maneuver planning emits distinct muted canvas commands for known AA and Interception zones", () => {
  const { state, mover } = stateWithKnownThreats();
  const route = planRoutes(state, mover, "risky").get("1,0");
  const event = {
    hazards: [],
    interceptors: (route.interceptions || []).map(id => state.units.find(unit => unit.id === id)).filter(Boolean)
  };

  assert.deepEqual(route.previewConsequences.map(({ kind, sourceId }) => ({ kind, sourceId })), [
    { kind: "aa", sourceId: "aa-owner" },
    { kind: "interception", sourceId: "interceptor" }
  ]);
  assert.deepEqual(renderCommands(new Map([["1,0", route]]), null, event), {
    base: {
      fillStyle: "rgba(179,76,88,.14)",
      strokeStyle: "rgba(211,125,84,.92)",
      lineWidth: 2.5,
      lineDash: [5, 4]
    },
    outlines: [aaCommand, interceptionCommand]
  });
});

test("renders a known AA zone from unselected route previews", () => {
  assert.deepEqual(renderCommands(new Map([["aa", routeWith("aa")]])), {
    base: { fillStyle: "rgba(179,76,88,.14)", strokeStyle: "rgba(196,92,104,.78)", lineWidth: 2, lineDash: [] },
    outlines: [aaCommand]
  });
});

test("renders a known interception zone from unselected route previews", () => {
  assert.deepEqual(renderCommands(new Map([["interception", routeWith("interception")]])), {
    base: { fillStyle: "rgba(198,126,75,.15)", strokeStyle: "rgba(211,137,83,.82)", lineWidth: 2.5, lineDash: [5, 4] },
    outlines: [interceptionCommand]
  });
});

test("renders overlapping known zones with distinguishable outlines", () => {
  assert.deepEqual(renderCommands(new Map([["overlap", routeWith("aa", "interception")]])), {
    base: { fillStyle: "rgba(179,76,88,.14)", strokeStyle: "rgba(211,125,84,.92)", lineWidth: 2.5, lineDash: [5, 4] },
    outlines: [aaCommand, interceptionCommand]
  });
});

test("selected route refines known zones without hiding global route previews", () => {
  assert.deepEqual(renderCommands(new Map([["aa", routeWith("aa")]]), routeWith("interception")), {
    base: { fillStyle: "rgba(179,76,88,.14)", strokeStyle: "rgba(211,125,84,.92)", lineWidth: 2.5, lineDash: [5, 4] },
    outlines: [aaCommand, interceptionCommand]
  });
});

test("does not infer hidden zones from event units without preview descriptors", () => {
  assert.deepEqual(renderCommands(new Map([["hidden", routeWith()]]), null, { hazards: [], interceptors: [{ id: "hidden" }] }), {
    base: null,
    outlines: []
  });
});

test("preserves hazard fill beneath a known interception outline", () => {
  assert.deepEqual(renderCommands(new Map([["interception", routeWith("interception")]]), null, { hazards: [{}], interceptors: [] }), {
    base: { strokeStyle: "rgba(211,137,83,.82)", lineWidth: 2.5, lineDash: [5, 4] },
    outlines: [interceptionCommand]
  });
});
