import assert from "node:assert/strict";
import test from "node:test";
import { destroyUnit, executeManeuverElement, movementEvasion, planManeuver, planRoutes, resolvePostEntryInterceptions } from "./domain.js";
import { resolvePostEntryAA } from "./battle.js";
import { buildManeuverOptions } from "./ui-rules.js";

function unit(overrides = {}) {
  return {
    id: "mover",
    name: "Mover",
    sideId: "azure",
    kind: "squadron",
    position: { q: 0, r: 0 },
    currentSpeed: 3,
    maneuver: 0,
    speedSpent: 0,
    speedRemaining: 3,
    maneuverSpent: 0,
    maneuverRemaining: 0,
    movementEvasion: 0,
    evasiveManeuver: false,
    evasionLocked: false,
    canWait: true,
    shield: 0,
    armor: 0,
    integrity: 20,
    maxIntegrity: 20,
    stack: 4,
    unitHealth: 5,
    engagedWith: [],
    weapons: [],
    ...overrides
  };
}

function battle(mover, { units = [], contents = [] } = {}) {
  return {
    scenario: {
      id: "maneuver-execution",
      bounds: { minCol: -4, maxCol: 4, minRow: -4, maxRow: 4 },
      contents
    },
    units: [mover, ...units],
    activeUnitId: mover.id,
    roundNumber: 1,
    lifecycle: "SystemActions",
    stage: "system",
    log: [],
    events: [],
    sequence: 0,
    initiativeOrder: [mover.id, ...units.map(unit => unit.id)],
    winner: null,
    rng: Math.random
  };
}

function optionAt(state, mover, destination, heading) {
  const route = planRoutes(state, mover, "risky").get(destination);
  assert.ok(route, `expected route to ${destination}`);
  const headings = heading === undefined ? null : new Set([heading]);
  return buildManeuverOptions(mover, route, headings, (from, to) => {
    let delta = (to - from + 6) % 6;
    if (delta > 3) delta -= 6;
    return delta;
  })[0];
}

function recursivelyFrozen(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value) && Object.values(value).every(child => recursivelyFrozen(child, seen));
}

function objectReferences(value, result = new Set()) {
  if (!value || typeof value !== "object" || result.has(value)) return result;
  result.add(value);
  for (const child of Object.values(value)) objectReferences(child, result);
  return result;
}

test("confirmed maneuver plan is recursively immutable and detached from mutable battle state", () => {
  const mover = unit();
  const hazard = {
    id: "mines",
    kind: "hazard",
    type: "minefield",
    label: "Minefield",
    position: { q: 1, r: 0 },
    hazard: { probability: 0.5, min: 2, max: 4, effect: "integrity damage" }
  };
  const state = battle(mover, { contents: [hazard] });
  const option = optionAt(state, mover, "1,0");
  const before = structuredClone({ ...state, rng: null });

  const plan = planManeuver(state, option);

  assert.ok(plan);
  assert.equal(recursivelyFrozen(plan), true);
  assert.deepEqual({ ...state, rng: null }, before);
  assert.deepEqual({
    actorId: plan.actorId,
    start: plan.start,
    elements: plan.elements,
    costs: plan.costs,
    consequences: plan.consequences,
    finalState: plan.finalState
  }, {
    actorId: "mover",
    start: { position: { q: 0, r: 0 } },
    elements: [{ type: "move", from: { q: 0, r: 0 }, to: { q: 1, r: 0 }, travelHeading: 0, cost: 1, consequences: [{ sourceId: "mines", sourceName: "Minefield", probability: 0.5, min: 2, max: 4, effect: "integrity damage" }], final: true }],
    costs: { speed: 1, maneuver: 0 },
    consequences: [{ sourceId: "mines", sourceName: "Minefield", probability: 0.5, min: 2, max: 4, effect: "integrity damage" }],
    finalState: { position: { q: 1, r: 0 } }
  });
  const planReferences = objectReferences(plan);
  for (const reference of objectReferences(state)) assert.equal(planReferences.has(reference), false);
  mover.position.q = 9;
  hazard.hazard.min = 99;
  assert.deepEqual(plan.start.position, { q: 0, r: 0 });
  assert.equal(plan.consequences[0].min, 2);
});

