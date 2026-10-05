export const LIFECYCLE = Object.freeze([
  "DeploymentLeft", "DeploymentRight", "RoundStart", "WaitDecision", "ActivationStart",
  "SystemActions", "Maneuver", "Attack", "EndActivation", "RoundEnd", "Finished"
]);

const sides = ["left", "right"];

export function createBattle({ id = "battle-1", units = [], bounds = null, contents = [] } = {}) {
  const normalized = units.map(unit => ({ ...unit, side: unit.side ?? unit.sideId, position: unit.position ? { ...unit.position } : null, currentSpeed: unit.currentSpeed ?? unit.speed ?? 1, hasActivated: false, hasWaited: false }));
  const normalizedContents = contents.map(item => ({ ...item, position: { ...item.position }, onEnterEffects: item.onEnterEffects?.map(effect => normalizeOnEnterEffect(effect)) }));
  const state = {
    id, units: normalized, contents: normalizedContents, bounds,
    lifecycle: "DeploymentLeft", deployment: { left: false, right: false }, round: 0, queue: [], activeUnitId: null,
    activationStage: null, attackSpentBy: null, winner: null, events: [], sequence: 0, interceptionLinks: []
  };
  if (bounds) for (const side of sides) {
    const required = normalized.filter(unit => unit.side === side).length;
    const available = deploymentZone(state, side).filter(position => !state.contents.some(item => samePosition(item.position, position))).length;
    if (available < required) throw new RangeError(`Insufficient ${side} deployment capacity`);
  }
  return state;
}

export function recordEvent(state, action, data = {}) {
  const event = Object.freeze({ eventId: `${state.id}:${++state.sequence}`, battleId: state.id, round: state.round,
    phase: state.lifecycle, sequence: state.sequence, actorId: null, subjectIds: [], action, ...data });
  state.events.push(event);
  return event;
}

function sideForLifecycle(lifecycle) { return lifecycle === "DeploymentLeft" ? "left" : lifecycle === "DeploymentRight" ? "right" : null; }
function samePosition(a, b) { return a && b && a.q === b.q && a.r === b.r; }
function unitAt(state, position, except) { return state.units.find(unit => unit.id !== except && samePosition(unit.position, position)); }
function distance(a, b) { const dq = a.q - b.q, dr = a.r - b.r; return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2; }
function withinBounds(bounds, position) { return position.q >= bounds.minCol && position.q <= bounds.maxCol && position.r >= bounds.minRow && position.r <= bounds.maxRow && position.q + position.r >= (bounds.minCol + bounds.minRow) && position.q + position.r <= (bounds.maxCol + bounds.maxRow); }
function normalizeOnEnterEffect(effect) {
  if (effect?.type === "damage" && Number.isFinite(effect.amount) && effect.amount > 0) return Object.freeze({ type: "damage", amount: effect.amount });
  if (effect?.type === "modify-unit" && ["currentSpeed", "evasion"].includes(effect.field) && Number.isFinite(effect.amount)) return Object.freeze({ type: "modify-unit", field: effect.field, amount: effect.amount });
  throw new TypeError("Invalid onEnter effect");
}
function resolveOnEnterEffect(state, unit, content, effect, movement, position) {
  if (effect.type === "damage") {
    const onEnter = recordEvent(state, "on-enter", { actorId: content.id, subjectIds: [unit.id], causeEventId: movement.eventId, position: { ...position }, effect: "damage", amount: effect.amount });
    applyDamagePacket(state, unit, { amount: effect.amount, sourceId: content.id, cause: "onEnter", causeEventId: onEnter.eventId });
    return;
  }
  const before = unit[effect.field] ?? 0;
  const upper = effect.field === "evasion" ? 100 : Infinity;
  unit[effect.field] = Math.max(0, Math.min(upper, before + effect.amount));
  recordEvent(state, "on-enter", { actorId: content.id, subjectIds: [unit.id], causeEventId: movement.eventId, position: { ...position }, effect: "modify-unit", field: effect.field, amount: effect.amount, before: Object.freeze({ [effect.field]: before }), after: Object.freeze({ [effect.field]: unit[effect.field] }) });
}

const interceptionKey = (a, b) => [a, b].sort().join(":");
const compareIds = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
const initiativeOrder = (a, b) => (b.initiative ?? 0) - (a.initiative ?? 0) || compareIds(a.id, b.id);

export function refreshInterception(state, { causeEventId = null } = {}) {
  const previous = new Map((state.interceptionLinks ?? []).map(link => [link.key, link]));
  const squadrons = state.units.filter(unit => unit.kind === "squadron" && unit.position && unit.interception !== false);
  const next = new Map();
  for (let i = 0; i < squadrons.length; i += 1) for (let j = i + 1; j < squadrons.length; j += 1) {
    const a = squadrons[i], b = squadrons[j];
    if (a.side === b.side) continue;
    const creators = [a, b].filter((unit, index) => (unit.role ?? unit.type) !== "bomber" && distance(unit.position, index ? a.position : b.position) <= (unit.interceptRange ?? 1)).map(unit => unit.id).sort();
    const key = interceptionKey(a.id, b.id);
    if (creators.length && ![a, b].some(unit => unit.disengagedLinks?.includes(key))) next.set(key, { key, unitIds: [a.id, b.id].sort(), creators });
  }
  state.interceptionLinks = [...next.values()].sort((a, b) => a.key.localeCompare(b.key));
  state.units.forEach(unit => { if (unit.kind === "squadron") unit.engagedWith = state.interceptionLinks.filter(link => link.unitIds.includes(unit.id)).flatMap(link => link.unitIds.filter(id => id !== unit.id)).sort(); });
  for (const [key, link] of previous) if (!next.has(key)) recordEvent(state, "interception-link-removed", { subjectIds: link.unitIds, causeEventId, creators: link.creators });
  for (const [key, link] of next) if (!previous.has(key)) recordEvent(state, "interception-link-created", { subjectIds: link.unitIds, causeEventId, creators: link.creators });
  return state.units.filter(unit => unit.kind === "squadron").map(unit => ({ id: unit.id, engagedWith: [...(unit.engagedWith ?? [])] }));
}

function restrictingEnemies(state, unit) {
  return (state.interceptionLinks ?? []).filter(link => link.unitIds.includes(unit.id) && link.creators.some(id => id !== unit.id)).map(link => state.units.find(candidate => candidate.id === link.unitIds.find(id => id !== unit.id))).filter(Boolean);
}

