import assert from "node:assert/strict";
import test from "node:test";
import { applyAttackStep, confirmWeaponAttackAction } from "./battle.js";
import {
  activationResources,
  activeUnit,
  beginActionPlanning,
  beginActivation,
  cancelActionPlanning,
  confirmDeployment,
  confirmManeuverAction,
  confirmSystemAction,
  createBattleState,
  destroyUnit,
  endActivation,
  executeManeuverElement,
  movementEvasion,
  planManeuver,
  planRoutes,
  unitById,
  waitActiveUnit
} from "./domain.js";
import { buildManeuverOptions } from "./ui-rules.js";

function activationBattle() {
  const state = createBattleState();
  const atlas = unitById(state, "atlas");
  const swift = unitById(state, "swift");
  const bastion = unitById(state, "bastion");
  state.scenario.contents = [];
  state.units = [atlas, swift, bastion];
  state.initiativeOrder = [atlas.id, swift.id, bastion.id];
  state.activeUnitId = atlas.id;
  state.lifecycle = "WaitDecision";
  state.stage = "wait-decision";
  atlas.position = { q: 0, r: 0 };
  atlas.heading = 0;
  swift.position = { q: -3, r: 0 };
  bastion.position = { q: 2, r: 0 };
  atlas.reactor.currentEnergy = 1;
  return { state, atlas, swift, bastion };
}

function damagingStayEffect(id, position, amount = 1) {
  return {
    id,
    kind: "hazard",
    type: "radiation",
    label: id,
    position,
    stayEffect: { effect: "integrity damage", execute: { type: "damage", amount, layer: "integrity" } }
  };
}

test("final deployment automatically starts the first activation exactly once", () => {
  const state = createBattleState();
  const firstId = [...state.units]
    .sort((left, right) => right.initiative - left.initiative || right.currentSpeed - left.currentSpeed || ((state.units.indexOf(left) * 37 + 17) % 97) / 97 - ((state.units.indexOf(right) * 37 + 17) % 97) / 97)[0].id;
  const first = unitById(state, firstId);
  first.reactor && (first.reactor.currentEnergy = 0);

  assert.equal(confirmDeployment(state, "azure"), true);
  assert.equal(confirmDeployment(state, "crimson"), true);

  assert.equal(activeUnit(state), first);
  assert.equal(state.lifecycle, "ActionChoice");
  assert.equal(state.stage, "action-choice");
  assert.equal(first.activationStartedThisRound, true);
  assert.equal(state.events.filter(event => event.action === "activation-start" && event.actorId === first.id).length, 1);
});

test("automatic activation start leaves wait available and waiting does not restart later", () => {
  const { state, atlas, swift, bastion } = activationBattle();
  atlas.speedSpent = 2;
  atlas.speedRemaining = 1;
  atlas.maneuverSpent = 1;
  atlas.maneuverRemaining = 1;

  assert.equal(beginActivation(state), true);
  assert.equal(atlas.reactor.currentEnergy, 3);
  assert.equal(waitActiveUnit(state), true);

  assert.equal(activeUnit(state), swift);
  assert.equal(state.lifecycle, "ActionChoice");
  assert.equal(swift.activationStartedThisRound, true);
  assert.equal(atlas.hasWaited, true);
  assert.equal(atlas.canWait, false);

  assert.deepEqual(endActivation(state), { newRound: false });
  assert.equal(activeUnit(state), bastion);
  assert.deepEqual(endActivation(state), { newRound: false });
  assert.equal(activeUnit(state), atlas);
  assert.equal(state.lifecycle, "ActionChoice");
  assert.equal(atlas.reactor.currentEnergy, 3);
  assert.equal(atlas.speedSpent, 0);
  assert.equal(atlas.maneuverSpent, 0);
  assert.equal(state.events.filter(event => event.action === "activation-start" && event.actorId === atlas.id).length, 1);
});

test("activation start occurs once and enters the unified action choice", () => {
  const { state, atlas } = activationBattle();

  assert.equal(beginActivation(state), true);
  assert.equal(state.lifecycle, "ActionChoice");
  assert.equal(state.stage, "action-choice");
  assert.equal(atlas.activationStartedThisRound, true);
  assert.equal(atlas.reactor.currentEnergy, 3);

  atlas.speedSpent = 2;
  atlas.speedRemaining = 1;
  assert.equal(beginActivation(state), false);
  assert.equal(atlas.reactor.currentEnergy, 3);
  assert.equal(atlas.speedSpent, 2);
  assert.equal(atlas.speedRemaining, 1);
});

test("planning and canceling previews preserve wait eligibility", () => {
  const { state, atlas } = activationBattle();
  beginActivation(state);

  assert.ok(beginActionPlanning(state, { type: "maneuver", reason: "player-choice" }));
  assert.equal(cancelActionPlanning(state), true);
  assert.equal(atlas.canWait, true);
  assert.equal(waitActiveUnit(state), true);
});

