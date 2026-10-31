import assert from "node:assert/strict";
import test from "node:test";
import { applyAttackStep, confirmWeaponAttack, resolvePostEntryAA } from "./battle.js";
import * as domain from "./domain.js";
import { buildManeuverOptions } from "./ui-rules.js";

function weapon(overrides = {}) {
  return {
    id: "weapon",
    weaponId: "weapon-catalog",
    slotOrder: 0,
    name: "Weapon",
    mount: "turret",
    orientation: null,
    weaponClass: "kinetic",
    delivery: "projectile",
    targetKinds: ["capital", "squadron"],
    accuracy: 50,
    effectiveRange: 4,
    maxRange: 4,
    shots: 1,
    damage: 1,
    critChance: 0,
    energyCost: 0,
    cooldownRounds: 0,
    firedThisRound: false,
    cooldownRemaining: 0,
    overwatch: false,
    visual: { projectile: "tracer", color: "#fff", size: 0.1, speedHexesPerSecond: 5, launchIntervalMs: 0, trail: "short", impact: "spark", impactRadius: 0.1 },
    ...overrides
  };
}

function unit(overrides = {}) {
  return {
    id: "mover",
    name: "Mover",
    sideId: "azure",
    kind: "squadron",
    position: { q: 0, r: 0 },
    heading: 0,
    currentSpeed: 5,
    maneuver: 0,
    initiative: 5,
    speedSpent: 0,
    speedRemaining: 5,
    maneuverSpent: 0,
    maneuverRemaining: 0,
    movementEvasion: 0,
    baseEvasion: 0,
    evasiveManeuver: false,
    evasionLocked: false,
    canWait: true,
    hasActivated: false,
    hasWaited: false,
    activationStartedThisRound: true,
    shield: 0,
    armor: 0,
    integrity: 20,
    maxIntegrity: 20,
    stack: 4,
    unitHealth: 5,
    criticals: [],
    engagedWith: [],
    reactor: null,
    weapons: [weapon()],
    ...overrides
  };
}

function battle(units, contents = []) {
  return {
    scenario: { id: "stage-zero", bounds: { minCol: -5, maxCol: 6, minRow: 0, maxRow: 0 }, contents },
    units,
    activeUnitId: units[0].id,
    roundNumber: 1,
    lifecycle: "SystemActions",
    stage: "system",
    log: [],
    events: [],
    sequence: 0,
    initiativeOrder: units.map(candidate => candidate.id),
    winner: null,
    rng: () => 0
  };
}

function optionFor(state, destination, heading) {
  const mover = domain.activeUnit(state);
  const routes = domain.planRoutes(state, mover, "risky");
  const route = heading === undefined ? routes.get(destination) : routes.get(`${destination}:${heading}`);
  assert.ok(route, `expected route to ${destination}`);
  return buildManeuverOptions(mover, route)[0];
}

function snapshot(state) {
  return structuredClone({ ...state, rng: null });
}

