import assert from "node:assert/strict";
import test from "node:test";
import { planRoutes } from "./domain.js";
import { aaPreviewDescriptors } from "./route-preview.js";
import { buildManeuverOptions } from "./ui-rules.js";

function unit(overrides = {}) {
  return {
    id: "mover",
    name: "Mover",
    sideId: "azure",
    kind: "squadron",
    canIntercept: true,
    position: { q: 0, r: 0 },
    currentSpeed: 3,
    heading: 0,
    maneuver: 5,
    speedSpent: 0,
    speedRemaining: 3,
    maneuverSpent: 0,
    maneuverRemaining: 5,
    engagedWith: [],
    weapons: [{ id: "weapon-a", firedThisRound: false, cooldownRemaining: 0 }],
    ...overrides
  };
}

function battle(mover, { units = [], contents = [] } = {}) {
  return {
    scenario: {
      id: "route-planning-characterization",
      bounds: { minCol: -4, maxCol: 4, minRow: -4, maxRow: 4 },
      contents
    },
    units: [mover, ...units],
    events: [{ eventId: "existing-event" }],
    sequence: 1,
    randomState: { seed: 17 }
  };
}

function terrain(type = "asteroidField", overrides = {}) {
  return {
    id: `${type}-a`,
    kind: "terrain",
    type,
    label: type,
    position: { q: 1, r: 0 },
    ...overrides
  };
}

function routeShape(routes) {
  return [...routes.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([destination, route]) => ({
      destination,
      position: route.position,
      heading: route.heading,
      movementCost: route.movementCost,
      turnsSpent: route.turnsSpent,
      steps: route.steps,
      consequences: route.consequences,
      previewConsequences: route.previewConsequences,
      path: route.path,
      interceptions: route.interceptions
    }));
}

const costCases = [
  { name: "large ship entering an ordinary hex", kind: "capital", contents: [], expectedCost: 1 },
  { name: "large ship entering asteroid terrain", kind: "capital", contents: [terrain()], expectedCost: 1 },
  { name: "squadron entering an ordinary hex", kind: "squadron", contents: [], expectedCost: 1 },
  { name: "squadron entering asteroid terrain", kind: "squadron", contents: [terrain()], expectedCost: 2 }
];

for (const scenario of costCases) {
  test(`characterizes movement cost: ${scenario.name}`, () => {
    const mover = unit({
      kind: scenario.kind,
      currentSpeed: 2,
      speedRemaining: 2,
      ...(scenario.kind === "capital" ? { heading: 0, maneuver: 0 } : {})
    });
    const routes = planRoutes(battle(mover, { contents: scenario.contents }), mover, "risky");
    assert.equal(routes.get("1,0")?.movementCost, scenario.expectedCost);
  });
}

const blockedCases = [
  { name: "large ship by a large ship", moverKind: "capital", blockerKind: "capital", blockerType: "unit" },
  { name: "large ship by a squadron", moverKind: "capital", blockerKind: "squadron", blockerType: "unit" },
  { name: "squadron by a squadron", moverKind: "squadron", blockerKind: "squadron", blockerType: "unit" },
  { name: "large ship by an object", moverKind: "capital", blockerType: "object" },
  { name: "squadron by an object", moverKind: "squadron", blockerType: "object" }
];

for (const scenario of blockedCases) {
  test(`characterizes forbidden entry: ${scenario.name}`, () => {
    const mover = unit({
      kind: scenario.moverKind,
      currentSpeed: 1,
      speedRemaining: 1,
      ...(scenario.moverKind === "capital" ? { heading: 0, maneuver: 0 } : {})
    });
    const blocker = scenario.blockerType === "unit"
      ? unit({ id: "blocker", kind: scenario.blockerKind, sideId: "crimson", position: { q: 1, r: 0 } })
      : null;
    const contents = scenario.blockerType === "object"
      ? [{ id: "station", kind: "object", type: "station", position: { q: 1, r: 0 } }]
      : [];
    const routes = planRoutes(battle(mover, { units: blocker ? [blocker] : [], contents }), mover, "risky");
    assert.equal(routes.has("1,0"), false);
  });
}

test("squadron may cross a large ship but may not stop in its hex", () => {
  const mover = unit({ currentSpeed: 2, speedRemaining: 2 });
  const largeShip = unit({ id: "blocker", kind: "capital", sideId: "crimson", position: { q: 1, r: 0 }, heading: 3 });
  const routes = planRoutes(battle(mover, { units: [largeShip] }), mover, "risky");
  assert.equal(routes.has("1,0"), false);
  assert.deepEqual(routes.get("2,0")?.path, [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }]);
});