test("planning and cancellation are pure and only one action may be planned or resolved", () => {
  const { state, atlas } = activationBattle();
  beginActivation(state);
  const before = structuredClone({ ...state, rng: null });

  assert.ok(beginActionPlanning(state, { type: "maneuver", reason: "player-choice" }));
  assert.equal(beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: atlas.weapons[0].id }), null);
  assert.equal(cancelActionPlanning(state), true);
  assert.deepEqual({ ...state, rng: null }, before);

  beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
  const route = planRoutes(state, atlas, "safe").get("1,0:0");
  const plan = confirmManeuverAction(state, buildManeuverOptions(atlas, route)[0]);
  assert.ok(plan);
  assert.equal(atlas.canWait, false);
  assert.equal(waitActiveUnit(state), false);
  assert.equal(state.lifecycle, "ActionResolution");
  assert.equal(beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: atlas.weapons[0].id }), null);
  assert.equal(cancelActionPlanning(state), false);

  assert.equal(executeManeuverElement(state, plan, 0).status, "completed");
  assert.equal(state.lifecycle, "ActionChoice");
  assert.equal(state.stage, "action-choice");
});

test("confirmation revalidates current executor and legality without trusting the preview", () => {
  const { state, atlas, swift, bastion } = activationBattle();
  beginActivation(state);
  const slot = atlas.weapons.find(weapon => weapon.mount === "forward");
  beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: slot.id });
  state.activeUnitId = swift.id;

  assert.equal(confirmWeaponAttackAction(state, atlas.id, slot.id, bastion.id, () => 1, () => 0), null);
  assert.equal(slot.firedThisRound, false);
  assert.equal(atlas.reactor.currentEnergy, 3);
  assert.equal(state.events.some(event => event.action === "activation-action-confirm"), false);
});

test("maneuver and weapon actions return to choice with stable action context", () => {
  const { state, atlas, bastion } = activationBattle();
  beginActivation(state);

  beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
  const route = planRoutes(state, atlas, "safe").get("0,0:1");
  const maneuver = confirmManeuverAction(state, buildManeuverOptions(atlas, route)[0]);
  const maneuverContext = maneuver.actionContext;
  assert.equal(executeManeuverElement(state, maneuver, 0).status, "completed");
  assert.equal(state.lifecycle, "ActionChoice");

  bastion.position = { q: -2, r: 0 };
  const slot = atlas.weapons.find(weapon => weapon.id === "atlas-battery-left");
  beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: slot.id });
  const attack = confirmWeaponAttackAction(state, atlas.id, slot.id, bastion.id, () => 100, () => 0);
  assert.ok(attack);
  assert.equal(atlas.canWait, false);
  assert.equal(waitActiveUnit(state), false);
  assert.notEqual(attack.actionContext.actionId, maneuverContext.actionId);
  assert.deepEqual(attack.actionContext, {
    actionId: attack.actionContext.actionId,
    actionType: "weapon-attack",
    actorId: atlas.id,
    reason: "player-choice"
  });
  for (let index = 0; index < attack.steps.length; index++) assert.equal(applyAttackStep(state, attack, index).status, "applied");
  assert.equal(state.lifecycle, "ActionChoice");
  const damage = state.events.find(event => event.action === "damage");
  if (damage) {
    assert.equal(damage.actionId, attack.actionContext.actionId);
    assert.equal(damage.actionType, "weapon-attack");
    assert.equal(damage.actionReason, "player-choice");
  }
});

test("system action planning is pure and confirmation revalidates actor, cost, and condition", () => {
  const { state, atlas, swift } = activationBattle();
  beginActivation(state);
  const before = structuredClone({ ...state, rng: null });

  const preview = beginActionPlanning(state, { type: "system-action", systemActionId: "evasive-maneuver", reason: "player-choice" });
  assert.deepEqual(preview, {
    status: "planning",
    type: "system-action",
    actorId: atlas.id,
    reason: "player-choice",
    systemActionId: "evasive-maneuver"
  });
  assert.equal(atlas.evasiveManeuver, false);
  assert.equal(atlas.maneuverSpent, 0);
  assert.equal(cancelActionPlanning(state), true);
  assert.deepEqual({ ...state, rng: null }, before);

  beginActionPlanning(state, { type: "system-action", systemActionId: "evasive-maneuver", reason: "player-choice" });
  state.activeUnitId = swift.id;
  assert.equal(confirmSystemAction(state, { systemActionId: "evasive-maneuver", costs: { maneuver: 0 } }), null);
  assert.equal(atlas.evasiveManeuver, false);
  assert.equal(atlas.maneuverSpent, 0);

  state.activeUnitId = atlas.id;
  atlas.maneuverSpent = atlas.maneuver;
  atlas.maneuverRemaining = 0;
  assert.equal(confirmSystemAction(state, { systemActionId: "evasive-maneuver", costs: { maneuver: 0 } }), null);
  assert.equal(atlas.evasiveManeuver, false);
  assert.equal(atlas.maneuverSpent, atlas.maneuver);
});

test("confirmed system actions pay once, remove wait, and return to common choice", () => {
  const { state, atlas } = activationBattle();
  beginActivation(state);

  beginActionPlanning(state, { type: "system-action", systemActionId: "evasive-maneuver", reason: "player-choice" });
  const resolved = confirmSystemAction(state, { systemActionId: "evasive-maneuver", costs: { maneuver: 0 } });

  assert.deepEqual(resolved.costs, { maneuver: 1 });
  assert.equal(atlas.evasiveManeuver, true);
  assert.equal(atlas.maneuverSpent, 1);
  assert.equal(atlas.maneuverRemaining, atlas.maneuver - 1);
  assert.equal(atlas.canWait, false);
  assert.equal(waitActiveUnit(state), false);
  assert.equal(state.lifecycle, "ActionChoice");
  assert.equal(state.stage, "action-choice");
  assert.equal(confirmSystemAction(state, resolved), null);
  assert.equal(atlas.maneuverSpent, 1);
  assert.equal(state.events.filter(event => event.action === "system-action-resolve").length, 1);
});

