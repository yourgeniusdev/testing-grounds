import assert from "node:assert/strict";
import test from "node:test";
import { beginActionPlanning, buildBattleLog, buildManeuverLog, cancelActionPlanning, confirmManeuverAction, destroyUnit, executeManeuverElement, planRoutes, resolvePostEntryInterceptions, resumeManeuverPostEntry } from "./domain.js";
import { applyReactionStep, planPostEntryAA, resolvePostEntryAA } from "./battle.js";
import { buildManeuverOptions } from "./ui-rules.js";

function unit(overrides = {}) {
  return {
    id: "mover",
    name: "Mover",
    sideId: "azure",
    kind: "squadron",
    canIntercept: true,
    hullType: "cruiser",
    position: { q: 0, r: 0 },
    heading: 0,
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
    lifecycle: "ActionChoice",
    activeAction: null,
    maneuverApplication: null,
    attackApplication: null,
    log: [],
    events: [],
    sequence: 0,
    initiativeOrder: [mover.id, ...units.map(unit => unit.id)],
    winner: null,
    rng: Math.random
  };
}

function optionAt(state, mover, destination, heading) {
  const routes = planRoutes(state, mover, "risky");
  const route = heading === undefined ? routes.get(destination) : routes.get(`${destination}:${heading}`);
  assert.ok(route, `expected route to ${destination}`);
  return buildManeuverOptions(mover, route)[0];
}

function chooseManeuver(state, option) {
  beginActionPlanning(state, { type: "maneuver", reason: "test" });
  return confirmManeuverAction(state, option);
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
  const before = structuredClone({ mover, hazard });

  const plan = chooseManeuver(state, option);

  assert.ok(plan);
  assert.equal(recursivelyFrozen(plan), true);
  assert.deepEqual({ mover: { ...mover, canWait: true }, hazard }, before);
  assert.equal(mover.canWait, false);
  assert.deepEqual({
    actorId: plan.actorId,
    start: plan.start,
    elements: plan.elements,
    costs: plan.costs,
    consequences: plan.consequences,
    finalState: plan.finalState
  }, {
    actorId: "mover",
    start: { position: { q: 0, r: 0 }, heading: 0 },
    elements: [{ type: "move", from: { q: 0, r: 0 }, to: { q: 1, r: 0 }, heading: 0, cost: 1, consequences: [{ sourceId: "mines", sourceName: "Minefield", probability: 0.5, min: 2, max: 4, effect: "integrity damage" }], final: true }],
    costs: { speed: 1, maneuver: 0 },
    consequences: [{ sourceId: "mines", sourceName: "Minefield", probability: 0.5, min: 2, max: 4, effect: "integrity damage" }],
    finalState: { position: { q: 1, r: 0 }, heading: 0 }
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
    ["adjacency", ({ option }) => { option.route.actions.find(action => action.type === "move").to = { q: 3, r: 0 }; }],
    ["traversal", ({ state }) => { state.scenario.contents.push({ id: "station", kind: "object", type: "station", position: { q: 1, r: -1 } }); }],
    ["speed resources", ({ mover }) => { mover.speedRemaining = 0; }],
    ["maneuver resources", ({ mover }) => { mover.maneuverRemaining = 0; }]
  ];

  for (const [name, mutate] of cases) await t.test(name, () => {
    const mover = unit({ kind: "capital", heading: 0, maneuver: 2, maneuverRemaining: 2 });
    const state = battle(mover, { units: [unit({ id: "other", position: { q: -3, r: 0 } })] });
    const option = optionAt(state, mover, "1,-1", 1);
    mutate({ state, mover, option });
    assert.equal(chooseManeuver(state, option), null);
  });
});

test("route preview becomes stale after position, heading, traversal cost, or resource changes", async t => {
  const cases = [
    ["position", ({ mover }) => { mover.position = { q: 0, r: 1 }; }],
    ["heading", ({ mover }) => { mover.heading = 1; }],
    ["cost", ({ state }) => { state.scenario.contents.push({ id: "cost", kind: "terrain", type: "asteroidField", position: { q: 1, r: 0 } }); }],
    ["resource", ({ mover }) => { mover.currentSpeed = 0; }]
  ];

  for (const [name, mutate] of cases) await t.test(name, () => {
    const mover = unit({ currentSpeed: 1, speedRemaining: 1 });
    const state = battle(mover);
    const option = optionAt(state, mover, "1,0", 0);
    beginActionPlanning(state, { type: "maneuver", reason: "test" });

    mutate({ state, mover });

    assert.equal(confirmManeuverAction(state, option), null);
    assert.equal(mover.speedSpent, 0);
    assert.equal(state.maneuverApplication, null);
  });
});

