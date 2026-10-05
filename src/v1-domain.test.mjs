import test from "node:test";
import assert from "node:assert/strict";
import {
  createBattle,
  deployUnit,
  confirmDeployment,
  decide,
  advanceActivation,
  moveAtomic,
  movementDestinations,
  applyDamagePacket,
  refreshInterception,
  previewDisengagement,
  disengage,
  previewAttack,
  ram,
  progress,
  resolveAttack,
  resolveOverwatch,
  planMovement,
  changeHeading,
  supercoverLine
} from "./v1-domain.js";

const bounds = { minCol: 0, maxCol: 3, minRow: 0, maxRow: 1 };
const units = [
  { id: "l-cap", side: "left", kind: "capital", initiative: 4, shield: 0, armor: 0, integrity: 10 },
  { id: "r-cap", side: "right", kind: "capital", initiative: 3, shield: 0, armor: 0, integrity: 10 }
];

function deployedBattle() {
  const state = createBattle({ id: "acceptance", bounds, units });
  assert.equal(deployUnit(state, "l-cap", { q: 0, r: 0 }, 2), true);
  assert.equal(confirmDeployment(state, "left"), true);
  assert.equal(deployUnit(state, "r-cap", { q: 3, r: 0 }, 5), true);
  assert.equal(confirmDeployment(state, "right"), true);
  return state;
}

test("sequential deployment locks each side and starts first decision", () => {
  const state = createBattle({ bounds, units });
  assert.equal(deployUnit(state, "l-cap", { q: 0, r: 0 }, 2), true);
  assert.equal(deployUnit(state, "l-cap", { q: 1, r: 0 }, 2), true);
  assert.equal(confirmDeployment(state, "left"), true);
  assert.equal(state.lifecycle, "DeploymentRight");
  assert.equal(deployUnit(state, "l-cap", { q: 0, r: 1 }, 1), false);
  assert.equal(deployUnit(state, "r-cap", { q: 3, r: 0 }, 5), true);
  assert.equal(confirmDeployment(state, "right"), true);
  assert.equal(state.lifecycle, "WaitDecision");
  assert.equal(state.round, 1);
  assert.equal(state.activeUnitId, "l-cap");
});

test("deployment rejects occupied objects and duplicate hexes", () => {
  const state = createBattle({ bounds, contents: [{ id: "rock", kind: "object", position: { q: 0, r: 0 } }], units });
  assert.equal(deployUnit(state, "l-cap", { q: 0, r: 0 }, 0), false);
  assert.equal(deployUnit(state, "l-cap", { q: 0, r: 1 }, 0), true);
  assert.equal(deployUnit(state, "r-cap", { q: 0, r: 1 }, 0), false);
});

test("deployment enforces zone, heading, phase, and complete-fleet boundaries", () => {
  const fleet = [...units, { id: "l-squad", side: "left", kind: "squadron", integrity: 3 }];
  const state = createBattle({ bounds, units: fleet });
  assert.equal(deployUnit(state, "r-cap", { q: 3, r: 1 }, 5), false);
  assert.equal(deployUnit(state, "l-cap", { q: 2, r: 0 }, 0), false);
  for (const heading of [-1, 1.5, 6]) assert.equal(deployUnit(state, "l-cap", { q: 0, r: 0 }, heading), false);
  assert.equal(deployUnit(state, "l-cap", { q: 0, r: 0 }, 0), true);
  assert.equal(deployUnit(state, "l-squad", { q: 1, r: 0 }, 2), false);
  assert.equal(confirmDeployment(state, "left"), false);
  assert.equal(deployUnit(state, "l-squad", { q: 1, r: 0 }), true);
  assert.equal(confirmDeployment(state, "left"), true);
  const snapshot = structuredClone(state.units.find(unit => unit.id === "l-cap"));
  const eventCount = state.events.length;
  assert.equal(deployUnit(state, "l-cap", { q: 0, r: 1 }, 3), false);
  assert.deepEqual(state.units.find(unit => unit.id === "l-cap"), snapshot);
  assert.equal(state.events.length, eventCount);
});

test("battle creation rejects insufficient free deployment capacity", () => {
  const crowded = [0, 1, 2, 3].map((r, index) => ({ id: `block-${index}`, kind: "terrain", position: { q: index < 2 ? 0 : 1, r: index % 2 } }));
  assert.throws(() => createBattle({ bounds, units, contents: crowded }), /deployment capacity/);
});

test("wait moves unit once, then activation progresses through stages", () => {
  const state = deployedBattle();
  assert.equal(decide(state, "wait"), true);
  assert.equal(state.lifecycle, "WaitDecision");
  assert.equal(state.activeUnitId, "r-cap");
  assert.equal(decide(state, "continue"), true);
  assert.equal(state.lifecycle, "SystemActions");
  assert.equal(advanceActivation(state, "Maneuver"), true);
  assert.equal(advanceActivation(state, "Attack"), true);
  assert.equal(advanceActivation(state, "EndActivation"), true);
});

test("atomic movement enforces active maneuver ownership", () => {
  const state = deployedBattle();
  assert.equal(moveAtomic(state, "l-cap", [{ q: 1, r: 0 }]).moved, 0);
  state.lifecycle = "Maneuver";
  state.activeUnitId = "r-cap";
  assert.equal(moveAtomic(state, "l-cap", [{ q: 1, r: 0 }]).moved, 0);
  state.activeUnitId = "l-cap";
  state.units.find(unit => unit.id === "l-cap").currentSpeed = 3;
  state.units.find(unit => unit.id === "l-cap").heading = 0;
  const result = moveAtomic(state, "l-cap", [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }]);
  assert.equal(result.status, "blocked");
  assert.equal(result.moved, 2);
  assert.deepEqual(state.units.find(unit => unit.id === "l-cap").position, { q: 2, r: 0 });
});

test("movement collision boundaries reject occupied cells and teleports", () => {
  const state = deployedBattle();
  state.lifecycle = "Maneuver";
  state.activeUnitId = "l-cap";
  const events = state.events.length;
  assert.deepEqual(moveAtomic(state, "l-cap", [{ q: 2, r: 0 }]), { status: "blocked", moved: 0 });
  assert.deepEqual(state.units.find(unit => unit.id === "l-cap").position, { q: 0, r: 0 });
  assert.equal(state.events.length, events + 1);
  assert.equal(state.events.at(-1).action, "entry-attempt");
  state.units.push({ id: "friendly", side: "left", kind: "squadron", position: { q: 1, r: 0 }, integrity: 1 });
  assert.deepEqual(moveAtomic(state, "l-cap", [{ q: 1, r: 0 }]), { status: "blocked", moved: 0 });
});

test("squadrons may pass through objects but may not stop on them", () => {
  const state = deployedBattle();
  state.units.push({ id: "fighter", side: "left", kind: "squadron", position: { q: 0, r: 1 }, integrity: 2, currentSpeed: 2 });
  state.contents.push({ id: "rock", kind: "object", position: { q: 1, r: 1 } });
  state.lifecycle = "Maneuver";
  state.activeUnitId = "fighter";
  assert.deepEqual(moveAtomic(state, "fighter", [{ q: 1, r: 1 }]), { status: "blocked", moved: 0 });
  assert.deepEqual(moveAtomic(state, "fighter", [{ q: 1, r: 1 }, { q: 2, r: 1 }]), { status: "moved", moved: 2 });
  assert.deepEqual(state.units.find(unit => unit.id === "fighter").position, { q: 2, r: 1 });
});