test("a second config-backed system action is available after maneuver and attack", () => {
  const { state, atlas, bastion } = activationBattle();
  beginActivation(state);

  beginActionPlanning(state, { type: "system-action", systemActionId: "evasive-maneuver", reason: "player-choice" });
  assert.ok(confirmSystemAction(state, { systemActionId: "evasive-maneuver" }));

  beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
  const route = planRoutes(state, atlas, "safe").get("1,0:0");
  const maneuver = confirmManeuverAction(state, buildManeuverOptions(atlas, route)[0]);
  assert.equal(executeManeuverElement(state, maneuver, 0).status, "completed");
  assert.equal(atlas.movementEvasion, 7.5);

  bastion.position = { q: 1, r: -2 };
  const slot = atlas.weapons.find(weapon => weapon.id === "atlas-battery-left");
  beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: slot.id });
  const attack = confirmWeaponAttackAction(state, atlas.id, slot.id, bastion.id, () => 100, () => 0);
  for (let index = 0; index < attack.steps.length; index++) applyAttackStep(state, attack, index);

  const energy = atlas.reactor.currentEnergy;
  beginActionPlanning(state, { type: "system-action", systemActionId: "reactor-to-engines", reason: "player-choice" });
  const boost = confirmSystemAction(state, { systemActionId: "reactor-to-engines", costs: { energy: 0 } });
  assert.deepEqual(boost.costs, { energy: 1 });
  assert.equal(atlas.reactor.currentEnergy, energy - 1);
  assert.equal(atlas.currentSpeed, atlas.baseSpeed + 1);
  assert.equal(atlas.speedRemaining, Math.max(0, atlas.currentSpeed - atlas.speedSpent));
  assert.equal(state.lifecycle, "ActionChoice");
});

test("maneuver planning and execution require the chosen action through confirmation", () => {
  const { state, atlas } = activationBattle();
  beginActivation(state);
  const route = planRoutes(state, atlas, "safe").get("1,0:0");
  const option = buildManeuverOptions(atlas, route)[0];

  assert.equal(planManeuver(state, option), null);
  assert.equal(confirmManeuverAction(state, option), null);
  assert.equal(state.lifecycle, "ActionChoice");

  beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: atlas.weapons[0].id });
  assert.equal(planManeuver(state, option), null);
  cancelActionPlanning(state);

  beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
  const plan = confirmManeuverAction(state, option);
  assert.ok(plan);
  state.activeAction = { ...state.activeAction, planId: "another-plan" };
  assert.equal(executeManeuverElement(state, plan, 0).status, "invalid");
  assert.equal(atlas.speedSpent, 0);
  assert.equal(atlas.maneuverSpent, 0);
});

test("maneuver, weapon attack, and another maneuver share cumulative movement budgets", () => {
  const { state, atlas, bastion } = activationBattle();
  beginActivation(state);

  beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
  const firstRoute = planRoutes(state, atlas, "safe").get("1,0:0");
  const firstManeuver = confirmManeuverAction(state, buildManeuverOptions(atlas, firstRoute)[0]);
  assert.equal(executeManeuverElement(state, firstManeuver, 0).status, "completed");
  assert.deepEqual({ position: atlas.position, heading: atlas.heading, speedSpent: atlas.speedSpent, speedRemaining: atlas.speedRemaining }, {
    position: { q: 1, r: 0 }, heading: 0, speedSpent: 1, speedRemaining: atlas.currentSpeed - 1
  });

  bastion.position = { q: 1, r: -2 };
  const slot = atlas.weapons.find(weapon => weapon.id === "atlas-battery-left");
  beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: slot.id });
  const attack = confirmWeaponAttackAction(state, atlas.id, slot.id, bastion.id, () => 100, () => 0);
  for (let index = 0; index < attack.steps.length; index++) assert.equal(applyAttackStep(state, attack, index).status, "applied");
  assert.deepEqual({ speedSpent: atlas.speedSpent, speedRemaining: atlas.speedRemaining, maneuverSpent: atlas.maneuverSpent, maneuverRemaining: atlas.maneuverRemaining }, {
    speedSpent: 1, speedRemaining: atlas.currentSpeed - 1, maneuverSpent: 0, maneuverRemaining: atlas.maneuver
  });

  beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
  const secondRoutes = planRoutes(state, atlas, "safe");
  assert.equal(secondRoutes.has("4,0:0"), false);
  const secondRoute = secondRoutes.get("3,0:0");
  const secondManeuver = confirmManeuverAction(state, buildManeuverOptions(atlas, secondRoute)[0]);
  for (let index = 0; index < secondManeuver.elements.length; index++) assert.notEqual(executeManeuverElement(state, secondManeuver, index).status, "invalid");

  assert.deepEqual({ position: atlas.position, heading: atlas.heading, speedSpent: atlas.speedSpent, speedRemaining: atlas.speedRemaining, maneuverSpent: atlas.maneuverSpent, maneuverRemaining: atlas.maneuverRemaining }, {
    position: { q: 3, r: 0 }, heading: 0, speedSpent: 3, speedRemaining: 0, maneuverSpent: 0, maneuverRemaining: atlas.maneuver
  });
  assert.equal(state.lifecycle, "ActionChoice");
});