export function previewDisengagement(state, unitId) {
  const unit = state.units.find(candidate => candidate.id === unitId);
  const enemies = unit ? restrictingEnemies(state, unit) : [];
  const cost = enemies.length;
  if (!unit || unit.kind !== "squadron" || !cost) return { eligible: false, chance: 0, cost };
  const closest = enemies.slice().sort((a, b) => (b.stack ?? b.count ?? 1) - (a.stack ?? a.count ?? 1) || initiativeOrder(a, b))[0];
  const enemyIds = new Set(enemies.map(enemy => enemy.id));
  const friendlyCount = state.units.filter(candidate => candidate.kind === "squadron" && candidate.side === unit.side && candidate.id !== unit.id && (state.interceptionLinks ?? []).some(link => link.unitIds.includes(candidate.id) && link.unitIds.some(id => enemyIds.has(id)))).length;
  const craftPenalty = Math.max(0, (closest.stack ?? closest.count ?? 1) - 1) * 10;
  const enemyPenalty = Math.max(0, enemies.length - 1) * 10;
  const friendlyBonus = friendlyCount * 10;
  const chance = Math.max(10, Math.min(90, 60 - craftPenalty - enemyPenalty + friendlyBonus));
  return { eligible: (unit.currentSpeed ?? unit.speed ?? 0) >= cost, chance, cost, closestId: closest.id, craftPenalty, enemyPenalty, friendlyBonus };
}

export function disengage(state, unitId, { random } = {}) {
  const unit = state.units.find(candidate => candidate.id === unitId);
  const preview = previewDisengagement(state, unitId);
  if (!preview.eligible || state.lifecycle !== "Maneuver" || state.activeUnitId !== unitId || typeof random !== "function") return { success: false, chance: preview.eligible ? preview.chance : 0, cost: preview.cost };
  const declared = recordEvent(state, "disengagement-declared", { actorId: unitId, subjectIds: [unitId], preview });
  const beforeSpeed = unit.currentSpeed ?? unit.speed ?? 0;
  unit.currentSpeed = beforeSpeed - preview.cost;
  const paid = recordEvent(state, "disengagement-paid", { actorId: unitId, subjectIds: [unitId], causeEventId: declared.eventId, before: { speed: beforeSpeed }, after: { speed: unit.currentSpeed }, cost: preview.cost });
  unit.disengagementEvasion = unit.evasion ?? 0;
  unit.evasion = Math.max(0, unit.disengagementEvasion - 10);
  recordEvent(state, "evasion-modifier-applied", { actorId: unitId, subjectIds: [unitId], causeEventId: paid.eventId, amount: -10, before: { evasion: unit.disengagementEvasion }, after: { evasion: unit.evasion } });
  const roll = random() * 100;
  const success = roll < preview.chance;
  const checked = recordEvent(state, "disengagement-check", { actorId: unitId, subjectIds: [unitId], causeEventId: paid.eventId, random: { roll, chance: preview.chance }, preview });
  const resultEvent = recordEvent(state, success ? "disengagement-succeeded" : "disengagement-failed", { actorId: unitId, subjectIds: [unitId], causeEventId: checked.eventId });
  if (success) {
    unit.disengagedLinks = (state.interceptionLinks ?? []).filter(link => link.unitIds.includes(unitId)).map(link => link.key);
    state.interceptionLinks = (state.interceptionLinks ?? []).filter(link => !link.unitIds.includes(unitId));
    unit.engagedWith = [];
    state.units.forEach(enemy => { enemy.engagedWith = (enemy.engagedWith ?? []).filter(id => id !== unitId); });
    for (const key of unit.disengagedLinks) recordEvent(state, "interception-link-removed", { actorId: unitId, subjectIds: key.split(":"), causeEventId: resultEvent.eventId });
  } else {
    state.lifecycle = "Attack";
    state.activationStage = "Attack";
    recordEvent(state, "activation-stage", { actorId: unitId, causeEventId: resultEvent.eventId, after: "Attack" });
  }
  return { success, chance: preview.chance, cost: preview.cost };
}


export function deploymentZone(state, side) {
  if (!state.bounds) return [];
  const edge = side === "left" ? state.bounds.minCol : state.bounds.maxCol;
  const columns = side === "left" ? [edge, edge + 1] : [edge, edge - 1];
  return columns.flatMap(col => Array.from({ length: state.bounds.maxRow - state.bounds.minRow + 1 }, (_, i) => ({ q: col, r: state.bounds.minRow + i })))
    .filter(position => withinBounds(state.bounds, position));
}

function validDeployment(state, unit, position, heading) {
  return deploymentZone(state, unit.side).some(cell => samePosition(cell, position)) &&
    !unitAt(state, position, unit.id) && !state.contents.some(item => samePosition(item.position, position)) &&
    (unit.kind === "capital" ? Number.isInteger(heading) && heading >= 0 && heading <= 5 : heading === null || heading === undefined);
}

export function deployUnit(state, unitId, position, heading = null) {
  const side = sideForLifecycle(state.lifecycle), unit = state.units.find(candidate => candidate.id === unitId);
  if (!side || !unit || unit.side !== side || state.deployment[side] || !validDeployment(state, unit, position, heading)) return false;
  unit.position = { ...position };
  if (unit.kind === "capital") unit.heading = heading;
  recordEvent(state, "deployment-place", { actorId: unitId, subjectIds: [unitId], position: { ...position }, heading: unit.heading ?? null });
  return true;
}

export function confirmDeployment(state, side) {
  if (side !== sideForLifecycle(state.lifecycle) || state.deployment[side]) return false;
  const fleet = state.units.filter(unit => unit.side === side);
  if (fleet.some(unit => !unit.position || !validDeployment(state, unit, unit.position, unit.heading))) return false;
  state.deployment[side] = true;
  recordEvent(state, "deployment-confirm", { actorId: side, subjectIds: fleet.map(unit => unit.id) });
  state.lifecycle = side === "left" ? "DeploymentRight" : "RoundStart";
  if (side === "right") progress(state);
  return true;
}

function weaponSlots(unit) {
  return unit?.weapons ?? unit?.weaponSlots ?? [];
}

function slotAmmo(slot) {
  const weapon = slot?.weapon ?? slot;
  return slot?.ammo ?? weapon?.ammo ?? 1;
}

function spendSlot(slot) {
  const weapon = slot?.weapon ?? slot;
  slot.ready = false;
  slot.overwatch = false;
  if (Object.hasOwn(slot, "ammo")) slot.ammo -= 1;
  else if (weapon && Object.hasOwn(weapon, "ammo")) weapon.ammo -= 1;
}

function slotCanOverwatch(state, owner, slot, target) {
  const weapon = slot.weapon ?? slot;
  return owner && target && owner.side !== target.side && target.kind === "squadron" &&
    (slot.destroyed !== true) && (slot.ready !== false) && slot.overwatchEligible === true && slot.overwatch === true &&
    slotAmmo(slot) > 0 && arcAllows(owner, target, weapon) &&
    previewAttack(state, owner, target, weapon).canAttack;
}

