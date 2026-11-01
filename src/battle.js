import { availabilityReason, createAvailability, insufficientResourceReasons } from "./availability-contract.js";
import { activationResources, activeUnit, applyDamage, beginWeaponCooldown, confirmOwnAction, currentEvasion, destroyUnit, hexDistance, inside, key, overwatchAvailability, recordEvent, spendActivationResource, unitById, weaponReadiness } from "./domain.js";

const MULTIPLIERS = {
  kinetic: { shield: 1.5, armor: 0.75, integrity: 1 },
  energy: { shield: 0.5, armor: 1, integrity: 1 },
  explosive: { shield: 1, armor: 1.5, integrity: 1.25 }
};

const CRITICALS = {
  kinetic: ["Деформация брони", "Пробоина", "Разрушение конструкции"],
  energy: ["Термическое повреждение", "Ионизация системы", "Оплавление контура"],
  explosive: ["Разрыв корпуса", "Деформация обшивки", "Повреждение отсека"]
};

const COVER_MODIFIERS = { nebula: 15, debrisField: 10, asteroidField: 20 };
const BLOCKER_COVER = { small: 25, medium: 50, large: 100 };
const NO_REACTOR = "Требуется реактор";
const INVALID_TARGET = "Недопустимый тип цели";

function rotatePosition(position, turns) {
  let { q, r } = position;
  for (let turn = 0; turn < turns; turn++) [q, r] = [q + r, -q];
  return { q, r };
}

export function isPositionInFiringArc(origin, heading, target, firingArc, orientation) {
  const relative = { q: target.q - origin.q, r: target.r - origin.r };
  if (relative.q === 0 && relative.r === 0) return false;
  if (firingArc === "turret") return true;
  const local = rotatePosition(relative, (6 - heading) % 6);
  if (firingArc === "line") return local.q > 0 && local.r === 0;
  if (firingArc === "battery-left") return local.q >= 0 && local.r < 0 && local.q + local.r <= 0;
  if (firingArc === "battery-right") return local.q <= 0 && local.r > 0 && local.q + local.r >= 0;
  if (firingArc === "forward") {
    const facing = orientation ?? "fore";
    const oriented = facing === "aft" ? rotatePosition(local, 3) : local;
    return ["fore", "aft"].includes(facing) && oriented.q > 0 && oriented.q + oriented.r > 0;
  }
  return false;
}

function inArc(attacker, target, weapon) {
  return isPositionInFiringArc(attacker.position, attacker.heading || 0, target.position, weapon.firingArc ?? weapon.mount, weapon.orientation);
}

function effectiveWeapon(attacker, weapon) {
  return attacker.kind === "squadron" ? { ...weapon, shots: weapon.shots * attacker.stack } : { ...weapon };
}

function unavailableReason(attacker, target, weapon, reaction = false) {
  return weaponAttackAvailability({ units: [attacker, ...(target ? [target] : [])], activeUnitId: attacker?.id, lifecycle: "ActionChoice", winner: null, attackApplication: null, maneuverApplication: null, scenario: { contents: [] } }, attacker?.id, weapon?.id, target?.id, { reaction, explicitAttacker: attacker, explicitWeapon: weapon, explicitTarget: target }).reasons[0]?.message || null;
}

function cube(position) { return { x: position.q, z: position.r, y: -position.q - position.r }; }
function cubeRound(c) {
  let x = Math.round(c.x), y = Math.round(c.y), z = Math.round(c.z);
  const dx = Math.abs(x - c.x), dy = Math.abs(y - c.y), dz = Math.abs(z - c.z);
  if (dx > dy && dx > dz) x = -y - z;
  else if (dy > dz) y = -x - z;
  else z = -x - y;
  return { x, y, z };
}