test("Evasion accumulates actual steps across maneuvers and survives intervening weapon and system actions", () => {
  const { state, atlas, bastion } = activationBattle();
  bastion.position = { q: 3, r: 3 };
  beginActivation(state);

  beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
  const firstRoute = planRoutes(state, atlas, "safe").get("1,0:0");
  const firstManeuver = confirmManeuverAction(state, buildManeuverOptions(atlas, firstRoute)[0]);
  assert.equal(executeManeuverElement(state, firstManeuver, 0).status, "completed");
  assert.equal(atlas.movementEvasion, movementEvasion(1));

  bastion.position = { q: 1, r: -2 };
  const slot = atlas.weapons.find(weapon => weapon.id === "atlas-battery-left");
  beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: slot.id });
  const attack = confirmWeaponAttackAction(state, atlas.id, slot.id, bastion.id, () => 100, () => 0);
  for (let index = 0; index < attack.steps.length; index++) applyAttackStep(state, attack, index);
  assert.equal(atlas.movementEvasion, movementEvasion(1));

  beginActionPlanning(state, { type: "system-action", systemActionId: "reactor-to-engines", reason: "player-choice" });
  assert.ok(confirmSystemAction(state));
  assert.equal(atlas.movementEvasion, movementEvasion(1));

  beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
  const secondRoute = planRoutes(state, atlas, "safe").get("3,0:0");
  const secondManeuver = confirmManeuverAction(state, buildManeuverOptions(atlas, secondRoute)[0]);
  for (let index = 0; index < secondManeuver.elements.length; index++) executeManeuverElement(state, secondManeuver, index);

  assert.equal(atlas.activationMovement.steps, 3);
  assert.equal(atlas.movementEvasion, movementEvasion(3));
});

test("a later turn-only maneuver conservatively locks accumulated Evasion until the next Activation Start", () => {
  const { state, atlas, swift, bastion } = activationBattle();
  bastion.position = { q: 3, r: 3 };
  beginActivation(state);

  beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
  const movement = confirmManeuverAction(state, buildManeuverOptions(atlas, planRoutes(state, atlas, "safe").get("1,0:0"))[0]);
  executeManeuverElement(state, movement, 0);
  assert.equal(atlas.movementEvasion, movementEvasion(1));

  beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
  const turn = confirmManeuverAction(state, buildManeuverOptions(atlas, planRoutes(state, atlas, "safe").get("1,0:1"))[0]);
  executeManeuverElement(state, turn, 0);
  assert.equal(atlas.evasionLocked, true);
  assert.equal(atlas.movementEvasion, 0);

  endActivation(state);
  endActivation(state);
  endActivation(state);
  endActivation(state);
  assert.equal(activeUnit(state), atlas);
  assert.equal(atlas.activationStartedThisRound, true);
  assert.equal(atlas.evasionLocked, false);
  assert.equal(atlas.activationMovement.steps, 0);
  assert.equal(atlas.movementEvasion, 0);
  assert.ok(swift);
});

test("spent Speed and Maneuver survive maximum decreases and increases", () => {
  const { state, atlas } = activationBattle();
  beginActivation(state);
  atlas.speedSpent = 2;
  atlas.maneuverSpent = 1;

  atlas.currentSpeed = 1;
  atlas.maneuver = 0;
  assert.deepEqual(activationResources(atlas), {
    speed: { spent: 2, remaining: 0, capacity: 1 },
    maneuver: { spent: 1, remaining: 0, capacity: 0 },
    energy: { spent: 0, remaining: 3, capacity: 3 }
  });
  assert.equal(planRoutes(state, atlas, "safe").size, 0);

  atlas.currentSpeed = 4;
  atlas.maneuver = 2;
  assert.deepEqual(activationResources(atlas).speed, { spent: 2, remaining: 2, capacity: 4 });
  assert.deepEqual(activationResources(atlas).maneuver, { spent: 1, remaining: 1, capacity: 2 });
  assert.ok(planRoutes(state, atlas, "safe").get("1,0:0"));
});

test("attacks and system actions share an activation energy budget across maximum changes", () => {
  const { state, atlas, bastion } = activationBattle();
  beginActivation(state);
  const slot = atlas.weapons.find(weapon => weapon.id === "atlas-battery-left");
  slot.energyCost = 1;
  bastion.position = { q: 0, r: -2 };
  beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: slot.id });
  const attack = confirmWeaponAttackAction(state, atlas.id, slot.id, bastion.id, () => 100, () => 0);
  for (let index = 0; index < attack.steps.length; index++) applyAttackStep(state, attack, index);
  assert.equal(atlas.energySpent, 1);
  assert.equal(atlas.reactor.currentEnergy, 2);

  atlas.reactor.capacity = 1;
  assert.deepEqual(activationResources(atlas).energy, { spent: 1, remaining: 0, capacity: 1 });
  beginActionPlanning(state, { type: "system-action", systemActionId: "reactor-to-engines", reason: "player-choice" });
  assert.equal(confirmSystemAction(state), null);

  atlas.reactor.capacity = 4;
  assert.deepEqual(activationResources(atlas).energy, { spent: 1, remaining: 2, capacity: 3 });
  assert.ok(confirmSystemAction(state));
  assert.equal(atlas.energySpent, 2);
  assert.equal(atlas.reactor.currentEnergy, 1);
});

