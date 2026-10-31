import { buildCapitalProfile, buildSquadronProfile } from "./config/index.js";
import { aaPreviewDescriptors, guaranteedEffectPreviewDescriptor, hazardPreviewDescriptor, interceptionPreviewDescriptors, isKnownTo } from "./route-preview.js";

export const DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export const ARROWS = ["→", "↗", "↖", "←", "↙", "↘"];
export const EVASION_BY_STEPS = [0, 5, 9, 12, 14, 15];

export function key(q, r) {
  return `${q},${r}`;
}

export function offsetToAxial(col, row) {
  return { q: col - (row - (row & 1)) / 2, r: row };
}

export function axialToOffset(q, r) {
  return { col: q + (r - (r & 1)) / 2, row: r };
}

export function placed(col, row, data) {
  return { ...data, position: offsetToAxial(col, row) };
}

export function hexDistance(a, b) {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs((-a.q - a.r) - (-b.q - b.r))) / 2;
}

export function signedTurn(from, to) {
  let delta = (to - from + 6) % 6;
  if (delta > 3) delta -= 6;
  return delta;
}

export function movementEvasion(stepCount, evasiveManeuver = false) {
  const base = EVASION_BY_STEPS[Math.min(stepCount, EVASION_BY_STEPS.length - 1)];
  return Math.min(25, Math.round(base * (evasiveManeuver ? 1.5 : 1) * 10) / 10);
}

export function createScenario() {
  const unitInstances = [
    { id: "atlas", loadoutId: "atlas", name: "Крейсер «Атлас»", sideId: "azure", color: "#66e4ff", col: -5, row: -2, heading: 0, initialEnergy: 4 },
    { id: "swift", loadoutId: "swift", name: "Фрегат «Стриж»", sideId: "azure", color: "#66e4ff", col: -5, row: 2, heading: 0, initialEnergy: 4 },
    { id: "wasps", loadoutId: "wasps", name: "Эскадрилья «Осы»", callsign: "Осы", sideId: "azure", color: "#66e4ff", col: -5, row: 0 },
    { id: "bastion", loadoutId: "bastion", name: "Линкор «Бастион»", sideId: "crimson", color: "#ff667d", col: 5, row: -2, heading: 3, initialEnergy: 6 },
    { id: "raptor", loadoutId: "raptor", name: "Эсминец «Раптор»", sideId: "crimson", color: "#ff667d", col: 5, row: 2, heading: 3, initialEnergy: 4 },
    { id: "mantis", loadoutId: "mantis", name: "Эскадрилья «Мантисы»", callsign: "Мантисы", sideId: "crimson", color: "#ff7d9f", col: 5, row: 0 }
  ];
  const units = unitInstances.map(instance => {
    const { col, row, initialEnergy, ...data } = instance;
    const profile = initialEnergy === undefined ? buildSquadronProfile(instance.loadoutId) : buildCapitalProfile(instance.loadoutId);
    const reactor = profile.reactor ? { ...profile.reactor, currentEnergy: initialEnergy } : undefined;
    return placed(col, row, { ...profile, ...data, ...(reactor ? { reactor } : {}) });
  });
  const contents = [
    placed(-2, -1, { id: "asteroids-a", kind: "terrain", type: "asteroidField", label: "Астероидное поле", hazard: { probability: 0.35, min: 4, max: 10, effect: "урон целостности" } }),
    placed(-1, 0, { id: "debris-a", kind: "terrain", type: "debrisField", label: "Поле обломков", hazard: { probability: 0.25, min: 2, max: 7, effect: "урон целостности" } }),
    placed(1, -1, { id: "asteroids-b", kind: "terrain", type: "asteroidField", label: "Астероидное поле", hazard: { probability: 0.35, min: 4, max: 10, effect: "урон целостности" } }),
    placed(-2, 3, { id: "nebula-a", kind: "terrain", type: "nebula", label: "Туманность" }),
    placed(1, 3, { id: "mines-a", kind: "hazard", type: "minefield", label: "Минное поле", hazard: { probability: 0.55, min: 8, max: 16, effect: "урон целостности" } }),
    placed(2, -3, { id: "rock-a", kind: "object", type: "largeAsteroid", label: "Крупный астероид" }),
    placed(0, 1, { id: "station-a", kind: "object", type: "station", label: "Станция" })
  ];
  return { id: "movement-playtest-1", bounds: { minCol: -6, maxCol: 6, minRow: -5, maxRow: 5 }, units, contents };
}

export function initializeWeaponState(weapon, fallbackSlotOrder = 0) {
  const runtimeWeapon = { ...weapon, weaponId: weapon.weaponId ?? weapon.catalogWeaponId };
  delete runtimeWeapon.ready;
  delete runtimeWeapon.catalogWeaponId;
  return {
    ...runtimeWeapon,
    slotOrder: Number.isInteger(weapon.slotOrder) ? weapon.slotOrder : fallbackSlotOrder,
    firedThisRound: false,
    cooldownRemaining: 0,
    overwatch: false
  };
}

export function beginWeaponCooldown(weapon) {
  weapon.firedThisRound = true;
  weapon.cooldownRemaining = weapon.cooldownRounds || 0;
  weapon.overwatch = false;
}

export function advanceWeaponRound(weapon) {
  if (weapon.firedThisRound) weapon.firedThisRound = false;
  else if (weapon.cooldownRemaining > 0) weapon.cooldownRemaining--;
  weapon.overwatch = false;
  return weapon;
}