test("a completely empty maneuver is rejected", () => {
  const mover = unit({ kind: "capital", heading: 0, maneuver: 2, maneuverRemaining: 2 });
  const state = battle(mover);
  const route = { position: { ...mover.position }, heading: mover.heading, movementCost: 0, turnsSpent: 0, steps: [], actions: [], consequences: [], previewConsequences: [], path: [{ ...mover.position }] };
  const [option] = buildManeuverOptions(mover, route);

  assert.equal(chooseManeuver(state, option), null);
});

test("preview changes and cancellation remain pure", () => {
  const mover = unit({ kind: "capital", heading: 0, maneuver: 2, maneuverRemaining: 2 });
  const state = battle(mover);
  const route = planRoutes(state, mover, "risky").get("1,-1:1");
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
  const original = optionAt(state, mover, "1,-1", 1);
  const forgeries = [
    option => { option.resources.speed.spent = 0; },
    option => { option.route.movementCost = 0; },
    option => { option.finalState.hex = { q: 4, r: 4 }; },
    option => { option.finalState.heading = 3; }
  ];

  for (const forge of forgeries) {
    const option = structuredClone(original);
    forge(option);
    assert.equal(chooseManeuver(state, option), null);
  }
  assert.deepEqual(mover.position, { q: 0, r: 0 });
  assert.equal(mover.speedSpent, 0);
  assert.equal(mover.maneuverSpent, 0);
});

test("a destination move remains final when the maneuver ends with a turn", () => {
  const mover = unit({ kind: "squadron", heading: 0, maneuver: 1, maneuverRemaining: 1, currentSpeed: 1, speedRemaining: 1 });
  const state = battle(mover);
  const option = optionAt(state, mover, "1,0", 1);
  const plan = chooseManeuver(state, option);

  assert.deepEqual(plan.elements.map(element => ({ type: element.type, final: element.final })), [
    { type: "move", final: true },
    { type: "turn", final: undefined }
  ]);
  state.units.push(unit({ id: "blocker", kind: "capital", sideId: "crimson", position: { q: 1, r: 0 }, heading: 3 }));

  const result = executeManeuverElement(state, plan, 0);

  assert.equal(result.status, "stopped");
  assert.equal(result.reason, "blocked");
  assert.deepEqual(mover.position, { q: 0, r: 0 });
});

test("executor charges each move and turn, including the final turn, before applying its transition", () => {
  const mover = unit({ kind: "capital", heading: 0, maneuver: 2, maneuverRemaining: 2 });
  const state = battle(mover);
  const option = optionAt(state, mover, "1,-1", 0);
  const plan = chooseManeuver(state, option);

  assert.deepEqual(plan.elements.map(element => ({ type: element.type, cost: element.cost, heading: element.heading })), [
    { type: "turn", cost: 1, heading: 1 },
    { type: "move", cost: 1, heading: 1 },
    { type: "turn", cost: 1, heading: 0 }
  ]);

  const first = executeManeuverElement(state, plan, 0);
  assert.equal(first.status, "executed");
  assert.equal(first.transition.maneuverCost, 1);
  assert.equal(mover.heading, 1);
  assert.deepEqual({ speedSpent: mover.speedSpent, maneuverSpent: mover.maneuverSpent, lifecycle: state.lifecycle }, { speedSpent: 0, maneuverSpent: 1, lifecycle: "ActionResolution" });

  const second = executeManeuverElement(state, plan, 1);
  assert.equal(second.status, "executed");
  assert.equal(second.transition.speedCost, 1);
  assert.deepEqual(mover.position, { q: 1, r: -1 });
  assert.deepEqual({ speedSpent: mover.speedSpent, maneuverSpent: mover.maneuverSpent, evasion: mover.movementEvasion }, { speedSpent: 1, maneuverSpent: 1, evasion: 2 });

  const third = executeManeuverElement(state, plan, 2);
  assert.equal(third.status, "completed");
  assert.equal(mover.heading, 0);
  assert.deepEqual({ speedSpent: mover.speedSpent, maneuverSpent: mover.maneuverSpent, lifecycle: state.lifecycle }, { speedSpent: 1, maneuverSpent: 2, lifecycle: "ActionChoice" });
});

