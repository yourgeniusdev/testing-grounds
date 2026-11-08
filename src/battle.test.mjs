import assert from "node:assert/strict";
import { aaPreviewDescriptors } from "./route-preview.js";
import { actionAvailability, beginActivation, confirmSystemAction, overwatchAvailability } from "./domain.js";
import test from "node:test";
import {
  applyAttackStep,
  availableWeaponAttackTargets,
  confirmWeaponAttackAction,
  planPostEntryAA,
  applyReactionStep,
  previewWeaponAttack,
  resolvePostEntryAA,
  supercoverLine,
  weaponAttackArc,
  weaponHitDamage
} from "./battle.js";
import {
  advanceWeaponRound,
  beginActionPlanning,
  beginWeaponCooldown,
  cancelActionPlanning,
  createBattleState,
  endActivation,
  initializeWeaponState,
  resetUnitWeaponsForNewRound,
  waitActiveUnit,
  weaponReadiness
} from "./domain.js";

test("Overwatch cannot attack an unrelated squadron while held by a third party", () => {
  const state = createBattleState();
  const owner = state.units.find(unit => unit.id === "hornet-azure");
  const holder = state.units.find(unit => unit.id === "kiro");
  const target = state.units.find(unit => unit.id === "mantis");
  state.units = [owner, holder, target];
  state.scenario.contents = [];
  owner.position = { q: 0, r: 0 };
  holder.position = { q: 0, r: 1 };
  target.position = { q: 2, r: 0 };
  const slot = owner.weapons[0];
  slot.overwatch = true;
  const before = JSON.stringify(state);
  assert.ok(previewWeaponAttack(state, owner.id, slot.id, target.id).availability.reasons.some(reason => reason.code === "target.intercepted"));
  assert.equal(planPostEntryAA(state, target, {}, () => 100), null);
  assert.equal(JSON.stringify(state), before);
});

test("reaction previews respect third-party holders at the hypothetical mover position", () => {
  const state = createBattleState();
  const owner = state.units.find(unit => unit.id === "hornet-azure");
  const holder = state.units.find(unit => unit.id === "kiro");
  const target = state.units.find(unit => unit.id === "mantis");
  state.units = [owner, holder, target];
  state.scenario.contents = [];
  owner.position = { q: 0, r: 0 };
  holder.position = { q: 0, r: 1 };
  target.position = { q: 2, r: 0 };
  owner.weapons[0].overwatch = true;
  const before = JSON.stringify(state);
  assert.deepEqual(aaPreviewDescriptors(state, target, target.position), []);
  assert.equal(aaPreviewDescriptors(state, holder, { q: 1, r: 0 }).length, 1);
  assert.equal(aaPreviewDescriptors(state, holder, { q: 2, r: 0 }).length, 1);
  assert.equal(JSON.stringify(state), before);
});

function weapon(overrides = {}) {
  return {
    id: "slot-a",
    weaponId: "catalog-a",
    slotOrder: 0,
    name: "Орудие A",
    mount: "turret",
    orientation: null,
    weaponClass: "kinetic",
    delivery: "projectile",
    targetKinds: ["capital"],
    accuracy: 80,
    effectiveRange: 3,
    maxRange: 6,
    shots: 1,
    damage: 4,
    critChance: 0,
    energyCost: 0,
    cooldownRounds: 0,
    firedThisRound: false,
    cooldownRemaining: 0,
    overwatch: false,
    visual: { projectile: "tracer", color: "#fff", size: 0.1, speedHexesPerSecond: 5, launchIntervalMs: 100, trail: "short", impact: "spark", impactRadius: 0.1 },
    ...overrides
  };
}

function unit(overrides = {}) {
  return {
    id: "attacker",
    name: "Атакующий",
    sideId: "azure",
    kind: "capital",
    position: { q: 0, r: 0 },
    heading: 0,
    shield: 0,
    armor: 0,
    integrity: 20,
    maxShield: 0,
    maxArmor: 0,
    maxIntegrity: 20,
    baseEvasion: 0,
    movementEvasion: 0,
    criticals: [],
    stack: 1,
    weapons: [],
    reactor: null,
    ...overrides
  };
}

function battle(weapons, targetOverrides = {}) {
  const attacker = unit({ weapons });
  const target = unit({ id: "target", name: "Цель", sideId: "crimson", position: { q: 2, r: 0 }, shield: 8, armor: 8, integrity: 12, maxShield: 8, maxArmor: 8, maxIntegrity: 12, ...targetOverrides });
  const state = {
    scenario: { id: "test", bounds: { minCol: -8, maxCol: 8, minRow: -8, maxRow: 8 }, contents: [] },
    units: [attacker, target],
    activeUnitId: attacker.id,
    initiativeOrder: [attacker.id, target.id],
    lifecycle: "ActionChoice",
    activeAction: null,
    maneuverApplication: null,
    attackApplication: null,
    roundNumber: 1,
    winner: null,
    log: [],
    events: [],
    sequence: 0
  };
  return { state, attacker, target };
}

