import assert from "node:assert/strict";
import {
  applyAttackStep,
  attackArc,
  attackPreview,
  availableAttackTargets,
  planAttack,
  resolveAttack,
  resolvePostEntryAA,
  supercoverLine
} from "./battle.js";
import {
  advanceWeaponRound,
  beginActivation,
  beginWeaponCooldown,
  createBattleState,
  endActivation,
  hexDistance,
  initializeWeaponState,
  resetUnitWeaponsForNewRound
} from "./domain.js";

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
    stage: "attack",
    lifecycle: "Attack",
    roundNumber: 1,
    winner: null,
    log: [],
    events: [],
    sequence: 0
  };
  return { state, attacker, target };
}

{
  const slot = initializeWeaponState(weapon({ cooldownRounds: 1 }), 3);
  assert.equal(slot.slotOrder, 0);
  beginWeaponCooldown(slot);
  assert.deepEqual({ fired: slot.firedThisRound, cooldown: slot.cooldownRemaining }, { fired: true, cooldown: 1 });
  advanceWeaponRound(slot);
  assert.deepEqual({ fired: slot.firedThisRound, cooldown: slot.cooldownRemaining }, { fired: false, cooldown: 1 });
  advanceWeaponRound(slot);
  assert.equal(slot.cooldownRemaining, 0);
  const unused = initializeWeaponState(weapon({ cooldownRounds: 2 }));
  resetUnitWeaponsForNewRound({ weapons: [unused] });
  assert.deepEqual({ fired: unused.firedThisRound, cooldown: unused.cooldownRemaining }, { fired: false, cooldown: 0 });
}

{
  const state = createBattleState();
  for (const candidate of state.units) {
    assert.equal("primaryReady" in candidate, false);
    assert.equal("auxiliaryReady" in candidate, false);
    candidate.weapons.forEach((slot, slotOrder) => {
      assert.equal(slot.weaponId.length > 0, true);
      assert.equal(slot.slotOrder, slotOrder);
      assert.equal(slot.firedThisRound, false);
      assert.equal(slot.cooldownRemaining, 0);
      assert.equal("ready" in slot, false);
    });
  }
}

{
  const antiCapital = weapon();
  const antiAir = weapon({ id: "slot-aa", weaponId: "catalog-aa", slotOrder: 1, targetKinds: ["capital", "squadron"] });
  const { state, target } = battle([antiCapital, antiAir], { kind: "squadron", stack: 3, unitHealth: 4 });
  const selection = new Set([antiCapital.id, antiAir.id]);
  const preview = attackPreview(state, target.id, selection);
  assert.deepEqual(preview.included.map(item => item.id), [antiAir.id]);
  assert.equal(preview.excluded.find(item => item.id === antiCapital.id).reason, "Недопустимый тип цели");
  assert.equal(preview.canConfirm, false);
  assert.deepEqual(availableAttackTargets(state, selection).map(item => item.id), [target.id]);
  assert.equal(planAttack(state, target.id, selection, () => 1, () => 0), null);
  assert.equal(planAttack(state, target.id, new Set([antiAir.id, "missing-slot"]), () => 1, () => 0), null);
  assert.throws(() => attackPreview(state, target.id, "primary"), TypeError);
}

{
  const costly = weapon({ energyCost: 3 });
  const { state, attacker, target } = battle([costly]);
  let preview = attackPreview(state, target.id, new Set([costly.id]));
  assert.equal(preview.canConfirm, false);
  assert.deepEqual({ required: preview.energyRequired, available: preview.energyAvailable }, { required: 3, available: 0 });
  attacker.reactor = { capacity: 5, currentEnergy: 2, rechargeRate: 1 };
  preview = attackPreview(state, target.id, new Set([costly.id]));
  assert.equal(preview.canConfirm, false);
  attacker.reactor.currentEnergy = 3;
  assert.equal(attackPreview(state, target.id, new Set([costly.id])).canConfirm, true);
}