export function armOverwatch(state, unitId = state.activeUnitId) {
  const owner = state.units.find(unit => unit.id === unitId);
  if (state.lifecycle !== "EndActivation" || unitId !== state.activeUnitId || !owner) return [];
  const armed = [];
  weaponSlots(owner).forEach((slot, index) => {
    const weapon = slot.weapon ?? slot;
    if (slot.destroyed !== true && slot.ready !== false && slot.overwatchEligible === true && slotAmmo(slot) > 0) {
      slot.overwatch = true;
      slot.overwatchRound = state.round;
      slot.overwatchTargets = slot.overwatchTargets ?? [];
      armed.push(`${owner.id}:${slot.id ?? index}`);
    }
  });
  if (armed.length) recordEvent(state, "overwatch-armed", { actorId: owner.id, subjectIds: armed });
  return armed;
}

function overwatchCandidates(state, target) {
  if (!target || target.kind !== "squadron") return [];
  const candidates = [];
  state.units.forEach(owner => weaponSlots(owner).forEach((slot, index) => {
    if (slot.overwatch && slot.overwatchRound === state.round && slotCanOverwatch(state, owner, slot, target) && !(slot.overwatchTargets ?? []).includes(target.id))
      candidates.push({ owner, slot, index, weapon: slot.weapon ?? slot });
  }));
  return candidates.sort((a, b) => {
    const initiativeOrder = (b.owner.initiative ?? 0) - (a.owner.initiative ?? 0);
    if (initiativeOrder) return initiativeOrder;
    const ownerOrder = compareIds(a.owner.id, b.owner.id);
    if (ownerOrder) return ownerOrder;
    return a.index - b.index;
  });
}

export function resolveOverwatch(state, targetId, { random = Math.random, causeEventId = null } = {}) {
  const target = state.units.find(unit => unit.id === targetId);
  if (state.lifecycle !== "Maneuver" || !target || target.kind !== "squadron") return [];
  const candidates = overwatchCandidates(state, target);
  const results = [];
  for (const candidate of candidates) {
    if (!state.units.includes(target) || target.kind !== "squadron") break;
    if (!state.units.includes(candidate.owner) || !slotCanOverwatch(state, candidate.owner, candidate.slot, target)) continue;
    const { owner, slot, index } = candidate, weapon = slot.weapon ?? slot;
    const slotId = `${owner.id}:${slot.id ?? index}`;
    spendSlot(slot); slot.overwatchTargets = [...(slot.overwatchTargets ?? []), target.id];
    const declared = recordEvent(state, "overwatch-declared", { actorId: owner.id, subjectIds: [target.id], causeEventId, slotId });
    const launched = recordEvent(state, "overwatch-shot", { actorId: owner.id, subjectIds: [target.id], causeEventId: declared.eventId, slotId });
    const result = resolveAttackInternal(state, owner, target, slot, { random, causeEventId: launched.eventId, cause: "overwatch", reaction: true });
    results.push({ ownerId: owner.id, targetId: target.id, slotId, ...result });
  }
  return results;
}

function clearOverwatch(state) {
  state.units.forEach(unit => weaponSlots(unit).forEach(slot => { slot.overwatch = false; slot.overwatchTargets = []; }));
}

export function progress(state) {
  if (state.lifecycle === "Finished") return state.lifecycle;
  if (state.lifecycle === "RoundStart") {
    state.round += 1; state.attackSpentBy = null; state.units.forEach(unit => {
      unit.hasActivated = false; unit.hasWaited = false;
      weaponSlots(unit).forEach(slot => { if (slot.destroyed !== true) slot.ready = true; });
    });
    state.queue = state.units.filter(unit => unit.position).slice().sort(initiativeOrder).map(unit => unit.id);
    state.lifecycle = "WaitDecision"; state.activeUnitId = state.queue[0] ?? null;
  } else if (state.lifecycle === "ActivationStart") {
    state.lifecycle = "SystemActions"; state.activationStage = "SystemActions";
  } else if (state.lifecycle === "EndActivation") {
    const unit = state.units.find(candidate => candidate.id === state.activeUnitId); if (unit) { unit.hasActivated = true; if (Object.hasOwn(unit, "disengagementEvasion")) { unit.evasion = unit.disengagementEvasion; delete unit.disengagementEvasion; } delete unit.disengagedLinks; armOverwatch(state, unit.id); }
    state.attackSpentBy = null;
    const next = state.queue.find(id => { const candidate = state.units.find(unit => unit.id === id); return candidate && !candidate.hasActivated; });
    if (next) { state.activeUnitId = next; state.lifecycle = "WaitDecision"; }
    else state.lifecycle = "RoundEnd";
  } else if (state.lifecycle === "RoundEnd") { clearOverwatch(state); state.lifecycle = "RoundStart"; }
  recordEvent(state, "lifecycle-progress", { after: state.lifecycle });
  return state.lifecycle;
}

export function decide(state, decision = "continue") {
  if (state.lifecycle !== "WaitDecision") return false;
  const unit = state.units.find(candidate => candidate.id === state.activeUnitId); if (!unit) return false;
  if (decision === "wait" && !unit.hasWaited) { unit.hasWaited = true; state.queue = [...state.queue.filter(id => id !== unit.id), unit.id]; state.activeUnitId = state.queue.find(id => !state.units.find(candidate => candidate.id === id).hasActivated); recordEvent(state, "wait", { actorId: unit.id }); return true; }
  unit.currentSpeed = unit.baseSpeed ?? unit.speed ?? unit.currentSpeed ?? 0;
  unit.turnsSpent = 0;
  if (Object.hasOwn(unit, "stationaryTurnEvasion")) { unit.evasion = unit.stationaryTurnEvasion; delete unit.stationaryTurnEvasion; }
  state.lifecycle = "ActivationStart"; recordEvent(state, "activation-start", { actorId: unit.id }); progress(state); return true;
}

export function advanceActivation(state, stage) {
  const order = ["SystemActions", "Maneuver", "Attack", "EndActivation"], current = order.indexOf(state.lifecycle);
  if (current < 0 || order.indexOf(stage) !== current + 1) return false;
  state.lifecycle = stage; state.activationStage = stage; recordEvent(state, "activation-stage", { actorId: state.activeUnitId, after: stage }); return true;
}