test("illegal next element stops at the last legal state without rolling back completed work", () => {
  const mover = unit({ currentSpeed: 2, speedRemaining: 2 });
  const state = battle(mover);
  const option = optionAt(state, mover, "2,0");
  const plan = chooseManeuver(state, option);

  assert.equal(executeManeuverElement(state, plan, 0).status, "executed");
  state.scenario.contents.push({ id: "station", kind: "object", type: "station", position: { q: 2, r: 0 } });
  const result = executeManeuverElement(state, plan, 1);

  assert.equal(result.status, "stopped");
  assert.deepEqual(mover.position, { q: 1, r: 0 });
  assert.deepEqual({ speedSpent: mover.speedSpent, speedRemaining: mover.speedRemaining, maneuverSpent: mover.maneuverSpent, evasion: mover.movementEvasion }, {
    speedSpent: 1,
    speedRemaining: 1,
    maneuverSpent: 0,
    evasion: 4
  });
  assert.equal(state.lifecycle, "ActionChoice");
});

test("unaffordable next element stops and only executed elements affect resources and Evasion", () => {
  const mover = unit({ currentSpeed: 2, speedRemaining: 2 });
  const state = battle(mover);
  const plan = chooseManeuver(state, optionAt(state, mover, "2,0"));

  const first = executeManeuverElement(state, plan, 0);
  assert.equal(first.status, "executed");
  assert.deepEqual(first.completedElements, [{ type: "move", planId: plan.id, elementIndex: 0, speedCost: 1, maneuverCost: 0, evasionGain: 4 }]);
  mover.speedRemaining = 0;
  const result = executeManeuverElement(state, plan, 1);

  assert.equal(result.status, "stopped");
  assert.deepEqual(result.completedElements, [{ type: "move", planId: plan.id, elementIndex: 0, speedCost: 1, maneuverCost: 0, evasionGain: 4 }]);
  assert.deepEqual(mover.position, { q: 1, r: 0 });
  assert.equal(mover.speedSpent, 1);
  assert.equal(mover.movementEvasion, 4);
  assert.equal(state.lifecycle, "ActionChoice");
});

test("actual movement facts count entered hexes rather than terrain Speed surcharge", () => {
  const mover = unit({ currentSpeed: 3, speedRemaining: 3 });
  const terrain = { id: "debris", kind: "terrain", type: "debrisField", label: "Debris", position: { q: 1, r: 0 } };
  const state = battle(mover, { contents: [terrain] });
  const plan = chooseManeuver(state, optionAt(state, mover, "2,0"));

  const first = executeManeuverElement(state, plan, 0);
  const second = executeManeuverElement(state, plan, 1);

  assert.equal(first.transition.speedCost, 2);
  assert.equal(second.status, "completed");
  assert.deepEqual(second.completedElements.map(element => ({ type: element.type, speedCost: element.speedCost })), [
    { type: "move", speedCost: 2 },
    { type: "move", speedCost: 1 }
  ]);
  assert.equal(mover.activationMovement.steps, 2);
  assert.equal(mover.movementEvasion, 8);
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
  const plan = chooseManeuver(state, optionAt(state, mover, "2,0"));
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
  const plan = chooseManeuver(state, optionAt(state, mover, "2,0"));

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
  const plan = chooseManeuver(state, optionAt(state, mover, "2,0"));

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
  const plan = chooseManeuver(state, optionAt(state, mover, "2,0"));

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
  const plan = chooseManeuver(state, optionAt(state, mover, "2,0"));

  const result = executeManeuverElement(state, plan, 0);

  assert.equal(result.status, "destroyed");
  assert.equal(result.hazardOutcomes.length, 1);
  assert.equal(randomCalls, 2);
  assert.equal(mover.speedSpent, 1);
  assert.equal(mover.speedRemaining, 1);
  assert.equal(mover.movementEvasion, 4);
  assert.equal(state.units.includes(mover), false);
  assert.deepEqual(result.destruction.debris.position, { q: 1, r: 0 });
  assert.equal(state.scenario.contents.filter(content => content.id.startsWith(`debris-${mover.id}-`)).length, 1);
  assert.equal(state.activeAction, null);
  assert.equal(state.maneuverApplication, null);
  assert.equal(state.attackApplication, null);
  assert.equal(executeManeuverElement(state, plan, 1).status, "invalid");
  assert.equal(destroyUnit(state, mover), null);
  assert.equal(state.scenario.contents.filter(content => content.id.startsWith(`debris-${mover.id}-`)).length, 1);
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
  const plan = chooseManeuver(state, optionAt(state, mover, "2,0"));

  const result = executeManeuverElement(state, plan, 0, { canContinue: () => false });

  assert.equal(result.status, "stopped");
  assert.equal(result.reason, "continuation-forbidden");
  assert.equal(mover.speedSpent, 1);
  assert.equal(mover.movementEvasion, 4);
  assert.deepEqual(mover.position, { q: 1, r: 0 });
  assert.equal(randomCalls, 0);
  assert.equal(executeManeuverElement(state, plan, 1).status, "invalid");
});