{
  const guns = weapon({ mount: "squadronWeapon", firingArc: "forward", targetKinds: ["capital", "squadron"], shots: 2, damage: 1 });
  const { state, attacker, target } = battle([guns]);
  attacker.kind = "squadron";
  attacker.stack = 3;
  const preview = attackPreview(state, target.id, new Set([guns.id]));
  assert.equal(preview.included[0].shots, 6);
  assert.equal(preview.shots, 6);
  assert.equal(planAttack(state, target.id, new Set([guns.id]), () => 100, () => 0).steps.length, 6);
}

{
  const explosive = weapon({ id: "slot-explosive", weaponId: "explosive", slotOrder: 0, weaponClass: "explosive", delivery: "missile", damage: 4 });
  const kineticLater = weapon({ id: "slot-kinetic-later", weaponId: "kinetic-later", slotOrder: 2, damage: 8 });
  const kineticFirst = weapon({ id: "slot-kinetic-first", weaponId: "kinetic-first", slotOrder: 1, damage: 8 });
  const { state, target } = battle([explosive, kineticLater, kineticFirst], { shield: 1, armor: 20 });
  const plan = planAttack(state, target.id, new Set([explosive.id, kineticLater.id, kineticFirst.id]), () => 1, () => 0);
  assert.deepEqual(plan.weapons.map(item => item.slotId), [kineticFirst.id, explosive.id, kineticLater.id]);
  assert.equal(plan.steps[0].layer, "shield");
  assert.equal(plan.steps[1].layer, "armor");
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.steps[0].endpoint), true);
  assert.equal(target.shield, 1);
  assert.equal(target.armor, 20);
}

{
  const miss = weapon({ delivery: "beam", weaponClass: "energy", visual: { projectile: "beam", launchIntervalMs: 0 } });
  const { state, target } = battle([miss]);
  const plan = planAttack(state, target.id, new Set([miss.id]), () => 100, () => 0.25);
  assert.equal(plan.steps[0].outcome, "miss");
  assert.notDeepEqual(plan.steps[0].endpoint, target.position);
  assert.deepEqual(plan.steps[0].targetAfter, plan.steps[0].targetBefore);
  assert.equal(plan.steps[0].duration, Math.max(120, Math.round(hexDistance({ q: 0, r: 0 }, plan.steps[0].endpoint) / (miss.visual.speedHexesPerSecond || 1) * 1000)));
}

{
  const burst = weapon({ shots: 3, visual: { projectile: "tracer", color: "#fff", size: 0.1, speedHexesPerSecond: 5, launchIntervalMs: 100, trail: "short", impact: "spark", impactRadius: 0.1 } });
  const { state, target } = battle([burst]);
  const plan = planAttack(state, target.id, new Set([burst.id]), () => 100, () => 0);
  assert.deepEqual(plan.steps.map(step => step.launchTime), [0, 100, 200]);
  assert.deepEqual(plan.steps.map(step => step.arrivalTime), plan.steps.map(step => step.launchTime + step.duration));
  assert.equal(plan.steps[1].launchTime - plan.steps[0].launchTime, burst.visual.launchIntervalMs);
  assert.equal(planAttack(state, target.id, new Set([burst.id]), () => 100, () => 0), null);
  assert.equal(attackPreview(state, target.id, new Set([burst.id])).salvoAvailable, false);
}

{
  const accurate = weapon({ id: "accurate", accuracy: 90 });
  const inaccurate = weapon({ id: "inaccurate", accuracy: 50, slotOrder: 1 });
  const { state, target } = battle([accurate, inaccurate], { baseEvasion: 10 });
  const preview = attackPreview(state, target.id, new Set([accurate.id, inaccurate.id]));
  assert.deepEqual(preview.hitChances, { accurate: 80, inaccurate: 40 });
}