export function supercoverLine(from, to) {
  const a = cube(from), b = cube(to), distance = hexDistance(from, to);
  const cells = new Map();
  const add = c => cells.set(key(c.x, c.z), { q: c.x || 0, r: c.z || 0 });
  for (let i = 0; i <= distance * 100; i++) {
    const t = distance ? i / (distance * 100) : 0;
    const c = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    add(cubeRound(c));
  }
  return [...cells.values()];
}

function blockerSize(unit) { return unit.size || (unit.kind === "capital" ? (unit.mass >= 120 ? "large" : "medium") : "small"); }
function endpointCover(state, target) {
  const content = state.scenario.contents.find(item => item.position.q === target.position.q && item.position.r === target.position.r && COVER_MODIFIERS[item.type]);
  return content ? COVER_MODIFIERS[content.type] : 0;
}
function lineBlocker(state, attacker, target, excludedIds = new Set()) {
  const cells = supercoverLine(attacker.position, target.position).slice(1, -1);
  const candidates = state.units.filter(unit => unit.id !== attacker.id && unit.id !== target.id && !excludedIds.has(unit.id) && unit.kind !== "squadron" && cells.some(cell => cell.q === unit.position.q && cell.r === unit.position.r));
  return candidates.sort((a, b) => hexDistance(attacker.position, a.position) - hexDistance(attacker.position, b.position) || String(a.id).localeCompare(String(b.id)))[0] || null;
}

export function targetEvasion(target) {
  return currentEvasion(target);
}

export function hitChance(weapon, target, cover = 0) {
  return Math.max(0, Math.min(100, weapon.accuracy - targetEvasion(target) - cover));
}

export function attackGeometry(state, targetId, excludedBlockerIds = new Set(), explicitAttacker = null) {
  const attacker = explicitAttacker || activeUnit(state), target = unitById(state, targetId);
  const blocker = target ? lineBlocker(state, attacker, target, excludedBlockerIds) : null;
  const cover = blocker ? Math.min(100, BLOCKER_COVER[blockerSize(blocker)]) : 0;
  const endpoint = target ? endpointCover(state, target) : 0;
  return { line: target ? supercoverLine(attacker.position, target.position) : [], blocker, cover, endpointCover: endpoint };
}

export function activeLayer(target) {
  if ((target.shield || 0) > 0) return "shield";
  if ((target.armor || 0) > 0) return "armor";
  return "integrity";
}

export function weaponDamage(weapon, layer) {
  return Math.max(1, Math.floor(weapon.damage * MULTIPLIERS[weapon.weaponClass][layer]));
}

function effectiveness(weapon, layer) {
  return MULTIPLIERS[weapon.weaponClass][layer];
}