function planAttack(state, attacker, slot, target, rollD100 = () => 100, random = () => 0) {
  beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: slot.id });
  return confirmWeaponAttackAction(state, attacker.id, slot.id, target.id, rollD100, random);
}

function applyPlan(state, plan) {
  for (let index = 0; index < plan.steps.length; index++) assert.equal(applyAttackStep(state, plan, index).status, "applied");
}

test("positive shields absorb whole weapon hits without spillover or minimum damage", () => {
  for (const [weaponClass, damage, shield, armor, expected] of [
    ["kinetic", 8, 3, 3, [3]],
    ["energy", 8, 1, 2, [1]],
    ["explosive", 8, 2, 3, [2]],
    ["kinetic", 2, 2, 0, [2]],
    ["kinetic", 3, 1, 1, [1]]
  ]) {
    const slot = weapon({ weaponClass, damage });
    const { state, attacker, target } = battle([slot], { shield, armor, integrity: 20, kind: "squadron", unitHealth: 4, stack: 5 });
    slot.targetKinds = ["squadron"];
    assert.deepEqual(weaponHitDamage(target, slot).map(entry => entry.damage), expected);
    const preview = previewWeaponAttack(state, attacker.id, slot.id, target.id);
    const plan = planAttack(state, attacker, slot, target, () => 1);
    assert.equal(plan.steps[0].damage, expected.reduce((sum, value) => sum + value, 0));
    assert.equal(preview.potentialDamage, plan.steps[0].damage);
    applyPlan(state, plan);
    assert.deepEqual({ shield: target.shield, armor: target.armor, integrity: target.integrity, stack: target.stack }, plan.targetAfter);
    const events = state.events.filter(event => event.action === "damage");
    assert.equal(events.reduce((sum, event) => sum + event.before[event.layer] - event.after[event.layer], 0), preview.potentialDamage);
    assert.equal(target.stack, Math.ceil(target.integrity / 4));
  }
  assert.deepEqual(weaponHitDamage({ shield: 0, armor: 2, integrity: 4 }, weapon({ damage: 1 })).map(entry => entry.damage), []);
});

test("one penetrating hit destroys a stack once and stops later shots", () => {
  const slot = weapon({ damage: 20, shots: 3, targetKinds: ["squadron"] });
  const { state, attacker, target } = battle([slot], { kind: "squadron", shield: 3, armor: 3, integrity: 8, unitHealth: 4, stack: 2 });
  const plan = planAttack(state, attacker, slot, target, () => 1);
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].damage, 3);
  assert.equal(plan.steps[1].damage, 8);
  applyPlan(state, plan);
  assert.equal(target.stack, 0);
  assert.equal(state.events.filter(event => event.action === "destroy").length, 1);
});

test("blocker and target outcomes never exceed final accuracy", () => {
  for (const accuracy of [0, 20, 80, 100]) {
    let hits = 0;
    for (let roll = 1; roll <= 100; roll++) {
      const slot = weapon({ accuracy });
      const { state, attacker, target } = battle([slot], { baseEvasion: 5, movementEvasion: 5 });
      state.scenario.contents = [{ type: "debrisField", position: { ...target.position } }];
      state.units.push(unit({ id: "blocker", position: { q: 1, r: 0 }, mass: 200 }));
      const plan = planAttack(state, attacker, slot, target, () => roll);
      const step = plan.steps[0];
      assert.equal(step.blockerChance, Math.max(0, accuracy - 15));
      if (step.outcome !== "miss") hits++;
    }
    assert.equal(hits, Math.max(0, accuracy - 15));
  }
});

test("weapon readiness is derived and shared by manual fire and overwatch", () => {
  const slot = initializeWeaponState(weapon({ cooldownRounds: 1 }), 3);
  assert.deepEqual(weaponReadiness(slot), { ready: true, reason: null });
  assert.equal(beginWeaponCooldown(slot), true);
  assert.deepEqual(weaponReadiness(slot), { ready: false, reason: "Уже стреляло в этом раунде" });
  assert.equal(slot.overwatch, false);
  advanceWeaponRound(slot);
  assert.deepEqual(weaponReadiness(slot), { ready: false, reason: "Перезарядка 1 раунд" });
  advanceWeaponRound(slot);
  assert.deepEqual(weaponReadiness(slot), { ready: true, reason: null });
  resetUnitWeaponsForNewRound({ weapons: [slot] });
  assert.equal("ready" in slot, false);
});