export function movementDestinations(state, unitId) {
  const unit = state.units.find(candidate => candidate.id === unitId);
  if (!unit?.position) return [];
  const range = Math.max(0, unit.currentSpeed ?? unit.speed ?? 0);
  const cells = [];
  for (let q = -range; q <= range; q += 1) for (let r = -range; r <= range; r += 1) {
    const position = { q: unit.position.q + q, r: unit.position.r + r };
    if ((Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2 <= range && canEnter(state, unit, position, { final: true }) && (unit.kind !== "capital" || planMovement(state, unitId, position).valid)) cells.push(position);
  }
  return cells;
}

const movementDirections = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }];
const turnDistance = (from, to) => Math.min((to - from + 6) % 6, (from - to + 6) % 6);
const headingForStep = (from, to) => movementDirections.findIndex(direction => from.q + direction.q === to.q && from.r + direction.r === to.r);

export function planMovement(state, unitId, destination) {
  const unit = state.units.find(candidate => candidate.id === unitId);
  if (!unit?.position || !destination) return { valid: false, steps: [], reason: "Нет исходной позиции" };
  const speed = Math.max(0, unit.currentSpeed ?? unit.speed ?? 0);
  if (samePosition(unit.position, destination)) return { valid: true, steps: [], reason: null, movementCost: 0, turnsSpent: 0, finalHeading: unit.heading, stepHeadings: [] };
  const start = { position: { ...unit.position }, heading: unit.heading, movementCost: 0, turnsSpent: 0, steps: [], stepHeadings: [] };
  const queue = [start], seen = new Set([`${unit.position.q}:${unit.position.r}:${unit.heading}:${unit.turnsSpent ?? 0}:0`]);
  while (queue.length) {
    const route = queue.shift();
    for (let heading = 0; heading < movementDirections.length; heading += 1) {
      const turn = unit.kind === "capital" ? turnDistance(route.heading, heading) : 0;
      if (unit.kind === "capital" && (turn > 1 || (unit.turnsSpent ?? 0) + route.turnsSpent + turn > (unit.maneuver ?? 0))) continue;
      const direction = movementDirections[heading], position = { q: route.position.q + direction.q, r: route.position.r + direction.r };
      const content = state.contents.find(item => samePosition(item.position, position));
      const movementCost = route.movementCost + (content?.movementCost ?? 1);
      if (movementCost > speed || !canEnter(state, unit, position, { final: samePosition(position, destination) })) continue;
      const next = { position, heading: unit.kind === "capital" ? heading : route.heading, movementCost, turnsSpent: route.turnsSpent + turn, steps: [...route.steps, position], stepHeadings: [...route.stepHeadings, heading] };
      if (samePosition(position, destination)) return { valid: true, steps: next.steps, reason: null, movementCost, turnsSpent: next.turnsSpent, finalHeading: next.heading, stepHeadings: next.stepHeadings };
      const key = `${position.q}:${position.r}:${next.heading}:${next.turnsSpent}:${movementCost}`;
      if (!seen.has(key)) { seen.add(key); queue.push(next); }
    }
  }
  const liesOnShortestRoute = position => distance(unit.position, position) + distance(position, destination) === distance(unit.position, destination);
  const object = state.contents.find(item => item.kind === "object" && liesOnShortestRoute(item.position));
  const occupant = state.units.find(candidate => candidate.id !== unit.id && candidate.position && liesOnShortestRoute(candidate.position));
  const reason = object ? `Маршрут заблокирован объектом: ${object.type ?? "препятствие"}` : occupant ? `Гекс занят кораблём: ${occupant.name ?? occupant.id}` : "Цель вне доступной дальности";
  return { valid: false, steps: [], reason, movementCost: 0 };
}

export function previewManeuverRoute(state, unitId, steps, { heading = null, ramTargetId = null } = {}) {
  const source = state.units.find(candidate => candidate.id === unitId);
  if (!source?.position || !Array.isArray(steps)) return { valid: false, reason: "Нет исходной позиции", entries: [] };
  const projectedState = structuredClone(state);
  const unit = projectedState.units.find(candidate => candidate.id === unitId);
  const entries = [];
  let movementCost = 0, turnsUsed = 0, currentHeading = unit.heading, reachable = true, reason = null;
  for (let index = 0; index < steps.length; index += 1) {
    const destination = steps[index];
    const contents = projectedState.contents.filter(item => samePosition(item.position, destination));
    const cost = contents.find(item => item.movementCost !== undefined)?.movementCost ?? 1;
    const occupant = unitAt(projectedState, destination, unit.id);
    const ramRequired = Boolean(occupant && unit.kind === "capital" && occupant.kind === "capital" && occupant.side !== unit.side);
    const stepHeading = unit.kind === "capital" ? headingForStep(unit.position, destination) : currentHeading;
    const turn = unit.kind === "capital" ? turnDistance(currentHeading, stepHeading) : 0;
    const adjacent = distance(unit.position, destination) === 1;
    const enterLegal = adjacent && canEnter(projectedState, unit, destination, { final: index === steps.length - 1, ramming: ramRequired });
    const stopLegal = adjacent && canEnter(projectedState, unit, destination, { final: true });
    if (!reachable || !enterLegal || stepHeading < 0 || turn > 1 || (unit.currentSpeed ?? 0) < cost || (unit.turnsSpent ?? 0) + turn > (unit.maneuver ?? 0)) {
      reachable = false;
      reason ??= "Маршрут нарушает ограничения движения";
    }
    const effects = contents.flatMap(content => [...(content.onEnterEffects ?? []), ...((content.onEnterDamage ?? 0) > 0 ? [{ type: "damage", amount: content.onEnterDamage }] : [])].map(effect => ({ sourceId: content.id, ...normalizeOnEnterEffect(effect) })));
    if (reachable) {
      movementCost += cost; turnsUsed += turn; unit.currentSpeed -= cost; unit.turnsSpent = (unit.turnsSpent ?? 0) + turn;
      unit.position = { ...destination }; currentHeading = stepHeading; unit.heading = stepHeading;
      for (const effect of effects) {
        if (effect.type === "modify-unit") {
          const upper = effect.field === "evasion" ? 100 : Infinity;
          unit[effect.field] = Math.max(0, Math.min(upper, (unit[effect.field] ?? 0) + effect.amount));
        } else unit.integrity = Math.max(0, (unit.integrity ?? 0) - effect.amount);
      }
    }
    const aaRisks = reachable && unit.integrity !== 0 ? overwatchCandidates(projectedState, unit).map(({ owner, slot, index: slotIndex, weapon }) => {
      const attack = previewAttack(projectedState, owner, unit, weapon);
      slot.overwatch = false;
      slot.overwatchTargets = [...(slot.overwatchTargets ?? []), unit.id];
      return { ownerId: owner.id, slotId: slot.id ?? `${owner.id}:${slotIndex}`, accuracy: attack.accuracy, damage: attack.damage, shots: attack.shots };
    }) : [];
    const lethal = reachable && unit.integrity === 0;
    entries.push({ index: index + 1, position: { ...destination }, reachable, cost, cumulativeCost: movementCost, speedRemaining: unit.currentSpeed, heading: stepHeading, turn, effects, aaRisks, stopLegal, ramRequired, ramTargetId: ramRequired ? occupant.id : null, lethal });
    if (lethal) { reachable = false; reason = "Детерминированный эффект уничтожает юнит на маршруте"; }
  }
  const target = ramTargetId ? projectedState.units.find(candidate => candidate.id === ramTargetId) : null;
  const explicitRam = Boolean(target && source.kind === "capital" && target.kind === "capital" && target.side !== source.side && distance(unit.position, target.position) === 1);
  const finalTurn = unit.kind === "capital" && heading !== null ? turnDistance(currentHeading, heading) : 0;
  const finalTurnLegal = finalTurn <= 1;
  const totalTurns = (unit.turnsSpent ?? 0) + finalTurn;
  const valid = reachable && finalTurnLegal && totalTurns <= (unit.maneuver ?? 0) && (!entries.at(-1)?.ramRequired || entries.at(-1)?.ramTargetId === ramTargetId);
  if (!finalTurnLegal) reason ??= "Финальный поворот превышает 60°";
  return { valid, reason: valid ? null : reason ?? "Маршрут нарушает ограничения движения", movementCost, speedRemaining: unit.currentSpeed, turnsUsed: turnsUsed + finalTurn, turnsRemaining: Math.max(0, (unit.maneuver ?? 0) - totalTurns), finalHeading: heading ?? currentHeading, entries, stopLegal: entries.at(-1)?.stopLegal ?? true, ramRequired: Boolean(entries.at(-1)?.ramRequired || explicitRam), ramTargetId: entries.at(-1)?.ramTargetId ?? (explicitRam ? target.id : null) };
}