export function weaponAttackAvailability(state, attackerId, slotId, targetId, options = {}) {
  const attacker = options.explicitAttacker || unitById(state, attackerId);
  const target = options.explicitTarget || unitById(state, targetId);
  const weapon = options.explicitWeapon || attacker?.weapons.find(candidate => candidate.id === slotId);
  const resources = activationResources(attacker);
  const cost = { energy: weapon?.energyCost || 0 };
  const reasons = [];
  if (state.winner || state.lifecycle === "Finished") reasons.push(availabilityReason("battle.finished", "Бой завершён"));
  if (!attacker) reasons.push(availabilityReason("actor.missing", "Атакующий отсутствует", { attackerId }));
  if (!options.reaction && (state.lifecycle === "ActionResolution" || state.attackApplication || state.maneuverApplication || state.activeAction?.status === "resolving")) reasons.push(availabilityReason("action.another-resolving", "Разрешается другое действие"));
  if (attacker && !weapon) reasons.push(availabilityReason("action.invalid", "Оружейный слот отсутствует", { slotId }));
  const readiness = weapon ? weaponReadiness(weapon) : { ready: false, reason: "Оружейный слот отсутствует" };
  if (weapon && !readiness.ready) reasons.push(availabilityReason("action.not-ready", readiness.reason, { firedThisRound: Boolean(weapon.firedThisRound), cooldownRemaining: weapon.cooldownRemaining || 0 }));
  if (weapon?.energyCost > 0 && !attacker?.reactor) reasons.push(availabilityReason("resource.unavailable", NO_REACTOR, { resource: "energy" }));
  if (attacker && weapon) {
    const validationResources = options.reaction ? { ...resources, energy: { ...resources.energy, remaining: attacker.reactor?.currentEnergy || 0 } } : resources;
    reasons.push(...insufficientResourceReasons(validationResources, cost));
  }
  const targetRequested = targetId !== undefined || options.explicitTarget !== undefined;
  let geometry = { blocker: null, cover: 0, endpointCover: 0, line: [] };
  let distance = null;
  let arcValid = null;
  let rangeValid = null;
  let kindValid = null;
  if (attacker && weapon && targetRequested) {
    if (!target) reasons.push(availabilityReason("target.missing", "Цель отсутствует", { targetId: targetId || null }));
    else {
      kindValid = weapon.targetKinds.includes(target.kind);
      distance = hexDistance(attacker.position, target.position);
      rangeValid = distance <= weapon.maxRange;
      arcValid = inArc(attacker, target, weapon);
      geometry = attackGeometry(state, target.id, new Set(), attacker);
      if (target.sideId === attacker.sideId) reasons.push(availabilityReason("target.friendly", "Союзная цель", { targetId: target.id }));
      if (!kindValid) reasons.push(availabilityReason("target.invalid-kind", INVALID_TARGET, { actual: target.kind, allowed: [...weapon.targetKinds] }));
      if (!arcValid) reasons.push(availabilityReason("target.out-of-arc", "Вне сектора", { firingArc: weapon.firingArc ?? weapon.mount, orientation: weapon.orientation ?? null }));
      if (!rangeValid) reasons.push(availabilityReason("target.out-of-range", "Вне дальности", { distance, maxRange: weapon.maxRange }));
      if (weapon.requiresClearLineOfFire && geometry.blocker) reasons.push(availabilityReason("target.line-of-fire-blocked", "Линия огня перекрыта", { blockerId: geometry.blocker.id }));
    }
  }
  const targetDetails = targetRequested ? {
    requestedId: targetId ?? target?.id ?? null,
    targetId: target?.id || null,
    kind: target?.kind || null,
    kindValid,
    distance,
    range: weapon ? { effective: weapon.effectiveRange ?? null, maximum: weapon.maxRange ?? null, valid: rangeValid } : null,
    arc: weapon ? { type: weapon.firingArc ?? weapon.mount, orientation: weapon.orientation ?? null, valid: arcValid } : null,
    lineOfFire: { clear: !geometry.blocker, blockerId: geometry.blocker?.id || null, cover: geometry.cover || 0, endpointCover: geometry.endpointCover || 0 }
  } : null;
  return createAvailability({ action: { type: "weapon-attack", attackerId, slotId, ...(targetRequested ? { targetId: targetId ?? null } : {}) }, reasons, cost, resources, readiness: { ready: readiness.ready, state: readiness.ready ? "ready" : weapon?.firedThisRound ? "fired" : weapon?.cooldownRemaining > 0 ? "cooldown" : "missing", cooldownRemaining: weapon?.cooldownRemaining || 0 }, target: targetDetails });
}