export function resetUnitWeaponsForNewRound(unit) {
  for (const weapon of unit.weapons) advanceWeaponRound(weapon);
}

export function createBattleState() {
  const scenario = createScenario();
  const randomKeys = Object.fromEntries(scenario.units.map((unit, index) => [unit.id, ((index * 37 + 17) % 97) / 97]));
  const initiativeOrder = [...scenario.units].sort((a, b) => b.initiative - a.initiative || b.currentSpeed - a.currentSpeed || randomKeys[a.id] - randomKeys[b.id]).map(unit => unit.id);
  const units = scenario.units.map(unit => ({ ...unit, position: { ...unit.position }, reactor: unit.reactor ? { ...unit.reactor } : null, weapons: unit.weapons.map(initializeWeaponState), criticals: [], hasActivated: false, hasWaited: false, canWait: true, activationStartedThisRound: false, salvoCommitted: false, movementEvasion: 0, evasiveManeuver: false, evasionLocked: false, speedSpent: 0, speedRemaining: unit.currentSpeed, maneuverSpent: 0, maneuverRemaining: unit.maneuver ?? 0, unitHealth: unit.kind === "squadron" ? unit.unitHealth : null, maxUnits: unit.kind === "squadron" ? unit.stack : null, deployed: true }));
  return { scenario, units, roundNumber: 1, phase: "activation", lifecycle: "DeploymentLeft", stage: "system", initiativeOrder: [], activeUnitId: units[0]?.id || null, winner: null, log: [], events: [], sequence: 0, rng: Math.random, deployment: { left: false, right: false } };
}

function deploymentSide(state) {
  return state.lifecycle === "DeploymentLeft" ? "azure" : state.lifecycle === "DeploymentRight" ? "crimson" : null;
}

export function deploymentZone(state, sideId) {
  const { minCol, maxCol, minRow, maxRow } = state.scenario.bounds;
  const edge = sideId === "azure" ? minCol : maxCol;
  const columns = sideId === "azure" ? [edge, edge + 1] : [edge, edge - 1];
  const cells = [];
  for (let row = minRow; row <= maxRow; row++) for (const col of columns) {
    const position = offsetToAxial(col, row);
    if (!contentsAt(state, position).length) cells.push(position);
  }
  return cells;
}

export function deployUnit(state, unitId, position, heading = null) {
  const sideId = deploymentSide(state);
  const unit = unitById(state, unitId);
  if (!sideId || !unit || unit.sideId !== sideId || state.deployment[sideId === "azure" ? "left" : "right"]) return false;
  if (!deploymentZone(state, sideId).some(cell => key(cell.q, cell.r) === key(position.q, position.r))) return false;
  const occupant = unitAt(state, position, unit.id);
  if (occupant) return false;
  if (heading !== null && unit.kind === "capital") unit.heading = heading;
  unit.position = { ...position };
  recordEvent(state, "deployment-place", { actorId: unit.id, subjectIds: [unit.id], after: { position: unit.position, heading: unit.heading ?? null } });
  return true;
}

export function confirmDeployment(state, sideId) {
  const expected = deploymentSide(state);
  const flag = sideId === "azure" ? "left" : sideId === "crimson" ? "right" : null;
  if (!expected || expected !== sideId || !flag || state.deployment[flag]) return false;
  const fleet = state.units.filter(unit => unit.sideId === sideId);
  if (fleet.some(unit => !deploymentZone(state, sideId).some(cell => key(cell.q, cell.r) === key(unit.position.q, unit.position.r)))) return false;
  state.deployment[flag] = true;
  recordEvent(state, "deployment-confirm", { actorId: sideId, subjectIds: fleet.map(unit => unit.id) });
  if (sideId === "azure") state.lifecycle = "DeploymentRight";
  else {
    const randomKeys = Object.fromEntries(state.units.map((unit, index) => [unit.id, ((index * 37 + 17) % 97) / 97]));
    state.initiativeOrder = [...state.units].sort((a, b) => b.initiative - a.initiative || b.currentSpeed - a.currentSpeed || randomKeys[a.id] - randomKeys[b.id]).map(unit => unit.id);
    state.activeUnitId = state.initiativeOrder[0] || null;
    state.lifecycle = "WaitDecision";
    state.stage = "system";
  }
  return true;
}

export function recordEvent(state, action, data = {}) {
  const event = Object.freeze({ eventId: `${state.scenario.id}-${++state.sequence}`, battleId: state.scenario.id, round: state.roundNumber, phase: state.lifecycle || state.stage, action, ...data });
  state.events.push(event);
  return event;
}

export function applyDamage(state, unit, amount, cause = "damage", startLayer = "shield", context = {}) {
  if (!unit || !state.units.includes(unit) || amount <= 0) return { amount: 0, destroyed: false };
  const before = { shield: unit.shield, armor: unit.armor, integrity: unit.integrity };
  let remaining = amount;
  const layers = [startLayer];
  for (const layer of layers) {
    const absorbed = Math.min(unit[layer] || 0, remaining);
    unit[layer] = Math.max(0, (unit[layer] || 0) - absorbed);
    remaining -= absorbed;
    if (!remaining) break;
  }
  if (unit.kind === "squadron" && unit.unitHealth) unit.stack = unit.integrity ? Math.ceil(unit.integrity / unit.unitHealth) : 0;
  const event = recordEvent(state, "damage", { actorId: null, subjectIds: [unit.id], cause, before, after: { shield: unit.shield, armor: unit.armor, integrity: unit.integrity }, ...context });
  return { amount: amount - remaining, destroyed: unit.integrity === 0, event };
}