test("movement destinations exclude capital hexes unreachable within remaining maneuver", () => {
  const state = deployedBattle();
  state.lifecycle = "Maneuver";
  state.activeUnitId = "l-cap";
  const unit = state.units.find(candidate => candidate.id === "l-cap");
  Object.assign(unit, { heading: 0, maneuver: 0, turnsSpent: 0, currentSpeed: 2 });
  const destinations = movementDestinations(state, unit.id);
  assert.equal(destinations.some(position => position.q === 2 && position.r === 0), true);
  assert.equal(destinations.some(position => position.q === 0 && position.r === 1), false);
  assert.equal(planMovement(state, unit.id, { q: 0, r: 1 }).valid, false);
  unit.maneuver = 1;
  assert.equal(movementDestinations(state, unit.id).some(position => position.q === 0 && position.r === 1), true);
});

test("movement planning reports blocked route reasons", () => {
  const state = deployedBattle();
  state.lifecycle = "Maneuver";
  state.activeUnitId = "l-cap";
  state.contents.push({ id: "rock", kind: "object", position: { q: 1, r: 0 } });
  const plan = planMovement(state, "l-cap", { q: 2, r: 0 });
  assert.equal(plan.valid, false);
  assert.match(plan.reason, /объектом/i);
});

test("movement planning names occupied ships", () => {
  const state = deployedBattle();
  state.lifecycle = "Maneuver";
  state.activeUnitId = "l-cap";
  state.units.find(unit => unit.id === "l-cap").speed = 8;
  state.units.find(unit => unit.id === "l-cap").currentSpeed = 8;
  const plan = planMovement(state, "l-cap", { q: 7, r: 0 });
  assert.equal(plan.valid, false);
  assert.match(plan.reason, /кораблём/i);
});

test("movement planning returns deterministic route and heading changes during maneuver", () => {
  const state = deployedBattle();
  state.lifecycle = "Maneuver";
  state.activeUnitId = "l-cap";
  state.units.find(unit => unit.id === "l-cap").speed = 2;
  state.units.find(unit => unit.id === "l-cap").currentSpeed = 2;
  state.units.find(unit => unit.id === "l-cap").heading = 0;
  const plan = planMovement(state, "l-cap", { q: 2, r: 0 });
  assert.equal(plan.valid, true);
  assert.deepEqual(plan.steps, [{ q: 1, r: 0 }, { q: 2, r: 0 }]);
  state.units.find(unit => unit.id === "l-cap").heading = 2;
  state.units.find(unit => unit.id === "l-cap").maneuver = 1;
  assert.equal(changeHeading(state, "l-cap", 3), true);
  assert.equal(state.units.find(unit => unit.id === "l-cap").heading, 3);
  assert.equal(state.events.at(-1).action, "heading-change");
});

test("atomic movement spends speed before entry and stops before an unaffordable step", () => {
  const state = deployedBattle();
  state.lifecycle = "Maneuver";
  state.activeUnitId = "l-cap";
  const unit = state.units.find(candidate => candidate.id === "l-cap");
  unit.currentSpeed = 1;
  unit.heading = 0;
  const result = moveAtomic(state, unit.id, [{ q: 1, r: 0 }, { q: 2, r: 0 }]);
  assert.deepEqual(result, { status: "blocked", moved: 1 });
  assert.equal(unit.currentSpeed, 0);
  assert.deepEqual(unit.position, { q: 1, r: 0 });
  assert.deepEqual(state.events.slice(-3).map(event => event.action), ["entry-attempt", "movement-step", "entry-attempt"]);
  assert.equal(state.events.at(-2).cost, 1);
  assert.equal(state.events.at(-2).remainingSpeed, 0);
});

test("heading changes are limited to one turn and maneuver budget", () => {
  const state = deployedBattle();
  state.lifecycle = "Maneuver";
  state.activeUnitId = "l-cap";
  const unit = state.units.find(candidate => candidate.id === "l-cap");
  unit.maneuver = 1;
  const eventCount = state.events.length;
  assert.equal(changeHeading(state, unit.id, 4), false);
  assert.equal(unit.heading, 2);
  assert.equal(state.events.length, eventCount);
  assert.equal(changeHeading(state, unit.id, 3), true);
  assert.equal(changeHeading(state, unit.id, 4), false);
  assert.equal(unit.heading, 3);
  assert.equal(unit.turnsSpent, 1);
});

test("capital movement turns at most once before each heading-constrained step and accumulates maneuver", () => {
  const state = deployedBattle();
  state.lifecycle = "Maneuver";
  state.activeUnitId = "l-cap";
  const unit = state.units.find(candidate => candidate.id === "l-cap");
  Object.assign(unit, { heading: 0, maneuver: 2, turnsSpent: 0, currentSpeed: 3 });
  const plan = planMovement(state, unit.id, { q: 1, r: 1 });
  assert.equal(plan.valid, true);
  assert.deepEqual(plan.steps, [{ q: 1, r: 0 }, { q: 1, r: 1 }]);
  assert.deepEqual(plan.stepHeadings, [0, 5]);
  assert.equal(plan.turnsSpent, 1);
  assert.equal(plan.finalHeading, 5);
  const result = moveAtomic(state, unit.id, plan.steps);
  assert.deepEqual(result, { status: "moved", moved: 2 });
  assert.equal(unit.heading, 5);
  assert.equal(unit.turnsSpent, 1);
  assert.deepEqual(state.events.slice(-5).map(event => event.action), ["entry-attempt", "movement-step", "entry-attempt", "heading-change", "movement-step"]);
  const turn = state.events.at(-2);
  assert.equal(turn.causeEventId, state.events.at(-3).eventId);
  assert.equal(state.events.at(-1).causeEventId, turn.eventId);
});

test("capital movement rejects a step that cannot match heading within remaining maneuver", () => {
  const state = deployedBattle();
  state.lifecycle = "Maneuver";
  state.activeUnitId = "l-cap";
  const unit = state.units.find(candidate => candidate.id === "l-cap");
  Object.assign(unit, { heading: 0, maneuver: 0, turnsSpent: 0, currentSpeed: 2 });
  assert.deepEqual(moveAtomic(state, unit.id, [{ q: 1, r: -1 }]), { status: "blocked", moved: 0 });
  assert.deepEqual(unit.position, { q: 0, r: 0 });
  assert.equal(unit.currentSpeed, 2);
});

test("capital may spend one remaining turn after arrival", () => {
  const state = deployedBattle();
  state.lifecycle = "Maneuver";
  state.activeUnitId = "l-cap";
  const unit = state.units.find(candidate => candidate.id === "l-cap");
  Object.assign(unit, { heading: 0, maneuver: 2, turnsSpent: 0, currentSpeed: 1 });
  assert.deepEqual(moveAtomic(state, unit.id, [{ q: 1, r: 0 }], { heading: 1 }), { status: "moved", moved: 1 });
  assert.equal(unit.heading, 1);
  assert.equal(unit.turnsSpent, 1);
  assert.deepEqual(state.events.slice(-3).map(event => event.action), ["entry-attempt", "movement-step", "heading-change"]);
  assert.equal(state.events.at(-1).causeEventId, state.events.at(-2).eventId);
});

test("stationary capital turn spends maneuver and clears evasion", () => {
  const state = deployedBattle();
  state.lifecycle = "Maneuver";
  state.activeUnitId = "l-cap";
  const unit = state.units.find(candidate => candidate.id === "l-cap");
  Object.assign(unit, { heading: 0, maneuver: 1, turnsSpent: 0, currentSpeed: 2, evasion: 12 });
  assert.deepEqual(moveAtomic(state, unit.id, [], { heading: 1 }), { status: "moved", moved: 0 });
  assert.equal(unit.heading, 1);
  assert.equal(unit.turnsSpent, 1);
  assert.equal(unit.evasion, 0);
  assert.equal(state.events.at(-1).stationary, true);
});