test("nebula cover applies to both unit kinds and dispersion hit chance stays within bounds", () => {
  for (const kind of ["capital", "squadron"]) {
    const { state, attacker, target } = battle([weapon({ targetKinds: ["capital", "squadron"] })], { kind });
    const slot = attacker.weapons[0];
    const clear = previewWeaponAttack(state, attacker.id, slot.id, target.id).hitChance;
    state.scenario.contents = [{ type: "nebula", position: { ...target.position } }];
    assert.equal(previewWeaponAttack(state, attacker.id, slot.id, target.id).hitChance, clear - 15);
    attacker.dispersionActive = true;
    target.dispersionActive = true;
    slot.accuracy = 10;
    assert.equal(previewWeaponAttack(state, attacker.id, slot.id, target.id).hitChance, 0);
    slot.accuracy = 200;
    assert.equal(previewWeaponAttack(state, attacker.id, slot.id, target.id).hitChance, 100);
  }
});

test("overwatch route preview shares effective accuracy and shots with actual dispersed Hornet attacks", () => {
  for (const dispersed of [false, true]) {
    for (const stack of [1, 2]) {
      const state = createBattleState();
      const owner = state.units.find(unit => unit.id === "hornet-azure");
      const target = state.units.find(unit => unit.id === "mantis");
      state.units = [owner, target];
      state.scenario.contents = [];
      owner.position = { q: 0, r: 0 };
      owner.heading = 0;
      owner.stack = stack;
      owner.dispersionActive = dispersed;
      target.position = { q: 1, r: 0 };
      owner.weapons.forEach(slot => { slot.overwatch = true; });
      const before = JSON.stringify(state);
      const previews = aaPreviewDescriptors(state, target, target.position);
      assert.equal(JSON.stringify(state), before);
      assert.equal(previews.length, 2);
      const expected = dispersed ? 65 : 80;
      for (const preview of previews) {
        assert.equal(preview.probability, expected / 100);
        assert.equal(preview.max, stack * 200);
        assert.equal(preview.expectedHarm, expected / 100 * stack * 200);
      }
      const plan = planPostEntryAA(state, target, {}, () => expected + 1, () => 0);
      assert.ok(plan);
      assert.equal(plan.steps.length, stack * 2);
      assert.ok(plan.steps.every(step => step.chance === previews[0].probability * 100 && step.outcome === "miss"));
    }
  }
});

test("dispersion applies to manual and overwatch attacks and attack history survives readiness restoration", () => {
  for (const reaction of [false, true]) {
    const state = createBattleState();
    const owner = state.units.find(unit => unit.id === "hornet-azure");
    const target = state.units.find(unit => unit.id === "mantis");
    state.units = [owner, target];
    state.initiativeOrder = [owner.id, target.id];
    state.scenario.contents = [{ type: "nebula", position: { q: 1, r: 0 } }];
    owner.position = { q: 0, r: 0 };
    owner.heading = 0;
    target.position = { q: 1, r: 0 };
    target.baseEvasion = 10;
    target.dispersionActive = true;
    state.activeUnitId = owner.id;
    state.lifecycle = "WaitDecision";
    beginActivation(state);
    assert.ok(beginActionPlanning(state, { type: "system-action", systemActionId: "dispersion", reason: "player-choice" }));
    assert.ok(confirmSystemAction(state));
    const slot = owner.weapons[0];
    assert.equal(previewWeaponAttack(state, owner.id, slot.id, target.id).hitChance, 35);
    if (reaction) {
      slot.overwatch = true;
      const plan = planPostEntryAA(state, target, {}, () => 36, () => 0);
      assert.ok(plan);
      assert.ok(plan.steps.every(step => step.outcome === "miss"));
      for (let index = 0; index < plan.steps.length; index++) assert.equal(applyReactionStep(state, plan, index).status, "applied");
    } else {
      const plan = planAttack(state, owner, slot, target, () => 36);
      assert.ok(plan.steps.every(step => step.outcome === "miss"));
      applyPlan(state, plan);
    }
    assert.equal(owner.attackedThisRound, true);
    owner.weapons.forEach(slot => { slot.firedThisRound = false; slot.cooldownRemaining = 0; });
    owner.dispersionActive = false;
    owner.usedSystemActions = [];
    owner.activationStartedThisRound = false;
    state.lifecycle = "WaitDecision";
    beginActivation(state);
    assert.ok(actionAvailability(state, { type: "system-action", systemActionId: "dispersion", reason: "player-choice" }).reasons.some(reason => reason.message.includes("после собственной атаки")));
    state.units = [owner];
    state.initiativeOrder = [owner.id];
    endActivation(state);
    assert.equal(owner.attackedThisRound, false);
    assert.equal(actionAvailability(state, { type: "system-action", systemActionId: "dispersion", reason: "player-choice" }).available, true);
  }
});

test("an explicitly enabled squadron hardpoint enters overwatch at activation end", () => {
  const aa = weapon({ hardpointId: "aa", targetKinds: ["capital", "squadron"] });
  const squadron = unit({ kind: "squadron", overwatchHardpointIds: ["aa"], weapons: [aa] });
  const enemy = unit({ id: "enemy", sideId: "crimson", weapons: [] });
  const state = battle([]).state;
  state.units = [squadron, enemy];
  state.activeUnitId = squadron.id;
  state.initiativeOrder = [squadron.id, enemy.id];

  assert.deepEqual(endActivation(state), { newRound: false });
  assert.equal(aa.overwatch, true);

  state.activeUnitId = squadron.id;
  state.lifecycle = "ActionChoice";
  assert.ok(beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: aa.id }));
  assert.equal(aa.overwatch, true);
});