export function previewWeaponAttack(state, attackerId, slotId, targetId) {
  const attacker = unitById(state, attackerId);
  const target = unitById(state, targetId);
  const weapon = attacker?.weapons.find(candidate => candidate.id === slotId);
  const availability = weaponAttackAvailability(state, attackerId, slotId, targetId);
  const effective = attacker && weapon ? effectiveWeapon(attacker, weapon) : null;
  const geometry = attacker && target ? attackGeometry(state, targetId, new Set(), attacker) : { blocker: null, cover: 0, endpointCover: 0 };
  const layer = target ? activeLayer(target) : null;
  const chance = effective && target ? Math.max(0, hitChance(effective, target, geometry.endpointCover) - geometry.cover) : 0;
  const simulated = target ? cloneCombatant(target) : null;
  const potentialDamageByLayer = { shield: 0, armor: 0, integrity: 0 };
  for (let shot = 0; simulated && effective && shot < effective.shots && simulated.integrity > 0; shot++) {
    const layers = weaponHitDamage(simulated, effective);
    for (const entry of layers) potentialDamageByLayer[entry.layer] += entry.damage;
    simulatedDamage(simulated, layers);
  }
  return deepFreeze({
    availability,
    attackerId,
    slotId,
    targetId,
    canConfirm: availability.available,
    reasons: availability.reasons.map(reason => reason.message),
    reasonCodes: availability.reasons.map(reason => reason.code),
    shots: effective?.shots || 0,
    damage: effective?.damage || 0,
    effectiveRange: effective?.effectiveRange ?? null,
    maxRange: effective?.maxRange ?? null,
    energyRequired: availability.forecast.cost.energy,
    energyAvailable: availability.resources.energy?.remaining || 0,
    layer,
    potentialDamage: Object.values(potentialDamageByLayer).reduce((total, damage) => total + damage, 0),
    potentialDamageByLayer,
    blockerChance: effective && target ? Math.min(geometry.cover, hitChance(effective, target, geometry.endpointCover)) : 0,
    hitChance: chance,
    blocker: geometry.blocker ? { id: geometry.blocker.id, name: geometry.blocker.name, position: { ...geometry.blocker.position } } : null,
    cover: geometry.cover,
    endpointCover: geometry.endpointCover
  });
}

export function weaponAttackArc(state, attackerId, slotId) {
  const attacker = unitById(state, attackerId);
  const weapon = attacker?.weapons.find(candidate => candidate.id === slotId);
  const positions = new Set();
  if (!attacker || !weapon || !weaponReadiness(weapon).ready) return positions;
  for (let q = attacker.position.q - weapon.maxRange; q <= attacker.position.q + weapon.maxRange; q++) {
    for (let r = attacker.position.r - weapon.maxRange; r <= attacker.position.r + weapon.maxRange; r++) {
      const position = { q, r };
      if (!inside(state, position) || (q === attacker.position.q && r === attacker.position.r)) continue;
      if (hexDistance(attacker.position, position) <= weapon.maxRange && inArc(attacker, { position }, weapon)) positions.add(key(q, r));
    }
  }
  return positions;
}

export function availableWeaponAttackTargets(state, attackerId, slotId) {
  const attacker = unitById(state, attackerId);
  if (!attacker) return [];
  return state.units.filter(target => target.sideId !== attacker.sideId && previewWeaponAttack(state, attackerId, slotId, target.id).canConfirm);
}

function cloneCombatant(unit) {
  return { id: unit.id, kind: unit.kind, shield: unit.shield || 0, armor: unit.armor || 0, integrity: unit.integrity || 0, stack: unit.stack, unitHealth: unit.unitHealth };
}

function snapshot(unit) {
  return Object.freeze({ shield: unit.shield, armor: unit.armor, integrity: unit.integrity, stack: unit.stack });
}

export function weaponHitDamage(unit, weapon) {
  let remaining = weapon.damage;
  const layers = [];
  for (const layer of ["shield", "armor", "integrity"]) {
    if (remaining <= 0 || !(unit[layer] > 0)) continue;
    const multiplier = effectiveness(weapon, layer);
    const scaled = remaining * multiplier;
    const damage = Math.min(unit[layer], Math.max(remaining >= 1 ? 1 : 0, Math.floor(scaled + 1e-10)));
    if (damage > 0) layers.push({ layer, damage, multiplier });
    if (scaled < unit[layer]) break;
    remaining = Math.max(0, remaining - unit[layer] / multiplier);
  }
  return layers;
}

function simulatedDamage(unit, layers) {
  for (const { layer, damage } of layers) unit[layer] = Math.max(0, unit[layer] - damage);
  if (unit.kind === "squadron" && unit.unitHealth) unit.stack = unit.integrity ? Math.ceil(unit.integrity / unit.unitHealth) : 0;
}