test("Stage 0 battle seam executes movement stepwise through hazards, AA, interception, and the weapon attack block", () => {
  const mover = unit();
  const passThroughCapital = unit({ id: "capital", name: "Capital", sideId: "crimson", kind: "capital", position: { q: 2, r: 0 }, heading: 3, currentSpeed: 2, speedRemaining: 2, maneuver: 1, maneuverRemaining: 1, stack: 1, unitHealth: null, weapons: [weapon({ id: "aa", name: "AA", targetKinds: ["squadron"], overwatch: true })] });
  const interceptor = unit({ id: "interceptor", name: "Interceptor", sideId: "crimson", position: { q: 4, r: 2 }, weapons: [] });
  const asteroid = { id: "asteroid", kind: "terrain", type: "asteroidField", label: "Asteroid Field", position: { q: 2, r: 0 }, hazard: { probability: 1, min: 99, max: 99, effect: "ignored for squadrons" } };
  const mine = { id: "mine", kind: "hazard", type: "minefield", label: "Minefield", position: { q: 2, r: 0 }, hazard: { probability: 1, min: 3, max: 3, effect: "integrity damage" } };
  const state = battle([mover, passThroughCapital, interceptor], [asteroid, mine]);
  const beforePreview = snapshot(state);

  const routes = domain.planRoutes(state, mover, "risky");
  const route = routes.get("4,0");
  assert.ok(route);
  assert.equal(route.movementCost, 5);
  assert.deepEqual(route.consequences.map(consequence => consequence.sourceId), ["mine"]);
  const option = buildManeuverOptions(mover, route, null, domain.signedTurn)[0];
  let preview = option;
  preview = null;
  assert.equal(preview, null);
  assert.deepEqual(snapshot(state), beforePreview);

  const plan = domain.planManeuver(state, option);
  assert.ok(plan);
  interceptor.position = { q: 3, r: 1 };
  const positions = [];
  let result;
  for (let elementIndex = 0; elementIndex < plan.elements.length; elementIndex++) {
    result = domain.executeManeuverElement(state, plan, elementIndex, {
      resolvePostEntry({ state: current, unit: entered, plan: currentPlan, elementIndex: currentIndex, causeEventId }) {
        return resolvePostEntryAA(current, entered, { planId: currentPlan.id, elementIndex: currentIndex, causeEventId }, () => 100, () => 0);
      }
    });
    positions.push({ ...mover.position });
    if (result.status !== "executed") break;
  }

  assert.deepEqual(positions, [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }]);
  assert.equal(result.status, "stopped");
  assert.equal(result.reason, "interception");
  assert.equal(state.stage, "attack");
  assert.equal(mover.speedSpent, 4);
  assert.equal(mover.integrity, 17);
  assert.deepEqual(mover.engagedWith, ["interceptor"]);
  assert.deepEqual(interceptor.engagedWith, ["mover"]);
  assert.equal(passThroughCapital.weapons[0].firedThisRound, true);
  assert.deepEqual(state.scenario.contents.map(content => content.id), ["asteroid", "mine"]);

  const attackPlan = confirmWeaponAttack(state, mover.id, mover.weapons[0].id, passThroughCapital.id, () => 100, () => 0);
  assert.ok(attackPlan);
  assert.equal(applyAttackStep(state, attackPlan, 0).status, "applied");

  const maneuverEvents = state.events.filter(event => event.planId === plan.id);
  assert.ok(maneuverEvents.length > 0);
  assert.equal(maneuverEvents.every(event => Number.isInteger(event.elementIndex)), true);
  const aaDeclaration = maneuverEvents.find(event => event.action === "aa-reaction-declare");
  const firstMove = maneuverEvents.find(event => event.action === "maneuver-move" && event.elementIndex === 0);
  assert.equal(aaDeclaration.causeEventId, firstMove.eventId);
  const hazardCheck = maneuverEvents.find(event => event.action === "hazard-check");
  const hazardDamage = maneuverEvents.find(event => event.action === "damage" && event.cause === "hazard:mine");
  assert.equal(hazardDamage.causeEventId, hazardCheck.eventId);
  const interception = maneuverEvents.find(event => event.action === "interception-create");
  const interceptionMove = maneuverEvents.find(event => event.action === "maneuver-move" && event.elementIndex === 2);
  assert.equal(interception.causeEventId, interceptionMove.eventId);
  assert.equal("applyMovement" in domain, false);
  assert.equal("applyMovementStep" in domain, false);
});

test("hazard destruction completes the active action and advances valid initiative", () => {
  const mover = unit({ currentSpeed: 1, speedRemaining: 1, integrity: 3, stack: 1 });
  const ally = unit({ id: "ally", position: { q: -2, r: 0 }, weapons: [], activationStartedThisRound: false });
  const enemy = unit({ id: "enemy", sideId: "crimson", position: { q: 4, r: 0 }, weapons: [], activationStartedThisRound: false });
  const mine = { id: "mine", kind: "hazard", type: "minefield", label: "Minefield", position: { q: 1, r: 0 }, hazard: { probability: 1, min: 3, max: 3, effect: "integrity damage" } };
  const state = battle([mover, ally, enemy], [mine]);
  const plan = domain.planManeuver(state, optionFor(state, "1,0"));

  const result = domain.executeManeuverElement(state, plan, 0);

  assert.equal(result.status, "destroyed");
  assert.equal(state.winner, null);
  assert.equal(state.activeUnitId, ally.id);
  assert.equal(domain.activeUnit(state), ally);
  assert.deepEqual(state.initiativeOrder, [ally.id, enemy.id]);
  assert.equal(state.lifecycle, "SystemActions");
  assert.equal(state.stage, "system");
  assert.deepEqual(result.destruction.debris.position, { q: 1, r: 0 });
});

test("AA destruction completes the action with a valid victory state and causal chain", () => {
  const mover = unit({ currentSpeed: 1, speedRemaining: 1, integrity: 1, stack: 1 });
  const owner = unit({ id: "owner", sideId: "crimson", kind: "capital", position: { q: 0, r: 1 }, heading: 0, stack: 1, unitHealth: null, weapons: [weapon({ id: "aa", name: "AA", targetKinds: ["squadron"], accuracy: 100, damage: 1, overwatch: true })] });
  const state = battle([mover, owner]);
  const plan = domain.planManeuver(state, optionFor(state, "1,0"));

  const result = domain.executeManeuverElement(state, plan, 0, {
    resolvePostEntry({ state: current, unit: entered, plan: currentPlan, elementIndex, causeEventId }) {
      return resolvePostEntryAA(current, entered, { planId: currentPlan.id, elementIndex, causeEventId }, () => 1, () => 0);
    }
  });

  assert.equal(result.status, "destroyed");
  assert.equal(result.reason, "reaction");
  assert.equal(state.winner, "crimson");
  assert.equal(state.lifecycle, "Finished");
  assert.equal(state.activeUnitId, null);
  assert.deepEqual(state.initiativeOrder, [owner.id]);
  const declaration = state.events.find(event => event.action === "aa-reaction-declare");
  const damage = state.events.find(event => event.action === "damage");
  const destruction = state.events.find(event => event.action === "destroy");
  assert.equal(damage.causeEventId, declaration.eventId);
  assert.equal(destruction.causeEventId, damage.eventId);
});