test("existing squadrons cannot react while both hornet slots independently react on one step", () => {
  const state = createBattleState();
  for (const id of ["wasps", "mantis", "kiro"]) {
    const owner = state.units.find(unit => unit.id === id);
    for (const slot of owner.weapons) {
      slot.overwatch = true;
      assert.equal(overwatchAvailability(owner, slot).readiness.eligible, false);
    }
  }
  const owner = state.units.find(unit => unit.id === "hornet-azure");
  const target = state.units.find(unit => unit.id === "mantis");
  state.units = [owner, target];
  state.scenario.contents = [];
  owner.position = { q: 0, r: 0 };
  owner.heading = 0;
  target.position = { q: 1, r: 0 };
  target.baseEvasion = 0;
  owner.weapons.forEach(slot => { slot.overwatch = true; });
  const preview = aaPreviewDescriptors(state, target, target.position);
  assert.deepEqual(preview.map(entry => entry.max), [400, 400]);
  const outcomes = resolvePostEntryAA(state, target, {}, () => 1, () => 0);
  assert.equal(outcomes.length, 2);
  assert.equal(owner.weapons.every(slot => slot.firedThisRound && !slot.overwatch), true);
  assert.equal(target.integrity, 700);
  owner.weapons.forEach(slot => { slot.firedThisRound = false; slot.overwatch = true; });
  state.activeUnitId = owner.id;
  state.lifecycle = "ActionChoice";
  applyPlan(state, planAttack(state, owner, owner.weapons[0], target, () => 100));
  endActivation(state);
  assert.equal(owner.weapons[0].overwatch, false);
  assert.equal(owner.weapons[1].overwatch, true);
  owner.weapons[1].targetKinds = ["capital"];
  assert.equal(overwatchAvailability(owner, owner.weapons[1]).readiness.eligible, false);
});

test("planning one slot and target is pure until confirmation", () => {
  const first = weapon({ energyCost: 2 });
  const second = weapon({ id: "second", slotOrder: 1, energyCost: 1 });
  const { state, attacker, target } = battle([first, second]);
  attacker.reactor = { capacity: 4, currentEnergy: 4, rechargeRate: 1 };
  const other = unit({ id: "other", sideId: "crimson", position: { q: 3, r: 0 } });
  state.units.push(other);
  const before = structuredClone({ energy: attacker.reactor.currentEnergy, first, second, target, other });

  beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: first.id });
  assert.equal(previewWeaponAttack(state, attacker.id, first.id, target.id).canConfirm, true);
  assert.equal(previewWeaponAttack(state, attacker.id, first.id, other.id).canConfirm, true);
  assert.equal(state.activeAction.slotId, first.id);
  assert.deepEqual({ energy: attacker.reactor.currentEnergy, first, second, target, other }, before);
});

test("single-slot preview is pure and exposes domain reasons", () => {
  const gun = weapon({ energyCost: 2 });
  const { state, attacker, target } = battle([gun]);
  attacker.reactor = { capacity: 4, currentEnergy: 4, rechargeRate: 1 };
  const before = structuredClone(state);
  const preview = previewWeaponAttack(state, attacker.id, gun.id, target.id);
  assert.equal(preview.canConfirm, true);
  assert.deepEqual(preview.reasons, []);
  assert.deepEqual({ shots: preview.shots, effectiveRange: preview.effectiveRange, maxRange: preview.maxRange }, { shots: 1, effectiveRange: 3, maxRange: 6 });
  assert.deepEqual(state, before);
  assert.deepEqual(previewWeaponAttack(state, "missing", gun.id, target.id).reasons, ["Атакующий отсутствует"]);
  assert.deepEqual(previewWeaponAttack(state, attacker.id, "missing", target.id).reasons, ["Оружейный слот отсутствует"]);
  assert.deepEqual(previewWeaponAttack(state, attacker.id, gun.id, "missing").reasons, ["Цель отсутствует"]);
  target.position = { q: 7, r: 0 };
  assert.deepEqual(previewWeaponAttack(state, attacker.id, gun.id, target.id).reasons, ["Вне дальности"]);
});

test("squadron preview scales shots from its surviving stack", () => {
  const gun = weapon({ targetKinds: ["capital", "squadron"], shots: 2 });
  const { state, attacker, target } = battle([gun]);
  attacker.kind = "squadron";
  attacker.stack = 3;
  assert.equal(previewWeaponAttack(state, attacker.id, gun.id, target.id).shots, 6);
});