export function changeHeading(state, unitId, heading, { causeEventId = null, stationary = false } = {}) {
  const unit = state.units.find(candidate => candidate.id === unitId);
  const turn = unit ? turnDistance(unit.heading, heading) : 0;
  if (!unit || unit.kind !== "capital" || !Number.isInteger(heading) || heading < 0 || heading > 5 || turn > 1 || (unit.turnsSpent ?? 0) + turn > (unit.maneuver ?? 0) || state.lifecycle !== "Maneuver" || state.activeUnitId !== unitId) return false;
  if (turn === 0) return true;
  unit.heading = heading;
  unit.turnsSpent = (unit.turnsSpent ?? 0) + turn;
  recordEvent(state, "heading-change", { actorId: unitId, subjectIds: [unitId], causeEventId, heading, turn, stationary });
  return true;
}

export function canEnter(state, unit, position, { final = false, ramming = false } = {}) {
  if (!unit || !position || (state.bounds && !withinBounds(state.bounds, position))) return false;
  const occupant = unitAt(state, position, unit.id), object = state.contents.find(item => samePosition(item.position, position) && item.kind === "object");
  if (occupant) return ramming && unit.kind === "capital" && occupant.kind === "capital" && occupant.side !== unit.side;
  if (object) return unit.kind === "squadron" && !final;
  return true;
}

export function moveAtomic(state, unitId, steps, { ramming = false, ramTargetId = null, heading = null, causeEventId = null } = {}) {
  const unit = state.units.find(candidate => candidate.id === unitId);
  if (!unit?.position || state.lifecycle !== "Maneuver" || (state.activeUnitId && state.activeUnitId !== unitId) || unit.hasActivated) return { status: "blocked", moved: 0 };
  if (!ramming && unit.kind === "squadron" && unit.engagedWith?.length) return { status: "blocked", moved: 0 };
  if (heading !== null && unit.kind === "capital") {
    if (!Number.isInteger(heading) || heading < 0 || heading > 5) return { status: "blocked", moved: 0 };
    let arrivalHeading = unit.heading, projectedTurns = unit.turnsSpent ?? 0, projectedPosition = unit.position;
    for (const position of steps) {
      const stepHeading = headingForStep(projectedPosition, position), stepTurn = turnDistance(arrivalHeading, stepHeading);
      if (stepHeading < 0 || stepTurn > 1) return { status: "blocked", moved: 0 };
      projectedTurns += stepTurn; arrivalHeading = stepHeading; projectedPosition = position;
    }
    const finalTurn = turnDistance(arrivalHeading, heading);
    if (finalTurn > 1 || projectedTurns + finalTurn > (unit.maneuver ?? 0)) return { status: "blocked", moved: 0 };
  }
  let moved = 0, lastMovementEventId = null;
  for (const position of steps) {
    const contents = state.contents.filter(item => samePosition(item.position, position));
    const cost = contents.find(item => item.movementCost !== undefined)?.movementCost ?? 1;
    const entry = recordEvent(state, "entry-attempt", { actorId: unitId, subjectIds: [unitId], causeEventId, position: { ...position }, cost });
    const stepHeading = unit.kind === "capital" ? headingForStep(unit.position, position) : null;
    const stepTurn = unit.kind === "capital" ? turnDistance(unit.heading, stepHeading) : 0;
    const occupant = unitAt(state, position, unit.id);
    const targetEntry = Boolean(ramming && occupant?.id === ramTargetId && samePosition(position, steps.at(-1)));
    if (distance(unit.position, position) !== 1 || (unit.currentSpeed ?? 0) < cost || !canEnter(state, unit, position, { final: samePosition(position, steps.at(-1)), ramming: targetEntry }) || (unit.kind === "capital" && (stepHeading < 0 || stepTurn > 1 || (unit.turnsSpent ?? 0) + stepTurn > (unit.maneuver ?? 0)))) break;
    unit.currentSpeed -= cost;
    let stepCauseEventId = entry.eventId;
    if (unit.kind === "capital" && stepTurn) { changeHeading(state, unitId, stepHeading, { causeEventId: entry.eventId }); stepCauseEventId = state.events.at(-1).eventId; }
    unit.position = { ...position };
    moved += 1;
    const movement = recordEvent(state, "movement-step", { actorId: unitId, subjectIds: [unitId], causeEventId: stepCauseEventId, position: { ...position }, cost, remainingSpeed: unit.currentSpeed, heading: unit.heading ?? null });
    lastMovementEventId = movement.eventId;
    for (const content of contents) {
      const effects = [...(content.onEnterEffects ?? []), ...((content.onEnterDamage ?? 0) > 0 ? [{ type: "damage", amount: content.onEnterDamage }] : [])];
      for (const effect of effects) {
        resolveOnEnterEffect(state, unit, content, normalizeOnEnterEffect(effect), movement, position);
        if (!state.units.includes(unit)) break;
      }
      if (!state.units.includes(unit)) break;
    }
    if (!state.units.includes(unit)) break;
    if (unit.kind === "squadron") resolveOverwatch(state, unit.id, { causeEventId: movement.eventId });
    if (!state.units.includes(unit)) break;
    refreshInterception(state, { causeEventId: movement.eventId });
    if (unit.kind === "squadron" && restrictingEnemies(state, unit).length) break;
  }
  if (moved === steps.length && state.units.includes(unit) && heading !== null && unit.kind === "capital") {
    const stationary = moved === 0;
    const beforeHeading = unit.heading;
    if (changeHeading(state, unitId, heading, { causeEventId: lastMovementEventId, stationary }) && stationary && beforeHeading !== heading) { unit.stationaryTurnEvasion = unit.evasion; unit.evasion = 0; }
  }
  return { status: moved === steps.length && state.units.includes(unit) ? "moved" : "blocked", moved };
}