test("confirmation revalidates executor, start, adjacency, traversal, and resources", async t => {
  const cases = [
    ["executor", ({ state }) => { state.activeUnitId = "other"; }],
    ["start position", ({ mover }) => { mover.position = { q: 0, r: 1 }; }],
    ["start heading", ({ mover }) => { mover.heading = 1; }],
    ["adjacency", ({ option }) => { option.route.steps[0].to = { q: 3, r: 0 }; }],
    ["traversal", ({ state }) => { state.scenario.contents.push({ id: "station", kind: "object", type: "station", position: { q: 1, r: 0 } }); }],
    ["speed resources", ({ mover }) => { mover.speedRemaining = 0; }],
    ["maneuver resources", ({ mover }) => { mover.maneuverRemaining = 0; }]
  ];

  for (const [name, mutate] of cases) await t.test(name, () => {
    const mover = unit({ kind: "capital", heading: 0, maneuver: 2, maneuverRemaining: 2 });
    const state = battle(mover, { units: [unit({ id: "other", position: { q: -3, r: 0 } })] });
    const option = optionAt(state, mover, "1,-1", 5);
    mutate({ state, mover, option });
    assert.equal(planManeuver(state, option), null);
  });
});

test("a completely empty maneuver is rejected", () => {
  const mover = unit({ kind: "capital", heading: 0, maneuver: 2, maneuverRemaining: 2 });
  const state = battle(mover);
  const option = optionAt(state, mover, "0,0", 0);

  assert.equal(planManeuver(state, option), null);
});

test("preview changes and cancellation remain pure", () => {
  const mover = unit({ kind: "capital", heading: 0, maneuver: 2, maneuverRemaining: 2 });
  const state = battle(mover);
  const route = planRoutes(state, mover, "risky").get("1,-1");
  const before = structuredClone({ ...state, rng: null });

  const options = buildManeuverOptions(mover, route, new Set([0, 1]), (from, to) => {
    let delta = (to - from + 6) % 6;
    if (delta > 3) delta -= 6;
    return delta;
  });
  let preview = options[0];
  preview = options[1];
  preview = null;

  assert.equal(preview, null);
  assert.deepEqual({ ...state, rng: null }, before);
});

test("forged UI cost, endpoint, and heading fields are rejected", () => {
  const mover = unit({ kind: "capital", heading: 0, maneuver: 2, maneuverRemaining: 2 });
  const state = battle(mover);
  const original = optionAt(state, mover, "1,-1", 5);
  const forgeries = [
    option => { option.resources.speed.spent = 0; },
    option => { option.route.movementCost = 0; },
    option => { option.finalState.hex = { q: 4, r: 4 }; },
    option => { option.finalState.heading = 3; }
  ];

  for (const forge of forgeries) {
    const option = structuredClone(original);
    forge(option);
    assert.equal(planManeuver(state, option), null);
  }
  assert.deepEqual(mover.position, { q: 0, r: 0 });
  assert.equal(mover.speedSpent, 0);
  assert.equal(mover.maneuverSpent, 0);
});