test("final heading is validated from arrival heading with the combined maneuver budget before mutation", () => {
  const state = deployedBattle();
  state.lifecycle = "Maneuver";
  state.activeUnitId = "l-cap";
  const unit = state.units.find(candidate => candidate.id === "l-cap");
  Object.assign(unit, { heading: 0, maneuver: 1, turnsSpent: 0, currentSpeed: 2 });
  const before = structuredClone(unit);
  const events = state.events.length;
  assert.deepEqual(moveAtomic(state, unit.id, [{ q: 1, r: 0 }, { q: 1, r: 1 }], { heading: 0 }), { status: "blocked", moved: 0 });
  assert.deepEqual(unit, before);
  assert.equal(state.events.length, events);
});

test("unchanged final heading does not record a zero-turn event", () => {
  const state = deployedBattle();
  state.lifecycle = "Maneuver";
  state.activeUnitId = "l-cap";
  const unit = state.units.find(candidate => candidate.id === "l-cap");
  Object.assign(unit, { heading: 0, maneuver: 1, turnsSpent: 0, currentSpeed: 1 });
  assert.deepEqual(moveAtomic(state, unit.id, [{ q: 1, r: 0 }], { heading: 0 }), { status: "moved", moved: 1 });
  assert.equal(state.events.filter(event => event.action === "heading-change").length, 0);
});

test("stationary turn evasion suppression is restored at the next activation", () => {
  const state = deployedBattle();
  state.lifecycle = "Maneuver";
  state.activeUnitId = "l-cap";
  const unit = state.units.find(candidate => candidate.id === "l-cap");
  Object.assign(unit, { heading: 0, maneuver: 1, turnsSpent: 0, currentSpeed: 2, evasion: 12 });
  assert.deepEqual(moveAtomic(state, unit.id, [], { heading: 1 }), { status: "moved", moved: 0 });
  assert.equal(unit.evasion, 0);
  assert.equal(unit.stationaryTurnEvasion, 12);
  state.lifecycle = "WaitDecision";
  assert.equal(decide(state, "continue"), true);
  assert.equal(unit.evasion, 12);
  assert.equal("stationaryTurnEvasion" in unit, false);
});

test("nonlethal and repeated onEnter damage resolves once per entry without stopping movement", () => {
  const state = createBattle({ bounds: { minCol: 0, maxCol: 3, minRow: 0, maxRow: 1 }, units: [
    { id: "fighter", side: "left", kind: "squadron", position: { q: 0, r: 0 }, integrity: 5, currentSpeed: 3 },
    { id: "enemy", side: "right", kind: "capital", position: { q: 3, r: 0 }, integrity: 10 }
  ], contents: [
    { id: "nebula", kind: "terrain", position: { q: 1, r: 0 } },
    { id: "mine", kind: "hazard", position: { q: 1, r: 0 }, onEnterDamage: 1 }
  ] });
  state.lifecycle = "Maneuver";
  state.activeUnitId = "fighter";
  const result = moveAtomic(state, "fighter", [{ q: 1, r: 0 }, { q: 1, r: 1 }, { q: 1, r: 0 }]);
  const fighter = state.units.find(unit => unit.id === "fighter");
  assert.deepEqual(result, { status: "moved", moved: 3 });
  assert.deepEqual(fighter.position, { q: 1, r: 0 });
  assert.equal(fighter.integrity, 3);
  assert.equal(state.events.filter(event => event.action === "on-enter").length, 2);
  assert.deepEqual(state.events.map(event => event.action), ["entry-attempt", "movement-step", "on-enter", "damage-packet", "entry-attempt", "movement-step", "entry-attempt", "movement-step", "on-enter", "damage-packet"]);
  for (const movement of state.events.filter(event => event.action === "movement-step")) assert.equal(state.events.find(event => event.eventId === movement.causeEventId)?.action, "entry-attempt");
  for (const event of state.events.filter(candidate => candidate.action === "on-enter")) assert.equal(state.events.find(candidate => candidate.eventId === event.causeEventId)?.action, "movement-step");
  for (const event of state.events.filter(candidate => candidate.action === "damage-packet")) assert.equal(state.events.find(candidate => candidate.eventId === event.causeEventId)?.action, "on-enter");
});

test("state-changing onEnter effects resolve in content and effect order on every entry", () => {
  const state = createBattle({ bounds: { minCol: 0, maxCol: 3, minRow: 0, maxRow: 1 }, units: [
    { id: "fighter", side: "left", kind: "squadron", position: { q: 0, r: 0 }, integrity: 5, currentSpeed: 4, evasion: 10 },
    { id: "enemy", side: "right", kind: "capital", position: { q: 3, r: 0 }, integrity: 10 }
  ], contents: [
    { id: "mist", kind: "terrain", position: { q: 1, r: 0 }, onEnterEffects: [{ type: "modify-unit", field: "evasion", amount: -2 }, { type: "modify-unit", field: "currentSpeed", amount: 1 }] },
    { id: "wake", kind: "hazard", position: { q: 1, r: 0 }, onEnterEffects: [{ type: "modify-unit", field: "evasion", amount: 1 }] }
  ] });
  state.lifecycle = "Maneuver";
  state.activeUnitId = "fighter";
  assert.deepEqual(moveAtomic(state, "fighter", [{ q: 1, r: 0 }, { q: 1, r: 1 }, { q: 1, r: 0 }]), { status: "moved", moved: 3 });
  const fighter = state.units.find(unit => unit.id === "fighter");
  assert.equal(fighter.evasion, 8);
  assert.equal(fighter.currentSpeed, 3);
  const effects = state.events.filter(event => event.action === "on-enter");
  assert.deepEqual(effects.map(event => [event.actorId, event.field, event.before, event.after]), [
    ["mist", "evasion", { evasion: 10 }, { evasion: 8 }],
    ["mist", "currentSpeed", { currentSpeed: 3 }, { currentSpeed: 4 }],
    ["wake", "evasion", { evasion: 8 }, { evasion: 9 }],
    ["mist", "evasion", { evasion: 9 }, { evasion: 7 }],
    ["mist", "currentSpeed", { currentSpeed: 2 }, { currentSpeed: 3 }],
    ["wake", "evasion", { evasion: 7 }, { evasion: 8 }]
  ]);
  for (const event of effects) assert.equal(state.events.find(candidate => candidate.eventId === event.causeEventId)?.action, "movement-step");
});

test("onEnter effect configuration rejects unsupported effects and clamps bounded unit state", () => {
  assert.throws(() => createBattle({ contents: [{ id: "bad", position: { q: 0, r: 0 }, onEnterEffects: [{ type: "modify-unit", field: "integrity", amount: -1 }] }] }), /Invalid onEnter effect/);
  const state = createBattle({ bounds: { minCol: 0, maxCol: 2, minRow: 0, maxRow: 1 }, units: [
    { id: "fighter", side: "left", kind: "squadron", position: { q: 0, r: 0 }, integrity: 5, currentSpeed: 1, evasion: 99 },
    { id: "enemy", side: "right", kind: "capital", position: { q: 2, r: 0 }, integrity: 10 }
  ], contents: [{ id: "surge", kind: "terrain", position: { q: 1, r: 0 }, onEnterEffects: [{ type: "modify-unit", field: "currentSpeed", amount: -5 }, { type: "modify-unit", field: "evasion", amount: 5 }] }] });
  state.lifecycle = "Maneuver";
  state.activeUnitId = "fighter";
  assert.deepEqual(moveAtomic(state, "fighter", [{ q: 1, r: 0 }]), { status: "moved", moved: 1 });
  const fighter = state.units.find(unit => unit.id === "fighter");
  assert.equal(fighter.currentSpeed, 0);
  assert.equal(fighter.evasion, 100);
  const effects = state.events.filter(event => event.action === "on-enter");
  assert.equal(Object.isFrozen(effects[0].before), true);
  assert.equal(Object.isFrozen(effects[0].after), true);
});

