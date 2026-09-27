export const LIFECYCLE = Object.freeze([
  "DeploymentLeft", "DeploymentRight", "RoundStart", "WaitDecision", "ActivationStart",
  "SystemActions", "Maneuver", "Attack", "EndActivation", "RoundEnd", "Finished"
]);

const sides = ["left", "right"];

export function createBattle({ id = "battle-1", units = [], bounds = null, contents = [] } = {}) {
  const normalized = units.map(unit => ({ ...unit, side: unit.side ?? unit.sideId, position: unit.position ? { ...unit.position } : null, hasActivated: false, hasWaited: false }));
  return {
    id, units: normalized, contents: contents.map(item => ({ ...item, position: { ...item.position } })), bounds,
    lifecycle: "DeploymentLeft", deployment: { left: false, right: false }, round: 0, queue: [], activeUnitId: null,
    activationStage: null, winner: null, events: [], sequence: 0
  };
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
  const closest = enemies.slice().sort((a, b) => (b.stack ?? b.count ?? 1) - (a.stack ?? a.count ?? 1))[0];
  const chance = Math.max(10, Math.min(90, 60 - Math.max(0, (closest?.stack ?? 1) - 1) * 10 - Math.max(0, enemies.length - 1) * 10 + (unit.friendlyLinked ?? 0) * 10));
  unit.speed = Math.max(0, (unit.speed ?? 0) - enemies.length);
  unit.evasionPenalty = (unit.evasionPenalty ?? 0) - 10;
  const success = random() * 100 < chance;
  if (success) { unit.engagedWith = []; unit.disengagedUntilRound = state.round; enemies.forEach(enemy => { enemy.engagedWith = (enemy.engagedWith ?? []).filter(id => id !== unit.id); }); }
  recordEvent(state, "disengage", { actorId: unitId, chance, success });
  return { success, chance, cost: enemies.length };
}


export function deploymentZone(state, side) {
  if (!state.bounds) return [];
  const edge = side === "left" ? state.bounds.minCol : state.bounds.maxCol;
  const columns = side === "left" ? [edge, edge + 1] : [edge, edge - 1];
  return columns.flatMap(col => Array.from({ length: state.bounds.maxRow - state.bounds.minRow + 1 }, (_, i) => ({ q: col, r: state.bounds.minRow + i })));
}

export function deployUnit(state, unitId, position, heading = null) {
  const side = sideForLifecycle(state.lifecycle), unit = state.units.find(candidate => candidate.id === unitId);
  if (!side || !unit || unit.side !== side || state.deployment[side] || unitAt(state, position, unitId) || state.contents.some(item => samePosition(item.position, position)) || !deploymentZone(state, side).some(cell => samePosition(cell, position))) return false;
  unit.position = { ...position };
  if (heading !== null && unit.kind === "capital") unit.heading = heading;
  recordEvent(state, "deployment-place", { actorId: unitId, subjectIds: [unitId], position: { ...position } });
  return true;
}

export function confirmDeployment(state, side) {
  if (side !== sideForLifecycle(state.lifecycle) || state.deployment[side]) return false;
  const fleet = state.units.filter(unit => unit.side === side);
  if (fleet.some(unit => !unit.position || !deploymentZone(state, side).some(cell => samePosition(cell, unit.position)))) return false;
  state.deployment[side] = true;
  recordEvent(state, "deployment-confirm", { actorId: side, subjectIds: fleet.map(unit => unit.id) });
  state.lifecycle = side === "left" ? "DeploymentRight" : "RoundStart";
  if (side === "right") progress(state);
  return true;
}

export function progress(state) {
  if (state.lifecycle === "Finished") return state.lifecycle;
  if (state.lifecycle === "RoundStart") {
    state.round += 1; state.units.forEach(unit => { unit.hasActivated = false; unit.hasWaited = false; });
    state.queue = state.units.filter(unit => unit.position).slice().sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0)).map(unit => unit.id);
    state.lifecycle = "WaitDecision"; state.activeUnitId = state.queue[0] ?? null;
  } else if (state.lifecycle === "ActivationStart") {
    state.lifecycle = "SystemActions"; state.activationStage = "SystemActions";
  } else if (state.lifecycle === "EndActivation") {
    const unit = state.units.find(candidate => candidate.id === state.activeUnitId); if (unit) unit.hasActivated = true;
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
  state.lifecycle = "ActivationStart"; recordEvent(state, "activation-start", { actorId: unit.id }); progress(state); return true;
}