test("executor charges each move and turn, including the final turn, before applying its transition", () => {
  const mover = unit({ kind: "capital", heading: 0, maneuver: 2, maneuverRemaining: 2 });
  const state = battle(mover);
  const option = optionAt(state, mover, "1,-1", 0);
  const plan = planManeuver(state, option);

  assert.deepEqual(plan.elements.map(element => ({ type: element.type, cost: element.cost, heading: element.heading })), [
    { type: "turn", cost: 1, heading: 1 },
    { type: "move", cost: 1, heading: 1 },
    { type: "turn", cost: 1, heading: 0 }
  ]);

  const first = executeManeuverElement(state, plan, 0);
  assert.equal(first.status, "executed");
  assert.equal(first.transition.maneuverCost, 1);
  assert.equal(mover.heading, 1);
  assert.deepEqual({ speedSpent: mover.speedSpent, maneuverSpent: mover.maneuverSpent, stage: state.stage }, { speedSpent: 0, maneuverSpent: 1, stage: "system" });

  const second = executeManeuverElement(state, plan, 1);
  assert.equal(second.status, "executed");
  assert.equal(second.transition.speedCost, 1);
  assert.deepEqual(mover.position, { q: 1, r: -1 });
  assert.deepEqual({ speedSpent: mover.speedSpent, maneuverSpent: mover.maneuverSpent, evasion: mover.movementEvasion }, { speedSpent: 1, maneuverSpent: 1, evasion: movementEvasion(1) });

  const third = executeManeuverElement(state, plan, 2);
  assert.equal(third.status, "completed");
  assert.equal(mover.heading, 0);
  assert.deepEqual({ speedSpent: mover.speedSpent, maneuverSpent: mover.maneuverSpent, stage: state.stage }, { speedSpent: 1, maneuverSpent: 2, stage: "attack" });
});

test("illegal next element stops at the last legal state without rolling back completed work", () => {
  const mover = unit({ currentSpeed: 2, speedRemaining: 2 });
  const state = battle(mover);
  const option = optionAt(state, mover, "2,0");
  const plan = planManeuver(state, option);

  assert.equal(executeManeuverElement(state, plan, 0).status, "executed");
  state.scenario.contents.push({ id: "station", kind: "object", type: "station", position: { q: 2, r: 0 } });
  const result = executeManeuverElement(state, plan, 1);

  assert.equal(result.status, "stopped");
  assert.deepEqual(mover.position, { q: 1, r: 0 });
  assert.deepEqual({ speedSpent: mover.speedSpent, speedRemaining: mover.speedRemaining, maneuverSpent: mover.maneuverSpent, evasion: mover.movementEvasion }, {
    speedSpent: 1,
    speedRemaining: 1,
    maneuverSpent: 0,
    evasion: movementEvasion(1)
  });
  assert.equal(state.stage, "attack");
});

test("unaffordable next element stops and only executed elements affect resources and Evasion", () => {
  const mover = unit({ currentSpeed: 2, speedRemaining: 2 });
  const state = battle(mover);
  const plan = planManeuver(state, optionAt(state, mover, "2,0"));

  assert.equal(executeManeuverElement(state, plan, 0).status, "executed");
  mover.speedRemaining = 0;
  const result = executeManeuverElement(state, plan, 1);

  assert.equal(result.status, "stopped");
  assert.deepEqual(mover.position, { q: 1, r: 0 });
  assert.equal(mover.speedSpent, 1);
  assert.equal(mover.movementEvasion, movementEvasion(1));
  assert.equal(state.stage, "attack");
});

function hazard(position, overrides = {}) {
  return {
    id: "mines",
    kind: "hazard",
    type: "minefield",
    label: "Minefield",
    position,
    hazard: { probability: 1, min: 3, max: 3, effect: "integrity damage" },
    ...overrides
  };
}

function instrumentedContents(state, trace) {
  const contents = state.scenario.contents;
  let reads = 0;
  Object.defineProperty(state.scenario, "contents", {
    configurable: true,
    get() {
      trace.push(reads++ === 0 ? "exit" : "revalidate");
      return contents;
    }
  });
  return contents;
}

test("move effect pipeline orders exit, revalidation, spending, entry, hazards, and continuation", () => {
  const trace = [];
  const mover = unit({ currentSpeed: 2, speedRemaining: 2 });
  const state = battle(mover, { contents: [hazard({ q: 1, r: 0 })] });
  const plan = planManeuver(state, optionAt(state, mover, "2,0"));
  const contents = instrumentedContents(state, trace);
  let spent = mover.speedSpent;
  Object.defineProperty(mover, "speedSpent", {
    configurable: true,
    get: () => spent,
    set(value) {
      trace.push("spend");
      spent = value;
    }
  });
  let position = mover.position;
  Object.defineProperty(mover, "position", {
    configurable: true,
    get: () => position,
    set(value) {
      trace.push("enter");
      position = value;
    }
  });
  state.rng = () => {
    trace.push("hazards");
    return 0;
  };

  const result = executeManeuverElement(state, plan, 0, {
    resolveExit() {},
    canContinue() {
      trace.push("continue");
      return true;
    }
  });

  Object.defineProperty(state.scenario, "contents", { configurable: true, value: contents, writable: true });
  assert.equal(result.status, "executed");
  assert.deepEqual(trace, ["exit", "revalidate", "spend", "enter", "hazards", "hazards", "continue"]);
});