test("state-changing onEnter can invalidate the next route step without partial movement", () => {
  const state = createBattle({ bounds: { minCol: 0, maxCol: 3, minRow: 0, maxRow: 1 }, units: [
    { id: "fighter", side: "left", kind: "squadron", position: { q: 0, r: 0 }, integrity: 5, currentSpeed: 2 },
    { id: "enemy", side: "right", kind: "capital", position: { q: 3, r: 0 }, integrity: 10 }
  ], contents: [{ id: "drag", kind: "terrain", position: { q: 1, r: 0 }, onEnterEffects: [{ type: "modify-unit", field: "currentSpeed", amount: -1 }] }] });
  state.lifecycle = "Maneuver";
  state.activeUnitId = "fighter";
  assert.deepEqual(moveAtomic(state, "fighter", [{ q: 1, r: 0 }, { q: 2, r: 0 }]), { status: "blocked", moved: 1 });
  const fighter = state.units.find(unit => unit.id === "fighter");
  assert.deepEqual(fighter.position, { q: 1, r: 0 });
  assert.equal(fighter.currentSpeed, 0);
  assert.deepEqual(state.events.map(event => event.action), ["entry-attempt", "movement-step", "on-enter", "entry-attempt"]);
});

test("lethal onEnter damage ends the route before reactions and creates debris", () => {
  const state = createBattle({ bounds: { minCol: 0, maxCol: 4, minRow: 0, maxRow: 1 }, round: 1, units: [
    { id: "fighter", side: "left", kind: "squadron", position: { q: 0, r: 0 }, integrity: 2, currentSpeed: 3 },
    { id: "enemy", side: "right", kind: "capital", position: { q: 3, r: 0 }, integrity: 10, weapons: [{ id: "aa", ready: true, ammo: 1, maxRange: 3, damage: 1, accuracy: 100, overwatchEligible: true, overwatch: true, overwatchRound: 1 }] }
  ], contents: [{ id: "mine", kind: "hazard", position: { q: 1, r: 0 }, onEnterDamage: 2 }] });
  state.lifecycle = "Maneuver";
  state.activeUnitId = "fighter";
  const result = moveAtomic(state, "fighter", [{ q: 1, r: 0 }, { q: 2, r: 0 }]);
  assert.deepEqual(result, { status: "blocked", moved: 1 });
  assert.equal(state.units.some(unit => unit.id === "fighter"), false);
  assert.ok(state.contents.some(item => item.kind === "debris" && item.position.q === 1));
  assert.deepEqual(state.events.map(event => event.action), ["entry-attempt", "movement-step", "on-enter", "damage-packet", "unit-destroyed", "debris-created", "victory"]);
  const [entry, movement, onEnter, damage, destroyed, debris] = state.events;
  assert.equal(movement.causeEventId, entry.eventId);
  assert.equal(onEnter.causeEventId, movement.eventId);
  assert.equal(damage.causeEventId, onEnter.eventId);
  assert.equal(destroyed.causeEventId, damage.eventId);
  assert.equal(debris.causeEventId, destroyed.eventId);
  assert.equal(state.events.some(event => event.action.startsWith("overwatch-")), false);
});

test("movement planning rejects blocked route without mutating state", () => {
  const state = deployedBattle();
  state.lifecycle = "Maneuver";
  state.activeUnitId = "l-cap";
  state.units.find(unit => unit.id === "l-cap").speed = 2;
  state.contents.push({ id: "rock", kind: "object", position: { q: 1, r: 0 } });
  const plan = planMovement(state, "l-cap", { q: 2, r: 0 });
  assert.equal(plan.valid, false);
  assert.deepEqual(state.units.find(unit => unit.id === "l-cap").position, { q: 0, r: 0 });
});

test("squadron degradation follows integrity boundaries and records craft losses", () => {
  for (const [damage, integrity, stack, lost] of [[1, 29, 3, 0], [10, 20, 2, 1], [19, 11, 2, 1], [20, 10, 1, 2], [29, 1, 1, 2]]) {
    const state = createBattle({ units: [
      { id: "s", side: "left", kind: "squadron", integrity: 30, unitHealth: 10, stack: 3 },
      { id: "enemy", side: "right", kind: "capital", integrity: 10 }
    ] });
    applyDamagePacket(state, "s", { amount: damage, sourceId: "enemy" });
    assert.equal(state.units[0].integrity, integrity);
    assert.equal(state.units[0].stack, stack);
    const loss = state.events.find(event => event.action === "squadron-craft-lost");
    assert.equal(loss?.lost ?? 0, lost);
    assert.deepEqual(state.events[0].after, { shield: 0, armor: 0, integrity, stack });
  }
});

test("squadron degradation immediately reduces shots and interception strength without changing evasion", () => {
  const state = createBattle({ units: [
    { id: "s", side: "left", kind: "squadron", position: { q: 0, r: 0 }, integrity: 30, unitHealth: 10, stack: 3, speed: 3, evasion: 25 },
    { id: "enemy", side: "right", kind: "squadron", position: { q: 1, r: 0 }, integrity: 30, unitHealth: 10, stack: 3 }
  ] });
  const weapon = { accuracy: 100, damage: 1, shots: 1, arc: "360", maxRange: 3 };
  assert.equal(previewAttack(state, "s", "enemy", weapon).shots, 3);
  refreshInterception(state);
  assert.equal(disengage(structuredClone(state), "s", { random: () => 0 }).chance, 40);
  applyDamagePacket(state, "enemy", { amount: 10, sourceId: "s" });
  assert.equal(previewAttack(state, "enemy", "s", weapon).shots, 2);
  assert.equal(disengage(state, "s", { random: () => 0 }).chance, 50);
  assert.equal(state.units.find(unit => unit.id === "s").evasion, 25);
});

test("lethal squadron degradation orders loss before destruction and cleans interception", () => {
  const state = createBattle({ units: [
    { id: "s", side: "left", kind: "squadron", position: { q: 0, r: 0 }, integrity: 10, unitHealth: 10, stack: 1 },
    { id: "enemy", side: "right", kind: "squadron", position: { q: 1, r: 0 }, integrity: 10, unitHealth: 10, stack: 1 }
  ] });
  refreshInterception(state);
  applyDamagePacket(state, "s", { amount: 20, sourceId: "enemy" });
  assert.deepEqual(state.events.map(event => event.action), ["interception-link-created", "damage-packet", "squadron-craft-lost", "unit-destroyed", "debris-created", "interception-link-removed", "victory"]);
  assert.deepEqual(state.units[0].engagedWith, []);
  assert.equal(state.contents[0].cover, "debris");
});

test("damage crosses layers and destruction creates debris and victory", () => {
  const state = deployedBattle();
  const target = state.units.find(unit => unit.id === "r-cap");
  target.shield = 3;
  target.armor = 2;
  target.integrity = 4;
  const result = applyDamagePacket(state, target, { amount: 9, sourceId: "l-cap" });
  assert.equal(result.amount, 9);
  assert.equal(state.lifecycle, "Finished");
  assert.equal(state.winner, "left");
  assert.ok(state.contents.some(item => item.kind === "debris"));
  assert.ok(state.events.some(event => event.action === "unit-destroyed"));
});