test("increasing reactor capacity cannot restore energy missing at activation start", () => {
  const { state, atlas } = activationBattle();
  atlas.reactor.currentEnergy = 0;
  beginActivation(state);

  assert.equal(atlas.reactor.currentEnergy, 2);
  assert.deepEqual(activationResources(atlas).energy, { spent: 0, remaining: 2, capacity: 2 });

  atlas.reactor.capacity += 3;
  assert.deepEqual(activationResources(atlas).energy, { spent: 0, remaining: 2, capacity: 2 });
});

test("confirmation revalidates every mutable maximum after planning", async t => {
  await t.test("Speed", () => {
    const { state, atlas } = activationBattle();
    beginActivation(state);
    atlas.speedSpent = 1;
    beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
    const route = planRoutes(state, atlas, "safe").get("1,0:0");
    const option = buildManeuverOptions(atlas, route)[0];
    atlas.currentSpeed = 1;
    assert.equal(confirmManeuverAction(state, option), null);
    atlas.currentSpeed = 2;
    assert.ok(confirmManeuverAction(state, option));
  });

  await t.test("Maneuver", () => {
    const { state, atlas } = activationBattle();
    beginActivation(state);
    atlas.maneuverSpent = 1;
    beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
    const route = planRoutes(state, atlas, "safe").get("0,0:1");
    const option = buildManeuverOptions(atlas, route)[0];
    atlas.maneuver = 1;
    assert.equal(confirmManeuverAction(state, option), null);
    atlas.maneuver = 2;
    assert.ok(confirmManeuverAction(state, option));
  });

  await t.test("energy", () => {
    const { state, atlas, bastion } = activationBattle();
    beginActivation(state);
    atlas.energySpent = 1;
    atlas.reactor.currentEnergy = 2;
    const slot = atlas.weapons.find(weapon => weapon.energyCost > 0);
    slot.energyCost = 1;
    slot.mount = "turret";
    bastion.position = { q: 0, r: -2 };
    beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: slot.id });
    atlas.reactor.capacity = 1;
    assert.equal(confirmWeaponAttackAction(state, atlas.id, slot.id, bastion.id, () => 100, () => 0), null);
    atlas.reactor.capacity = 3;
    assert.ok(confirmWeaponAttackAction(state, atlas.id, slot.id, bastion.id, () => 100, () => 0));
  });
});

test("activation start resets only cumulative activation spending and preserves persistent reactor energy", () => {
  const { state, atlas } = activationBattle();
  atlas.speedSpent = 2;
  atlas.maneuverSpent = 1;
  atlas.energySpent = 3;
  atlas.reactor.currentEnergy = 0;

  beginActivation(state);

  assert.deepEqual({ speed: atlas.speedSpent, maneuver: atlas.maneuverSpent, energy: atlas.energySpent }, { speed: 0, maneuver: 0, energy: 0 });
  assert.equal(atlas.reactor.currentEnergy, 2);
  assert.equal(atlas.activationEnergyBudget, 2);
  assert.deepEqual(activationResources(atlas).energy, { spent: 0, remaining: 2, capacity: 2 });
});

test("every surviving maneuver stop outcome returns to action choice", async t => {
  const cases = [
    ["full maneuver", null, "completed"],
    ["early stop", () => ({ canContinue: () => false }), "stopped"],
    ["survived hazard", ({ state }) => {
      state.scenario.contents.push({ id: "mines", kind: "hazard", type: "minefield", label: "Mines", position: { q: 1, r: 0 }, hazard: { probability: 1, min: 1, max: 1, effect: "damage" } });
      state.rng = () => 0;
      return null;
    }, "completed"]
  ];

  for (const [name, prepare, expectedStatus] of cases) await t.test(name, () => {
    const { state, atlas, bastion } = activationBattle();
    bastion.position = { q: 3, r: 3 };
    beginActivation(state);
    const effects = prepare?.({ state, atlas }) || {};
    beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
    const destination = name === "early stop" ? "3,0:0" : "1,0:0";
    const route = planRoutes(state, atlas, "risky").get(destination);
    const plan = confirmManeuverAction(state, buildManeuverOptions(atlas, route)[0]);
    let result;
    for (let index = 0; index < plan.elements.length; index++) {
      result = executeManeuverElement(state, plan, index, effects);
      if (result.status !== "executed") break;
    }
    assert.equal(result.status, expectedStatus);
    assert.equal(state.lifecycle, "ActionChoice");
    assert.equal(state.stage, "action-choice");
  });
});

