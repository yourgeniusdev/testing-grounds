export const LIFECYCLE = Object.freeze([
  "DeploymentLeft", "DeploymentRight", "RoundStart", "WaitDecision", "ActivationStart",
  "SystemActions", "Maneuver", "Attack", "EndActivation", "RoundEnd", "Finished"
]);

const sides = ["left", "right"];

export function createBattle({ id = "battle-1", units = [], bounds = null, contents = [] } = {}) {
  const normalized = units.map(unit => ({ ...unit, side: unit.side ?? unit.sideId, position: unit.position ? { ...unit.position } : null, currentSpeed: unit.currentSpeed ?? unit.speed ?? 1, hasActivated: false, hasWaited: false }));
  const state = {
    id, units: normalized, contents: contents.map(item => ({ ...item, position: { ...item.position } })), bounds,
    lifecycle: "DeploymentLeft", deployment: { left: false, right: false }, round: 0, queue: [], activeUnitId: null,
    activationStage: null, attackSpentBy: null, winner: null, events: [], sequence: 0
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

export function refreshInterception(state) {
  state.units.forEach(unit => { if (unit.kind === "squadron") unit.engagedWith = []; });
  const squadrons = state.units.filter(unit => unit.kind === "squadron" && unit.position && unit.interception !== false);
  for (const a of squadrons) for (const b of squadrons) if (a !== b && a.side !== b.side && (a.role ?? a.type) !== "bomber" && distance(a.position, b.position) <= (a.interceptRange ?? 1)) {
    a.engagedWith.push(b.id);
  }
  return state.units.filter(unit => unit.kind === "squadron").map(unit => ({ id: unit.id, engagedWith: [...(unit.engagedWith ?? [])] }));
}

export function disengage(state, unitId, { random = Math.random } = {}) {
  const unit = state.units.find(candidate => candidate.id === unitId);
  if (!unit || unit.kind !== "squadron" || !(unit.engagedWith?.length)) return { success: false, chance: 0, cost: 0 };
  const enemies = unit.engagedWith.map(id => state.units.find(candidate => candidate.id === id)).filter(Boolean);
  const cost = enemies.length;
  if ((unit.currentSpeed ?? unit.speed ?? 0) < cost) return { success: false, chance: 0, cost };
  const closest = enemies.slice().sort((a, b) => (b.stack ?? b.count ?? 1) - (a.stack ?? a.count ?? 1))[0];
  const chance = Math.max(10, Math.min(90, 60 - Math.max(0, (closest?.stack ?? 1) - 1) * 10 - Math.max(0, enemies.length - 1) * 10 + (unit.friendlyLinked ?? 0) * 10));
  unit.currentSpeed = (unit.currentSpeed ?? unit.speed ?? 0) - cost;
  unit.evasionPenalty = (unit.evasionPenalty ?? 0) - 10;
  const roll = random() * 100;
  const success = roll < chance;
  if (success) { unit.engagedWith = []; unit.disengagedUntilRound = state.round; enemies.forEach(enemy => { enemy.engagedWith = (enemy.engagedWith ?? []).filter(id => id !== unit.id); }); }
  recordEvent(state, "disengage", { actorId: unitId, chance, success, random: { roll, chance } });
  if (!success && state.lifecycle === "Maneuver" && state.activeUnitId === unitId) {
    state.lifecycle = "Attack";
    state.activationStage = "Attack";
    recordEvent(state, "activation-stage", { actorId: unitId, after: "Attack" });
  }
  return { success, chance, cost };
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

function slotCanOverwatch(state, owner, slot, target) {
  const weapon = slot.weapon ?? slot;
  return owner && target && owner.side !== target.side && target.kind === "squadron" &&
    (slot.destroyed !== true) && (slot.ready !== false) && slot.overwatch === true &&
    (slot.ammo ?? weapon.ammo ?? 1) > 0 && arcAllows(owner, target, weapon) &&
    previewAttack(state, owner, target, weapon).canAttack;
}

export function armOverwatch(state, unitId = state.activeUnitId) {
  const owner = state.units.find(unit => unit.id === unitId);
  if (!owner) return [];
  const armed = [];
  weaponSlots(owner).forEach((slot, index) => {
    const weapon = slot.weapon ?? slot;
    if ((slot.ready !== false) && slot.overwatchEligible === true && (slot.ammo ?? weapon.ammo ?? 1) > 0) {
      slot.overwatch = true;
      slot.overwatchRound = state.round;
      slot.overwatchTargets = slot.overwatchTargets ?? [];
      armed.push(`${owner.id}:${slot.id ?? index}`);
    }
  });
  if (armed.length) recordEvent(state, "overwatch-armed", { actorId: owner.id, subjectIds: armed });
  return armed;
}

export function resolveOverwatch(state, targetId, { random = Math.random, causeEventId = null } = {}) {
  const target = state.units.find(unit => unit.id === targetId);
  if (!target || target.kind !== "squadron") return [];
  const candidates = [];
  state.units.forEach(owner => weaponSlots(owner).forEach((slot, index) => {
    if (slot.overwatch && slot.overwatchRound === state.round && slotCanOverwatch(state, owner, slot, target) && !(slot.overwatchTargets ?? []).includes(target.id))
      candidates.push({ owner, slot, index });
  }));
  candidates.sort((a, b) => (b.owner.initiative ?? 0) - (a.owner.initiative ?? 0) || `${a.owner.id}:${a.index}`.localeCompare(`${b.owner.id}:${b.index}`));
  const results = [];
  for (const candidate of candidates) {
    if (!state.units.includes(target) || !state.units.includes(candidate.owner) || !slotCanOverwatch(state, candidate.owner, candidate.slot, target)) break;
    const { owner, slot } = candidate, weapon = slot.weapon ?? slot;
    slot.ready = false; slot.overwatch = false; slot.overwatchTargets = [...(slot.overwatchTargets ?? []), target.id];
    const declared = recordEvent(state, "overwatch-declared", { actorId: owner.id, subjectIds: [target.id], causeEventId });
    const preview = previewAttack(state, owner, target, weapon);
    const roll = random() * 100;
    recordEvent(state, "overwatch-shot", { actorId: owner.id, subjectIds: [target.id], causeEventId: declared.eventId, random: { roll, accuracy: preview.accuracy } });
    const result = roll < preview.accuracy ? resolveAttack(state, owner, target, weapon, { random: () => 0 }) : { damage: 0, hits: 0, destroyed: false };
    results.push({ ownerId: owner.id, targetId: target.id, roll, ...result });
  }
  return results;
}

function clearOverwatch(state) {
  state.units.forEach(unit => weaponSlots(unit).forEach(slot => { slot.overwatch = false; slot.overwatchTargets = []; }));
}

export function progress(state) {
  if (state.lifecycle === "Finished") return state.lifecycle;
  if (state.lifecycle === "RoundStart") {
    state.round += 1; state.attackSpentBy = null; clearOverwatch(state); state.units.forEach(unit => { unit.hasActivated = false; unit.hasWaited = false; });
    state.queue = state.units.filter(unit => unit.position).slice().sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0)).map(unit => unit.id);
    state.lifecycle = "WaitDecision"; state.activeUnitId = state.queue[0] ?? null;
  } else if (state.lifecycle === "ActivationStart") {
    state.lifecycle = "SystemActions"; state.activationStage = "SystemActions";
  } else if (state.lifecycle === "EndActivation") {
    const unit = state.units.find(candidate => candidate.id === state.activeUnitId); if (unit) { unit.hasActivated = true; armOverwatch(state, unit.id); }
    state.attackSpentBy = null;
    const next = state.queue.find(id => { const candidate = state.units.find(unit => unit.id === id); return candidate && !candidate.hasActivated; });
    if (next) { state.activeUnitId = next; state.lifecycle = "WaitDecision"; }
    else state.lifecycle = "RoundEnd";
  } else if (state.lifecycle === "RoundEnd") state.lifecycle = "RoundStart";
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
  const occupant = state.units.find(candidate => candidate.id !== unit.id && liesOnShortestRoute(candidate.position));
  const reason = object ? `Маршрут заблокирован объектом: ${object.type ?? "препятствие"}` : occupant ? `Гекс занят кораблём: ${occupant.name ?? occupant.id}` : "Цель вне доступной дальности";
  return { valid: false, steps: [], reason, movementCost: 0 };
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

export function moveAtomic(state, unitId, steps, { ramming = false, heading = null } = {}) {
  const unit = state.units.find(candidate => candidate.id === unitId);
  if (!unit?.position || state.lifecycle === "Finished" || (!ramming && state.lifecycle !== "Maneuver") || (!ramming && state.activeUnitId && state.activeUnitId !== unitId) || (!ramming && unit.hasActivated)) return { status: "blocked", moved: 0 };
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
    const entry = recordEvent(state, "entry-attempt", { actorId: unitId, subjectIds: [unitId], position: { ...position }, cost });
    const stepHeading = unit.kind === "capital" ? headingForStep(unit.position, position) : null;
    const stepTurn = unit.kind === "capital" ? turnDistance(unit.heading, stepHeading) : 0;
    if (distance(unit.position, position) !== 1 || (unit.currentSpeed ?? 0) < cost || !canEnter(state, unit, position, { final: samePosition(position, steps.at(-1)), ramming }) || (unit.kind === "capital" && (stepHeading < 0 || stepTurn > 1 || (unit.turnsSpent ?? 0) + stepTurn > (unit.maneuver ?? 0)))) break;
    unit.currentSpeed -= cost;
    let causeEventId = entry.eventId;
    if (unit.kind === "capital" && stepTurn) { changeHeading(state, unitId, stepHeading, { causeEventId: entry.eventId }); causeEventId = state.events.at(-1).eventId; }
    unit.position = { ...position };
    moved += 1;
    const movement = recordEvent(state, "movement-step", { actorId: unitId, subjectIds: [unitId], causeEventId, position: { ...position }, cost, remainingSpeed: unit.currentSpeed, heading: unit.heading ?? null });
    lastMovementEventId = movement.eventId;
    for (const content of contents.filter(item => (item.onEnterDamage ?? 0) > 0)) {
      const onEnter = recordEvent(state, "on-enter", { actorId: content.id, subjectIds: [unitId], causeEventId: movement.eventId, position: { ...position }, effect: "damage", amount: content.onEnterDamage });
      applyDamagePacket(state, unit, { amount: content.onEnterDamage, sourceId: content.id, cause: "onEnter", causeEventId: onEnter.eventId });
      if (!state.units.includes(unit)) break;
    }
    if (!state.units.includes(unit)) break;
    if (unit.kind === "squadron") resolveOverwatch(state, unit.id, { causeEventId: movement.eventId });
    if (!state.units.includes(unit)) break;
    refreshInterception(state);
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
  if (destroyed) destroyUnit(state, unit, { causeEventId });
  return { amount: packet.amount - remaining, destroyed, layers };
}

export function destroyUnit(state, target, { causeEventId = null } = {}) {
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
  state.units.forEach(candidate => { if (Array.isArray(candidate.engagedWith)) candidate.engagedWith = candidate.engagedWith.filter(id => id !== unit.id); });
  const remainingSides = new Set(state.units.map(candidate => candidate.side));
  if (remainingSides.size === 1 && state.units.length) {
    state.winner = [...remainingSides][0]; state.lifecycle = "Finished";
    recordEvent(state, "victory", { after: { winner: state.winner } });
  }
  return { destroyed: true, unitId: unit.id, winner: state.winner };
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

function applyObjectDamage(state, object, amount, sourceId, cause = "ramming") {
  const before = object.integrity ?? 0;
  object.integrity = Math.max(0, before - amount);
  const destroyed = object.integrity === 0;
  recordEvent(state, "damage-packet", { actorId: sourceId, subjectIds: [object.id], cause, before: { integrity: before }, after: { integrity: object.integrity }, layers: [{ layer: "integrity", amount: before - object.integrity, remaining: Math.max(0, amount - before) }] });
  if (destroyed) {
    state.contents = state.contents.filter(item => item !== object);
    const destroyedEvent = recordEvent(state, "object-destroyed", { subjectIds: [object.id], position: { ...object.position }, after: { debris: true } });
    const debris = { id: `debris-${object.id}-${state.sequence + 1}`, kind: "debris", type: "debrisField", cover: "debris", position: { ...object.position } };
    state.contents.push(debris);
    recordEvent(state, "debris-created", { subjectIds: [debris.id], causeEventId: destroyedEvent.eventId, position: { ...object.position } });
  }
  return { amount: before - object.integrity, destroyed };
}

export function ram(state, attacker, target, steps, { random = Math.random } = {}) {
  const source = typeof attacker === "string" ? state.units.find(unit => unit.id === attacker) : attacker;
  const victim = typeof target === "string" ? [...state.units, ...state.contents].find(item => item.id === target) : target;
  if (!source || !victim || source.kind !== "capital" || !["capital", "object"].includes(victim.kind) || (victim.kind === "object" && victim.size !== "large") || source.side === victim.side) return { success: false, damage: 0 };
  const route = moveAtomic(state, source.id, steps, { ramming: true });
  if (route.moved !== steps.length || distance(source.position, victim.position) !== 1) return { success: false, damage: 0, moved: route.moved };
  const directSteps = steps.length;
  if (victim.position && samePosition(source.position, victim.position)) return { success: false, damage: 0, moved: route.moved };
  const targetDamage = (source.mass ?? 0) * (1 + directSteps);
  const attackerDamage = victim.mass ?? 0;
  const targetResult = victim.kind === "capital" ? applyDamagePacket(state, victim, { amount: targetDamage, sourceId: source.id, cause: "ramming" }) : applyObjectDamage(state, victim, targetDamage, source.id);
  if (state.units.includes(source)) { source.evasion = 0; applyDamagePacket(state, source, { amount: attackerDamage, sourceId: victim.id, cause: "ramming" }); }
  state.attackSpentBy = source.id;
  recordEvent(state, "ramming", { actorId: source.id, subjectIds: [victim.id], targetDamage, attackerDamage });
  return { success: true, damage: targetResult.amount, targetDestroyed: targetResult.destroyed };
}

export function resolveAttack(state, attacker, target, weapon = {}, { random = Math.random } = {}) {
  const preview = previewAttack(state, attacker, target, weapon);
  if (!preview.canAttack || state.lifecycle === "Finished" || state.attackSpentBy === preview.attackerId) return { ...preview, hits: 0, damage: 0 };
  let hits = 0, damage = 0;
  for (let shot = 0; shot < preview.shots; shot += 1) {
    const current = previewAttack(state, preview.attackerId, preview.targetId, weapon);
    if (!current.canAttack) break;
    const roll = random() * 100;
    const blockerHit = Boolean(current.blockerId && roll < current.hitBlocker);
    const mainHit = !blockerHit && roll < current.hitBlocker + current.hitMain;
    const hitId = blockerHit ? current.blockerId : mainHit ? current.targetId : null;
    recordEvent(state, "attack-shot", { actorId: current.attackerId, subjectIds: [current.targetId], random: { roll, hitBlocker: current.hitBlocker, hitMain: current.hitMain, miss: current.miss }, after: { hitId } });
    if (!hitId) continue;
    const unit = state.units.find(candidate => candidate.id === hitId);
    const object = state.contents.find(candidate => candidate.id === hitId);
    const result = unit ? applyDamagePacket(state, unit, { amount: current.damage, sourceId: current.attackerId, cause: blockerHit && current.friendlyFire ? "friendly-fire" : "attack" }) : applyObjectDamage(state, object, current.damage, current.attackerId, blockerHit && current.friendlyFire ? "friendly-fire" : "attack");
    hits += 1;
    damage += result.amount;
    if (mainHit && result.destroyed) break;
  }
  return { ...preview, hits, damage, destroyed: !state.units.some(unit => unit.id === preview.targetId) };
}