test("repeated identical-source hazard triggers roll independently after confirmation", () => {
  const mover = unit({ currentSpeed: 2, speedRemaining: 2 });
  const state = battle(mover, { contents: [hazard({ q: 1, r: 0 }, { hazard: { probability: 0.5, min: 3, max: 3, effect: "integrity damage" } })] });
  let randomCalls = 0;
  state.rng = () => {
    randomCalls++;
    return randomCalls === 1 ? 1 : 0;
  };
  const plan = planManeuver(state, optionAt(state, mover, "2,0"));

  assert.equal(randomCalls, 0);
  const first = executeManeuverElement(state, plan, 0);
  state.scenario.contents[0].position = { q: 2, r: 0 };
  const second = executeManeuverElement(state, plan, 1);

  assert.equal(first.hazardOutcomes.length, 1);
  assert.equal(first.hazardOutcomes[0].hit, false);
  assert.equal(second.hazardOutcomes.length, 1);
  assert.equal(second.hazardOutcomes[0].hit, true);
  assert.equal(randomCalls, 3);
  assert.equal(mover.integrity, 17);
});

test("guaranteed route entry effects execute deterministically after hazards", () => {
  const mover = unit({ currentSpeed: 2, speedRemaining: 2 });
  const gravity = {
    id: "gravity",
    kind: "terrain",
    type: "gravityWell",
    label: "Gravity Well",
    position: { q: 1, r: 0 },
    routeEffect: { guaranteed: true, negative: true, effect: "speed lock", execute: { type: "set", path: "speedRemaining", value: 0 } }
  };
  const state = battle(mover, { contents: [gravity] });
  const plan = planManeuver(state, optionAt(state, mover, "2,0"));

  const entry = executeManeuverElement(state, plan, 0);
  const result = executeManeuverElement(state, plan, 1);

  assert.equal(entry.status, "executed");
  assert.equal(result.status, "stopped");
  assert.equal(result.reason, "insufficient-speed");
  assert.equal(mover.speedRemaining, 0);
  assert.deepEqual(entry.effectOutcomes, [{ sourceId: "gravity", sourceName: "Gravity Well", effect: "speed lock", execute: { type: "set", path: "speedRemaining", value: 0 } }]);
  assert.equal(state.events.some(event => event.action === "route-effect" && event.sourceId === "gravity"), true);
});

test("nonlethal hazard applies in the entered hex and permits continuation", () => {
  const mover = unit({ currentSpeed: 2, speedRemaining: 2 });
  const state = battle(mover, { contents: [hazard({ q: 1, r: 0 })] });
  state.rng = () => 0;
  const plan = planManeuver(state, optionAt(state, mover, "2,0"));

  const result = executeManeuverElement(state, plan, 0);

  assert.equal(result.status, "executed");
  assert.deepEqual(mover.position, { q: 1, r: 0 });
  assert.equal(mover.integrity, 17);
  assert.equal(result.hazardOutcomes[0].destroyed, false);
  assert.equal(executeManeuverElement(state, plan, 1).status, "completed");
});