test("maneuver step hazard events carry plan, step, and cause context", () => {
  const mover = unit({ currentSpeed: 1, speedRemaining: 1 });
  const state = battle(mover, { contents: [hazard({ q: 1, r: 0 }, { hazard: { probability: 1, min: 20, max: 20, effect: "integrity damage" } })] });
  state.rng = () => 0;
  const plan = chooseManeuver(state, optionAt(state, mover, "1,0"));

  executeManeuverElement(state, plan, 0);

  const actionEvents = state.events.filter(event => event.action !== "activation-action-confirm");
  assert.deepEqual(actionEvents.map(event => event.action), ["maneuver-exit", "maneuver-move", "hazard-check", "damage", "destroy", "maneuver-stop", "debris-create"]);
  const [exit, move, check, damage, destruction, stop, debris] = actionEvents;
  for (const event of actionEvents) assert.equal(event.planId, plan.id);
  for (const event of actionEvents.slice(0, 5)) assert.equal(event.elementIndex, 0);
  assert.equal(stop.elementIndex, undefined);
  assert.equal(debris.elementIndex, 0);
  assert.equal(move.causeEventId, exit.eventId);
  assert.equal(check.causeEventId, move.eventId);
  assert.equal(damage.causeEventId, check.eventId);
  assert.equal(destruction.causeEventId, damage.eventId);
  assert.equal(stop.causeEventId, destruction.eventId);
  assert.equal(debris.causeEventId, stop.eventId);
  assert.equal(stop.reason, "hazard");
  assert.equal(damage.cause, "hazard:mines");
  assert.deepEqual(check.position, { q: 1, r: 0 });
});

test("completed maneuver events and user log preserve deterministic order and causal action context", () => {
  const mover = unit({ name: "Scout", currentSpeed: 2, speedRemaining: 2, maneuver: 1, maneuverRemaining: 1 });
  const state = battle(mover, { contents: [hazard({ q: 1, r: 0 }, { hazard: { probability: 0, min: 3, max: 3, effect: "integrity damage" } })] });
  state.rng = () => 1;
  const plan = chooseManeuver(state, optionAt(state, mover, "2,0"));

  assert.equal(executeManeuverElement(state, plan, 0).status, "executed");
  assert.equal(executeManeuverElement(state, plan, 1).status, "completed");

  const actionEvents = state.events.filter(event => event.actionId === plan.actionId);
  assert.deepEqual(actionEvents.map(event => event.action), [
    "activation-action-confirm",
    "maneuver-exit",
    "maneuver-move",
    "hazard-check",
    "maneuver-exit",
    "maneuver-move",
    "maneuver-complete"
  ]);
  assert.deepEqual(actionEvents.map(event => event.eventOrder), [...actionEvents.map(event => event.eventOrder)].sort((left, right) => left - right));
  assert.equal(actionEvents.every(event => event.activationId === undefined && event.lifecycle !== "movement"), true);
  assert.equal(actionEvents[1].causeEventId, actionEvents[0].eventId);
  assert.equal(actionEvents[2].causeEventId, actionEvents[1].eventId);
  assert.equal(actionEvents[3].causeEventId, actionEvents[2].eventId);
  assert.equal(actionEvents[4].causeEventId, actionEvents[2].eventId);
  assert.equal(actionEvents[5].causeEventId, actionEvents[4].eventId);
  assert.equal(actionEvents[6].causeEventId, actionEvents[5].eventId);
  assert.deepEqual(buildManeuverLog(state).map(entry => entry.eventId), actionEvents.filter(event => event.action !== "maneuver-exit").map(event => event.eventId));
  assert.match(buildManeuverLog(state).at(-1).message, /завершён штатно/);
});