test("crossing a large ship considers terrain cost and compatible hazards in the same hex", () => {
  const mover = unit({ currentSpeed: 3, speedRemaining: 3 });
  const largeShip = unit({ id: "blocker", kind: "capital", sideId: "crimson", position: { q: 1, r: 0 }, heading: 3 });
  const minefield = terrain("minefield", {
    id: "mines-a",
    kind: "hazard",
    label: "Minefield",
    hazard: { probability: 0.5, min: 4, max: 8, effect: "integrity damage" }
  });
  const detourBlockers = [
    { q: 0, r: 1 },
    { q: -1, r: 1 },
    { q: -1, r: 0 },
    { q: 0, r: -1 },
    { q: 1, r: -1 }
  ].map((position, index) => ({ id: `station-${index}`, kind: "object", type: "station", position }));
  const routes = planRoutes(battle(mover, { units: [largeShip], contents: [terrain(), minefield, ...detourBlockers] }), mover, "risky");

  assert.equal(routes.has("1,0"), false);
  assert.equal(routes.get("2,0")?.movementCost, 3);
  assert.deepEqual(routes.get("2,0")?.consequences, [{
    sourceId: "mines-a",
    sourceName: "Minefield",
    probability: 0.5,
    min: 4,
    max: 8,
    effect: "integrity damage"
  }]);
});

test("a no-stop hex is not traversed without an affordable legal continuation", () => {
  const mover = unit({ currentSpeed: 2, speedRemaining: 2 });
  const largeShip = unit({ id: "blocker", kind: "capital", sideId: "crimson", position: { q: 1, r: 0 }, heading: 3 });
  const routes = planRoutes(battle(mover, { units: [largeShip], contents: [terrain()] }), mover, "risky");

  assert.equal(routes.has("1,0"), false);
  assert.equal(routes.get("2,0"), undefined);
});

test("safe policy excludes known danger while risky policy exposes it", () => {
  const mover = unit({ currentSpeed: 1, speedRemaining: 1 });
  const minefield = {
    id: "mines-a",
    kind: "hazard",
    type: "minefield",
    label: "Minefield",
    position: { q: 1, r: 0 },
    hazard: { probability: 0.5, min: 4, max: 8, effect: "integrity damage" }
  };
  const state = battle(mover, { contents: [minefield] });
  assert.equal(planRoutes(state, mover, "safe").has("1,0"), false);
  assert.deepEqual(planRoutes(state, mover, "risky").get("1,0")?.consequences, [{
    sourceId: "mines-a",
    sourceName: "Minefield",
    probability: 0.5,
    min: 4,
    max: 8,
    effect: "integrity damage"
  }]);
});

test("selected routes never visit a hex twice", () => {
  const mover = unit({ kind: "capital", heading: 0, maneuver: 3, currentSpeed: 5, speedRemaining: 5 });
  const routes = planRoutes(battle(mover), mover, "risky");
  for (const route of routes.values()) {
    const visited = route.path.map(position => `${position.q},${position.r}`);
    assert.equal(new Set(visited).size, visited.length, `route to ${route.position.q},${route.position.r}`);
  }
});

test("equal-cost alternatives select one reproducible route", () => {
  const mover = unit({ currentSpeed: 3, speedRemaining: 3 });
  const obstruction = { id: "station", kind: "object", type: "station", position: { q: 1, r: 0 } };
  const route = planRoutes(battle(mover, { contents: [obstruction] }), mover, "risky").get("2,0");
  assert.deepEqual(route?.path, [{ q: 0, r: 0 }, { q: 1, r: -1 }, { q: 2, r: -1 }, { q: 2, r: 0 }]);
});