{
  const killer = weapon({ id: "slot-killer", weaponId: "killer", slotOrder: 0, weaponClass: "explosive", damage: 20, energyCost: 2, cooldownRounds: 1 });
  const unused = weapon({ id: "slot-unused", weaponId: "unused", slotOrder: 1, energyCost: 3, cooldownRounds: 1 });
  const { state, attacker, target } = battle([killer, unused], { shield: 0, armor: 0, integrity: 1 });
  attacker.reactor = { capacity: 8, currentEnergy: 5, rechargeRate: 1 };
  const plan = planAttack(state, target.id, new Set([killer.id, unused.id]), () => 1, () => 0);
  assert.deepEqual(plan.weapons.map(item => item.slotId), [killer.id]);
  assert.equal(applyAttackStep(state, plan, 0).status, "applied");
  assert.equal(attacker.reactor.currentEnergy, 3);
  assert.equal(killer.firedThisRound, true);
  assert.equal(killer.cooldownRemaining, 1);
  assert.equal(unused.firedThisRound, false);
  assert.equal(state.units.includes(target), false);
  assert.equal(state.scenario.contents.some(item => item.type === "debrisField"), true);
}

{
  const gun = weapon();
  const { state, attacker } = battle([gun]);
  assert.equal(planAttack(state, attacker.id, new Set([gun.id]), () => 1, () => 0), null);
}

{
  const gun = weapon();
  const { state, target } = battle([gun]);
  assert.equal(resolveAttack(state, target.id, new Set([gun.id]), () => 1, () => 0), true);
  assert.equal(gun.firedThisRound, true);
  assert.equal(target.shield < 8, true);
  assert.equal(resolveAttack(state, target.id, new Set([gun.id]), () => 1, () => 0), false);
}

{
  const gun = weapon({ targetKinds: ["capital", "squadron"] });
  const { state, attacker, target } = battle([gun]);
  attacker.salvoCommitted = true;
  beginActivation(state);
  assert.equal(attacker.salvoCommitted, false);
  attacker.salvoCommitted = true;
  endActivation(state);
  assert.equal(attacker.salvoCommitted, false);
  assert.equal(gun.overwatch, true);
  beginActivation(state);
  assert.equal(gun.overwatch, true);
}

{
  const gun = weapon({ mount: "battery-left" });
  const { state } = battle([gun]);
  const arc = attackArc(state, new Set([gun.id]));
  assert.equal(arc.has("0,-2"), true);
  assert.equal(arc.has("2,0"), false);
  assert.deepEqual(supercoverLine({ q: 0, r: 0 }, { q: 2, r: -1 }), [{ q: 0, r: 0 }, { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 2, r: -1 }]);
}

{
  const manual = weapon({ id: "manual", mount: "battery-left", targetKinds: ["squadron"] });
  const reactor = unit({ id: "reactor", sideId: "crimson", position: { q: 0, r: 0 }, heading: 0, weapons: [manual] });
  const target = unit({ id: "fighter", kind: "squadron", sideId: "azure", position: { q: 0, r: -2 }, stack: 2, unitHealth: 5 });
  const state = battle([]).state;
  state.units = [target, reactor];
  state.activeUnitId = target.id;
  state.stage = "attack";
  assert.deepEqual(attackPreview(state, target.id, new Set([manual.id]), reactor).included.map(item => item.id), [manual.id]);
  assert.equal(attackArc(state, new Set([manual.id]), reactor).has("0,-2"), true);
  assert.deepEqual(availableAttackTargets(state, new Set([manual.id]), reactor).map(item => item.id), [target.id]);
  assert.equal(planAttack(state, target.id, new Set([manual.id]), () => 100, () => 0, reactor), null);
  assert.equal(reactor.salvoCommitted, undefined);
}