test("combined battle log preserves legacy and event chronology without duplicate AA or destruction entries", () => {
  const mover = unit({ name: "Scout", currentSpeed: 1, speedRemaining: 1 });
  const owner = unit({ id: "owner", name: "Guardian", kind: "capital", sideId: "crimson", position: { q: 0, r: 0 }, heading: 0, weapons: [aaWeapon({ damage: 20 })] });
  const state = battle(mover, { units: [owner] });
  state.log.push({ id: "before", journalOrder: state.journalSequence = 1, round: 1, message: "before", tone: "system" });
  const plan = chooseManeuver(state, optionAt(state, mover, "1,0"));

  executeManeuverElement(state, plan, 0, {
    resolvePostEntry({ state: current, unit: entered, plan: currentPlan, elementIndex, causeEventId }) {
      return resolvePostEntryAA(current, entered, { ...currentPlan.actionContext, planId: currentPlan.id, elementIndex, causeEventId }, () => 1, () => 0);
    }
  });
  state.log.unshift({ id: "after", journalOrder: state.journalSequence = (state.journalSequence ?? 0) + 1, round: 1, message: "after", tone: "system" });

  const entries = buildBattleLog(state);
  assert.equal(entries[0].message, "after");
  assert.equal(entries.at(-1).message, "before");
  assert.equal(entries.filter(entry => /реакция ПВО/.test(entry.message)).length, 1);
  assert.equal(entries.filter(entry => /Scout уничтожен/.test(entry.message)).length, 1);
  assert.deepEqual(entries.filter(entry => entry.eventId).map(entry => entry.journalOrder), [...entries.filter(entry => entry.eventId).map(entry => entry.journalOrder)].sort((left, right) => right - left));
});

test("reaction miss is a maneuver-step event and appears once through the event-derived journal", () => {
  const mover = unit({ name: "Scout", currentSpeed: 1, speedRemaining: 1 });
  const owner = unit({ id: "owner", name: "Guardian", kind: "capital", sideId: "crimson", position: { q: 0, r: 0 }, heading: 0, weapons: [aaWeapon({ accuracy: 50 })] });
  const state = battle(mover, { units: [owner] });
  const plan = chooseManeuver(state, optionAt(state, mover, "1,0"));

  assert.equal(executeManeuverElement(state, plan, 0, {
    resolvePostEntry({ state: current, unit: entered, plan: currentPlan, elementIndex, causeEventId }) {
      return resolvePostEntryAA(current, entered, { ...currentPlan.actionContext, planId: currentPlan.id, elementIndex, causeEventId }, () => 100, () => 0);
    }
  }).status, "completed");

  const move = state.events.find(event => event.action === "maneuver-move");
  const declaration = state.events.find(event => event.action === "aa-reaction-declare");
  const miss = state.events.find(event => event.action === "aa-reaction-miss");
  assert.deepEqual({ actionId: miss.actionId, causeEventId: miss.causeEventId, elementIndex: miss.elementIndex }, {
    actionId: declaration.eventId,
    causeEventId: move.eventId,
    elementIndex: move.elementIndex
  });
  assert.ok(move.eventOrder < declaration.eventOrder && declaration.eventOrder < miss.eventOrder);
  assert.equal(buildBattleLog(state).filter(entry => /промах/.test(entry.message)).length, 1);
  assert.equal(state.log.some(entry => /промах/.test(entry.message)), false);
});