function startNewRound(state) {
  state.roundNumber++;
  for (const candidate of state.units) {
    candidate.hasActivated = false;
    candidate.hasWaited = false;
    candidate.canWait = true;
    candidate.activationStartedThisRound = false;
    resetUnitWeaponsForNewRound(candidate);
  }
  state.initiativeOrder = [...state.units].sort((a, b) => b.initiative - a.initiative || b.currentSpeed - a.currentSpeed || a.id.localeCompare(b.id)).map(candidate => candidate.id);
  state.activeUnitId = state.initiativeOrder[0] || null;
  if (state.activeUnitId) beginActivation(state);
}

export function destroyUnit(state, unit, context = {}) {
  if (!state.units.includes(unit)) return null;
  const wasActive = state.activeUnitId === unit.id;
  const debris = { id: `debris-${unit.id}-${state.roundNumber}`, kind: "terrain", type: "debrisField", label: `Обломки ${unit.name}`, position: { ...unit.position }, hazard: { probability: 0.25, min: 2, max: 7, effect: "урон целостности" } };
  state.units = state.units.filter(candidate => candidate.id !== unit.id);
  state.initiativeOrder = state.initiativeOrder.filter(id => id !== unit.id);
  for (const candidate of state.units) candidate.engagedWith = candidate.engagedWith?.filter(id => id !== unit.id) || candidate.engagedWith;
  state.scenario.contents.push(debris);
  const sides = [...new Set(state.units.map(candidate => candidate.sideId))];
  if (sides.length === 1) {
    state.winner = sides[0];
    state.lifecycle = "Finished";
    state.activeUnitId = null;
  } else if (wasActive) {
    const nextId = state.initiativeOrder.find(id => !unitById(state, id).hasActivated) || null;
    if (nextId) {
      state.activeUnitId = nextId;
      beginActivation(state);
    } else startNewRound(state);
  }
  const destructionEvent = recordEvent(state, "destroy", { subjectIds: [unit.id], after: { winner: state.winner, debrisId: debris.id, activeUnitId: state.activeUnitId }, ...context });
  if (context.planId) recordEvent(state, "debris-create", { actorId: null, subjectIds: [debris.id], position: { ...debris.position }, planId: context.planId, elementIndex: context.elementIndex, causeEventId: destructionEvent.eventId });
  return { destroyed: true, unitId: unit.id, debris, winner: state.winner };
}

export function resolveRouteEffects(state, unit, contents, context = null) {
  const outcomes = [];
  for (const content of [...contents].sort(compareIds)) {
    const outcome = executableRouteEffect(content);
    if (!outcome) continue;
    unit[outcome.execute.path] = outcome.execute.value;
    outcomes.push(outcome);
    if (context) recordEvent(state, "route-effect", { actorId: null, subjectIds: [unit.id], sourceId: outcome.sourceId, effect: outcome.effect, execute: outcome.execute, ...context });
  }
  return outcomes;
}

export function resolveHazardConsequences(state, unit, consequences, random = state.rng, context = null) {
  const outcomes = [];
  for (const consequence of consequences) {
    const probabilityRoll = random();
    const hit = probabilityRoll <= consequence.probability;
    const damageRoll = hit ? random() : null;
    const damage = hit ? Math.floor(damageRoll * (consequence.max - consequence.min + 1)) + consequence.min : 0;
    const checkEvent = context ? recordEvent(state, "hazard-check", {
      actorId: null,
      subjectIds: [unit.id],
      position: { ...unit.position },
      sourceId: consequence.sourceId,
      random: { probability: probabilityRoll, damage: damageRoll },
      after: { hit, damage },
      ...context
    }) : null;
    if (!hit) {
      outcomes.push({ consequence, hit: false, damage: 0, destroyed: false, winner: null });
      continue;
    }
    const damageResult = applyDamage(state, unit, damage, `hazard:${consequence.sourceId}`, "integrity", context ? { planId: context.planId, elementIndex: context.elementIndex, causeEventId: checkEvent.eventId } : {});
    const destruction = unit.integrity === 0 ? destroyUnit(state, unit, context ? { planId: context.planId, elementIndex: context.elementIndex, causeEventId: damageResult.event.eventId } : {}) : null;
    const outcome = { consequence, hit: true, damage, destroyed: Boolean(destruction), winner: destruction?.winner || null };
    if (context) outcome.destruction = destruction;
    outcomes.push(outcome);
    if (destruction) break;
  }
  return outcomes;
}

export function unitById(state, id) {
  return state.units.find(unit => unit.id === id);
}

export function activeUnit(state) {
  return unitById(state, state.activeUnitId);
}

export function unitAt(state, position, excludeId = null) {
  return state.units.find(unit => unit.id !== excludeId && unit.position.q === position.q && unit.position.r === position.r);
}

export function contentsAt(state, position) {
  return state.scenario.contents.filter(content => content.position.q === position.q && content.position.r === position.r);
}