test("route selection is structurally stable across rule-irrelevant source ordering", () => {
  const moverA = unit({ currentSpeed: 1, speedRemaining: 1 });
  const enemiesA = [
    unit({ id: "enemy-east", sideId: "crimson", position: { q: 2, r: 0 } }),
    unit({ id: "enemy-southeast", sideId: "crimson", position: { q: 1, r: 1 } })
  ];
  const hazardsA = [
    terrain("minefield", { id: "mines-a", kind: "hazard", label: "Mines A", hazard: { probability: 0.5, min: 2, max: 4, effect: "integrity damage" } }),
    terrain("minefield", { id: "mines-b", kind: "hazard", label: "Mines B", hazard: { probability: 0.5, min: 2, max: 4, effect: "integrity damage" } })
  ];
  const stateA = battle(moverA, { units: enemiesA, contents: hazardsA });

  const moverB = structuredClone(moverA);
  const stateB = battle(moverB, {
    units: [...structuredClone(enemiesA)].reverse(),
    contents: [...structuredClone(hazardsA)].reverse()
  });

  assert.deepEqual(routeShape(planRoutes(stateA, moverA, "risky")), routeShape(planRoutes(stateB, moverB, "risky")));
});

test("maneuver options preserve stable public data without mutating battle state", () => {
  const mover = unit({
    reactor: { currentEnergy: 2, capacity: 4 },
    weapons: [{ id: "weapon-a", firedThisRound: false, cooldownRemaining: 0 }]
  });
  const enemy = unit({ id: "enemy", sideId: "crimson", position: { q: 3, r: 0 } });
  const minefield = terrain("minefield", {
    id: "mines-a",
    kind: "hazard",
    label: "Minefield",
    hazard: { probability: 0.5, min: 4, max: 8, effect: "integrity damage" }
  });
  const state = battle(mover, { units: [enemy], contents: [minefield] });
  let randomCalls = 0;
  const rng = () => {
    randomCalls++;
    return 0.5;
  };
  state.rng = rng;
  const before = structuredClone({ scenario: state.scenario, units: state.units, events: state.events, sequence: state.sequence, randomState: state.randomState });

  planRoutes(state, mover, "safe");
  const route = planRoutes(state, mover, "risky").get("1,0");
  const [option] = buildManeuverOptions(mover, route, null);

  assert.deepEqual({
    optionId: option.optionId,
    finalState: option.finalState,
    resources: option.resources,
    consequences: option.consequences,
    interceptions: option.interceptions
  }, {
    optionId: "maneuver:1:0:heading:0",
    finalState: { hex: { q: 1, r: 0 }, heading: 0 },
    resources: { speed: { spent: 1, remaining: 2, capacity: 3 }, maneuver: { spent: 0, remaining: 5, capacity: 5 } },
    consequences: [{ sourceId: "mines-a", sourceName: "Minefield", probability: 0.5, min: 4, max: 8, effect: "integrity damage" }],
    interceptions: []
  });
  assert.equal(option.route, route);
  assert.equal(option.consequences, route.consequences);
  assert.deepEqual({ scenario: state.scenario, units: state.units, events: state.events, sequence: state.sequence, randomState: state.randomState }, before);
  assert.equal(state.rng, rng);
  assert.equal(randomCalls, 0);
});

test("Squadron route preview exposes every expected interception in stable order", () => {
  const mover = unit({ currentSpeed: 1, speedRemaining: 1 });
  const enemies = [
    unit({ id: "enemy-z", sideId: "crimson", position: { q: 2, r: 0 } }),
    unit({ id: "enemy-a", sideId: "crimson", position: { q: 1, r: 1 } }),
    unit({ id: "enemy-a", sideId: "crimson", position: { q: 1, r: 1 } })
  ];
  const ally = unit({ id: "ally", position: { q: 0, r: 1 } });
  const route = planRoutes(battle(mover, { units: [enemies[0], ally, enemies[2], enemies[1]] }), mover, "risky").get("1,0");
  const [option] = buildManeuverOptions(mover, route, null);

  assert.deepEqual(route.interceptions, ["enemy-a", "enemy-z"]);
  assert.equal("interception" in route, false);
  assert.deepEqual(option.interceptions, ["enemy-a", "enemy-z"]);
  assert.equal("interception" in option, false);
});

test("common routing supports turn-only maneuvers but excludes the empty start state", () => {
  for (const kind of ["capital", "squadron"]) {
    const mover = unit({ kind, heading: 0, maneuver: 3, maneuverRemaining: 3, currentSpeed: 0, speedRemaining: 0 });
    const routes = planRoutes(battle(mover), mover, "risky");
    assert.equal(routes.has("0,0:0"), false);
    assert.deepEqual([...routes.values()].map(route => route.heading).sort(), [1, 2, 3, 4, 5]);
    const reverse = routes.get("0,0:3");
    assert.equal(reverse.movementCost, 0);
    assert.equal(reverse.turnsSpent, 3);
    assert.deepEqual(reverse.actions.map(action => action.type), ["turn", "turn", "turn"]);
  }
});