test("interception graph blocks engaged squadron movement and disengage clears links", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "squadron", position: { q: 1, r: 0 }, stack: 2, speed: 1 },
    { id: "b", side: "right", kind: "squadron", position: { q: 2, r: 0 }, stack: 1 }
  ] });
  state.lifecycle = "Maneuver";
  state.activeUnitId = "a";
  refreshInterception(state);
  assert.deepEqual(state.units[0].engagedWith, ["b"]);
  assert.equal(moveAtomic(state, "a", [{ q: 0, r: 0 }]).moved, 0);
  assert.equal(disengage(state, "a", { random: () => 0 }).success, true);
  assert.deepEqual(state.units[0].engagedWith, []);
});

test("failed disengagement spends speed, preserves links, ends maneuver, and preserves attack", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "squadron", position: { q: 1, r: 0 }, stack: 2, speed: 3 },
    { id: "b", side: "right", kind: "squadron", position: { q: 2, r: 0 }, stack: 1 },
    { id: "target", side: "right", kind: "capital", position: { q: 3, r: 0 }, integrity: 5 }
  ] });
  state.lifecycle = "Maneuver";
  state.activationStage = "Maneuver";
  state.activeUnitId = "a";
  refreshInterception(state);
  const eventCount = state.events.length;
  const result = disengage(state, "a", { random: () => 0.6 });
  assert.deepEqual(result, { success: false, chance: 60, cost: 1 });
  assert.equal(state.units[0].currentSpeed, 2);
  assert.equal(state.units[0].speed, 3);
  assert.equal(state.units[0].evasion, 0);
  assert.deepEqual(state.units[0].engagedWith, ["b"]);
  assert.deepEqual(state.units[1].engagedWith, ["a"]);
  assert.equal(state.lifecycle, "Attack");
  assert.deepEqual(state.events.find(event => event.action === "disengagement-check").random, { roll: 60, chance: 60 });
  assert.equal(moveAtomic(state, "a", [{ q: 0, r: 0 }]).moved, 0);
  assert.equal(resolveAttack(state, "a", "target", { arc: "360", maxRange: 3, accuracy: 100, damage: 2 }, { random: () => 0 }).damage, 4);
  assert.deepEqual(state.events.slice(eventCount).map(event => event.action), ["disengagement-declared", "disengagement-paid", "evasion-modifier-applied", "disengagement-check", "disengagement-failed", "activation-stage", "attack-shot", "damage-packet", "attack-shot", "damage-packet"]);
});

test("interception is symmetric many-to-many with bomber asymmetry and no allied links", () => {
  const state = createBattle({ units: [
    { id: "fighter", side: "left", kind: "squadron", role: "fighter", position: { q: 0, r: 0 } },
    { id: "ally", side: "left", kind: "squadron", role: "fighter", position: { q: 0, r: 1 } },
    { id: "bomber", side: "right", kind: "squadron", role: "bomber", position: { q: 1, r: 0 } },
    { id: "enemy", side: "right", kind: "squadron", role: "fighter", position: { q: 1, r: -1 } }
  ] });
  refreshInterception(state);
  assert.deepEqual(state.units.map(unit => [unit.id, unit.engagedWith]), [
    ["fighter", ["bomber", "enemy"]], ["ally", ["bomber"]], ["bomber", ["ally", "fighter"]], ["enemy", ["fighter"]]
  ]);
  assert.equal(state.interceptionLinks.some(link => link.unitIds.includes("fighter") && link.unitIds.includes("ally")), false);
  const bomberLink = state.interceptionLinks.find(link => link.unitIds.includes("fighter") && link.unitIds.includes("bomber"));
  assert.deepEqual(bomberLink.creators, ["fighter"]);
});

test("disengagement modifiers clamp and tie-break deterministically", () => {
  const units = [
    { id: "a", side: "left", kind: "squadron", position: { q: 0, r: 0 }, speed: 4 },
    { id: "ally", side: "left", kind: "squadron", position: { q: -2, r: 0 } },
    { id: "b", side: "right", kind: "squadron", position: { q: 1, r: 0 }, stack: 3, initiative: 1 },
    { id: "c", side: "right", kind: "squadron", position: { q: 1, r: -1 }, stack: 3, initiative: 2 }
  ];
  const state = createBattle({ units });
  refreshInterception(state);
  assert.deepEqual(previewDisengagement(state, "a"), { eligible: true, chance: 30, cost: 2, closestId: "c", craftPenalty: 20, enemyPenalty: 10, friendlyBonus: 0 });
  state.units.find(unit => unit.id === "ally").position = { q: 0, r: 1 };
  refreshInterception(state);
  assert.equal(previewDisengagement(state, "a").friendlyBonus, 10);
  state.units.find(unit => unit.id === "b").stack = 20;
  assert.equal(previewDisengagement(state, "a").chance, 10);
  state.units.find(unit => unit.id === "b").stack = 1;
  state.units.find(unit => unit.id === "c").position = { q: 5, r: 5 };
  state.units.push(...Array.from({ length: 4 }, (_, index) => ({ id: `ally-${index}`, side: "left", kind: "squadron", position: { q: 0, r: 1 } })));
  refreshInterception(state);
  assert.equal(previewDisengagement(state, "a").chance, 90);
});

test("successful disengagement records order, preserves escape, and clears activation penalty", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "squadron", position: { q: 0, r: 0 }, speed: 3, evasion: 40 },
    { id: "b", side: "right", kind: "squadron", position: { q: 1, r: 0 }, stack: 1 }
  ] });
  state.lifecycle = "Maneuver"; state.activationStage = "Maneuver"; state.activeUnitId = "a";
  refreshInterception(state);
  const start = state.events.length;
  assert.equal(disengage(state, "a", { random: () => 0.59 }).success, true);
  assert.equal(moveAtomic(state, "a", [{ q: -1, r: 0 }]).status, "moved");
  assert.deepEqual(state.events.slice(start, start + 6).map(event => event.action), ["disengagement-declared", "disengagement-paid", "evasion-modifier-applied", "disengagement-check", "disengagement-succeeded", "interception-link-removed"]);
  assert.equal(state.units[0].evasion, 30);
  state.lifecycle = "EndActivation";
  progress(state);
  assert.equal(state.units[0].evasion, 40);
  assert.equal(Object.hasOwn(state.units[0], "disengagementEvasion"), false);
});

test("disengagement is unavailable without full Speed payment", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "squadron", position: { q: 1, r: 0 }, stack: 2, speed: 1 },
    { id: "b", side: "right", kind: "squadron", position: { q: 2, r: 0 }, stack: 1 },
    { id: "c", side: "right", kind: "squadron", position: { q: 1, r: 1 }, stack: 1 }
  ] });
  state.lifecycle = "Maneuver";
  state.activeUnitId = "a";
  refreshInterception(state);
  const snapshot = structuredClone(state);
  let rolls = 0;
  assert.deepEqual(disengage(state, "a", { random: () => { rolls += 1; return 0; } }), { success: false, chance: 0, cost: 2 });
  assert.equal(rolls, 0);
  assert.deepEqual(state, snapshot);
});

test("attack preview applies every endpoint cover modifier and ignores intermediate terrain", () => {
  for (const [cover, penalty] of [[null, 0], ["nebula", 15], ["debris", 10], ["asteroid", 20]]) {
    const contents = [{ kind: "terrain", cover: "asteroid", position: { q: 1, r: 0 } }];
    if (cover) contents.push({ kind: "terrain", cover, position: { q: 3, r: 0 } });
    const state = createBattle({ units: [
      { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, heading: 2 },
      { id: "b", side: "right", kind: "capital", position: { q: 3, r: 0 } }
    ], contents });
    const result = previewAttack(state, "a", "b", { accuracy: 80, arc: "linear", minRange: 3, maxRange: 5 });
    assert.equal(result.canAttack, true);
    assert.equal(result.cover, penalty);
    assert.equal(result.accuracy, 80 - penalty);
  }
});