test("lethal hazard stops immediately, retains completed spending, and creates debris in the entry hex", () => {
  const mover = unit({ currentSpeed: 2, speedRemaining: 2, integrity: 3, stack: 1 });
  const enemy = unit({ id: "enemy", sideId: "crimson", position: { q: 4, r: 0 } });
  const state = battle(mover, {
    units: [enemy],
    contents: [
      hazard({ q: 1, r: 0 }),
      hazard({ q: 1, r: 0 }, { id: "second-mines", label: "Second Minefield" }),
      hazard({ q: 2, r: 0 }, { id: "future-mines", label: "Future Minefield" })
    ]
  });
  let randomCalls = 0;
  state.rng = () => {
    randomCalls++;
    return 0;
  };
  const plan = planManeuver(state, optionAt(state, mover, "2,0"));

  const result = executeManeuverElement(state, plan, 0);

  assert.equal(result.status, "destroyed");
  assert.equal(result.hazardOutcomes.length, 1);
  assert.equal(randomCalls, 2);
  assert.equal(mover.speedSpent, 1);
  assert.equal(mover.speedRemaining, 1);
  assert.equal(mover.movementEvasion, movementEvasion(1));
  assert.equal(state.units.includes(mover), false);
  assert.deepEqual(result.destruction.debris.position, { q: 1, r: 0 });
  assert.equal(executeManeuverElement(state, plan, 1).status, "invalid");
  assert.equal(randomCalls, 2);
});

test("unexecuted elements cause no costs, Evasion, or consequences after an early pipeline stop", () => {
  const mover = unit({ currentSpeed: 2, speedRemaining: 2 });
  const state = battle(mover, { contents: [hazard({ q: 2, r: 0 })] });
  let randomCalls = 0;
  state.rng = () => {
    randomCalls++;
    return 0;
  };
  const plan = planManeuver(state, optionAt(state, mover, "2,0"));

  const result = executeManeuverElement(state, plan, 0, { canContinue: () => false });

  assert.equal(result.status, "stopped");
  assert.equal(result.reason, "continuation-forbidden");
  assert.equal(mover.speedSpent, 1);
  assert.equal(mover.movementEvasion, movementEvasion(1));
  assert.deepEqual(mover.position, { q: 1, r: 0 });
  assert.equal(randomCalls, 0);
  assert.equal(executeManeuverElement(state, plan, 1).status, "invalid");
});

test("maneuver step hazard events carry plan, step, and cause context", () => {
  const mover = unit({ currentSpeed: 1, speedRemaining: 1 });
  const state = battle(mover, { contents: [hazard({ q: 1, r: 0 }, { hazard: { probability: 1, min: 20, max: 20, effect: "integrity damage" } })] });
  state.rng = () => 0;
  const plan = planManeuver(state, optionAt(state, mover, "1,0"));

  executeManeuverElement(state, plan, 0);

  const actions = state.events.map(event => event.action);
  assert.deepEqual(actions, ["maneuver-exit", "maneuver-move", "hazard-check", "damage", "destroy", "debris-create"]);
  const [exit, move, check, damage, destruction, debris] = state.events;
  for (const event of state.events) {
    assert.equal(event.planId, plan.id);
    assert.equal(event.elementIndex, 0);
  }
  assert.equal(move.causeEventId, exit.eventId);
  assert.equal(check.causeEventId, move.eventId);
  assert.equal(damage.causeEventId, check.eventId);
  assert.equal(destruction.causeEventId, damage.eventId);
  assert.equal(debris.causeEventId, destruction.eventId);
  assert.equal(damage.cause, "hazard:mines");
  assert.deepEqual(check.position, { q: 1, r: 0 });
});

test("post-entry interception resolver links every eligible adjacent enemy in stable deduplicated order", () => {
  const mover = unit({ engagedWith: ["enemy-z", "enemy-z"] });
  const enemyZ = unit({ id: "enemy-z", sideId: "crimson", position: { q: 1, r: 0 }, engagedWith: [] });
  const enemyA = unit({ id: "enemy-a", sideId: "crimson", position: { q: 0, r: 1 }, engagedWith: ["mover", "mover"] });
  const ally = unit({ id: "ally", position: { q: -1, r: 1 }, engagedWith: [] });
  const capital = unit({ id: "capital", kind: "capital", sideId: "crimson", position: { q: 0, r: -1 }, heading: 0, engagedWith: [] });
  const state = battle(mover, { units: [enemyZ, ally, capital, enemyA] });

  assert.deepEqual(resolvePostEntryInterceptions(state, mover), ["enemy-a", "enemy-z"]);
  assert.deepEqual(mover.engagedWith, ["enemy-a", "enemy-z"]);
  assert.deepEqual(enemyA.engagedWith, ["mover"]);
  assert.deepEqual(enemyZ.engagedWith, ["mover"]);
  assert.deepEqual(ally.engagedWith, []);
  assert.deepEqual(capital.engagedWith, []);
});