test("common routing permits multiple turns before, between, and after moves", () => {
  const mover = unit({ kind: "capital", heading: 0, maneuver: 3, maneuverRemaining: 3, currentSpeed: 2, speedRemaining: 2 });
  const routes = planRoutes(battle(mover), mover, "risky");
  const reverseThenMove = routes.get("-1,0:3");
  assert.deepEqual(reverseThenMove.actions.map(action => action.type), ["turn", "turn", "turn", "move"]);
    assert.deepEqual(reverseThenMove.path, [{ q: 0, r: 0 }, { q: -1, r: 0 }]);

  const woven = [...routes.values()].find(route => route.actions.some((action, index) => action.type === "turn" && route.actions[index - 1]?.type === "move" && route.actions.slice(index + 1).some(candidate => candidate.type === "move")));
  assert.ok(woven);
  const finalTurn = routes.get("2,0:1");
  assert.deepEqual(finalTurn.actions.map(action => action.type), ["move", "move", "turn"]);
});

test("zero maneuver permits only straight movement", () => {
  const mover = unit({ kind: "capital", heading: 0, maneuver: 0, maneuverRemaining: 0, currentSpeed: 3, speedRemaining: 3 });
  const routes = planRoutes(battle(mover), mover, "risky");
  assert.deepEqual([...routes.values()].map(route => `${route.position.q},${route.position.r}:${route.heading}`).sort(), ["1,0:0", "2,0:0", "3,0:0"]);
});

test("different headings in one hex remain distinct deterministic final states", () => {
  const mover = unit({ kind: "capital", heading: 0, maneuver: 3, maneuverRemaining: 3, currentSpeed: 1, speedRemaining: 1 });
  const state = battle(mover);
  const first = routeShape(planRoutes(state, mover, "risky"));
  const second = routeShape(planRoutes(state, mover, "risky"));
  assert.deepEqual(second, first);
  assert.ok(planRoutes(state, mover, "risky").has("1,0:0"));
  assert.ok(planRoutes(state, mover, "risky").has("1,0:1"));
});

test("capital ships and squadrons share heading-constrained routing with category traversal differences", () => {
  const capital = unit({ kind: "capital", heading: 0, maneuver: 3, maneuverRemaining: 3, currentSpeed: 2, speedRemaining: 2 });
  const squadron = unit({ kind: "squadron", heading: 0, maneuver: 3, maneuverRemaining: 3, currentSpeed: 2, speedRemaining: 2 });
  const blocker = unit({ id: "blocker", kind: "capital", sideId: "crimson", position: { q: 1, r: 0 }, heading: 3 });
  assert.equal(planRoutes(battle(capital, { units: [blocker] }), capital, "risky").has("2,0:0"), false);
  assert.equal(planRoutes(battle(squadron, { units: [blocker] }), squadron, "risky").has("2,0:0"), true);
});

function aaWeapon(overrides = {}) {
  return {
    id: "aa",
    weaponId: "aa-catalog",
    slotOrder: 0,
    name: "AA",
    mount: "turret",
    orientation: null,
    weaponClass: "kinetic",
    delivery: "projectile",
    targetKinds: ["squadron"],
    accuracy: 60,
    maxRange: 2,
    shots: 2,
    damage: 3,
    energyCost: 0,
    cooldownRounds: 0,
    firedThisRound: false,
    cooldownRemaining: 0,
    overwatch: true,
    ...overrides
  };
}

function aaOwner(overrides = {}) {
  return unit({
    id: "aa-owner",
    name: "AA Owner",
    kind: "capital",
    sideId: "crimson",
    position: { q: 0, r: 1 },
    heading: 0,
    integrity: 20,
    weapons: [aaWeapon()],
    ...overrides
  });
}