test("confirming one slot spends it and energy exactly once before resolution", () => {
  const gun = weapon({ shots: 2, energyCost: 2, cooldownRounds: 1 });
  const reserve = weapon({ id: "reserve", slotOrder: 1 });
  const { state, attacker, target } = battle([gun, reserve]);
  attacker.reactor = { capacity: 5, currentEnergy: 5, rechargeRate: 1 };
  const plan = planAttack(state, attacker, gun, target, () => 100, () => 0);
  assert.ok(plan);
  assert.equal(plan.slotId, gun.id);
  assert.equal(plan.steps.length, 2);
  assert.equal(Object.isFrozen(plan.steps[0]), true);
  assert.equal(attacker.reactor.currentEnergy, 3);
  assert.equal(gun.firedThisRound, true);
  assert.equal(reserve.firedThisRound, false);
  assert.equal(planAttack(state, attacker, reserve, target, () => 1, () => 0), null);
  assert.equal(endActivation(state), null);
  applyPlan(state, plan);
  assert.equal(attacker.reactor.currentEnergy, 3);
  assert.equal(state.lifecycle, "ActionChoice");
});

test("confirmation revalidates changed range, arc, energy, and readiness without spending", async t => {
  const cases = [
    ["range", ({ target }) => { target.position = { q: 7, r: 0 }; }],
    ["arc", ({ target, slot }) => { slot.mount = "battery-left"; target.position = { q: 2, r: 0 }; }],
    ["energy", ({ attacker }) => { attacker.reactor.currentEnergy = 0; }],
    ["readiness", ({ slot }) => { slot.firedThisRound = true; }]
  ];

  for (const [name, change] of cases) await t.test(name, () => {
    const slot = weapon({ energyCost: 1 });
    const { state, attacker, target } = battle([slot]);
    attacker.reactor = { capacity: 3, currentEnergy: 3, rechargeRate: 1 };
    beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: slot.id });
    change({ state, attacker, target, slot });
    const energy = attacker.reactor.currentEnergy;

    assert.equal(confirmWeaponAttackAction(state, attacker.id, slot.id, target.id, () => 1, () => 0), null);
    assert.equal(attacker.reactor.currentEnergy, energy);
    assert.equal(state.attackApplication, null);
    assert.equal(state.events.length, 0);
  });
});

test("selected target preview becomes stale after position, heading, cost, or resource changes", async t => {
  const cases = [
    ["position", ({ target }) => { target.position = { q: 7, r: 0 }; }],
    ["heading", ({ attacker }) => { attacker.heading = 3; }],
    ["cost", ({ slot }) => { slot.energyCost = 4; }],
    ["resource", ({ attacker }) => { attacker.reactor.currentEnergy = 0; }]
  ];

  for (const [name, change] of cases) await t.test(name, () => {
    const slot = weapon({ mount: "forward", maxRange: 3, energyCost: 1 });
    const { state, attacker, target } = battle([slot]);
    attacker.reactor = { capacity: 3, currentEnergy: 3, rechargeRate: 1 };
    attacker.activationEnergyBudget = 3;
    beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: slot.id });
    const preview = previewWeaponAttack(state, attacker.id, slot.id, target.id);
    assert.equal(preview.canConfirm, true);

    change({ attacker, target, slot });

    assert.equal(confirmWeaponAttackAction(state, preview.attackerId, preview.slotId, preview.targetId, () => 1, () => 0), null);
    assert.equal(state.attackApplication, null);
    assert.equal(attacker.energySpent || 0, 0);
  });
});

test("applyAttackStep rejects forged and stale plans without replacing confirmed progress", () => {
  const gun = weapon({ shots: 2 });
  const { state, attacker, target } = battle([gun]);
  const plan = planAttack(state, attacker, gun, target, () => 1, () => 0);
  const forged = structuredClone(plan);
  forged.id = "forged-plan";
  const copied = structuredClone(plan);
  const progress = state.attackApplication;
  const before = structuredClone({ progress, target, events: state.events, log: state.log });
  assert.deepEqual(applyAttackStep(state, forged, 0), { status: "invalid" });
  assert.deepEqual(applyAttackStep(state, copied, 0), { status: "invalid" });
  assert.equal(state.attackApplication, progress);
  assert.deepEqual({ progress: state.attackApplication, target, events: state.events, log: state.log }, before);
  applyPlan(state, plan);
  const completed = structuredClone({ target, events: state.events, log: state.log });
  assert.deepEqual(applyAttackStep(state, plan, 0), { status: "invalid" });
  assert.equal(state.attackApplication, null);
  assert.deepEqual({ target, events: state.events, log: state.log }, completed);
});