test("each resolved maneuver applies final-hex stay effects once before action choice and explicit end does not duplicate them", () => {
  const { state, atlas, bastion } = activationBattle();
  bastion.position = { q: 3, r: 3 };
  state.scenario.contents.push(
    damagingStayEffect("first-stay", { q: 1, r: 0 }),
    damagingStayEffect("second-stay", { q: 2, r: 0 })
  );
  beginActivation(state);

  for (const destination of ["1,0:0", "2,0:0"]) {
    beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
    const route = planRoutes(state, atlas, "risky").get(destination);
    const maneuver = confirmManeuverAction(state, buildManeuverOptions(atlas, route)[0]);
    const result = executeManeuverElement(state, maneuver, 0);
    assert.equal(result.status, "completed");
    assert.equal(state.lifecycle, "ActionChoice");
  }

  assert.equal(atlas.integrity, atlas.maxIntegrity - 2);
  const stayEvents = state.events.filter(event => event.action === "location-stay-effect");
  assert.deepEqual(stayEvents.map(event => ({ sourceId: event.sourceId, actionId: event.actionId, cause: event.cause })), [
    { sourceId: "first-stay", actionId: stayEvents[0].actionId, cause: "maneuver" },
    { sourceId: "second-stay", actionId: stayEvents[1].actionId, cause: "maneuver" }
  ]);
  assert.notEqual(stayEvents[0].actionId, stayEvents[1].actionId);

  assert.deepEqual(endActivation(state), { newRound: false });
  assert.equal(atlas.integrity, atlas.maxIntegrity - 2);
  assert.equal(state.events.filter(event => event.action === "location-stay-effect").length, 2);
});

test("turn-only and survived early-stop maneuvers apply stay effects at the actual final hex", async t => {
  await t.test("turn-only", () => {
    const { state, atlas } = activationBattle();
    state.scenario.contents.push(damagingStayEffect("stationary-stay", { q: 0, r: 0 }));
    beginActivation(state);
    beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
    const route = planRoutes(state, atlas, "risky").get("0,0:1");
    const maneuver = confirmManeuverAction(state, buildManeuverOptions(atlas, route)[0]);

    assert.equal(executeManeuverElement(state, maneuver, 0).status, "completed");
    assert.equal(atlas.integrity, atlas.maxIntegrity - 1);
    assert.deepEqual(state.events.find(event => event.action === "location-stay-effect").position, { q: 0, r: 0 });
  });

  await t.test("early stop", () => {
    const { state, atlas, bastion } = activationBattle();
    bastion.position = { q: 3, r: 3 };
    state.scenario.contents.push(
      damagingStayEffect("actual-stay", { q: 1, r: 0 }),
      damagingStayEffect("planned-stay", { q: 3, r: 0 }, 5)
    );
    beginActivation(state);
    beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
    const route = planRoutes(state, atlas, "risky").get("3,0:0");
    const maneuver = confirmManeuverAction(state, buildManeuverOptions(atlas, route)[0]);

    const result = executeManeuverElement(state, maneuver, 0, { canContinue: () => false });
    assert.equal(result.status, "stopped");
    assert.equal(atlas.integrity, atlas.maxIntegrity - 1);
    assert.deepEqual(state.events.find(event => event.action === "location-stay-effect").position, { q: 1, r: 0 });
  });
});

test("configured stay state changes execute with the same event and cause contract as damage", () => {
  const { state, atlas } = activationBattle();
  state.scenario.contents.push({
    id: "anchoring-field",
    kind: "terrain",
    type: "gravityWell",
    label: "Anchoring Field",
    position: { q: 0, r: 0 },
    stayEffect: { effect: "evasion lock", execute: { type: "set", path: "evasionLocked", value: true } }
  });
  beginActivation(state);

  assert.deepEqual(endActivation(state), { newRound: false });
  assert.equal(atlas.evasionLocked, true);
  const stay = state.events.find(event => event.action === "location-stay-effect");
  assert.deepEqual(stay.execute, { type: "set", path: "evasionLocked", value: true });
  assert.equal(stay.cause, "activation-end");
  assert.equal(stay.activationEndEventId, stay.causeEventId);
});

test("explicit end without a resolved maneuver applies stay effects once after other actions and identifies the end cause", () => {
  const { state, atlas } = activationBattle();
  state.scenario.contents.push(damagingStayEffect("end-stay", { q: 0, r: 0 }));
  beginActivation(state);
  beginActionPlanning(state, { type: "system-action", systemActionId: "evasive-maneuver", reason: "player-choice" });
  assert.ok(confirmSystemAction(state));

  assert.deepEqual(endActivation(state), { newRound: false });
  assert.equal(atlas.integrity, atlas.maxIntegrity - 1);
  const event = state.events.find(candidate => candidate.action === "location-stay-effect");
  assert.equal(event.cause, "activation-end");
  assert.equal(event.actionId, undefined);
  assert.equal(event.activationEndEventId, event.causeEventId);
  assert.equal(state.events.filter(candidate => candidate.action === "location-stay-effect").length, 1);
});

test("planning, cancellation, and a maneuver stopped before its first element do not apply or mark stay effects", () => {
  const { state, atlas } = activationBattle();
  state.scenario.contents.push(damagingStayEffect("idle-stay", { q: 0, r: 0 }));
  beginActivation(state);
  beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
  assert.equal(cancelActionPlanning(state), true);
  assert.equal(state.events.some(event => event.action === "location-stay-effect"), false);

  beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
  const route = planRoutes(state, atlas, "risky").get("1,0:0");
  const maneuver = confirmManeuverAction(state, buildManeuverOptions(atlas, route)[0]);
  atlas.currentSpeed = 0;
  atlas.speedRemaining = 0;
  assert.equal(executeManeuverElement(state, maneuver, 0).status, "stopped");
  assert.equal(state.events.some(event => event.action === "location-stay-effect"), false);

  assert.deepEqual(endActivation(state), { newRound: false });
  assert.equal(atlas.integrity, atlas.maxIntegrity - 1);
  assert.equal(state.events.find(event => event.action === "location-stay-effect").cause, "activation-end");
});