test("safe policy excludes every known negative preview descriptor while risky policy retains risk-only final states", async t => {
  const cases = [
    ["Hazard", ({ contents }) => contents.push(terrain("minefield", { id: "known-hazard", kind: "hazard", hazard: { probability: 0.5, min: 2, max: 4, effect: "damage" } }))],
    ["AA", ({ units }) => units.push(aaOwner())],
    ["Interception", ({ units }) => units.push(unit({ id: "interceptor", sideId: "crimson", position: { q: 2, r: 0 } }))],
    ["guaranteed effect", ({ contents }) => contents.push({ id: "gravity", kind: "terrain", type: "gravityWell", label: "Gravity Well", position: { q: 1, r: 0 }, routeEffect: { effect: "speed lock", negative: true, guaranteed: true, execute: { type: "set", path: "speedRemaining", value: 0 } } })]
  ];

  for (const [name, arrange] of cases) await t.test(name, () => {
    const mover = unit({ currentSpeed: 1, speedRemaining: 1 });
    const setup = { units: [], contents: [] };
    arrange(setup);
    const state = battle(mover, setup);
    assert.equal(planRoutes(state, mover, "safe").has("1,0"), false);
    const risky = planRoutes(state, mover, "risky").get("1,0");
    assert.ok(risky);
    assert.ok(risky.previewConsequences.length > 0);
  });
});

test("risky route ordering is speed then maneuver then expected known harm then geometry", () => {
  const mover = unit({ currentSpeed: 3, speedRemaining: 3 });
  const directRisk = terrain("minefield", {
    id: "direct-risk",
    kind: "hazard",
    position: { q: 1, r: 0 },
    hazard: { probability: 1, min: 20, max: 20, effect: "damage" }
  });
  const speedFirst = planRoutes(battle(mover, { contents: [directRisk] }), mover, "risky").get("2,0");
  assert.deepEqual(speedFirst.path, [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }]);

  const obstruction = { id: "station", kind: "object", type: "station", position: { q: 1, r: 0 } };
  const lowHarm = terrain("minefield", { id: "low", kind: "hazard", position: { q: 0, r: 1 }, hazard: { probability: 0.5, min: 2, max: 2, effect: "damage" } });
  const highHarm = terrain("minefield", { id: "high", kind: "hazard", position: { q: 1, r: -1 }, hazard: { probability: 1, min: 8, max: 8, effect: "damage" } });
  const harmBeforeGeometry = planRoutes(battle(mover, { contents: [obstruction, lowHarm, highHarm] }), mover, "risky").get("2,0");
  assert.deepEqual(harmBeforeGeometry.path, [{ q: 0, r: 0 }, { q: 0, r: 1 }, { q: 1, r: 1 }, { q: 2, r: 0 }]);

  const geometry = planRoutes(battle(mover, { contents: [obstruction] }), mover, "risky").get("2,0");
  assert.deepEqual(geometry.path, [{ q: 0, r: 0 }, { q: 1, r: -1 }, { q: 2, r: -1 }, { q: 2, r: 0 }]);
});

test("expected interception terminates a risky route without publishing later turns", () => {
  const mover = unit({ currentSpeed: 3, speedRemaining: 3, maneuver: 2, maneuverRemaining: 2 });
  const interceptor = unit({ id: "interceptor", sideId: "crimson", position: { q: 2, r: 0 } });
  const blockers = [
    { q: 0, r: 1 },
    { q: -1, r: 1 },
    { q: -1, r: 0 },
    { q: 0, r: -1 },
    { q: 1, r: -1 }
  ].map((position, index) => ({ id: `station-${index}`, kind: "object", type: "station", position }));
  const routes = planRoutes(battle(mover, { units: [interceptor], contents: blockers }), mover, "risky");
  const intercepted = routes.get("1,0");

  assert.deepEqual(intercepted.path, [{ q: 0, r: 0 }, { q: 1, r: 0 }]);
  assert.deepEqual(intercepted.interceptions, ["interceptor"]);
  assert.equal("interception" in intercepted, false);
  assert.equal(routes.has("2,0"), false);
  assert.equal([...routes.values()].some(route => route.path.length > 2), false);
  assert.equal(routes.matching({ q: 1, r: 0 }).length, 1);
  assert.equal(routes.get("1,0:1"), undefined);
});

test("a pass-through capital hex never exposes turn-only stopping states", () => {
  const mover = unit({ currentSpeed: 2, speedRemaining: 2, maneuver: 2, maneuverRemaining: 2 });
  const capital = unit({ id: "capital", kind: "capital", sideId: "crimson", position: { q: 1, r: 0 }, heading: 3 });
  const routes = planRoutes(battle(mover, { units: [capital] }), mover, "risky");

  assert.equal(routes.matching({ q: 1, r: 0 }).length, 0);
  assert.equal([...routes.values()].some(route => route.actions.at(-1)?.type === "turn" && route.position.q === 1 && route.position.r === 0), false);
  assert.ok(routes.get("2,0:0"));
});