test("manual damage events retain the confirmed attack action and plan context", () => {
  const gun = weapon({ damage: 40 });
  const { state, attacker, target } = battle([gun], { shield: 0, armor: 0, integrity: 30 });
  const survivor = unit({ id: "survivor", sideId: "crimson", position: { q: 4, r: 0 } });
  state.units.push(survivor);
  state.initiativeOrder.push(survivor.id);
  const plan = planAttack(state, attacker, gun, target, () => 1, () => 0);
  const declaration = state.events.find(event => event.action === "activation-action-confirm");
  applyPlan(state, plan);
  const damage = state.events.find(event => event.action === "damage");
  const destruction = state.events.find(event => event.action === "destroy");
  assert.equal(plan.actionId, declaration.eventId);
  assert.deepEqual(
    { planId: damage.planId, actionId: damage.actionId, causeEventId: damage.causeEventId },
    { planId: plan.id, actionId: declaration.eventId, causeEventId: declaration.eventId }
  );
  assert.deepEqual(
    { planId: destruction.planId, actionId: destruction.actionId, causeEventId: destruction.causeEventId },
    { planId: plan.id, actionId: declaration.eventId, causeEventId: damage.eventId }
  );
});

test("maneuvered position and heading are used when confirming the next attack", () => {
  const gun = weapon({ mount: "forward", maxRange: 2 });
  const { state, attacker, target } = battle([gun]);
  target.position = { q: 2, r: -1 };
  beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: gun.id });
  assert.equal(previewWeaponAttack(state, attacker.id, gun.id, target.id).canConfirm, true);
  state.activeAction = null;
  state.lifecycle = "ActionChoice";
  attacker.position = { q: 1, r: 0 };
  attacker.heading = 3;
  beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: gun.id });

  assert.equal(confirmWeaponAttackAction(state, attacker.id, gun.id, target.id, () => 1, () => 0), null);
  assert.deepEqual(previewWeaponAttack(state, attacker.id, gun.id, target.id).reasons, ["Вне сектора"]);
});

test("sequential attacks have distinct action contexts and may choose different targets", () => {
  const first = weapon({ id: "first" });
  const second = weapon({ id: "second", slotOrder: 1 });
  const { state, attacker, target } = battle([first, second]);
  const other = unit({ id: "other", sideId: "crimson", position: { q: 3, r: 0 }, shield: 8, armor: 8, integrity: 12 });
  state.units.push(other);
  const firstPlan = planAttack(state, attacker, first, target, () => 100, () => 0);
  applyPlan(state, firstPlan);
  const secondPlan = planAttack(state, attacker, second, other, () => 100, () => 0);
  applyPlan(state, secondPlan);
  assert.notEqual(firstPlan.id, secondPlan.id);
  assert.equal(state.lifecycle, "ActionChoice");
  assert.equal(state.activeUnitId, attacker.id);
});

test("blocker cover remains probabilistic and can absorb a shot", () => {
  const gun = weapon({ accuracy: 100 });
  const { state, attacker, target } = battle([gun]);
  const blocker = unit({ id: "blocker", sideId: "crimson", position: { q: 1, r: 0 }, mass: 200, shield: 0, armor: 0, integrity: 10 });
  state.units.push(blocker);
  const preview = previewWeaponAttack(state, attacker.id, gun.id, target.id);
  assert.equal(preview.canConfirm, true);
  assert.equal(preview.cover, 100);
  assert.equal(preview.blocker.id, blocker.id);
  const plan = planAttack(state, attacker, gun, target, () => 1, () => 0);
  assert.equal(plan.steps[0].outcome, "blocked");
  applyPlan(state, plan);
  assert.equal(blocker.integrity < 10, true);
});

test("single-slot arc and targets use the same domain validation", () => {
  const gun = weapon({ mount: "battery-left" });
  const { state, attacker, target } = battle([gun]);
  target.position = { q: 0, r: -2 };
  assert.equal(weaponAttackArc(state, attacker.id, gun.id).has("0,-2"), true);
  assert.deepEqual(availableWeaponAttackTargets(state, attacker.id, gun.id).map(candidate => candidate.id), [target.id]);
  assert.deepEqual(supercoverLine({ q: 0, r: 0 }, { q: 2, r: -1 }), [{ q: 0, r: 0 }, { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 2, r: -1 }]);
});

test("manual AA fire consumes the readiness needed for a later reaction", () => {
  const aa = weapon({ targetKinds: ["capital", "squadron"], overwatch: true });
  const { state, attacker, target } = battle([aa], { kind: "squadron", stack: 2, unitHealth: 5 });
  applyPlan(state, planAttack(state, attacker, aa, target, () => 100, () => 0));
  assert.equal(aa.firedThisRound, true);
  assert.equal(aa.overwatch, false);
  assert.equal(resolvePostEntryAA(state, target, {}, () => 100, () => 0).length, 0);
});