test("interception occurs only after a surviving actual Squadron move and after hazards", () => {
  const trace = [];
  const mover = unit({ currentSpeed: 2, speedRemaining: 2 });
  const enemy = unit({ id: "enemy", sideId: "crimson", position: { q: 2, r: 0 } });
  const state = battle(mover, { units: [enemy], contents: [hazard({ q: 1, r: 0 })] });
  state.rng = () => {
    trace.push("hazard");
    return 0;
  };
  const plan = planManeuver(state, optionAt(state, mover, "1,0"));
  enemy.position = { q: 2, r: 0 };

  assert.deepEqual(mover.engagedWith, []);
  const result = executeManeuverElement(state, plan, 0, {
    canContinue() {
      trace.push(`continue:${mover.engagedWith.join(",")}`);
      return true;
    }
  });

  assert.equal(result.status, "stopped");
  assert.equal(result.reason, "interception");
  assert.deepEqual(trace, ["hazard", "hazard"]);
  assert.deepEqual(mover.engagedWith, ["enemy"]);
  assert.deepEqual(enemy.engagedWith, ["mover"]);
  assert.deepEqual(mover.position, { q: 1, r: 0 });
  assert.equal(executeManeuverElement(state, plan, 1).status, "invalid");
  assert.equal(state.stage, "attack");
});

test("lethal entry hazard prevents interception", () => {
  const mover = unit({ currentSpeed: 1, speedRemaining: 1, integrity: 3, stack: 1 });
  const enemy = unit({ id: "enemy", sideId: "crimson", position: { q: 4, r: 0 } });
  const state = battle(mover, { units: [enemy], contents: [hazard({ q: 1, r: 0 })] });
  state.rng = () => 0;
  const result = executeManeuverElement(state, planManeuver(state, optionAt(state, mover, "1,0")), 0);

  assert.equal(result.status, "destroyed");
  assert.deepEqual(enemy.engagedWith, []);
});

test("passing through a capital alone creates no interception and route continues", () => {
  const mover = unit({ currentSpeed: 2, speedRemaining: 2 });
  const capital = unit({ id: "capital", kind: "capital", sideId: "crimson", position: { q: 1, r: 0 }, heading: 3 });
  const state = battle(mover, { units: [capital] });
  const plan = planManeuver(state, optionAt(state, mover, "2,0"));

  assert.equal(executeManeuverElement(state, plan, 0).status, "executed");
  assert.deepEqual(mover.engagedWith, []);
  assert.equal(executeManeuverElement(state, plan, 1).status, "completed");
});

test("remaining stationary next to an enemy does not create interception", () => {
  const mover = unit();
  const enemy = unit({ id: "enemy", sideId: "crimson", position: { q: 1, r: 0 } });
  const state = battle(mover, { units: [enemy] });
  const stationary = planRoutes(state, mover, "risky").get("0,0");

  assert.deepEqual(stationary.interceptions, []);
  assert.equal(stationary.interception, null);
  assert.deepEqual(resolvePostEntryInterceptions({ ...state, units: [mover] }, mover), []);
});

test("linked Squadron has no ordinary maneuver routes", () => {
  const mover = unit({ engagedWith: ["enemy"] });
  const enemy = unit({ id: "enemy", sideId: "crimson", position: { q: 1, r: 0 }, engagedWith: ["mover"] });
  const state = battle(mover, { units: [enemy] });

  assert.equal(planRoutes(state, mover, "risky").size, 0);
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
    accuracy: 100,
    effectiveRange: 2,
    maxRange: 2,
    shots: 1,
    damage: 20,
    critChance: 0,
    energyCost: 0,
    cooldownRounds: 0,
    firedThisRound: false,
    cooldownRemaining: 0,
    overwatch: true,
    visual: { speedHexesPerSecond: 5, launchIntervalMs: 0 },
    ...overrides
  };
}