test("AA preview expected harm uses battle geometry, endpoint cover, evasion, and active-layer multiplier", () => {
  const mover = unit({ currentSpeed: 3, speedRemaining: 3, baseEvasion: 10, movementEvasion: 0, shield: 4, armor: 0, integrity: 20 });
  const owner = aaOwner({ position: { q: -1, r: 0 }, weapons: [aaWeapon({ accuracy: 100, shots: 2, damage: 4, weaponClass: "kinetic", maxRange: 3 })] });
  const blocker = unit({ id: "blocker", kind: "capital", sideId: "crimson", position: { q: 1, r: 0 }, mass: 80, integrity: 20, heading: 0 });
  const cover = terrain("debrisField", { id: "cover", position: { q: 2, r: 0 } });
  const state = battle(mover, { units: [owner, blocker], contents: [cover] });
  const [aa] = aaPreviewDescriptors(state, mover, { q: 2, r: 0 });

  assert.deepEqual({ probability: aa.probability, max: aa.max, expectedHarm: aa.expectedHarm }, { probability: 0.4, max: 8, expectedHarm: 3.2 });
});

test("known AA preview is descriptive and consumes neither RNG nor readiness", () => {
  const mover = unit({ currentSpeed: 1, speedRemaining: 1, shield: 0, armor: 0, integrity: 20 });
  const owner = aaOwner();
  const state = battle(mover, { units: [owner] });
  let randomCalls = 0;
  state.rng = () => {
    randomCalls++;
    return 0;
  };
  const before = structuredClone({ units: state.units, events: state.events, sequence: state.sequence, randomState: state.randomState });

  const route = planRoutes(state, mover, "risky").get("1,0");

  assert.deepEqual(route.previewConsequences, [{ kind: "aa", sourceId: "aa-owner", sourceName: "AA Owner", slotId: "aa", effect: "AA reaction", probability: 0.56, min: 0, max: 6, expectedHarm: 3.36, negative: true, guaranteed: false, position: { q: 1, r: 0 } }]);
  assert.deepEqual({ units: state.units, events: state.events, sequence: state.sequence, randomState: state.randomState }, before);
  assert.equal(randomCalls, 0);
  assert.equal(owner.weapons[0].overwatch, true);
  assert.equal(owner.weapons[0].firedThisRound, false);
});

test("hidden hazards, AA, and interception neither exclude routes nor appear in preview descriptors", () => {
  const mover = unit({ currentSpeed: 1, speedRemaining: 1 });
  const hiddenHazard = terrain("minefield", {
    id: "hidden-hazard",
    kind: "hazard",
    hidden: true,
    hazard: { probability: 1, min: 9, max: 9, effect: "secret damage" }
  });
  const hiddenAA = aaOwner({ hidden: true });
  const hiddenInterceptor = unit({ id: "hidden-interceptor", sideId: "crimson", position: { q: 2, r: 0 }, hidden: true });
  const state = battle(mover, { units: [hiddenAA, hiddenInterceptor], contents: [hiddenHazard] });

  const safe = planRoutes(state, mover, "safe").get("1,0");
  const risky = planRoutes(state, mover, "risky").get("1,0");

  assert.ok(safe);
  assert.deepEqual(safe.previewConsequences, []);
  assert.deepEqual(risky.previewConsequences, []);
  assert.equal(JSON.stringify(safe).includes("secret damage"), false);
});

test("policy switching is pure and repeated visibility-filtered rebuilds are deterministic", () => {
  const mover = unit({ currentSpeed: 2, speedRemaining: 2 });
  const owner = aaOwner();
  const minefield = terrain("minefield", { id: "mines", kind: "hazard", hazard: { probability: 0.5, min: 2, max: 4, effect: "damage" } });
  const state = battle(mover, { units: [owner], contents: [minefield] });
  let randomCalls = 0;
  state.rng = () => {
    randomCalls++;
    return 0.5;
  };
  const before = structuredClone({ scenario: state.scenario, units: state.units, events: state.events, sequence: state.sequence, randomState: state.randomState });

  const riskyA = routeShape(planRoutes(state, mover, "risky"));
  planRoutes(state, mover, "safe");
  const riskyB = routeShape(planRoutes(state, mover, "risky"));

  assert.deepEqual(riskyB, riskyA);
  assert.deepEqual({ scenario: state.scenario, units: state.units, events: state.events, sequence: state.sequence, randomState: state.randomState }, before);
  assert.equal(randomCalls, 0);
});