export function advanceActivation(state, stage) {
  const order = ["SystemActions", "Maneuver", "Attack", "EndActivation"], current = order.indexOf(state.lifecycle);
  if (current < 0 || order.indexOf(stage) !== current + 1) return false;
  state.lifecycle = stage; state.activationStage = stage; recordEvent(state, "activation-stage", { actorId: state.activeUnitId, after: stage }); return true;
}

export function canEnter(state, unit, position, { final = false, ramming = false } = {}) {
  if (!unit || !position || (state.bounds && (position.q < state.bounds.minCol || position.q > state.bounds.maxCol || position.r < state.bounds.minRow || position.r > state.bounds.maxRow))) return false;
  const occupant = unitAt(state, position, unit.id), object = state.contents.find(item => samePosition(item.position, position) && item.kind === "object");
if (object || (occupant && occupant.side !== unit.side && !(ramming && unit.kind === "capital" && occupant.kind === "capital")) || (occupant && final)) return false;
   if (occupant && unit.kind === "capital") return false;
   if (occupant && unit.kind === "squadron" && occupant.kind === "capital") return false;
  return true;
}

export function moveAtomic(state, unitId, steps, { ramming = false } = {}) {
  const unit = state.units.find(candidate => candidate.id === unitId); if (!unit || state.lifecycle === "Finished") return { status: "blocked", moved: 0 };
  if (!ramming && unit.kind === "squadron" && unit.engagedWith?.length) return { status: "blocked", moved: 0 };
  let moved = 0;
  for (const position of steps) { if (!canEnter(state, unit, position, { final: position === steps.at(-1), ramming })) break; unit.position = { ...position }; moved += 1; recordEvent(state, "movement-step", { actorId: unitId, subjectIds: [unitId], position: { ...position } }); }
  return { status: moved === steps.length ? "moved" : "blocked", moved };
}

export function applyDamagePacket(state, target, packet = {}) {
  const unit = typeof target === "string" ? state.units.find(candidate => candidate.id === target) : target;
  if (!unit || !state.units.includes(unit) || (packet.amount ?? 0) <= 0) return { amount: 0, destroyed: false, layers: [] };
  let remaining = packet.amount;
  const before = { shield: unit.shield ?? 0, armor: unit.armor ?? 0, integrity: unit.integrity ?? 0 };
  const layers = [];
  for (const layer of ["shield", "armor", "integrity"]) {
    if (!remaining) break;
    const value = unit[layer] ?? 0;
    const absorbed = Math.min(value, remaining);
    unit[layer] = value - absorbed;
    remaining -= absorbed;
    layers.push({ layer, amount: absorbed, remaining });
  }
  if (unit.kind === "squadron" && unit.unitHealth) unit.stack = Math.max(0, Math.ceil((unit.integrity ?? 0) / unit.unitHealth));
  const destroyed = (unit.integrity ?? 0) <= 0;
  recordEvent(state, "damage-packet", { actorId: packet.sourceId ?? null, subjectIds: [unit.id], cause: packet.cause ?? "damage", before, after: { shield: unit.shield ?? 0, armor: unit.armor ?? 0, integrity: unit.integrity ?? 0 }, layers });
  if (destroyed) destroyUnit(state, unit, { causeEventId: state.events.at(-1).eventId });
  return { amount: packet.amount - remaining, destroyed, layers };
}