export function inside(state, position) {
  const { col, row } = axialToOffset(position.q, position.r);
  const bounds = state.scenario.bounds;
  return col >= bounds.minCol && col <= bounds.maxCol && row >= bounds.minRow && row <= bounds.maxRow;
}

function consequenceFor(content, unit, visibilityFiltered = true) {
  if (visibilityFiltered && !isKnownTo(content, unit.sideId)) return null;
  if (!content.hazard || (unit.kind === "squadron" && ["asteroidField", "debrisField"].includes(content.type))) return null;
  return { sourceId: content.id, sourceName: content.label, probability: content.hazard.probability, min: content.hazard.min, max: content.hazard.max, effect: content.hazard.effect };
}

function executableRouteEffect(content) {
  const effect = content.routeEffect || content.previewEffect;
  if (!effect?.guaranteed || !effect.execute) return null;
  const execute = effect.execute;
  if (execute.type !== "set" || !["speedRemaining", "maneuverRemaining", "movementEvasion", "evasionLocked"].includes(execute.path)) return null;
  if (!["number", "boolean"].includes(typeof execute.value)) return null;
  return { sourceId: content.id, sourceName: content.label, effect: effect.effect || effect.label || content.label, execute: { type: "set", path: execute.path, value: execute.value } };
}

function compareIds(left, right) {
  return left.id.localeCompare(right.id);
}

function adjacentEnemySquadronIds(state, unit, position = unit.position) {
  if (unit.kind !== "squadron") return [];
  return [...new Set(state.units
    .filter(other => other.id !== unit.id && other.kind === "squadron" && other.sideId !== unit.sideId && hexDistance(position, other.position) === 1)
    .map(other => other.id))]
    .sort((left, right) => left.localeCompare(right));
}

export function resolvePostEntryInterceptions(state, unit, context = {}) {
  const linkedIds = adjacentEnemySquadronIds(state, unit);
  if (!linkedIds.length) return [];
  unit.engagedWith = [...new Set([...(unit.engagedWith || []), ...linkedIds])].sort((left, right) => left.localeCompare(right));
  for (const linkedId of linkedIds) {
    const linked = unitById(state, linkedId);
    linked.engagedWith = [...new Set([...(linked.engagedWith || []), unit.id])].sort((left, right) => left.localeCompare(right));
  }
  if (context.planId) recordEvent(state, "interception-create", { actorId: unit.id, subjectIds: [unit.id, ...linkedIds], linkedIds, ...context });
  return linkedIds;
}