test("event cursor clears derived log entries without deleting domain events", () => {
  const mover = unit({ currentSpeed: 2, speedRemaining: 2 });
  const state = battle(mover);
  const first = chooseManeuver(state, optionAt(state, mover, "1,0"));
  assert.equal(executeManeuverElement(state, first, 0).status, "completed");
  const cursor = state.sequence;
  const preservedEvents = [...state.events];
  state.log = [];

  assert.deepEqual(buildBattleLog(state, cursor), []);
  beginActionPlanning(state, { type: "maneuver", reason: "test" });
  const second = confirmManeuverAction(state, buildManeuverOptions(mover, planRoutes(state, mover, "risky").get("2,0:0"))[0]);
  assert.equal(executeManeuverElement(state, second, 0).status, "completed");
  assert.equal(state.events.slice(0, preservedEvents.length).every((event, index) => event === preservedEvents[index]), true);
  assert.equal(buildBattleLog(state, cursor).every(entry => entry.eventOrder > cursor), true);
  assert.ok(buildBattleLog(state, cursor).length > 0);
});

test("planning and cancellation do not create maneuver events or user log entries", () => {
  const mover = unit();
  const state = battle(mover);
  const before = structuredClone({ events: state.events, sequence: state.sequence, log: state.log });

  beginActionPlanning(state, { type: "maneuver", reason: "test" });
  optionAt(state, mover, "1,0");
  assert.equal(cancelActionPlanning(state), true);

  assert.deepEqual({ events: state.events, sequence: state.sequence, log: state.log }, before);
  assert.deepEqual(buildManeuverLog(state), []);
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
  assert.deepEqual(enemyA.engagedWith, ["ally", "mover"]);
  assert.deepEqual(enemyZ.engagedWith, ["mover"]);
  assert.deepEqual(ally.engagedWith, ["enemy-a"]);
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
  const plan = chooseManeuver(state, optionAt(state, mover, "1,0"));
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
  assert.equal(state.lifecycle, "ActionChoice");
  const move = state.events.find(event => event.action === "maneuver-move");
  const interception = state.events.find(event => event.action === "interception-create");
  const stop = state.events.find(event => event.action === "maneuver-stop");
  assert.equal(interception.causeEventId, move.eventId);
  assert.equal(stop.causeEventId, interception.eventId);
  assert.equal(stop.reason, "interception");
  assert.equal(stop.actionId, plan.actionId);
  assert.match(buildManeuverLog(state).at(-1).message, /возник Перехват/);
});

test("lethal entry hazard prevents interception", () => {
  const mover = unit({ currentSpeed: 1, speedRemaining: 1, integrity: 3, stack: 1 });
  const enemy = unit({ id: "enemy", sideId: "crimson", position: { q: 4, r: 0 } });
  const state = battle(mover, { units: [enemy], contents: [hazard({ q: 1, r: 0 })] });
  state.rng = () => 0;
  const result = executeManeuverElement(state, chooseManeuver(state, optionAt(state, mover, "1,0")), 0);

  assert.equal(result.status, "destroyed");
  assert.deepEqual(enemy.engagedWith, []);
});

test("passing through a capital alone creates no interception and route continues", () => {
  const mover = unit({ currentSpeed: 2, speedRemaining: 2 });
  const capital = unit({ id: "capital", kind: "capital", sideId: "crimson", position: { q: 1, r: 0 }, heading: 3 });
  const state = battle(mover, { units: [capital] });
  const plan = chooseManeuver(state, optionAt(state, mover, "2,0"));

  assert.equal(executeManeuverElement(state, plan, 0).status, "executed");
  assert.deepEqual(mover.engagedWith, []);
  assert.equal(executeManeuverElement(state, plan, 1).status, "completed");
});