test("endpoint cover clamps accuracy and is shared by attacks and overwatch", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, weapons: [{ id: "aa", accuracy: 10, damage: 2, arc: "360", maxRange: 3, overwatchEligible: true, overwatch: true, overwatchRound: 1 }] },
    { id: "b", side: "right", kind: "squadron", position: { q: 1, r: 0 }, integrity: 5, unitHealth: 5, stack: 1 }
  ], contents: [{ kind: "terrain", cover: "asteroid", position: { q: 1, r: 0 } }] });
  state.round = 1;
  assert.equal(previewAttack(state, "a", "b", state.units[0].weapons[0]).accuracy, 0);
  assert.equal(resolveAttack(state, "a", "b", state.units[0].weapons[0], { random: () => 0 }).damage, 0);
  state.units[0].weapons[0].ready = true;
  assert.equal(resolveOverwatch(state, "b", { random: () => 0 })[0].damage, 0);
  assert.equal(state.units[1].integrity, 5);
});

test("generated debris provides endpoint cover", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, integrity: 10 },
    { id: "wreck", side: "right", kind: "capital", position: { q: 2, r: 0 }, integrity: 1 },
    { id: "b", side: "right", kind: "capital", position: { q: 3, r: 0 }, integrity: 10 }
  ] });
  applyDamagePacket(state, "wreck", { amount: 1, sourceId: "a" });
  state.units.find(unit => unit.id === "b").position = { q: 2, r: 0 };
  assert.equal(previewAttack(state, "a", "b", { accuracy: 80, arc: "360", maxRange: 3 }).cover, 10);
});

test("endpoint cover preserves blocker selection and friendly-fire classification", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 } },
    { id: "blocker", side: "left", kind: "capital", size: "medium", position: { q: 1, r: 0 }, integrity: 5 },
    { id: "b", side: "right", kind: "capital", position: { q: 3, r: 0 }, integrity: 5 }
  ], contents: [{ kind: "terrain", cover: "nebula", position: { q: 3, r: 0 } }] });
  const preview = previewAttack(state, "a", "b", { accuracy: 80, arc: "360", maxRange: 3 });
  assert.equal(preview.blockerId, "blocker");
  assert.equal(preview.friendlyFire, true);
  assert.deepEqual({ hitBlocker: preview.hitBlocker, hitMain: preview.hitMain, miss: preview.miss }, { hitBlocker: 50, hitMain: 15, miss: 35 });
});

test("supercover includes both hexes touched along a shared boundary", () => {
  assert.deepEqual(supercoverLine({ q: 0, r: 0 }, { q: 2, r: -1 }), [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 2, r: -1 }
  ]);
});

test("friendly and enemy blockers use the same deterministic hit distribution", () => {
  for (const side of ["left", "right"]) {
    const state = createBattle({ units: [
      { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, integrity: 10 },
      { id: "blocker", side, kind: "capital", size: "medium", position: { q: 1, r: 0 }, integrity: 10 },
      { id: "b", side: "right", kind: "capital", position: { q: 3, r: 0 }, integrity: 10 }
    ] });
    const preview = previewAttack(state, "a", "b", { accuracy: 80, damage: 3, arc: "360", maxRange: 3 });
    assert.deepEqual({ hitBlocker: preview.hitBlocker, hitMain: preview.hitMain, miss: preview.miss, friendlyFire: preview.friendlyFire }, { hitBlocker: 50, hitMain: 30, miss: 20, friendlyFire: side === "left" });
    const result = resolveAttack(state, "a", "b", { accuracy: 80, damage: 3, arc: "360", maxRange: 3 }, { random: () => 0.49 });
    assert.equal(result.damage, 3);
    assert.equal(state.units.find(unit => unit.id === "blocker").integrity, 7);
    assert.equal(state.units.find(unit => unit.id === "b").integrity, 10);
    assert.equal(state.events.at(-1).cause, side === "left" ? "friendly-fire" : "attack");
  }
});

test("supercover finds a blocker in either boundary hex and ignores squadrons", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 } },
    { id: "squad", side: "left", kind: "squadron", size: "large", position: { q: 1, r: -1 }, integrity: 5 },
    { id: "blocker", side: "left", kind: "capital", size: "medium", position: { q: 1, r: 0 }, integrity: 5 },
    { id: "b", side: "right", kind: "capital", position: { q: 2, r: -1 }, integrity: 5 }
  ] });
  assert.equal(previewAttack(state, "a", "b", { arc: "360" }).blockerId, "blocker");
});

test("nearest blocker and boundary tie-break are independent of insertion order", () => {
  for (const blockers of [
    [
      { id: "z-boundary", side: "left", kind: "capital", size: "medium", position: { q: 1, r: 0 }, integrity: 5 },
      { id: "a-boundary", side: "left", kind: "capital", size: "medium", position: { q: 1, r: -1 }, integrity: 5 },
      { id: "near", side: "left", kind: "capital", size: "medium", position: { q: 2, r: -1 }, integrity: 5 }
    ],
    [
      { id: "near", side: "left", kind: "capital", size: "medium", position: { q: 2, r: -1 }, integrity: 5 },
      { id: "a-boundary", side: "left", kind: "capital", size: "medium", position: { q: 1, r: -1 }, integrity: 5 },
      { id: "z-boundary", side: "left", kind: "capital", size: "medium", position: { q: 1, r: 0 }, integrity: 5 }
    ]
  ]) {
    const state = createBattle({ units: [
      { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 } },
      ...blockers,
      { id: "b", side: "right", kind: "capital", position: { q: 4, r: -2 } }
    ] });
    assert.equal(previewAttack(state, "a", "b", { arc: "360", maxRange: 5 }).blockerId, "a-boundary");
  }
});

test("small objects do not block fire", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 } },
    { id: "blocker", side: "left", kind: "capital", size: "medium", position: { q: 2, r: 0 }, integrity: 5 },
    { id: "b", side: "right", kind: "capital", position: { q: 3, r: 0 } }
  ], contents: [{ id: "small", kind: "object", size: "small", position: { q: 1, r: 0 }, integrity: 5 }] });
  assert.equal(previewAttack(state, "a", "b", { arc: "360", maxRange: 3 }).blockerId, "blocker");
});

test("a destroyed blocker is removed before the next salvo shot", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, integrity: 10 },
    { id: "blocker", side: "left", kind: "capital", size: "medium", position: { q: 1, r: 0 }, integrity: 2 },
    { id: "b", side: "right", kind: "capital", position: { q: 3, r: 0 }, integrity: 10 }
  ] });
  const rolls = [0.1, 0.6];
  resolveAttack(state, "a", "b", { accuracy: 80, shots: 2, damage: 2, arc: "360", maxRange: 3 }, { random: () => rolls.shift() });
  assert.equal(state.units.some(unit => unit.id === "blocker"), false);
  assert.equal(state.units.find(unit => unit.id === "b").integrity, 8);
  assert.deepEqual(state.events.slice(-6).map(event => event.action), ["attack-shot", "damage-packet", "unit-destroyed", "debris-created", "attack-shot", "damage-packet"]);
});