function traversal(state, unit, position, visibilityFiltered = true) {
  const occupant = unitAt(state, position, unit.id);
  const contents = contentsAt(state, position);
  const object = contents.find(content => content.kind === "object");
  const cost = unit.kind === "squadron" && contents.some(content => ["asteroidField", "debrisField"].includes(content.type)) ? 2 : 1;
  const consequences = [...contents].sort(compareIds).map(content => consequenceFor(content, unit, visibilityFiltered)).filter(Boolean);
  if (object) return { canEnter: false, canStop: false, object, cost, consequences, contents };
  if (occupant && unit.kind === "capital") return { canEnter: false, canStop: false, occupant, cost, consequences, contents };
  if (occupant?.kind === "squadron" && unit.kind === "squadron") return { canEnter: false, canStop: false, interceptedBy: occupant, cost, consequences, contents };
  return { canEnter: true, canStop: !occupant, occupant, cost, consequences, contents };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function samePosition(left, right) {
  return Boolean(left && right && left.q === right.q && left.r === right.r);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function turnElements(position, from, to, role) {
  const delta = signedTurn(from, to);
  const direction = Math.sign(delta);
  const elements = [];
  let heading = from;
  for (let index = 0; index < Math.abs(delta); index++) {
    const nextHeading = (heading + direction + 6) % 6;
    elements.push({ type: "turn", role, position: { ...position }, headingBefore: heading, heading: nextHeading, cost: 1 });
    heading = nextHeading;
  }
  return elements;
}

function expectedResourceSpent(option, name) {
  const resource = option?.resources?.[name];
  return typeof resource === "number" ? resource : resource?.spent;
}

export function planManeuver(state, option) {
  const unit = activeUnit(state);
  const route = option?.route;
  if (!unit || state.lifecycle === "Finished" || state.stage === "attack" || !route || !option.finalState?.hex) return null;
  if (!samePosition(route.path?.[0], unit.position) || !samePosition(option.finalState.hex, route.position)) return null;
  if (unit.kind === "capital" && route.path[0].heading !== unit.heading) return null;
  const start = { position: { ...unit.position } };
  if (unit.kind === "capital") start.heading = unit.heading;
  const elements = [];
  const consequences = [];
  let position = { ...unit.position };
  let heading = unit.heading;
  let speedCost = 0;
  let maneuverCost = 0;
  for (let index = 0; index < route.steps.length; index++) {
    const step = route.steps[index];
    if (!samePosition(step.from, position) || hexDistance(position, step.to) !== 1) return null;
    if (unit.kind === "capital") {
      if (step.headingBeforeMove !== heading || step.turn !== signedTurn(heading, step.heading) || Math.abs(step.turn) > 1) return null;
      const [dq, dr] = DIRECTIONS[step.heading];
      if (step.to.q !== position.q + dq || step.to.r !== position.r + dr) return null;
      const turns = turnElements(position, heading, step.heading, "before-move");
      elements.push(...turns);
      maneuverCost += turns.length;
      heading = step.heading;
    } else {
      const direction = DIRECTIONS.findIndex(([dq, dr]) => step.to.q === position.q + dq && step.to.r === position.r + dr);
      if (direction < 0 || step.heading !== direction) return null;
    }
    const rule = traversal(state, unit, step.to);
    const finalMove = index === route.steps.length - 1;
    if (!rule.canEnter || (finalMove && !rule.canStop)) return null;
    speedCost += rule.cost;
    const knownConsequences = rule.consequences.map(consequence => ({ ...consequence }));
    consequences.push(...knownConsequences);
    elements.push({ type: "move", from: { ...position }, to: { ...step.to }, ...(unit.kind === "capital" ? { heading } : { travelHeading: step.heading }), cost: rule.cost, consequences: knownConsequences, final: finalMove });
    position = { ...step.to };
  }
  if (!samePosition(position, route.position) || route.movementCost !== speedCost || (route.turnsSpent || 0) !== maneuverCost || !sameValue(route.consequences || [], consequences)) return null;
  if (unit.kind === "capital") {
    if (route.steps.length && route.heading !== heading) return null;
    const finalHeading = option.finalState.heading;
    if (!Number.isInteger(finalHeading) || finalHeading < 0 || finalHeading > 5) return null;
    const finalTurnDistance = Math.abs(signedTurn(heading, finalHeading));
    if (route.steps.length && finalTurnDistance > 1) return null;
    const finalTurns = turnElements(position, heading, finalHeading, route.steps.length ? "final" : "stationary");
    elements.push(...finalTurns);
    maneuverCost += finalTurns.length;
    heading = finalHeading;
  } else if (option.finalState.heading !== undefined || route.heading !== undefined) return null;
  if (!elements.length) return null;
  const plannedSpeedSpent = unit.speedSpent + speedCost;
  const plannedManeuverSpent = unit.maneuverSpent + maneuverCost;
  if (expectedResourceSpent(option, "speed") !== plannedSpeedSpent || expectedResourceSpent(option, "maneuver") !== plannedManeuverSpent && Number.isFinite(unit.maneuver)) return null;
  if (speedCost > unit.speedRemaining || maneuverCost > unit.maneuverRemaining) return null;
  const finalState = { position: { ...position } };
  if (unit.kind === "capital") finalState.heading = heading;
  const plan = {
    id: `${state.scenario.id}:${state.roundNumber || 0}:${unit.id}:maneuver:${state.sequence || 0}:${option.optionId || "option"}`,
    actorId: unit.id,
    start,
    elements,
    costs: { speed: speedCost, maneuver: maneuverCost },
    consequences,
    finalState
  };
  return deepFreeze(plan);
}

function finishManeuver(state, unit, progress) {
  unit.canWait = false;
  unit.movementEvasion = unit.evasionLocked ? 0 : movementEvasion(progress.executedMoves, unit.evasiveManeuver);
  if (!progress.executedMoves && progress.executedTurns) {
    unit.movementEvasion = 0;
    unit.evasionLocked = true;
  }
  state.stage = "attack";
  progress.finished = true;
}

function stopManeuver(state, unit, progress, reason, transition = null, hazardOutcomes = []) {
  finishManeuver(state, unit, progress);
  return { status: "stopped", reason, executedElements: progress.nextElement, transition, hazardOutcomes };
}

export function executeManeuverElement(state, plan, elementIndex, effects = {}) {
  const unit = activeUnit(state);
  if (!plan || !unit || unit.id !== plan.actorId || state.lifecycle === "Finished") return { status: "invalid" };
  let progress = state.maneuverApplication;
  if (!progress || progress.planId !== plan.id) {
    if (elementIndex !== 0 || !samePosition(unit.position, plan.start.position) || unit.kind === "capital" && unit.heading !== plan.start.heading) return { status: "invalid" };
    progress = { planId: plan.id, nextElement: 0, executedMoves: 0, executedTurns: 0, finished: false };
    state.maneuverApplication = progress;
  }
  if (progress.finished || progress.nextElement !== elementIndex) return { status: "invalid" };
  const element = plan.elements[elementIndex];
  if (!element) {
    finishManeuver(state, unit, progress);
    return { status: "completed", executedElements: progress.nextElement, transition: null, hazardOutcomes: [] };
  }
  const before = { position: { ...unit.position }, ...(unit.kind === "capital" ? { heading: unit.heading } : {}) };
  let actualSpeedCost = 0;
  let actualConsequences = [];
  let hazardOutcomes = [];
  let effectOutcomes = [];
  let interceptionIds = [];
  if (element.type === "turn") {
    if (unit.kind !== "capital" || !samePosition(unit.position, element.position) || unit.heading !== element.headingBefore) return stopManeuver(state, unit, progress, "state-changed");
    if (unit.maneuverRemaining < element.cost) return stopManeuver(state, unit, progress, "insufficient-maneuver");
    unit.maneuverSpent += element.cost;
    unit.maneuverRemaining -= element.cost;
    unit.heading = element.heading;
    progress.executedTurns++;
  } else if (element.type === "move") {
    if (!samePosition(unit.position, element.from) || hexDistance(unit.position, element.to) !== 1) return stopManeuver(state, unit, progress, "state-changed");
    if (unit.kind === "capital" && unit.heading !== element.heading) return stopManeuver(state, unit, progress, "heading-changed");
    const preliminaryRule = traversal(state, unit, element.to);
    if (!preliminaryRule.canEnter || element.final && !preliminaryRule.canStop) return stopManeuver(state, unit, progress, "blocked");
    if (unit.speedRemaining < preliminaryRule.cost) return stopManeuver(state, unit, progress, "insufficient-speed");
    const exitEvent = recordEvent(state, "maneuver-exit", { actorId: unit.id, subjectIds: [unit.id], position: { ...unit.position }, planId: plan.id, elementIndex });
    effects.resolveExit?.({ state, unit, plan, element, elementIndex, causeEventId: exitEvent.eventId });
    if (!state.units.includes(unit)) return { status: "destroyed", reason: "exit-destruction", executedElements: progress.nextElement, transition: null, hazardOutcomes: [] };
    const rule = traversal(state, unit, element.to, false);
    if (!rule.canEnter || element.final && !rule.canStop) return stopManeuver(state, unit, progress, "blocked");
    if (unit.speedRemaining < rule.cost) return stopManeuver(state, unit, progress, "insufficient-speed");
    actualSpeedCost = rule.cost;
    actualConsequences = rule.consequences.map(consequence => ({ ...consequence }));
    unit.speedSpent += actualSpeedCost;
    unit.speedRemaining -= actualSpeedCost;
    unit.position = { ...element.to };
    progress.executedMoves++;
    unit.movementEvasion = unit.evasionLocked ? 0 : movementEvasion(progress.executedMoves, unit.evasiveManeuver);
    const afterEntry = { position: { ...unit.position }, ...(unit.kind === "capital" ? { heading: unit.heading } : {}) };
    const moveEvent = recordEvent(state, "maneuver-move", { actorId: unit.id, subjectIds: [unit.id], planId: plan.id, elementIndex, causeEventId: exitEvent.eventId, before, after: afterEntry });
    effects.resolveEntry?.({ state, unit, plan, element, elementIndex, causeEventId: moveEvent.eventId });
    if (!state.units.includes(unit)) return { status: "destroyed", reason: "entry-destruction", executedElements: progress.nextElement, transition: null, hazardOutcomes: [] };
    hazardOutcomes = resolveHazardConsequences(state, unit, actualConsequences, state.rng, { planId: plan.id, elementIndex, causeEventId: moveEvent.eventId });
    const lethalOutcome = hazardOutcomes.find(outcome => outcome.destroyed);
    if (lethalOutcome) {
      progress.nextElement++;
      progress.finished = true;
      unit.canWait = false;
      const transition = deepFreeze({ elementIndex, type: element.type, before, after: afterEntry, speedCost: actualSpeedCost, maneuverCost: 0, consequences: actualConsequences });
      return { status: "destroyed", reason: "hazard", executedElements: progress.nextElement, transition, hazardOutcomes, effectOutcomes, destruction: lethalOutcome.destruction };
    }
    effectOutcomes = resolveRouteEffects(state, unit, rule.contents, { planId: plan.id, elementIndex, causeEventId: moveEvent.eventId });
    const reactionOutcomes = effects.resolvePostEntry?.({ state, unit, plan, element, elementIndex, causeEventId: moveEvent.eventId }) || [];
    if (!state.units.includes(unit)) {
      progress.nextElement++;
      progress.finished = true;
      unit.canWait = false;
      const transition = deepFreeze({ elementIndex, type: element.type, before, after: afterEntry, speedCost: actualSpeedCost, maneuverCost: 0, consequences: actualConsequences });
      const destruction = reactionOutcomes.find(outcome => outcome.destruction)?.destruction || state.scenario.contents.find(content => content.id.startsWith(`debris-${unit.id}-`)) && { debris: state.scenario.contents.find(content => content.id.startsWith(`debris-${unit.id}-`)) };
      return { status: "destroyed", reason: "reaction", executedElements: progress.nextElement, transition, hazardOutcomes, effectOutcomes, reactionOutcomes, destruction };
    }
    interceptionIds = resolvePostEntryInterceptions(state, unit, { planId: plan.id, elementIndex, causeEventId: moveEvent.eventId });
  } else return stopManeuver(state, unit, progress, "unknown-element");
  unit.canWait = false;
  progress.nextElement++;
  const after = { position: { ...unit.position }, ...(unit.kind === "capital" ? { heading: unit.heading } : {}) };
  const transition = deepFreeze({ elementIndex, type: element.type, before, after, speedCost: actualSpeedCost, maneuverCost: element.type === "turn" ? element.cost : 0, consequences: actualConsequences });
  if (element.type === "turn") recordEvent(state, "maneuver-turn", { actorId: unit.id, subjectIds: [unit.id], planId: plan.id, elementIndex, before, after });
  if (interceptionIds.length) return { ...stopManeuver(state, unit, progress, "interception", transition, hazardOutcomes), effectOutcomes };
  if (effects.canContinue && !effects.canContinue({ state, unit, plan, element, elementIndex })) return { ...stopManeuver(state, unit, progress, "continuation-forbidden", transition, hazardOutcomes), effectOutcomes };
  if (progress.nextElement === plan.elements.length) {
    finishManeuver(state, unit, progress);
    return { status: "completed", executedElements: progress.nextElement, transition, hazardOutcomes, effectOutcomes };
  }
  return { status: "executed", executedElements: progress.nextElement, transition, hazardOutcomes, effectOutcomes };
}

function routeCode(route) {
  return route.steps.map(step => `${step.to.q}:${step.to.r}:${step.heading ?? 0}`).join("|");
}

function expectedDamage(consequences) {
  return consequences.reduce((total, consequence) => total + (consequence.expectedHarm ?? consequence.probability * (consequence.min + consequence.max) / 2), 0);
}

function compareRoutes(a, b) {
  return a.movementCost - b.movementCost || a.turnsSpent - b.turnsSpent || expectedDamage(a.previewConsequences || a.consequences) - expectedDamage(b.previewConsequences || b.consequences) || routeCode(a).localeCompare(routeCode(b));
}

function isSafe(route) {
  return !(route.previewConsequences || []).some(consequence => consequence.negative);
}

function stepPreview(state, unit, position, contents, executedMoves) {
  const orderedContents = [...contents].sort(compareIds);
  const hazards = orderedContents.map(content => hazardPreviewDescriptor(content, unit)).filter(Boolean);
  const effects = orderedContents.map(content => guaranteedEffectPreviewDescriptor(content, unit)).filter(Boolean);
  const previewUnit = { ...unit, movementEvasion: unit.evasionLocked ? 0 : movementEvasion(executedMoves, unit.evasiveManeuver) };
  const reactions = aaPreviewDescriptors(state, previewUnit, position);
  const interceptions = interceptionPreviewDescriptors(state, unit, position);
  return { descriptors: [...hazards, ...effects, ...reactions, ...interceptions], interceptions };
}

function interceptionIds(preview) {
  return preview.interceptions.map(consequence => consequence.sourceId);
}

export function planRoutes(state, unit, policy) {
  if (unit.kind === "squadron" && unit.engagedWith?.length) return new Map();
  return unit.kind === "capital" ? planCapitalRoutes(state, unit, policy) : planSquadronRoutes(state, unit, policy);
}

function planCapitalRoutes(state, unit, policy) {
  const maneuverBudget = unit.maneuver - (unit.evasiveManeuver ? 1 : 0);
  const start = { position: unit.position, heading: unit.heading, movementCost: 0, turnsSpent: 0, steps: [], consequences: [], previewConsequences: [], path: [{ ...unit.position, heading: unit.heading }] };
  const queue = [start];
  const results = new Map([[key(unit.position.q, unit.position.r), start]]);
  const seen = new Map();
  while (queue.length) {
    const route = queue.shift();
    if (route.movementCost >= unit.currentSpeed) continue;
    for (const turn of [-1, 0, 1]) {
      const turnsSpent = route.turnsSpent + Math.abs(turn);
      if (turnsSpent > maneuverBudget) continue;
      const heading = (route.heading + turn + 6) % 6;
      const [dq, dr] = DIRECTIONS[heading];
      const to = { q: route.position.q + dq, r: route.position.r + dr };
      if (!inside(state, to)) continue;
      const rule = traversal(state, unit, to);
      if (!rule.canEnter) continue;
      const movementCost = route.movementCost + rule.cost;
      if (movementCost > unit.currentSpeed) continue;
      const consequences = [...route.consequences, ...rule.consequences];
      const preview = stepPreview(state, unit, to, rule.contents, route.steps.length + 1);
      const previewConsequences = [...route.previewConsequences, ...preview.descriptors];
      const next = { position: to, heading, movementCost, turnsSpent, steps: [...route.steps, { from: route.position, to, headingBeforeMove: route.heading, turn, heading }], consequences, previewConsequences, path: [...route.path, { ...to, heading }] };
      if (policy === "safe" && !isSafe(next)) continue;
      const stateKey = `${key(to.q, to.r)}:${heading}:${turnsSpent}:${next.movementCost}`;
      if (seen.has(stateKey) && compareRoutes(seen.get(stateKey), next) <= 0) continue;
      seen.set(stateKey, next);
      queue.push(next);
      if (!rule.canStop) continue;
      const destinationKey = key(to.q, to.r);
      const previous = results.get(destinationKey);
      if (!previous || compareRoutes(next, previous) < 0) results.set(destinationKey, next);
    }
  }
  return results;
}

function planSquadronRoutes(state, unit, policy) {
  const start = { position: unit.position, movementCost: 0, turnsSpent: 0, steps: [], consequences: [], previewConsequences: [], path: [{ ...unit.position }], interceptions: [], interception: null };
  const queue = [start];
  const results = new Map([[key(unit.position.q, unit.position.r), start]]);
  const seen = new Map();
  while (queue.length) {
    queue.sort(compareRoutes);
    const route = queue.shift();
    for (let heading = 0; heading < 6; heading++) {
      const [dq, dr] = DIRECTIONS[heading];
      const to = { q: route.position.q + dq, r: route.position.r + dr };
      if (!inside(state, to) || route.path.some(position => position.q === to.q && position.r === to.r)) continue;
      const rule = traversal(state, unit, to);
      if (!rule.canEnter) continue;
      const cost = route.movementCost + rule.cost;
      if (cost > unit.currentSpeed) continue;
      const consequences = [...route.consequences, ...(rule.consequences || [])];
      const preview = stepPreview(state, unit, to, rule.contents, route.steps.length + 1);
      const previewConsequences = [...route.previewConsequences, ...preview.descriptors];
      const interceptions = interceptionIds(preview);
      const next = { position: to, movementCost: cost, turnsSpent: 0, steps: [...route.steps, { from: route.position, to, heading }], consequences, previewConsequences, path: [...route.path, { ...to }], interceptions, interception: interceptions[0] ?? null };
      if (policy === "safe" && !isSafe(next)) continue;
      const destinationKey = key(to.q, to.r);
      if (rule.canStop) {
        const previous = results.get(destinationKey);
        if (!previous || compareRoutes(next, previous) < 0) results.set(destinationKey, next);
      }
      if (interceptions.length) continue;
      const stateKey = `${destinationKey}:${cost}`;
      const previousSeen = seen.get(stateKey);
      if (!previousSeen || compareRoutes(next, previousSeen) < 0) {
        seen.set(stateKey, next);
        queue.push(next);
      }
    }
  }
  return results;
}

export function availableFinalHeadings(unit, route) {
  const options = new Set([route.heading]);
  const maneuverBudget = unit.maneuver - (unit.evasiveManeuver ? 1 : 0);
  if (route.turnsSpent < maneuverBudget) {
    options.add((route.heading + 1) % 6);
    options.add((route.heading + 5) % 6);
  }
  return options;
}

export function availableStationaryHeadings(unit) {
  const options = new Set();
  const maneuverBudget = unit.maneuver - (unit.evasiveManeuver ? 1 : 0);
  for (let heading = 0; heading < 6; heading++) if (Math.abs(signedTurn(unit.heading, heading)) <= maneuverBudget) options.add(heading);
  return options;
}

export function beginActivation(state) {
  if (state.lifecycle === "DeploymentLeft" || state.lifecycle === "DeploymentRight") return;
  state.lifecycle = "ActivationStart";
  const unit = activeUnit(state);
  if (!unit) return;
  if (!unit.activationStartedThisRound) {
    unit.activationStartedThisRound = true;
    unit.canWait = true;
    unit.evasionLocked = false;
    unit.movementEvasion = 0;
    unit.evasiveManeuver = false;
    unit.salvoCommitted = false;
    unit.speedSpent = 0;
    unit.speedRemaining = unit.currentSpeed;
    unit.maneuverSpent = 0;
    unit.maneuverRemaining = unit.maneuver ?? 0;
    if (unit.reactor) unit.reactor.currentEnergy = Math.min(unit.reactor.capacity, unit.reactor.currentEnergy + unit.reactor.rechargeRate);
  }
  state.stage = "system";
  state.lifecycle = "SystemActions";
}

export function useEvasiveManeuver(state) {
  const unit = activeUnit(state);
  if (unit?.kind !== "capital" || state.stage === "attack" || unit.maneuver < 1) return false;
  unit.evasiveManeuver = !unit.evasiveManeuver;
  if (unit.evasiveManeuver) unit.canWait = false;
  unit.maneuverSpent = unit.evasiveManeuver ? 1 : 0;
  unit.maneuverRemaining = Math.max(0, unit.maneuver - unit.maneuverSpent);
  return true;
}

export function waitActiveUnit(state) {
  const unit = activeUnit(state);
  if (!unit || unit.hasWaited || unit.canWait === false || state.stage !== "system") return false;
  unit.hasWaited = true;
  unit.canWait = false;
  state.initiativeOrder = [...state.initiativeOrder.filter(id => id !== unit.id), unit.id];
  state.activeUnitId = state.initiativeOrder.find(id => !unitById(state, id).hasActivated) || unit.id;
  beginActivation(state);
  return true;
}

export function applyStationaryRotation(state, heading) {
  const unit = activeUnit(state);
  if (unit.kind !== "capital" || !availableStationaryHeadings(unit).has(heading)) return false;
  const turnsSpent = Math.abs(signedTurn(unit.heading, heading));
  const rotated = heading !== unit.heading;
  unit.heading = heading;
  unit.canWait = false;
  unit.speedSpent = 0;
  unit.speedRemaining = unit.currentSpeed;
  unit.maneuverSpent = turnsSpent + (unit.evasiveManeuver ? 1 : 0);
  unit.maneuverRemaining = Math.max(0, unit.maneuver - unit.maneuverSpent);
  unit.movementEvasion = 0;
  unit.evasionLocked = rotated;
  state.stage = "attack";
  return true;
}

export function skipMovement(state) {
  const unit = activeUnit(state);
  unit.canWait = false;
  unit.speedSpent = 0;
  unit.speedRemaining = unit.currentSpeed;
  unit.maneuverSpent = unit.kind === "capital" && unit.evasiveManeuver ? 1 : 0;
  unit.maneuverRemaining = Math.max(0, (unit.maneuver ?? 0) - unit.maneuverSpent);
  unit.movementEvasion = 0;
  state.stage = "attack";
}

export function endActivation(state) {
  const unit = activeUnit(state);
  unit.salvoCommitted = false;
  for (const weapon of unit.weapons) weapon.overwatch = !weapon.firedThisRound && weapon.cooldownRemaining <= 0 && weapon.targetKinds.includes("squadron");
  unit.hasActivated = true;
  const nextId = state.initiativeOrder.find(id => !unitById(state, id).hasActivated);
  if (nextId) {
    state.activeUnitId = nextId;
    beginActivation(state);
    return { newRound: false };
  }
  startNewRound(state);
  return { newRound: true };
}