function missEndpoint(target, random) {
  const angle = random() * Math.PI * 2;
  const radius = 0.2 + random() * 0.55;
  return { q: target.position.q + Math.cos(angle) * radius, r: target.position.r + Math.sin(angle) * radius };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function plannedCritical(attacker, weapon, rollD100, random, shot) {
  const roll = rollD100();
  if (roll > weapon.critChance) return { roll, critical: null };
  const pool = CRITICALS[weapon.weaponClass];
  const type = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  return { roll, critical: { id: `critical-${attacker.id}-${weapon.id}-${shot}`, type, weaponClass: weapon.weaponClass, attackerId: attacker.id, weaponId: weapon.id } };
}

function planWeaponAttack(state, attacker, installedWeapon, target, rollD100, random, options = {}) {
  const weapon = effectiveWeapon(attacker, installedWeapon);
  const simulatedTarget = cloneCombatant(target);
  const simulatedBlockers = new Map();
  const destroyedBlockerIds = new Set();
  const steps = [];
  let weaponEndTime = 0;
  for (let shot = 1; shot <= weapon.shots && simulatedTarget.integrity > 0; shot++) {
      const geometry = attackGeometry(state, target.id, destroyedBlockerIds, attacker);
      const chance = Math.max(0, hitChance(weapon, target, geometry.endpointCover) - geometry.cover);
      const roll = rollD100();
      const targetBefore = snapshot(simulatedTarget);
      let outcome = "miss";
      let hitUnitId = null;
      let hitLayer = null;
      let damage = 0;
      let damageLayers = [];
      let multiplier = null;
      let critical = null;
      let criticalRoll = null;
      let destroyed = false;
      let layerDestroyed = false;
      let targetAfter = targetBefore;
      const finalAccuracy = hitChance(weapon, target, geometry.endpointCover);
      const blockerChance = Math.min(geometry.cover, finalAccuracy);
      if (geometry.blocker && roll <= blockerChance) {
        outcome = "blocked";
        hitUnitId = geometry.blocker.id;
        const simulatedBlocker = simulatedBlockers.get(hitUnitId) || cloneCombatant(geometry.blocker);
        simulatedBlockers.set(hitUnitId, simulatedBlocker);
        hitLayer = activeLayer(simulatedBlocker);
        multiplier = effectiveness(weapon, hitLayer);
        damageLayers = weaponHitDamage(simulatedBlocker, weapon);
        damage = damageLayers.reduce((total, entry) => total + entry.damage, 0);
        simulatedDamage(simulatedBlocker, damageLayers);
        destroyed = simulatedBlocker.integrity === 0;
        if (destroyed) destroyedBlockerIds.add(hitUnitId);
      } else if (roll <= finalAccuracy) {
        outcome = "hit";
        hitUnitId = target.id;
        hitLayer = activeLayer(simulatedTarget);
        multiplier = effectiveness(weapon, hitLayer);
        damageLayers = weaponHitDamage(simulatedTarget, weapon);
        damage = damageLayers.reduce((total, entry) => total + entry.damage, 0);
        const beforeLayer = simulatedTarget[hitLayer];
        simulatedDamage(simulatedTarget, damageLayers);
        layerDestroyed = beforeLayer > 0 && simulatedTarget[hitLayer] === 0 && hitLayer !== "integrity";
        destroyed = simulatedTarget.integrity === 0;
        if (damageLayers.some(entry => entry.layer === "integrity" && entry.damage > 0)) {
          const planned = plannedCritical(attacker, weapon, rollD100, random, shot);
          criticalRoll = planned.roll;
          critical = planned.critical;
        }
        targetAfter = snapshot(simulatedTarget);
      }
      const endpoint = outcome === "hit" ? { ...target.position } : outcome === "blocked" ? { ...geometry.blocker.position } : missEndpoint(target, random);
      const distance = hexDistance(attacker.position, endpoint);
      const speed = weapon.visual?.speedHexesPerSecond || 1;
      const duration = Math.max(120, Math.round(distance / speed * 1000));
      const launchTime = (shot - 1) * (weapon.visual?.launchIntervalMs || 0);
      const arrivalTime = launchTime + duration;
      steps.push({ index: steps.length, slotId: weapon.id, weaponId: weapon.weaponId, weaponName: weapon.name, weaponClass: weapon.weaponClass, delivery: weapon.delivery, visual: weapon.visual, shot, roll, chance, cover: geometry.cover, endpointCover: geometry.endpointCover, outcome, hitUnitId, layer: hitLayer, multiplier, damage, damageLayers, blockerChance, finalAccuracy, criticalRoll, critical: critical ? { ...critical, round: state.roundNumber } : null, layerDestroyed, destroyed, targetBefore, targetAfter, endpoint, launchTime, arrivalTime, duration });
      weaponEndTime = Math.max(weaponEndTime, arrivalTime);
  }
  return deepFreeze({
    id: `${state.scenario.id}:${state.roundNumber}:${attacker.id}:${target.id}:${options.actionId || state.sequence || 0}`,
    actionId: options.actionId || null,
    attackerId: attacker.id,
    targetId: target.id,
    round: state.roundNumber,
    slotId: weapon.id,
    weapon: { slotId: weapon.id, weaponId: weapon.weaponId, slotOrder: weapon.slotOrder, energyCost: weapon.energyCost, cooldownRounds: weapon.cooldownRounds, shotCount: steps.length },
    steps,
    duration: weaponEndTime,
    predictedDestruction: simulatedTarget.integrity === 0,
    targetAfter: snapshot(simulatedTarget),
    reaction: Boolean(options.reaction),
    context: options.context || null
  });
}

export function confirmWeaponAttackAction(state, attackerId, slotId, targetId, rollD100 = () => Math.floor(Math.random() * 100) + 1, random = Math.random) {
  const action = state.activeAction;
  if (state.winner || state.lifecycle !== "ActionPlanning" || action?.status !== "planning" || action.type !== "weapon-attack" || action.actorId !== attackerId || action.slotId !== slotId || attackerId !== activeUnit(state)?.id || state.attackApplication || state.maneuverApplication) return null;
  const availability = weaponAttackAvailability(state, attackerId, slotId, targetId);
  if (!availability.available) return null;
  const attacker = unitById(state, attackerId);
  const target = unitById(state, targetId);
  const weapon = attacker.weapons.find(candidate => candidate.id === slotId);
  const declaration = recordEvent(state, "activation-action-confirm", { actorId: attackerId, subjectIds: [targetId], slotId, targetId, actionType: "weapon-attack", actionReason: action.reason });
  const context = Object.freeze({ activationId: attacker.activationId, actionId: declaration.eventId, actionType: "weapon-attack", actorId: attackerId, reason: action.reason });
  const planned = planWeaponAttack(state, attacker, weapon, target, rollD100, random, { actionId: declaration.eventId, context });
  const plan = Object.freeze({ ...planned, actionContext: context });
  spendActivationResource(attacker, "energy", weapon.energyCost || 0);
  beginWeaponCooldown(weapon);
  confirmOwnAction(attacker);
  state.activeAction = Object.freeze({ ...action, status: "resolving", actionId: declaration.eventId, planId: plan.id });
  state.lifecycle = "ActionResolution";
  state.attackApplication = { plan, planId: plan.id, nextStep: 0, actionId: declaration.eventId };
  log(state, `${weapon.name}: открыта атака оружием.`, attacker.sideId);
  return plan;
}

function log(state, message, tone = "neutral", sourceEventId = null) {
  const journalOrder = state.journalSequence = (state.journalSequence ?? 0) + 1;
  state.log.unshift({ id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, journalOrder, round: state.roundNumber, message, tone, ...(sourceEventId ? { sourceEventId } : {}) });
}

function destroyTarget(state, target, context = {}) {
  const result = destroyUnit(state, target, context);
  if (!result) return null;
  log(state, `${target.name} уничтожен. На позиции появляется поле обломков.`, "danger", result.destructionEvent?.eventId);
  if (result.winner) log(state, `Победа флотилии ${result.winner}.`, "system");
  return result;
}

export function applyAttackStep(state, plan, stepIndex) {
  const progress = state.attackApplication;
  const step = plan?.steps?.[stepIndex];
  if (!plan || !progress || progress.plan !== plan || progress.planId !== plan.id || plan.round !== state.roundNumber || !plan.reaction && plan.attackerId !== activeUnit(state)?.id) return { status: "invalid" };
  if (!step || progress.nextStep !== stepIndex) return { status: "invalid" };
  const attacker = unitById(state, plan.attackerId);
  const target = unitById(state, plan.targetId);
  if (!attacker || !target) return { status: "stopped" };
  const hitUnit = step.hitUnitId ? unitById(state, step.hitUnitId) : null;
  const context = plan.reaction
    ? { actorId: plan.attackerId, planId: plan.context?.planId, actionId: plan.actionId, actionType: "reaction-attack", actionReason: "post-entry-aa", elementIndex: plan.context?.elementIndex, causeEventId: progress.actionId || plan.context?.causeEventId }
    : { actorId: plan.attackerId, planId: plan.id, actionId: plan.actionId, actionType: plan.actionContext?.actionType, actionReason: plan.actionContext?.reason, causeEventId: progress.actionId };
  let destruction = null;
  if (step.outcome === "miss" || !hitUnit) {
    const missEvent = plan.reaction ? recordEvent(state, "aa-reaction-miss", {
      ...context,
      actorName: attacker.name,
      causeEventId: plan.context?.causeEventId,
      subjectIds: [plan.targetId],
      targetName: target.name,
      slotId: step.slotId,
      shot: step.shot,
      random: { roll: step.roll },
      chance: step.chance,
      position: { ...target.position }
    }) : null;
    if (!plan.reaction) log(state, `${step.weaponName}, выстрел ${step.shot}: ${step.roll}/${step.chance}, промах.`);
    else if (!missEvent) return { status: "invalid" };
  } else {
    for (const entry of step.damageLayers) applyDamage(state, hitUnit, entry.damage, `weapon:${step.slotId}`, entry.layer, { ...context, shot: step.shot, slotId: step.slotId, layer: entry.layer });
    log(state, `${step.weaponName} [${step.weaponClass}], выстрел ${step.shot}: ${step.roll}/${step.chance}, попадание; ${step.damage} урона (${step.damageLayers.map(entry => `${entry.layer}: ${entry.damage}`).join(", ")}).`, attacker.sideId);
    if (step.critical) {
      hitUnit.criticals.push({ ...step.critical });
      log(state, `Крит ${step.criticalRoll}: ${step.critical.type}.`, "danger");
    }
    if (step.layerDestroyed) log(state, `${hitUnit.name}: слой «${step.layer}» разрушен.`, "danger");
    destruction = hitUnit.integrity === 0 ? destroyTarget(state, hitUnit, { ...context, destructionReason: plan.reaction ? "reaction" : undefined, causeEventId: state.events.at(-1)?.eventId }) : null;
  }
  progress.nextStep++;
  const targetDestroyed = destruction?.unitId === plan.targetId;
  if (targetDestroyed && plan.reaction) return { status: "applied", step, destroyed: true, destruction };
  if (progress.nextStep === plan.steps.length) {
    state.attackApplication = null;
    if (!plan.reaction && state.activeAction?.planId === plan.id) {
      state.activeAction = null;
      if (!state.winner) state.lifecycle = "ActionChoice";
    }
  }
  return { status: "applied", step, destroyed: step.destroyed };
}

function reactionCandidates(state, target) {
  if (!state.units.includes(target) || target.kind !== "squadron") return [];
  const initiative = new Map(state.initiativeOrder.map((id, index) => [id, index]));
  return state.units
    .filter(owner => owner.id !== target.id && owner.sideId !== target.sideId && owner.integrity > 0)
    .sort((left, right) => (initiative.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (initiative.get(right.id) ?? Number.MAX_SAFE_INTEGER) || String(left.id).localeCompare(String(right.id)))
    .flatMap(owner => owner.weapons
      .filter(slot => overwatchAvailability(owner, slot).available)
      .sort((left, right) => (left.slotOrder ?? Number.MAX_SAFE_INTEGER) - (right.slotOrder ?? Number.MAX_SAFE_INTEGER) || String(left.id).localeCompare(String(right.id)))
      .map(slot => ({ owner, slot })));
}

export function planPostEntryAA(state, target, context = {}, rollD100 = () => Math.floor(Math.random() * 100) + 1, random = Math.random) {
  if (state.attackApplication || state.reactionApplication || !state.units.includes(target)) return null;
  for (const { owner, slot } of reactionCandidates(state, target)) {
    if (!state.units.includes(target)) return null;
    if (!state.units.includes(owner) || !overwatchAvailability(owner, slot).available || unavailableReason(owner, target, slot, true)) continue;
    const declaration = recordEvent(state, "aa-reaction-declare", {
      activationId: context.activationId,
      actorId: owner.id,
      actorName: owner.name,
      subjectIds: [target.id],
      targetName: target.name,
      slotId: slot.id,
      planId: context.planId,
      elementIndex: context.elementIndex,
      causeEventId: context.causeEventId,
      maneuverActionId: context.actionId,
      maneuverActionType: context.actionType,
      maneuverActionReason: context.actionReason,
      actionType: "reaction-attack",
      actionReason: "post-entry-aa"
    });
    beginWeaponCooldown(slot);
    if (slot.energyCost > 0) owner.reactor.currentEnergy -= slot.energyCost;
    const plan = planWeaponAttack(state, owner, slot, target, rollD100, random, { reaction: true, context, actionId: declaration.eventId });
    state.reactionApplication = { plan, planId: plan.id, nextStep: 0, actionId: declaration.eventId, ownerId: owner.id, targetId: target.id };
    return plan;
  }
  return null;
}

export function applyReactionStep(state, plan, stepIndex) {
  const progress = state.reactionApplication;
  if (!plan || !progress || progress.plan !== plan || progress.planId !== plan.id || progress.nextStep !== stepIndex || !plan.reaction) return { status: "invalid" };
  const attackProgress = state.attackApplication;
  state.attackApplication = progress;
  const result = applyAttackStep(state, plan, stepIndex);
  state.attackApplication = attackProgress;
  if (result.status !== "applied") {
    state.reactionApplication = null;
    return result;
  }
  if (result.destruction?.unitId === plan.targetId || progress.nextStep === plan.steps.length || !unitById(state, plan.targetId)) state.reactionApplication = null;
  return result;
}

export function resolvePostEntryAA(state, target, context = {}, rollD100 = () => Math.floor(Math.random() * 100) + 1, random = Math.random) {
  if (state.attackApplication || state.reactionApplication) return [];
  const outcomes = [];
  while (state.units.includes(target)) {
    const plan = planPostEntryAA(state, target, context, rollD100, random);
    if (!plan) break;
    let destruction = null;
    for (let index = 0; index < plan.steps.length; index++) {
      const result = applyReactionStep(state, plan, index);
      const targetDestroyed = result.destruction?.unitId === target.id;
      if (targetDestroyed) destruction = result.destruction;
      if (result.status !== "applied" || targetDestroyed) break;
    }
    outcomes.push({ ownerId: plan.attackerId, slotId: plan.slotId, actionId: plan.actionId, steps: plan.steps, ...(destruction ? { destruction } : {}) });
  }
  return outcomes;
}