test("a lethal stay effect terminates the maneuver action and activation without returning control to the destroyed unit", () => {
  const { state, atlas, swift, bastion } = activationBattle();
  bastion.position = { q: 3, r: 3 };
  atlas.integrity = 1;
  state.scenario.contents.push(damagingStayEffect("lethal-stay", { q: 1, r: 0 }));
  beginActivation(state);
  beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
  const route = planRoutes(state, atlas, "risky").get("1,0:0");
  const maneuver = confirmManeuverAction(state, buildManeuverOptions(atlas, route)[0]);

  const result = executeManeuverElement(state, maneuver, 0);
  assert.equal(result.status, "destroyed");
  assert.equal(result.reason, "stay-effect");
  assert.equal(state.units.includes(atlas), false);
  assert.equal(activeUnit(state), swift);
  assert.equal(state.lifecycle, "ActionChoice");
  assert.equal(swift.activationStartedThisRound, true);
  assert.equal(state.activeAction, null);
  assert.equal(state.maneuverApplication, null);
  const stay = state.events.find(event => event.action === "location-stay-effect");
  const destruction = state.events.find(event => event.action === "destroy" && event.subjectIds.includes(atlas.id));
  assert.equal(stay.actionId, maneuver.actionId);
  assert.equal(destruction.causeEventId, stay.eventId);
});

test("confirmed maneuver steps, attacks, damage, and destruction retain concrete action and cause context", () => {
  const { state, atlas, swift, bastion } = activationBattle();
  const raptor = unitById(createBattleState(), "raptor");
  raptor.position = { q: 4, r: 4 };
  state.units.push(raptor);
  state.initiativeOrder.push(raptor.id);
  swift.position = { q: -4, r: 0 };
  bastion.position = { q: 1, r: -2 };
  bastion.shield = 0;
  bastion.armor = 0;
  bastion.integrity = 1;
  beginActivation(state);
  beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
  const maneuver = confirmManeuverAction(state, buildManeuverOptions(atlas, planRoutes(state, atlas, "safe").get("1,0:0"))[0]);
  executeManeuverElement(state, maneuver, 0);

  const maneuverEvents = state.events.filter(event => event.planId === maneuver.id);
  assert.ok(maneuverEvents.length > 0);
  assert.equal(maneuverEvents.every(event => event.actionId === maneuver.actionId && event.actionType === "maneuver" && event.actionReason === "player-choice"), true);
  const exit = maneuverEvents.find(event => event.action === "maneuver-exit");
  const move = maneuverEvents.find(event => event.action === "maneuver-move");
  assert.equal(move.causeEventId, exit.eventId);

  const slot = atlas.weapons.find(weapon => weapon.id === "atlas-battery-left");
  beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: slot.id });
  const attack = confirmWeaponAttackAction(state, atlas.id, slot.id, bastion.id, () => 1, () => 0);
  for (let index = 0; index < attack.steps.length; index++) applyAttackStep(state, attack, index);
  const damage = state.events.find(event => event.action === "damage" && event.actionId === attack.actionId);
  const destruction = state.events.find(event => event.action === "destroy" && event.subjectIds.includes(bastion.id));
  assert.deepEqual({ actionType: damage.actionType, actionReason: damage.actionReason, actorId: damage.actorId }, {
    actionType: "weapon-attack", actionReason: "player-choice", actorId: atlas.id
  });
  assert.equal(destruction.actionId, attack.actionId);
  assert.equal(destruction.causeEventId, damage.eventId);
  assert.equal(activeUnit(state), atlas);
  assert.equal(state.lifecycle, "ActionChoice");
});

test("weapon attack destruction determines the winner without reopening action choice", () => {
  const { state, atlas, bastion } = activationBattle();
  state.units = [atlas, bastion];
  state.initiativeOrder = [atlas.id, bastion.id];
  bastion.position = { q: 0, r: -2 };
  bastion.shield = 0;
  bastion.armor = 0;
  bastion.integrity = 1;
  beginActivation(state);
  const slot = atlas.weapons.find(weapon => weapon.id === "atlas-battery-left");
  beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: slot.id });
  const attack = confirmWeaponAttackAction(state, atlas.id, slot.id, bastion.id, () => 1, () => 0);

  for (let index = 0; index < attack.steps.length; index++) applyAttackStep(state, attack, index);

  assert.equal(state.winner, atlas.sideId);
  assert.equal(state.lifecycle, "Finished");
  assert.equal(state.activeUnitId, null);
  assert.equal(state.activeAction, null);
  assert.equal(state.attackApplication, null);
});