{
  const manual = weapon({ id: "manual", targetKinds: ["squadron"] });
  const reactor = unit({ id: "reactor", sideId: "crimson", position: { q: 0, r: 0 }, weapons: [manual] });
  const target = unit({ id: "fighter", kind: "squadron", sideId: "azure", position: { q: 1, r: 0 }, stack: 2, unitHealth: 5 });
  const state = battle([]).state;
  state.units = [target, reactor];
  state.activeUnitId = target.id;
  state.stage = "attack";

  assert.equal(planAttack(state, target.id, new Set([manual.id]), () => 1, () => 0, reactor), null);
  assert.ok(planAttack(state, target.id, new Set([manual.id]), () => 1, () => 0, reactor, { reaction: true }));
  assert.equal(planAttack(state, reactor.id, new Set([manual.id]), () => 1, () => 0), null);
}

{
  const slotA = weapon({ id: "slot-a", slotOrder: 1, targetKinds: ["squadron"], accuracy: 0, overwatch: true });
  const slotB = weapon({ id: "slot-b", slotOrder: 0, targetKinds: ["squadron"], accuracy: 100, overwatch: true });
  const ownerZ = unit({ id: "owner-z", sideId: "crimson", weapons: [slotA] });
  const ownerA = unit({ id: "owner-a", sideId: "crimson", weapons: [{ ...slotA, id: "owner-a-slot-a" }, slotB] });
  const target = unit({ id: "fighter", kind: "squadron", sideId: "azure", position: { q: 1, r: 0 }, integrity: 20, stack: 4, unitHealth: 5 });
  const state = battle([]).state;
  state.units = [target, ownerZ, ownerA];
  state.activeUnitId = target.id;
  state.initiativeOrder = [target.id, ownerA.id, ownerZ.id];
  state.stage = "system";
  state.lifecycle = "SystemActions";
  const outcomes = resolvePostEntryAA(state, target, { planId: "move-plan", elementIndex: 2, causeEventId: "move-event" }, () => 100, () => 0);
  assert.deepEqual(outcomes.map(outcome => `${outcome.ownerId}:${outcome.slotId}`), ["owner-a:slot-b", "owner-a:owner-a-slot-a", "owner-z:slot-a"]);
  assert.equal(outcomes[1].steps[0].outcome, "miss");
  assert.equal(ownerA.weapons.every(slot => slot.firedThisRound), true);
  assert.equal(ownerZ.weapons[0].firedThisRound, true);
  const declarations = state.events.filter(event => event.action === "aa-reaction-declare");
  assert.deepEqual(declarations.map(event => [event.actorId, event.slotId, event.planId, event.elementIndex, event.causeEventId]), [
    ["owner-a", "slot-b", "move-plan", 2, "move-event"],
    ["owner-a", "owner-a-slot-a", "move-plan", 2, "move-event"],
    ["owner-z", "slot-a", "move-plan", 2, "move-event"]
  ]);
  assert.equal(resolvePostEntryAA(state, target, { planId: "again", elementIndex: 3, causeEventId: "next" }).length, 0);
}

{
  const aa = weapon({ id: "aa", targetKinds: ["squadron"] });
  const owner = unit({ id: "owner", sideId: "crimson", weapons: [aa] });
  const target = unit({ id: "fighter", kind: "squadron", sideId: "azure", position: { q: 1, r: 0 }, stack: 2, unitHealth: 5 });
  const state = battle([]).state;
  state.units = [target, owner];
  state.activeUnitId = target.id;
  state.stage = "attack";
  assert.equal(resolveAttack(state, target.id, new Set([aa.id]), () => 100, () => 0, owner), false);
  assert.equal(resolvePostEntryAA(state, target, { causeEventId: "move" }).length, 0);
  aa.firedThisRound = false;
  aa.overwatch = true;
  owner.salvoCommitted = false;
  assert.equal(resolvePostEntryAA(state, target, { causeEventId: "attack" }, () => 100, () => 0).length, 0);
  state.stage = "system";
  assert.equal(resolvePostEntryAA(state, target, { causeEventId: "move" }, () => 100, () => 0).length, 1);
  state.stage = "attack";
  assert.equal(resolveAttack(state, target.id, new Set([aa.id]), () => 100, () => 0, owner), false);
}

console.log("battle checks passed");