test("a large battlefield object fully obscures the target but remains hittable", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, integrity: 10 },
    { id: "b", side: "right", kind: "capital", position: { q: 3, r: 0 }, integrity: 10 }
  ], contents: [{ id: "station", side: "neutral", kind: "object", size: "large", position: { q: 1, r: 0 }, integrity: 5 }] });
  const preview = previewAttack(state, "a", "b", { accuracy: 80, damage: 2, arc: "360", maxRange: 3 });
  assert.equal(preview.hitMain, 0);
  assert.equal(preview.canAttack, true);
  resolveAttack(state, "a", "b", { accuracy: 80, damage: 2, arc: "360", maxRange: 3 }, { random: () => 0.79 });
  assert.equal(state.contents.find(item => item.id === "station").integrity, 3);
  assert.equal(state.units.find(unit => unit.id === "b").integrity, 10);
});

test("an attack outside the weapon line of fire is rejected without rolling or damage", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, heading: 2 },
    { id: "b", side: "right", kind: "capital", position: { q: 0, r: 3 }, integrity: 5 }
  ] });
  let rolls = 0;
  const eventCount = state.events.length;
  const weapon = { accuracy: 100, damage: 3, arc: "linear", minRange: 3, maxRange: 5 };
  assert.equal(previewAttack(state, "a", "b", weapon).canAttack, false);
  assert.equal(resolveAttack(state, "a", "b", weapon, { random: () => { rolls += 1; return 0; } }).damage, 0);
  assert.equal(rolls, 0);
  assert.equal(state.units[1].integrity, 5);
  assert.equal(state.events.length, eventCount);
});

test("weapon arcs cover their complete heading-relative geometry", () => {
  const source = { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 } };
  const cases = [
    { heading: 2, arc: "turret", target: { q: -2, r: 0 }, expected: true },
    { heading: 2, arc: "battery-left", target: { q: 1, r: -2 }, expected: true },
    { heading: 2, arc: "battery-left", target: { q: 1, r: 1 }, expected: false },
    { heading: 2, arc: "battery-right", target: { q: 1, r: 1 }, expected: true },
    { heading: 2, arc: "battery-right", target: { q: 1, r: -2 }, expected: false },
    { heading: 2, arc: "linear", target: { q: 3, r: 0 }, expected: true },
    { heading: 2, arc: "linear", target: { q: 2, r: 0 }, expected: false },
    { heading: 2, arc: "linear", target: { q: 6, r: 0 }, expected: false },
    { heading: 4, arc: "linear", target: { q: 0, r: -4 }, expected: true },
    { heading: 2, arc: "forward", target: { q: 2, r: -1 }, expected: true },
    { heading: 2, arc: "forward", target: { q: -2, r: 0 }, expected: false },
    { heading: 5, arc: "forward", target: { q: -2, r: 1 }, expected: true },
    { heading: 5, arc: "forward", target: { q: -4, r: 2 }, expected: false }
  ];
  for (const entry of cases) {
    const state = createBattle({ units: [{ ...source, heading: entry.heading }, { id: "b", side: "right", kind: "capital", position: entry.target }] });
    assert.equal(previewAttack(state, "a", "b", { arc: entry.arc }).canAttack, entry.expected, JSON.stringify(entry));
  }
  for (let heading = 0; heading < 6; heading += 1) {
    const direction = [{ q: -1, r: 1 }, { q: 0, r: 1 }, { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }][heading];
    for (const range of [3, 4, 5]) {
      const target = { q: direction.q * range, r: direction.r * range };
      const state = createBattle({ units: [{ ...source, heading }, { id: "b", side: "right", kind: "capital", position: target }] });
      assert.equal(previewAttack(state, "a", "b", { arc: "linear" }).canAttack, true, `heading ${heading}, range ${range}`);
    }
  }
});

test("ramming applies mass damage and resets attacker evasion", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, mass: 3, evasion: 12, integrity: 10 },
    { id: "b", side: "right", kind: "capital", position: { q: 2, r: 0 }, mass: 2, integrity: 10 }
  ] });
  const result = ram(state, "a", "b", [{ q: 1, r: 0 }]);
  assert.equal(result.success, true);
  assert.equal(state.units.find(unit => unit.id === "a").evasion, 0);
  assert.equal(state.units.find(unit => unit.id === "b").integrity, 4);
  assert.ok(state.events.some(event => event.action === "ramming"));
});

test("successful ramming consumes attack only for the current round", () => {
  const state = createBattle({ units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, mass: 2, integrity: 20 },
    { id: "b", side: "right", kind: "capital", position: { q: 2, r: 0 }, mass: 1, integrity: 20 }
  ] });
  state.round = 1;
  state.lifecycle = "Maneuver";
  state.activeUnitId = "a";
  assert.equal(ram(state, "a", "b", [{ q: 1, r: 0 }]).success, true);
  state.lifecycle = "Attack";
  let rolls = 0;
  const eventCount = state.events.length;
  assert.equal(previewAttack(state, "a", "b", { arc: "360" }).canAttack, false);
  assert.equal(resolveAttack(state, "a", "b", { arc: "360", accuracy: 100, damage: 2 }, { random: () => { rolls += 1; return 0; } }).damage, 0);
  assert.equal(rolls, 0);
  assert.equal(state.events.length, eventCount);
  state.lifecycle = "RoundEnd";
  progress(state);
  progress(state);
  assert.equal(resolveAttack(state, "a", "b", { arc: "360", accuracy: 100, damage: 2 }, { random: () => 0 }).damage, 2);
});

test("explicit ramming can enter an enemy capital hex", () => {
  const state = createBattle({ bounds: { minCol: 0, maxCol: 2, minRow: 0, maxRow: 0 }, units: [
    { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, mass: 3, integrity: 10 },
    { id: "b", side: "right", kind: "capital", position: { q: 2, r: 0 }, mass: 1, integrity: 10 }
  ] });
  assert.equal(ram(state, "a", "b", [{ q: 1, r: 0 }]).success, true);
});

test("ramming destroys a large object through the damage lifecycle", () => {
  const state = createBattle({
    units: [{ id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, mass: 3, integrity: 10 }],
    contents: [{ id: "station", side: "neutral", kind: "object", size: "large", position: { q: 2, r: 0 }, mass: 2, integrity: 5 }]
  });
  state.lifecycle = "Maneuver";
  state.activeUnitId = "a";
  const result = ram(state, "a", "station", [{ q: 1, r: 0 }]);
  assert.deepEqual(result, { success: true, damage: 5, targetDestroyed: true });
  assert.equal(state.contents.some(item => item.id === "station"), false);
  assert.ok(state.contents.some(item => item.kind === "debris" && item.position.q === 2));
  assert.deepEqual(state.events.slice(-5).map(event => event.action), ["damage-packet", "object-destroyed", "debris-created", "damage-packet", "ramming"]);
});

test("ramming rejects ineligible actors and targets without side effects", () => {
  const cases = [
    [
      { id: "a", side: "left", kind: "squadron", position: { q: 0, r: 0 }, integrity: 5 },
      { id: "b", side: "right", kind: "capital", position: { q: 2, r: 0 }, integrity: 5 }
    ],
    [
      { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, integrity: 5 },
      { id: "b", side: "left", kind: "capital", position: { q: 2, r: 0 }, integrity: 5 }
    ],
    [
      { id: "a", side: "left", kind: "capital", position: { q: 0, r: 0 }, integrity: 5 },
      { id: "b", side: "right", kind: "object", size: "small", position: { q: 2, r: 0 }, integrity: 5 }
    ]
  ];
  for (const units of cases) {
    const state = createBattle({ units });
    state.lifecycle = "Maneuver";
    state.activeUnitId = "a";
    const snapshot = structuredClone(state);
    assert.deepEqual(ram(state, "a", "b", [{ q: 1, r: 0 }]), { success: false, damage: 0 });
    assert.deepEqual(state, snapshot);
  }
});