test("full free-order activation interleaves maneuvers, different weapon slots, a system action, and explicit end", () => {
  const { state, atlas, bastion } = activationBattle();
  const raptor = unitById(createBattleState(), "raptor");
  state.units.push(raptor);
  state.initiativeOrder = [atlas.id, bastion.id, raptor.id];
  bastion.position = { q: 1, r: -2 };
  raptor.position = { q: 3, r: 2 };
  beginActivation(state);

  const resources = () => activationResources(atlas);
  assert.deepEqual(resources(), {
    speed: { spent: 0, remaining: 3, capacity: 3 },
    maneuver: { spent: 0, remaining: 2, capacity: 2 },
    energy: { spent: 0, remaining: 3, capacity: 3 }
  });

  beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
  const firstManeuver = confirmManeuverAction(state, buildManeuverOptions(atlas, planRoutes(state, atlas, "safe").get("1,0:0"))[0]);
  assert.equal(executeManeuverElement(state, firstManeuver, 0).status, "completed");
  assert.deepEqual(resources(), {
    speed: { spent: 1, remaining: 2, capacity: 3 },
    maneuver: { spent: 0, remaining: 2, capacity: 2 },
    energy: { spent: 0, remaining: 3, capacity: 3 }
  });

  const left = atlas.weapons.find(weapon => weapon.id === "atlas-battery-left");
  beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: left.id });
  const firstAttack = confirmWeaponAttackAction(state, atlas.id, left.id, bastion.id, () => 100, () => 0);
  for (let index = 0; index < firstAttack.steps.length; index++) applyAttackStep(state, firstAttack, index);
  assert.deepEqual(resources(), {
    speed: { spent: 1, remaining: 2, capacity: 3 },
    maneuver: { spent: 0, remaining: 2, capacity: 2 },
    energy: { spent: 0, remaining: 3, capacity: 3 }
  });

  beginActionPlanning(state, { type: "system-action", systemActionId: "reactor-to-engines", reason: "player-choice" });
  assert.ok(confirmSystemAction(state));
  assert.deepEqual(resources(), {
    speed: { spent: 1, remaining: 3, capacity: 4 },
    maneuver: { spent: 0, remaining: 2, capacity: 2 },
    energy: { spent: 1, remaining: 2, capacity: 3 }
  });

  beginActionPlanning(state, { type: "maneuver", reason: "player-choice" });
  const secondManeuver = confirmManeuverAction(state, buildManeuverOptions(atlas, planRoutes(state, atlas, "safe").get("3,0:0"))[0]);
  for (let index = 0; index < secondManeuver.elements.length; index++) executeManeuverElement(state, secondManeuver, index);
  assert.deepEqual(resources(), {
    speed: { spent: 3, remaining: 1, capacity: 4 },
    maneuver: { spent: 0, remaining: 2, capacity: 2 },
    energy: { spent: 1, remaining: 2, capacity: 3 }
  });

  const right = atlas.weapons.find(weapon => weapon.id === "atlas-battery-right");
  beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: right.id });
  const secondAttack = confirmWeaponAttackAction(state, atlas.id, right.id, raptor.id, () => 100, () => 0);
  for (let index = 0; index < secondAttack.steps.length; index++) applyAttackStep(state, secondAttack, index);
  assert.deepEqual(resources(), {
    speed: { spent: 3, remaining: 1, capacity: 4 },
    maneuver: { spent: 0, remaining: 2, capacity: 2 },
    energy: { spent: 1, remaining: 2, capacity: 3 }
  });

  assert.deepEqual(endActivation(state), { newRound: false });
  assert.equal(activeUnit(state), bastion);
  assert.equal(atlas.currentSpeed, atlas.baseSpeed);
  assert.deepEqual(state.events.filter(event => event.action === "activation-action-confirm").map(event => event.actionType), [
    "maneuver", "weapon-attack", "system-action", "maneuver", "weapon-attack"
  ]);
});

test("explicit end cancels an unconfirmed preview without paying for it", () => {
  const { state, atlas, swift } = activationBattle();
  beginActivation(state);
  const slot = atlas.weapons.find(weapon => weapon.id === "atlas-forward");
  const before = structuredClone({ resources: activationResources(atlas), slot, events: state.events });
  beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: slot.id });

  assert.deepEqual(endActivation(state), { newRound: false });
  assert.equal(activeUnit(state), swift);
  assert.deepEqual({ resources: activationResources(atlas), slot, events: state.events.filter(event => !["activation-end", "activation-start"].includes(event.action) || event.action === "activation-start" && event.actorId === atlas.id) }, before);
});

test("activation may end immediately and active-unit destruction leaves initiative coherent", () => {
  const immediate = activationBattle();
  beginActivation(immediate.state);
  const energy = immediate.atlas.reactor.currentEnergy;
  assert.deepEqual(endActivation(immediate.state), { newRound: false });
  assert.equal(immediate.atlas.reactor.currentEnergy, energy);
  assert.equal(activeUnit(immediate.state), immediate.swift);
  assert.equal(immediate.state.lifecycle, "ActionChoice");
  assert.equal(immediate.swift.activationStartedThisRound, true);

  const resolving = activationBattle();
  beginActivation(resolving.state);
  beginActionPlanning(resolving.state, { type: "maneuver", reason: "player-choice" });
  const route = planRoutes(resolving.state, resolving.atlas, "safe").get("1,0:0");
  confirmManeuverAction(resolving.state, buildManeuverOptions(resolving.atlas, route)[0]);
  destroyUnit(resolving.state, resolving.atlas);
  assert.equal(activeUnit(resolving.state), resolving.swift);
  assert.equal(resolving.state.lifecycle, "ActionChoice");
  assert.equal(resolving.state.activeAction, null);
  assert.equal(resolving.state.maneuverApplication, null);
  assert.equal(resolving.swift.activationStartedThisRound, true);
});