test("post-entry AA revalidates after entry and destroys mover before later reactions, interception, or steps", () => {
  const mover = unit({ currentSpeed: 2, speedRemaining: 2, integrity: 5, stack: 1 });
  const later = unit({ id: "later", kind: "capital", sideId: "crimson", position: { q: 0, r: 1 }, heading: 0, weapons: [aaWeapon({ id: "later-aa" })] });
  const killer = unit({ id: "killer", kind: "capital", sideId: "crimson", position: { q: 0, r: 0 }, heading: 0, weapons: [aaWeapon()] });
  const interceptor = unit({ id: "interceptor", sideId: "crimson", position: { q: 3, r: 0 } });
  const state = battle(mover, { units: [killer, later, interceptor] });
  state.activeUnitId = mover.id;
  state.lifecycle = "SystemActions";
  state.stage = "system";
  const plan = planManeuver(state, optionAt(state, mover, "2,0"));

  const result = executeManeuverElement(state, plan, 0, {
    resolvePostEntry({ state: current, unit: entered, plan: currentPlan, elementIndex, causeEventId }) {
      return resolvePostEntryAA(current, entered, { planId: currentPlan.id, elementIndex, causeEventId }, () => 1, () => 0);
    }
  });

  assert.equal(result.status, "destroyed");
  assert.equal(result.reason, "reaction");
  assert.deepEqual(result.destruction.debris.position, { q: 1, r: 0 });
  assert.equal(killer.weapons[0].firedThisRound, true);
  assert.equal(later.weapons[0].firedThisRound, false);
  assert.deepEqual(interceptor.engagedWith, []);
  assert.equal(executeManeuverElement(state, plan, 1).status, "invalid");
  const declaration = state.events.find(event => event.action === "aa-reaction-declare");
  const move = state.events.find(event => event.action === "maneuver-move");
  assert.equal(declaration.causeEventId, move.eventId);
  assert.equal(declaration.planId, plan.id);
  assert.equal(declaration.elementIndex, 0);
  assert.equal(declaration.phase, "SystemActions");
});

test("post-entry AA legality is revalidated immediately before each declaration", () => {
  const mover = unit({ currentSpeed: 1, speedRemaining: 1 });
  const owner = unit({ id: "owner", kind: "capital", sideId: "crimson", position: { q: 0, r: 0 }, heading: 0, weapons: [aaWeapon({ maxRange: 1 })] });
  const state = battle(mover, { units: [owner] });
  const plan = planManeuver(state, optionAt(state, mover, "1,0"));
  const result = executeManeuverElement(state, plan, 0, {
    resolveEntry() {
      owner.position = { q: -4, r: 0 };
    },
    resolvePostEntry({ state: current, unit: entered, plan: currentPlan, elementIndex, causeEventId }) {
      return resolvePostEntryAA(current, entered, { planId: currentPlan.id, elementIndex, causeEventId }, () => 1, () => 0);
    }
  });

  assert.equal(result.status, "completed");
  assert.equal(owner.weapons[0].firedThisRound, false);
  assert.equal(state.events.some(event => event.action === "aa-reaction-declare"), false);
});

test("destroying an interception participant removes reciprocal links and preserves survivor links", () => {
  const destroyed = unit({ id: "destroyed", engagedWith: ["enemy-a", "enemy-b"] });
  const enemyA = unit({ id: "enemy-a", sideId: "crimson", position: { q: 1, r: 0 }, engagedWith: ["destroyed", "enemy-b"] });
  const enemyB = unit({ id: "enemy-b", sideId: "crimson", position: { q: 0, r: 1 }, engagedWith: ["destroyed", "enemy-a"] });
  const state = battle(destroyed, { units: [enemyA, enemyB] });

  destroyUnit(state, destroyed);

  assert.deepEqual(enemyA.engagedWith, ["enemy-b"]);
  assert.deepEqual(enemyB.engagedWith, ["enemy-a"]);
});