test("last activation overwatch survives the round boundary until the owner's first action", () => {
  const aa = weapon({ targetKinds: ["squadron"] });
  const owner = unit({ id: "owner", sideId: "crimson", weapons: [aa] });
  const target = unit({ id: "fighter", kind: "squadron", sideId: "azure", position: { q: 1, r: 0 }, stack: 2, unitHealth: 5, weapons: [] });
  const state = battle([]).state;
  state.units = [target, owner];
  state.activeUnitId = owner.id;
  state.initiativeOrder = [target.id, owner.id];
  state.lifecycle = "ActionChoice";
  target.hasActivated = true;
  target.activationStartedThisRound = true;
  owner.activationStartedThisRound = true;

  assert.deepEqual(endActivation(state), { newRound: true });
  assert.equal(aa.overwatch, true);
  assert.equal(state.activeUnitId, target.id);
  assert.equal(state.roundNumber, 2);
  assert.equal(resolvePostEntryAA(state, target, { planId: "opening-move", elementIndex: 0, causeEventId: "move" }, () => 100, () => 0).length, 1);
  assert.equal(aa.overwatch, false);
});

test("overwatch survives preview, cancel, and Wait until the owner's first confirmed action", () => {
  const aa = weapon({ targetKinds: ["squadron"], overwatch: true });
  const owner = unit({ id: "owner", sideId: "crimson", weapons: [aa], canWait: true, hasWaited: false });
  const target = unit({ id: "target", kind: "squadron", sideId: "azure", position: { q: 2, r: 0 }, canWait: true, hasWaited: false });
  const state = battle([]).state;
  state.units = [owner, target];
  state.activeUnitId = owner.id;
  state.initiativeOrder = [owner.id, target.id];
  state.lifecycle = "ActionChoice";

  assert.ok(beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: aa.id }));
  assert.equal(aa.overwatch, true);
  assert.equal(cancelActionPlanning(state), true);
  assert.equal(aa.overwatch, true);
  assert.equal(waitActiveUnit(state), true);
  assert.equal(aa.overwatch, true);

  state.activeUnitId = owner.id;
  state.lifecycle = "ActionChoice";
  assert.ok(beginActionPlanning(state, { type: "weapon-attack", reason: "player-choice", slotId: aa.id }));
  assert.ok(confirmWeaponAttackAction(state, owner.id, aa.id, target.id, () => 100, () => 0));
  assert.equal(aa.overwatch, false);
});

test("an unused AA slot enters overwatch at explicit activation end and reaction consumes persistent stored energy", () => {
  const aa = weapon({ targetKinds: ["squadron"], energyCost: 1 });
  const owner = unit({ id: "owner", sideId: "crimson", weapons: [aa], reactor: { capacity: 3, currentEnergy: 2, rechargeRate: 1 }, activationEnergyBudget: 0, energySpent: 0 });
  const target = unit({ id: "fighter", kind: "squadron", sideId: "azure", position: { q: 1, r: 0 }, stack: 2, unitHealth: 5 });
  const ally = unit({ id: "ally", sideId: "crimson", position: { q: -2, r: 0 }, weapons: [] });
  const state = battle([]).state;
  state.units = [owner, ally, target];
  state.activeUnitId = owner.id;
  state.initiativeOrder = [owner.id, ally.id, target.id];
  state.lifecycle = "ActionChoice";
  endActivation(state);
  assert.equal(aa.overwatch, true);
  state.activeUnitId = target.id;
  const outcomes = resolvePostEntryAA(state, target, { planId: "maneuver-plan", elementIndex: 2, causeEventId: "move" }, () => 1, () => 0);
  assert.equal(outcomes.length, 1);
  assert.equal(state.attackApplication, null);
  assert.equal(aa.firedThisRound, true);
  assert.equal(aa.overwatch, false);
  assert.equal(owner.reactor.currentEnergy, 1);
  assert.equal(owner.energySpent, 0);
  const damage = state.events.find(event => event.action === "damage");
  assert.deepEqual({ planId: damage.planId, elementIndex: damage.elementIndex }, { planId: "maneuver-plan", elementIndex: 2 });
});

test("a missed reaction spends shared readiness when declared and keeps maneuver action context", () => {
  const aa = weapon({ targetKinds: ["squadron"], overwatch: true });
  const owner = unit({ id: "owner", sideId: "crimson", weapons: [aa] });
  const target = unit({ id: "fighter", kind: "squadron", sideId: "azure", position: { q: 1, r: 0 }, stack: 2, unitHealth: 5 });
  const state = battle([]).state;
  state.units = [owner, target];
  state.activeUnitId = target.id;
  state.initiativeOrder = [owner.id, target.id];
  const context = { activationId: "activation-7", actionId: "maneuver-8", actionType: "maneuver", actionReason: "player-choice", planId: "route-9", elementIndex: 1, causeEventId: "move-10" };
  let readinessDuringRoll = null;

  const outcomes = resolvePostEntryAA(state, target, context, () => {
    readinessDuringRoll = weaponReadiness(aa);
    return 100;
  }, () => 0);

  assert.equal(outcomes.length, 1);
  assert.deepEqual(readinessDuringRoll, { ready: false, reason: "Уже стреляло в этом раунде" });
  assert.equal(aa.overwatch, false);
  assert.equal(target.integrity, 20);
  const declaration = state.events.find(event => event.action === "aa-reaction-declare");
  const miss = state.events.find(event => event.action === "aa-reaction-miss");
  assert.deepEqual({ activationId: declaration.activationId, actionId: declaration.actionId, maneuverActionId: declaration.maneuverActionId, causeEventId: declaration.causeEventId }, {
    activationId: context.activationId,
    actionId: declaration.eventId,
    maneuverActionId: context.actionId,
    causeEventId: context.causeEventId
  });
  assert.deepEqual({ actionId: miss.actionId, causeEventId: miss.causeEventId, eventOrder: miss.eventOrder, elementIndex: miss.elementIndex }, {
    actionId: declaration.eventId,
    causeEventId: context.causeEventId,
    eventOrder: declaration.eventOrder + 1,
    elementIndex: context.elementIndex
  });
  assert.equal(state.log.some(entry => /промах/.test(entry.message)), false);
});