export function applyDamagePacket(state, target, packet = {}) {
  const unit = typeof target === "string" ? state.units.find(candidate => candidate.id === target) : target;
  if (!unit || !state.units.includes(unit) || (packet.amount ?? 0) <= 0) return { amount: 0, destroyed: false, layers: [] };
  let remaining = packet.amount;
  const before = { shield: unit.shield ?? 0, armor: unit.armor ?? 0, integrity: unit.integrity ?? 0, ...(unit.kind === "squadron" ? { stack: unit.stack ?? 0 } : {}) };
  const layers = [];
  for (const layer of ["shield", "armor", "integrity"]) {
    if (!remaining) break;
    const value = unit[layer] ?? 0;
    const absorbed = Math.min(value, remaining);
    unit[layer] = value - absorbed;
    remaining -= absorbed;
    layers.push({ layer, amount: absorbed, remaining });
  }
  if (unit.kind === "squadron" && unit.unitHealth) unit.stack = Math.min(before.stack, Math.max(0, Math.ceil((unit.integrity ?? 0) / unit.unitHealth)));
  const after = { shield: unit.shield ?? 0, armor: unit.armor ?? 0, integrity: unit.integrity ?? 0, ...(unit.kind === "squadron" ? { stack: unit.stack ?? 0 } : {}) };
  const destroyed = (unit.integrity ?? 0) <= 0;
  const damageEvent = recordEvent(state, "damage-packet", { actorId: packet.sourceId ?? null, subjectIds: [unit.id], causeEventId: packet.causeEventId ?? null, cause: packet.cause ?? "damage", before, after, layers });
  let causeEventId = damageEvent.eventId;
  if (unit.kind === "squadron" && after.stack < before.stack) causeEventId = recordEvent(state, "squadron-craft-lost", { actorId: packet.sourceId ?? null, subjectIds: [unit.id], causeEventId, before: { stack: before.stack }, after: { stack: after.stack }, lost: before.stack - after.stack }).eventId;
  if (destroyed) destroyUnit(state, unit, { causeEventId, deferVictory: packet.deferVictory === true });
  return { amount: packet.amount - remaining, destroyed, layers };
}

function finishIfVictorious(state, causeEventId = null) {
  const remainingSides = new Set(state.units.map(candidate => candidate.side));
  if (remainingSides.size === 1 && state.units.length) {
    state.winner = [...remainingSides][0]; state.lifecycle = "Finished";
    recordEvent(state, "victory", { causeEventId, after: { winner: state.winner } });
  }
}

export function destroyUnit(state, target, { causeEventId = null, deferVictory = false } = {}) {
  const unit = typeof target === "string" ? state.units.find(candidate => candidate.id === target) : target;
  if (!unit || !state.units.includes(unit)) return { destroyed: false };
  const position = unit.position ? { ...unit.position } : null;
  weaponSlots(unit).forEach(slot => { slot.overwatch = false; slot.overwatchTargets = []; });
  state.units = state.units.filter(candidate => candidate !== unit);
  state.queue = state.queue.filter(id => id !== unit.id);
  state.contents = state.contents.filter(item => item.kind !== "debris" || !samePosition(item.position, position));
  const destroyedEvent = recordEvent(state, "unit-destroyed", { actorId: null, subjectIds: [unit.id], causeEventId, position, after: { debris: Boolean(position) } });
  if (position) {
    const debris = { id: `debris-${unit.id}-${state.sequence + 1}`, kind: "debris", type: "debrisField", cover: "debris", position };
    state.contents.push(debris);
    recordEvent(state, "debris-created", { subjectIds: [debris.id], causeEventId: destroyedEvent.eventId, position });
  }
  const removedLinks = (state.interceptionLinks ?? []).filter(link => link.unitIds.includes(unit.id));
  state.interceptionLinks = (state.interceptionLinks ?? []).filter(link => !link.unitIds.includes(unit.id));
  state.units.forEach(candidate => { if (Array.isArray(candidate.engagedWith)) candidate.engagedWith = candidate.engagedWith.filter(id => id !== unit.id); });
  removedLinks.forEach(link => recordEvent(state, "interception-link-removed", { subjectIds: link.unitIds, causeEventId: destroyedEvent.eventId, creators: link.creators }));
  if (!deferVictory) finishIfVictorious(state, destroyedEvent.eventId);
  return { destroyed: true, unitId: unit.id, winner: state.winner, eventId: destroyedEvent.eventId };
}

function roundCube({ x, y, z }) {
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx || 0, r: rz || 0 };
}

function drawHexLine(a, b, nudge) {
  const steps = distance(a, b);
  if (!steps) return [{ ...a }];
  const from = { x: a.q + nudge, z: a.r + nudge, y: -a.q - a.r - nudge * 2 };
  const to = { x: b.q + nudge, z: b.r + nudge, y: -b.q - b.r - nudge * 2 };
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    return roundCube({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t });
  });
}

export function supercoverLine(a, b) {
  const cells = [...drawHexLine(a, b, 1e-6), ...drawHexLine(a, b, -1e-6)];
  const unique = [...new Map(cells.map(cell => [`${cell.q},${cell.r}`, cell])).values()];
  const delta = { q: b.q - a.q, r: b.r - a.r };
  return unique.sort((left, right) => {
    const leftProgress = (left.q - a.q) * delta.q + (left.r - a.r) * delta.r;
    const rightProgress = (right.q - a.q) * delta.q + (right.r - a.r) * delta.r;
    return leftProgress - rightProgress || left.q - right.q || left.r - right.r;
  });
}

const hexDirections = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }];