export function destroyUnit(state, target, { causeEventId = null } = {}) {
  const unit = typeof target === "string" ? state.units.find(candidate => candidate.id === target) : target;
  if (!unit || !state.units.includes(unit)) return { destroyed: false };
  const position = unit.position ? { ...unit.position } : null;
  state.units = state.units.filter(candidate => candidate !== unit);
  state.queue = state.queue.filter(id => id !== unit.id);
  state.contents = state.contents.filter(item => item.kind !== "debris" || !samePosition(item.position, position));
  if (position) state.contents.push({ id: `debris-${unit.id}-${state.sequence + 1}`, kind: "debris", type: "debrisField", position });
  state.units.forEach(candidate => { if (Array.isArray(candidate.engagedWith)) candidate.engagedWith = candidate.engagedWith.filter(id => id !== unit.id); });
  recordEvent(state, "unit-destroyed", { actorId: null, subjectIds: [unit.id], causeEventId, position, after: { debris: Boolean(position) } });
  const remainingSides = new Set(state.units.map(candidate => candidate.side));
  if (remainingSides.size === 1 && state.units.length) {
    state.winner = [...remainingSides][0]; state.lifecycle = "Finished";
    recordEvent(state, "victory", { after: { winner: state.winner } });
  }
  return { destroyed: true, unitId: unit.id, winner: state.winner };
}

function lineCells(a, b) {
  const n = Math.max(1, distance(a, b)), cells = [];
  for (let i = 0; i <= n; i += 1) cells.push({ q: Math.round(a.q + (b.q - a.q) * i / n), r: Math.round(a.r + (b.r - a.r) * i / n) });
  return cells.filter((cell, index) => index === 0 || !samePosition(cell, cells[index - 1]));
}

function arcAllows(source, victim, weapon) {
  const range = distance(source.position, victim.position), min = weapon.minRange ?? (weapon.profile === "linear" ? 3 : 1), max = weapon.maxRange ?? 3;
  if (range < min || range > max) return false;
  if (weapon.arc === "360" || weapon.arc === "turret") return true;
  if (weapon.arc === "linear") return source.heading === undefined || Math.sign(victim.position.q - source.position.q) === (source.heading === 2 ? 1 : source.heading === 5 ? -1 : 0);
  return true;
}

export function previewAttack(state, attacker, target, weapon = {}) {
  const source = typeof attacker === "string" ? state.units.find(unit => unit.id === attacker) : attacker;
  const victim = typeof target === "string" ? state.units.find(unit => unit.id === target) : target;
  const accuracy = Math.max(0, Math.min(100, weapon.accuracy ?? 100));
  const shots = weapon.shots ?? 1;
  const damage = weapon.damage ?? 0;
  const terrain = victim?.position && state.contents.find(item => samePosition(item.position, victim.position) && item.cover);
  const coverPenalty = terrain?.cover === "nebula" ? 15 : terrain?.cover === "debris" ? 10 : terrain?.cover === "asteroid" ? 20 : 0;
  const cells = source?.position && victim?.position ? lineCells(source.position, victim.position) : [];
  const blocker = cells.slice(1, -1).map(position => state.units.find(unit => unit.position && samePosition(unit.position, position) && unit !== source && unit !== victim && unit.kind !== "squadron" && unit.size)).find(Boolean);
  const blockerCover = blocker ? ({ small: 25, medium: 50, large: 100 }[blocker.size] ?? 0) : 0;
  const effectiveAccuracy = Math.max(0, accuracy - coverPenalty);
  return { attackerId: source?.id ?? null, targetId: victim?.id ?? null, accuracy: effectiveAccuracy, baseAccuracy: accuracy, shots, damage, totalDamage: shots * damage, cover: coverPenalty, blockerId: blocker?.id ?? null, blockerCover, canAttack: Boolean(source && victim && source !== victim && source.side !== victim.side && arcAllows(source, victim, weapon)) };
}

export function resolveAttack(state, attacker, target, weapon = {}, { random = Math.random } = {}) {
  const preview = previewAttack(state, attacker, target, weapon);
  if (!preview.canAttack || state.lifecycle === "Finished") return { ...preview, hits: 0, damage: 0 };
  let hits = 0, damage = 0;
  for (let shot = 0; shot < preview.shots; shot += 1) {
    const roll = random() * 100;
    recordEvent(state, "attack-shot", { actorId: preview.attackerId, subjectIds: [preview.targetId], random: { roll, accuracy: preview.accuracy } });
    if (roll < preview.accuracy) { const result = applyDamagePacket(state, preview.targetId, { amount: preview.damage, sourceId: preview.attackerId, cause: "attack" }); hits += 1; damage += result.amount; if (result.destroyed) break; }
  }
  return { ...preview, hits, damage, destroyed: !state.units.some(unit => unit.id === preview.targetId) };
}