test("reaction hit and miss plans expose weapon visuals before explicit result application", async t => {
  for (const [name, roll, outcome, integrity] of [["hit", 1, "hit", 16], ["miss", 100, "miss", 20]]) await t.test(name, () => {
    const aa = weapon({ targetKinds: ["squadron"], overwatch: true, accuracy: 80, damage: 4 });
    const owner = unit({ id: "owner", sideId: "crimson", weapons: [aa] });
    const target = unit({ id: "fighter", kind: "squadron", sideId: "azure", position: { q: 1, r: 0 }, stack: 4, unitHealth: 5 });
    const state = battle([]).state;
    state.units = [owner, target];
    state.activeUnitId = target.id;
    state.initiativeOrder = [owner.id, target.id];

    const plan = planPostEntryAA(state, target, { planId: "route", elementIndex: 0, causeEventId: "move" }, () => roll, () => 0);

    assert.ok(plan);
    assert.equal(plan.steps[0].visual, aa.visual);
    assert.equal(plan.steps[0].outcome, outcome);
    assert.equal(target.integrity, 20);
    assert.equal(aa.firedThisRound, true);
    assert.equal(aa.overwatch, false);
    assert.equal(state.events.some(event => event.action === "damage"), false);
    assert.equal(applyReactionStep(state, plan, 0).status, "applied");
    assert.equal(target.integrity, integrity);
    assert.equal(state.reactionApplication, null);
  });
});

test("reaction continues after an intermediate blocker is destroyed while the moving target survives", () => {
  const aa = weapon({ targetKinds: ["squadron"], shots: 2, damage: 20, accuracy: 100, overwatch: true });
  const owner = unit({ id: "owner", sideId: "crimson", weapons: [aa] });
  const blocker = unit({ id: "blocker", sideId: "azure", position: { q: 1, r: 0 }, mass: 200, shield: 0, armor: 0, integrity: 10, maxIntegrity: 10 });
  const target = unit({ id: "fighter", kind: "squadron", sideId: "azure", position: { q: 2, r: 0 }, stack: 4, unitHealth: 10, integrity: 40, maxIntegrity: 40 });
  const state = battle([]).state;
  state.units = [owner, blocker, target];
  state.activeUnitId = target.id;
  state.initiativeOrder = [owner.id, target.id, blocker.id];

  const outcomes = resolvePostEntryAA(state, target, { planId: "maneuver", elementIndex: 0, causeEventId: "move" }, () => 1, () => 0);

  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].steps.length, 2);
  assert.equal(state.units.includes(blocker), false);
  assert.equal(target.integrity, 20);
  assert.equal(state.attackApplication, null);
});

test("ordinary weapon attack resolution never opens an AA reaction window", () => {
  const aa = weapon({ targetKinds: ["squadron"], overwatch: true });
  const owner = unit({ id: "owner", sideId: "crimson", weapons: [aa] });
  const target = unit({ id: "fighter", kind: "squadron", sideId: "azure", position: { q: 1, r: 0 }, stack: 2, unitHealth: 5 });
  const state = battle([]).state;
  state.units = [owner, target];
  state.attackApplication = { planId: "ordinary-attack" };
  const before = structuredClone({ aa, events: state.events, sequence: state.sequence, target });

  assert.deepEqual(resolvePostEntryAA(state, target, { causeEventId: "attack-step" }, () => 1, () => 0), []);
  assert.deepEqual({ aa, events: state.events, sequence: state.sequence, target }, before);
});

test("winner prevents activation end from mutating queue or round", () => {
  const { state, attacker } = battle([]);
  state.winner = attacker.sideId;
  const before = structuredClone(state);
  assert.equal(endActivation(state), null);
  assert.deepEqual(state, before);
});

test("runtime readiness uses only per-slot weapon state", () => {
  const state = createBattleState();
  assert.equal(state.units.every(candidate => candidate.weapons.every(slot => "firedThisRound" in slot)), true);
});