test("movement refreshes interception and stops after lethal overwatch", () => {
  const state = createBattle({ id: "movement-reaction", round: 1, units: [
    { id: "cap", side: "left", kind: "capital", position: { q: 0, r: 0 }, weapons: [{ id: "aa", ready: true, ammo: 1, maxRange: 3, damage: 5, accuracy: 100, overwatchEligible: true }] },
    { id: "squad", side: "right", kind: "squadron", position: { q: 3, r: 0 }, integrity: 5, interceptRange: 1, speed: 3 }
  ] });
  state.lifecycle = "Maneuver";
  refreshInterception(state);
  state.round = 1;
  state.activeUnitId = "squad";
  state.units[0].weapons[0].overwatch = true;
  state.units[0].weapons[0].overwatchRound = 1;
  const result = moveAtomic(state, "squad", [{ q: 2, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 0 }], { });
  assert.equal(result.moved, 1);
  assert.equal(state.units.some(unit => unit.id === "squad"), false);
  assert.equal(state.events.filter(event => event.action === "movement-step").length, 1);
});

test("an AA slot cannot trigger again against the same squadron in one round", () => {
  const state = createBattle({ id: "aa", round: 1, units: [
    { id: "cap", side: "left", kind: "capital", initiative: 5, position: { q: 0, r: 0 }, weapons: [{ id: "aa", ready: true, ammo: 2, maxRange: 3, damage: 3, accuracy: 0, overwatchEligible: true }] },
    { id: "squad", side: "right", kind: "squadron", position: { q: 2, r: 0 }, integrity: 5 }
  ] });
  state.lifecycle = "EndActivation"; state.activeUnitId = "cap"; progress(state);
  assert.equal(state.units[0].weapons[0].overwatch, true);
  const first = resolveOverwatch(state, "squad", { random: () => 0.1 });
  assert.equal(first[0].damage, 0);
  const slot = state.units[0].weapons[0];
  assert.equal(slot.ready, false);
  assert.equal(slot.overwatch, false);
  assert.deepEqual(slot.overwatchTargets, ["squad"]);
  assert.deepEqual(state.events.slice(-3).map(event => event.action), ["overwatch-declared", "overwatch-shot", "attack-shot"]);
  assert.deepEqual(state.events.at(-1).random, { roll: 10, hitBlocker: 0, hitMain: 0, miss: 100 });
  const counts = Object.fromEntries(["overwatch-declared", "overwatch-shot", "attack-shot", "damage-packet"].map(action => [action, state.events.filter(event => event.action === action).length]));
  slot.ready = true;
  slot.overwatch = true;
  assert.deepEqual(resolveOverwatch(state, "squad", { random: () => 0 }), []);
  for (const [action, count] of Object.entries(counts)) assert.equal(state.events.filter(event => event.action === action).length, count);
});

test("AA reactions follow initiative and stable numeric slot order", () => {
  const slots = Array.from({ length: 11 }, (_, index) => ({ id: `aa-${index}`, ready: true, ammo: 1, maxRange: 3, damage: 1, accuracy: 0, overwatchEligible: true, overwatch: true, overwatchRound: 1 }));
  const state = createBattle({ id: "aa-order", round: 1, units: [
    { id: "slow", side: "left", kind: "capital", initiative: 1, position: { q: 0, r: 1 }, weapons: [{ id: "slow-aa", ready: true, ammo: 1, maxRange: 3, damage: 1, accuracy: 0, overwatchEligible: true, overwatch: true, overwatchRound: 1 }] },
    { id: "fast", side: "left", kind: "capital", initiative: 5, position: { q: 0, r: 0 }, weapons: slots },
    { id: "squad", side: "right", kind: "squadron", position: { q: 2, r: 0 }, integrity: 5 }
  ] });
  state.round = 1;
  const results = resolveOverwatch(state, "squad", { random: () => 1 });
  assert.deepEqual(results.map(result => result.slotId), [...slots.map(slot => `fast:${slot.id}`), "slow:slow-aa"]);
  assert.deepEqual(state.events.filter(event => event.action === "overwatch-shot").map(event => event.slotId), [...slots.map(slot => `fast:${slot.id}`), "slow:slow-aa"]);
  const attacks = state.events.filter(event => event.action === "attack-shot");
  assert.equal(attacks.length, 12);
  assert.ok(attacks.every(event => event.after.hitId === null && event.causeEventId));
});

test("lethal AA cancels remaining queued reactions without spending their readiness", () => {
  let randomCalls = 0;
  const state = createBattle({ id: "aa-lethal", round: 1, units: [
    { id: "first", side: "left", kind: "capital", initiative: 5, position: { q: 0, r: 0 }, weapons: [{ id: "lethal", ready: true, ammo: 1, maxRange: 3, damage: 5, accuracy: 100, overwatchEligible: true, overwatch: true, overwatchRound: 1 }] },
    { id: "later", side: "left", kind: "capital", initiative: 1, position: { q: 0, r: 1 }, weapons: [{ id: "unused", ready: true, ammo: 1, maxRange: 3, damage: 5, accuracy: 100, overwatchEligible: true, overwatch: true, overwatchRound: 1 }] },
    { id: "squad", side: "right", kind: "squadron", position: { q: 2, r: 0 }, integrity: 5 }
  ] });
  state.round = 1;
  const results = resolveOverwatch(state, "squad", { random: () => { randomCalls += 1; return 0; } });
  assert.equal(results.length, 1);
  assert.equal(randomCalls, 1);
  assert.equal(state.units.some(unit => unit.id === "squad"), false);
  const later = state.units.find(unit => unit.id === "later").weapons[0];
  assert.equal(later.ready, true);
  assert.equal(later.overwatch, true);
  assert.equal(state.events.some(event => event.action === "overwatch-declared" && event.actorId === "later"), false);
});

test("RoundEnd clears overwatch and RoundStart restores readiness for a new-round reaction", () => {
  const state = createBattle({ id: "aa-reset", round: 1, units: [
    { id: "cap", side: "left", kind: "capital", initiative: 5, position: { q: 0, r: 0 }, weapons: [{ id: "aa", ready: false, ammo: 2, maxRange: 3, damage: 1, accuracy: 0, overwatchEligible: true, overwatch: true, overwatchRound: 1, overwatchTargets: ["squad"] }] },
    { id: "squad", side: "right", kind: "squadron", position: { q: 2, r: 0 }, integrity: 5 }
  ] });
  state.round = 1;
  state.lifecycle = "RoundEnd";
  assert.equal(progress(state), "RoundStart");
  const slot = state.units[0].weapons[0];
  assert.equal(slot.overwatch, false);
  assert.deepEqual(slot.overwatchTargets, []);
  assert.equal(progress(state), "WaitDecision");
  assert.equal(state.round, 2);
  assert.equal(slot.ready, true);
  assert.equal(slot.ammo, 2);
  state.lifecycle = "EndActivation";
  state.activeUnitId = "cap";
  progress(state);
  assert.equal(slot.overwatch, true);
  const result = resolveOverwatch(state, "squad", { random: () => 1 });
  assert.equal(result.length, 1);
  assert.equal(state.events.at(-1).round, 2);
});

test("memory store persists and notifies domain snapshots", async () => {
  const { createMemoryPersistence, createBattleStore } = await import("./v1-store.js");
  const persistence = createMemoryPersistence();
  const store = createBattleStore({ persistence, initial: { id: "stored", bounds, units } });
  let notifications = 0;
  store.subscribe(() => { notifications += 1; });
  store.transact(state => { state.round = 7; return state.round; });
  assert.equal(store.getState().round, 7);
  assert.equal(notifications, 1);
  assert.equal(persistence.load().round, 7);
});