function scaledDirection(direction, amount) { return { q: direction.q * amount, r: direction.r * amount }; }
function sameDelta(delta, candidate) { return delta.q === candidate.q && delta.r === candidate.r; }
function relativeToHeading(delta, heading) {
  let relative = { ...delta };
  for (let turn = 0; turn < heading; turn += 1) relative = { q: -relative.r, r: relative.q + relative.r };
  return relative;
}

function arcAllows(source, victim, weapon) {
  const range = distance(source.position, victim.position), arc = weapon.arc ?? weapon.profile ?? "360";
  const min = weapon.minRange ?? (arc === "linear" || arc === "line" ? 3 : 1), max = weapon.maxRange ?? (arc === "linear" || arc === "line" ? 5 : 3);
  if (range < min || range > max) return false;
  if (["360", "turret", "aa-turret"].includes(arc) || source.heading === undefined) return true;
  const heading = ((source.heading + 4) % 6 + 6) % 6;
  const delta = { q: victim.position.q - source.position.q, r: victim.position.r - source.position.r };
  if (arc === "linear" || arc === "line") return sameDelta(delta, scaledDirection(hexDirections[heading], range));
  const relative = relativeToHeading(delta, heading);
  if (arc === "battery-left" || arc === "left") return relative.r < 0 && relative.q >= 0;
  if (arc === "battery-right" || arc === "right") return relative.r > 0 && relative.q + relative.r >= 0;
  if (arc === "forward" || arc === "front") return relative.q >= 0 && relative.q + relative.r >= 0;
  return false;
}

function attackBlocker(state, source, victim) {
  if (!source?.position || !victim?.position) return null;
  const candidates = [...state.units, ...state.contents].filter(item => item !== source && item !== victim && item.position && item.kind !== "squadron" && !(item.kind === "object" && item.size === "small") && ["small", "medium", "large"].includes(item.size));
  const line = supercoverLine(source.position, victim.position).slice(1, -1);
  return candidates.filter(item => line.some(position => samePosition(item.position, position))).sort((left, right) => distance(source.position, left.position) - distance(source.position, right.position) || left.id.localeCompare(right.id))[0] ?? null;
}

export function previewAttack(state, attacker, target, weapon = {}) {
  const source = typeof attacker === "string" ? state.units.find(unit => unit.id === attacker) : attacker;
  const victim = typeof target === "string" ? state.units.find(unit => unit.id === target) : target;
  const accuracy = Math.max(0, Math.min(100, weapon.accuracy ?? 100));
  const shots = (weapon.shots ?? 1) * (source?.kind === "squadron" ? (source.stack ?? 1) : 1);
  const damage = weapon.damage ?? 0;
  const terrain = victim?.position && state.contents.find(item => samePosition(item.position, victim.position) && item.cover);
  const coverPenalty = terrain?.cover === "nebula" ? 15 : terrain?.cover === "debris" ? 10 : terrain?.cover === "asteroid" ? 20 : 0;
  const blocker = attackBlocker(state, source, victim);
  const blockerCover = blocker ? ({ small: 25, medium: 50, large: 100 }[blocker.size] ?? 0) : 0;
  const effectiveAccuracy = Math.max(0, accuracy - coverPenalty);
  const hitBlocker = Math.min(blockerCover, effectiveAccuracy);
  const hitMain = Math.max(0, effectiveAccuracy - blockerCover);
  const miss = Math.max(0, 100 - effectiveAccuracy);
  return { attackerId: source?.id ?? null, targetId: victim?.id ?? null, accuracy: hitMain, effectiveAccuracy, hitBlocker, hitMain, miss, baseAccuracy: accuracy, shots, damage, totalDamage: shots * damage, cover: coverPenalty, blockerId: blocker?.id ?? null, blockerCover, friendlyFire: Boolean(blocker && blocker.side === source?.side), canAttack: Boolean(source && victim && source !== victim && source.side !== victim.side && state.attackSpentBy !== source.id && arcAllows(source, victim, weapon)) };
}

function applyObjectDamage(state, object, amount, sourceId, cause = "ramming", causeEventId = null) {
  const before = object.integrity ?? 0;
  object.integrity = Math.max(0, before - amount);
  const destroyed = object.integrity === 0;
  const damageEvent = recordEvent(state, "damage-packet", { actorId: sourceId, subjectIds: [object.id], causeEventId, cause, before: { integrity: before }, after: { integrity: object.integrity }, layers: [{ layer: "integrity", amount: before - object.integrity, remaining: Math.max(0, amount - before) }] });
  if (destroyed) {
    state.contents = state.contents.filter(item => item !== object);
    const destroyedEvent = recordEvent(state, "object-destroyed", { subjectIds: [object.id], causeEventId: damageEvent.eventId, position: { ...object.position }, after: { debris: true } });
    const debris = { id: `debris-${object.id}-${state.sequence + 1}`, kind: "debris", type: "debrisField", cover: "debris", position: { ...object.position } };
    state.contents.push(debris);
    recordEvent(state, "debris-created", { subjectIds: [debris.id], causeEventId: destroyedEvent.eventId, position: { ...object.position } });
  }
  return { amount: before - object.integrity, destroyed };
}

function straightRun(stepHeadings) {
  if (!stepHeadings.length) return 0;
  let length = 1;
  for (let index = stepHeadings.length - 1; index > 0 && stepHeadings[index] === stepHeadings[index - 1]; index -= 1) length += 1;
  return length;
}

export function planRam(state, attacker, target) {
  const source = typeof attacker === "string" ? state.units.find(unit => unit.id === attacker) : attacker;
  const victim = typeof target === "string" ? [...state.units, ...state.contents].find(item => item.id === target) : target;
  if (!source?.position || !victim?.position || source.kind !== "capital" || !["capital", "object"].includes(victim.kind) || (victim.kind === "object" && victim.size !== "large") || source.side === victim.side) return { valid: false, steps: [], directSteps: 0 };
  const speed = Math.max(0, source.currentSpeed ?? source.speed ?? 0), routes = [], queue = [{ position: source.position, heading: source.heading, cost: 0, turns: 0, steps: [], headings: [] }];
  while (queue.length) {
    const route = queue.shift();
    if (distance(route.position, victim.position) === 1 && route.steps.length) routes.push(route);
    for (let heading = 0; heading < movementDirections.length; heading += 1) {
      const turn = turnDistance(route.heading, heading), direction = movementDirections[heading];
      if (turn > 1 || (source.turnsSpent ?? 0) + route.turns + turn > (source.maneuver ?? 0)) continue;
      const position = { q: route.position.q + direction.q, r: route.position.r + direction.r };
      const content = state.contents.find(item => samePosition(item.position, position));
      const cost = route.cost + (content?.movementCost ?? 1);
      if (cost > speed || !canEnter(state, source, position, { final: true }) || route.steps.some(step => samePosition(step, position)) || samePosition(source.position, position)) continue;
      queue.push({ position, heading, cost, turns: route.turns + turn, steps: [...route.steps, position], headings: [...route.headings, heading] });
    }
  }
  const routeRisk = route => route.steps.reduce((total, position) => total + state.contents.filter(item => samePosition(item.position, position)).flatMap(item => [...(item.onEnterEffects ?? []), ...((item.onEnterDamage ?? 0) > 0 ? [{ type: "damage", amount: item.onEnterDamage }] : [])]).reduce((sum, effect) => sum + (effect.type === "damage" ? effect.amount : 0), 0), 0);
  routes.sort((a, b) => straightRun(b.headings) - straightRun(a.headings) || routeRisk(a) - routeRisk(b) || b.steps.length - a.steps.length || a.cost - b.cost || JSON.stringify(a.steps).localeCompare(JSON.stringify(b.steps)));
  const route = routes[0];
  return route ? { valid: true, steps: route.steps, directSteps: straightRun(route.headings), movementCost: route.cost, finalHeading: route.heading } : { valid: false, steps: [], directSteps: 0 };
}