test("turn-only routes do not synthesize interception previews", () => {
  const mover = unit({ maneuver: 1, maneuverRemaining: 1 });
  const enemy = unit({ id: "enemy", sideId: "crimson", position: { q: 1, r: 0 } });
  const state = battle(mover, { units: [enemy] });
  const stationary = planRoutes(state, mover, "risky").get("0,0:1");

  assert.deepEqual(stationary.interceptions, []);
  assert.equal("interception" in stationary, false);
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

test("deferred reaction applies only after animation boundary and destruction cancels later reactions and route", () => {
  const mover = unit({ currentSpeed: 2, speedRemaining: 2, integrity: 5, stack: 1 });
  const later = unit({ id: "later", kind: "capital", sideId: "crimson", position: { q: 0, r: 1 }, heading: 0, weapons: [aaWeapon({ id: "later-aa" })] });
  const killer = unit({ id: "killer", kind: "capital", sideId: "crimson", position: { q: 0, r: 0 }, heading: 0, weapons: [aaWeapon()] });
  const state = battle(mover, { units: [killer, later] });
  const plan = chooseManeuver(state, optionAt(state, mover, "2,0"));
  const deferred = ({ state: current, unit: entered, plan: currentPlan, elementIndex, causeEventId }) => {
    const reactionPlan = planPostEntryAA(current, entered, { ...currentPlan.actionContext, planId: currentPlan.id, elementIndex, causeEventId }, () => 1, () => 0);
    return reactionPlan ? { pending: true, plan: reactionPlan } : [];
  };

  const pending = executeManeuverElement(state, plan, 0, { resolvePostEntry: deferred });

  assert.equal(pending.status, "reaction-pending");
  assert.equal(mover.integrity, 5);
  assert.equal(killer.weapons[0].firedThisRound, true);
  assert.equal(later.weapons[0].firedThisRound, false);
  const applied = applyReactionStep(state, pending.reactionPlan, 0);
  assert.equal(applied.destroyed, true);
  const stopped = resumeManeuverPostEntry(state, plan);
  assert.equal(stopped.status, "invalid");
  assert.equal(state.units.includes(mover), false);
  assert.equal(later.weapons[0].firedThisRound, false);
  assert.equal(executeManeuverElement(state, plan, 1).status, "invalid");
});

test("post-entry AA revalidates after entry and destroys mover before later reactions, interception, or steps", () => {
  const mover = unit({ currentSpeed: 2, speedRemaining: 2, integrity: 5, stack: 1 });
  const later = unit({ id: "later", kind: "capital", sideId: "crimson", position: { q: 0, r: 1 }, heading: 0, weapons: [aaWeapon({ id: "later-aa" })] });
  const killer = unit({ id: "killer", kind: "capital", sideId: "crimson", position: { q: 0, r: 0 }, heading: 0, weapons: [aaWeapon()] });
  const interceptor = unit({ id: "interceptor", sideId: "crimson", position: { q: 3, r: 0 } });
  const state = battle(mover, { units: [killer, later, interceptor] });
  state.activeUnitId = mover.id;
  const plan = chooseManeuver(state, optionAt(state, mover, "2,0"));

  const result = executeManeuverElement(state, plan, 0, {
    resolvePostEntry({ state: current, unit: entered, plan: currentPlan, elementIndex, causeEventId }) {
      return resolvePostEntryAA(current, entered, { planId: currentPlan.id, elementIndex, causeEventId }, () => 1, () => 0);
    }
  });

  assert.equal(result.status, "destroyed");
  assert.equal(result.reason, "reaction");
  assert.deepEqual(result.destruction.debris.position, { q: 1, r: 0 });
  assert.equal(state.scenario.contents.filter(content => content.id.startsWith(`debris-${mover.id}-`)).length, 1);
  assert.equal(state.activeAction, null);
  assert.equal(state.maneuverApplication, null);
  assert.equal(state.attackApplication, null);
  assert.equal(killer.weapons[0].firedThisRound, true);
  assert.equal(later.weapons[0].firedThisRound, false);
  assert.deepEqual(interceptor.engagedWith, []);
  assert.equal(executeManeuverElement(state, plan, 1).status, "invalid");
  const declaration = state.events.find(event => event.action === "aa-reaction-declare");
  const move = state.events.find(event => event.action === "maneuver-move");
  assert.equal(declaration.causeEventId, move.eventId);
  assert.equal(declaration.planId, plan.id);
  assert.equal(declaration.elementIndex, 0);
  assert.equal(declaration.lifecycle, "ActionResolution");
  const reactionDamage = state.events.find(event => event.action === "damage" && event.actionId === declaration.actionId);
  const destruction = state.events.find(event => event.action === "destroy" && event.subjectIds.includes(mover.id));
  const stop = state.events.find(event => event.action === "maneuver-stop");
  const debris = state.events.find(event => event.action === "debris-create");
  assert.equal(reactionDamage.causeEventId, declaration.eventId);
  assert.equal(destruction.causeEventId, reactionDamage.eventId);
  assert.equal(stop.causeEventId, destruction.eventId);
  assert.equal(debris.causeEventId, stop.eventId);
  assert.deepEqual(buildManeuverLog(state).map(entry => entry.eventId), state.events.filter(event => [plan.actionId, declaration.actionId].includes(event.actionId) || [move.eventId, declaration.eventId, reactionDamage.eventId, destruction.eventId, stop.eventId, debris.eventId].includes(event.causeEventId)).filter(event => event.action !== "maneuver-exit" && event.action !== "damage").map(event => event.eventId));
});

test("post-entry AA legality is revalidated immediately before each declaration", () => {
  const mover = unit({ currentSpeed: 1, speedRemaining: 1 });
  const owner = unit({ id: "owner", kind: "capital", sideId: "crimson", position: { q: 0, r: 0 }, heading: 0, weapons: [aaWeapon({ maxRange: 1 })] });
  const state = battle(mover, { units: [owner] });
  const plan = chooseManeuver(state, optionAt(state, mover, "1,0"));
  const result = executeManeuverElement(state, plan, 0, {
    resolveEntry() {
      owner.position = { q: -4, r: 0 };
    },
    resolvePostEntry({ state: current, unit: entered, plan: currentPlan, elementIndex, causeEventId }) {
      return resolvePostEntryAA(current, entered, { ...currentPlan.actionContext, planId: currentPlan.id, elementIndex, causeEventId }, () => 1, () => 0);
    }
  });

  assert.equal(result.status, "completed");
  assert.equal(owner.weapons[0].firedThisRound, false);
  assert.equal(state.events.some(event => event.action === "aa-reaction-declare"), false);
});

test("multiple post-entry reactions follow initiative and slot order with revalidation between declarations", () => {
  const mover = unit({ currentSpeed: 1, speedRemaining: 1, integrity: 40, stack: 4 });
  const later = unit({ id: "later", kind: "capital", sideId: "crimson", position: { q: 0, r: 1 }, heading: 0, weapons: [aaWeapon({ id: "later-aa", damage: 1 })] });
  const first = unit({ id: "first", kind: "capital", sideId: "crimson", position: { q: 0, r: 0 }, heading: 0, weapons: [aaWeapon({ id: "slot-b", slotOrder: 1, damage: 1 }), aaWeapon({ id: "slot-a", slotOrder: 0, damage: 1 })] });
  const state = battle(mover, { units: [later, first] });
  state.initiativeOrder = [first.id, later.id, mover.id];
  const plan = chooseManeuver(state, optionAt(state, mover, "1,0"));

  const result = executeManeuverElement(state, plan, 0, {
    resolvePostEntry({ state: current, unit: entered, plan: currentPlan, elementIndex, causeEventId }) {
      return resolvePostEntryAA(current, entered, { ...currentPlan.actionContext, planId: currentPlan.id, elementIndex, causeEventId }, () => 100, () => 0);
    }
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(state.events.filter(event => event.action === "aa-reaction-declare").map(event => [event.actorId, event.slotId]), [
    [first.id, "slot-a"],
    [first.id, "slot-b"],
    [later.id, "later-aa"]
  ]);
  assert.equal([first, later].flatMap(owner => owner.weapons).every(slot => slot.firedThisRound && !slot.overwatch), true);
});

test("destroying an interception participant removes reciprocal links and preserves survivor links", () => {
  const destroyed = unit({ id: "destroyed", engagedWith: ["enemy-a", "enemy-b"] });
  const enemyA = unit({ id: "enemy-a", sideId: "crimson", position: { q: 1, r: 0 }, engagedWith: ["destroyed", "enemy-b"] });
  const enemyB = unit({ id: "enemy-b", sideId: "crimson", position: { q: 0, r: 1 }, engagedWith: ["destroyed", "enemy-a"] });
  const state = battle(destroyed, { units: [enemyA, enemyB] });

  destroyUnit(state, destroyed);

  assert.deepEqual(enemyA.engagedWith, ["enemy-b"]);
  assert.deepEqual(enemyB.engagedWith, ["enemy-a"]);
  assert.equal(destroyUnit(state, destroyed), null);
  assert.deepEqual(enemyA.engagedWith, ["enemy-b"]);
  assert.deepEqual(enemyB.engagedWith, ["enemy-a"]);
  assert.equal(state.scenario.contents.filter(content => content.id.startsWith("debris-destroyed-")).length, 1);
});