export function ram(state, attacker, target, steps) {
  const source = typeof attacker === "string" ? state.units.find(unit => unit.id === attacker) : attacker;
  const victim = typeof target === "string" ? [...state.units, ...state.contents].find(item => item.id === target) : target;
  const plan = planRam(state, source, victim);
  if (!source || !victim || state.lifecycle !== "Maneuver" || state.activeUnitId !== source.id || state.attackSpentBy === source.id || !plan.valid || JSON.stringify(steps) !== JSON.stringify(plan.steps)) return { success: false, damage: 0 };
  const declared = recordEvent(state, "ramming-declared", { actorId: source.id, subjectIds: [victim.id], route: steps.map(position => ({ ...position })), directSteps: plan.directSteps });
  const route = moveAtomic(state, source.id, steps, { ramming: true, ramTargetId: victim.id, causeEventId: declared.eventId });
  if (route.moved !== steps.length || !state.units.includes(source) || distance(source.position, victim.position) !== 1) {
    recordEvent(state, "ramming-cancelled", { actorId: source.id, subjectIds: [victim.id], causeEventId: state.events.at(-1)?.eventId ?? declared.eventId, moved: route.moved });
    return { success: false, damage: 0, moved: route.moved };
  }
  const targetDamage = (source.mass ?? 0) * (1 + plan.directSteps), attackerDamage = victim.mass ?? 0;
  const impact = recordEvent(state, "ramming-impact", { actorId: source.id, subjectIds: [victim.id], causeEventId: state.events.at(-1)?.eventId ?? declared.eventId, targetDamage, attackerDamage, directSteps: plan.directSteps });
  const targetResult = victim.kind === "capital" ? applyDamagePacket(state, victim, { amount: targetDamage, sourceId: source.id, cause: "ramming", causeEventId: impact.eventId, deferVictory: true }) : applyObjectDamage(state, victim, targetDamage, source.id, "ramming", impact.eventId);
  source.evasion = 0;
  const attackerResult = applyDamagePacket(state, source, { amount: attackerDamage, sourceId: victim.id, cause: "ramming", causeEventId: impact.eventId, deferVictory: true });
  state.attackSpentBy = source.id;
  const resolved = recordEvent(state, "ramming-resolved", { actorId: source.id, subjectIds: [victim.id], causeEventId: impact.eventId, targetDamage: targetResult.amount, attackerDamage: attackerResult.amount, targetDestroyed: targetResult.destroyed, attackerDestroyed: attackerResult.destroyed });
  finishIfVictorious(state, resolved.eventId);
  return { success: true, damage: targetResult.amount, targetDestroyed: targetResult.destroyed, attackerDestroyed: attackerResult.destroyed };
}

export function resolveAttack(state, attacker, target, slot = null, { random = Math.random, causeEventId = null } = {}) {
  return resolveAttackInternal(state, attacker, target, slot, { random, causeEventId, cause: "attack", reaction: false });
}

function resolveAttackInternal(state, attacker, target, slot, { random, causeEventId, cause, reaction }) {
  const source = typeof attacker === "string" ? state.units.find(unit => unit.id === attacker) : attacker;
  const victim = typeof target === "string" ? state.units.find(unit => unit.id === target) : target;
  const ownedSlot = weaponSlots(source).find(candidate => candidate === slot);
  const weapon = ownedSlot?.weapon ?? ownedSlot ?? {};
  const preview = previewAttack(state, source, victim, weapon);
  const manual = !reaction;
  if (!source || !victim || !state.units.includes(source) || !state.units.includes(victim) || !ownedSlot || !preview.canAttack || state.lifecycle === "Finished" || (reaction && state.lifecycle !== "Maneuver") || (manual && state.attackSpentBy === source.id) || (manual && (state.lifecycle !== "Attack" || state.activeUnitId !== source.id || ownedSlot.destroyed === true || ownedSlot.ready === false || ownedSlot.overwatch === true || slotAmmo(ownedSlot) <= 0))) return { ...preview, hits: 0, damage: 0 };
  if (manual) spendSlot(ownedSlot);
  let hits = 0, damage = 0;
  for (let shot = 0; shot < preview.shots; shot += 1) {
    const current = previewAttack(state, preview.attackerId, preview.targetId, weapon);
    if (!current.canAttack) break;
    const roll = random() * 100;
    const blockerHit = Boolean(current.blockerId && roll < current.hitBlocker);
    const mainHit = !blockerHit && roll < current.hitBlocker + current.hitMain;
    const hitId = blockerHit ? current.blockerId : mainHit ? current.targetId : null;
    const shotEvent = recordEvent(state, "attack-shot", { actorId: current.attackerId, subjectIds: [current.targetId], causeEventId, random: { roll, hitBlocker: current.hitBlocker, hitMain: current.hitMain, miss: current.miss }, after: { hitId } });
    if (!hitId) continue;
    const unit = state.units.find(candidate => candidate.id === hitId);
    const object = state.contents.find(candidate => candidate.id === hitId);
    const damageCause = blockerHit && current.friendlyFire ? "friendly-fire" : cause;
    const result = unit ? applyDamagePacket(state, unit, { amount: current.damage, sourceId: current.attackerId, causeEventId: shotEvent.eventId, cause: damageCause }) : applyObjectDamage(state, object, current.damage, current.attackerId, damageCause);
    hits += 1;
    damage += result.amount;
    if (mainHit && result.destroyed) break;
  }
  if (manual) state.attackSpentBy = source.id;
  return { ...preview, hits, damage, destroyed: !state.units.some(unit => unit.id === preview.targetId) };
}
