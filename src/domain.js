import { buildCapitalProfile, buildSquadronProfile } from "./config/index.js";

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

export function createBattleState() {
  const scenario = createScenario();
  const randomKeys = Object.fromEntries(scenario.units.map((unit, index) => [unit.id, ((index * 37 + 17) % 97) / 97]));
  const initiativeOrder = [...scenario.units].sort((a, b) => b.initiative - a.initiative || b.currentSpeed - a.currentSpeed || randomKeys[a.id] - randomKeys[b.id]).map(unit => unit.id);
  const units = scenario.units.map(unit => ({ ...unit, position: { ...unit.position }, reactor: unit.reactor ? { ...unit.reactor } : null, weapons: unit.weapons.map(weapon => ({ ...weapon })), criticals: [], primaryReady: true, auxiliaryReady: true, hasActivated: false, hasWaited: false, movementEvasion: 0, evasiveManeuver: false, evasionLocked: false, unitHealth: unit.kind === "squadron" ? unit.unitHealth : null, maxUnits: unit.kind === "squadron" ? unit.stack : null, deployed: true }));
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

export function applyDamage(state, unit, amount, cause = "damage", startLayer = "shield") {
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
  recordEvent(state, "damage", { actorId: null, subjectIds: [unit.id], cause, before, after: { shield: unit.shield, armor: unit.armor, integrity: unit.integrity } });
  return { amount: amount - remaining, destroyed: unit.integrity === 0 };
}

export function destroyUnit(state, unit) {
  if (!state.units.includes(unit)) return null;
  const debris = { id: `debris-${unit.id}-${state.roundNumber}`, kind: "terrain", type: "debrisField", label: `Обломки ${unit.name}`, position: { ...unit.position }, hazard: { probability: 0.25, min: 2, max: 7, effect: "урон целостности" } };
  state.units = state.units.filter(candidate => candidate.id !== unit.id);
  state.initiativeOrder = state.initiativeOrder.filter(id => id !== unit.id);
  for (const candidate of state.units) candidate.engagedWith = candidate.engagedWith?.filter(id => id !== unit.id) || candidate.engagedWith;
  state.scenario.contents.push(debris);
  const sides = [...new Set(state.units.map(candidate => candidate.sideId))];
  if (sides.length === 1) { state.winner = sides[0]; state.lifecycle = "Finished"; }
  recordEvent(state, "destroy", { subjectIds: [unit.id], after: { winner: state.winner, debrisId: debris.id } });
  return { destroyed: true, unitId: unit.id, debris, winner: state.winner };
}

export function resolveHazardConsequences(state, unit, consequences, random = state.rng) {
  const outcomes = [];
  for (const consequence of consequences) {
    if (random() > consequence.probability) {
      outcomes.push({ consequence, hit: false, damage: 0, destroyed: false, winner: null });
      continue;
    }
    const damage = Math.floor(random() * (consequence.max - consequence.min + 1)) + consequence.min;
    applyDamage(state, unit, damage, `hazard:${consequence.sourceId}`, "integrity");
    const destruction = unit.integrity === 0 ? destroyUnit(state, unit) : null;
    outcomes.push({ consequence, hit: true, damage, destroyed: Boolean(destruction), winner: destruction?.winner || null });
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

function consequenceFor(content, unit) {
  if (!content.hazard || (unit.kind === "squadron" && ["asteroidField", "debrisField"].includes(content.type))) return null;
  return { sourceId: content.id, sourceName: content.label, probability: content.hazard.probability, min: content.hazard.min, max: content.hazard.max, effect: content.hazard.effect };
}

function traversal(state, unit, position) {
  const occupant = unitAt(state, position, unit.id);
  const contents = contentsAt(state, position);
  const object = contents.find(content => content.kind === "object");
  if (object) return { canEnter: false, canStop: false, object };
  if (occupant && unit.kind === "capital") return { canEnter: false, canStop: false, occupant };
  if (occupant?.kind === "capital" && unit.kind === "squadron") return { canEnter: true, canStop: false, occupant, cost: 1, consequences: [] };
  if (occupant?.kind === "squadron" && unit.kind === "squadron") return { canEnter: false, canStop: false, interceptedBy: occupant };
  const cost = unit.kind === "squadron" && contents.some(content => ["asteroidField", "debrisField"].includes(content.type)) ? 2 : 1;
  return { canEnter: true, canStop: !occupant, cost, consequences: contents.map(content => consequenceFor(content, unit)).filter(Boolean), contents };
}

function routeCode(route) {
  return route.steps.map(step => `${step.to.q}:${step.to.r}:${step.heading ?? 0}`).join("|");
}

function expectedDamage(consequences) {
  return consequences.reduce((total, consequence) => total + consequence.probability * (consequence.min + consequence.max) / 2, 0);
}

function compareRoutes(a, b) {
  return a.movementCost - b.movementCost || a.turnsSpent - b.turnsSpent || expectedDamage(a.consequences) - expectedDamage(b.consequences) || routeCode(a).localeCompare(routeCode(b));
}

function isSafe(route) {
  return route.consequences.length === 0;
}

export function planRoutes(state, unit, policy) {
  return unit.kind === "capital" ? planCapitalRoutes(state, unit, policy) : planSquadronRoutes(state, unit, policy);
}

function planCapitalRoutes(state, unit, policy) {
  const maneuverBudget = unit.maneuver - (unit.evasiveManeuver ? 1 : 0);
  const start = { position: unit.position, heading: unit.heading, movementCost: 0, turnsSpent: 0, steps: [], consequences: [], path: [{ ...unit.position, heading: unit.heading }] };
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
      const consequences = [...route.consequences, ...(rule.consequences || [])];
      const next = { position: to, heading, movementCost: route.movementCost + 1, turnsSpent, steps: [...route.steps, { from: route.position, to, headingBeforeMove: route.heading, turn, heading }], consequences, path: [...route.path, { ...to, heading }] };
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
  const start = { position: unit.position, movementCost: 0, turnsSpent: 0, steps: [], consequences: [], path: [{ ...unit.position }], interception: null };
  const queue = [start];
  const results = new Map([[key(unit.position.q, unit.position.r), start]]);
  const seen = new Map([[key(unit.position.q, unit.position.r), 0]]);
  while (queue.length) {
    queue.sort(compareRoutes);
    const route = queue.shift();
    for (let heading = 0; heading < 6; heading++) {
      const [dq, dr] = DIRECTIONS[heading];
      const to = { q: route.position.q + dq, r: route.position.r + dr };
      if (!inside(state, to)) continue;
      const rule = traversal(state, unit, to);
      if (!rule.canEnter) {
        if (rule.interceptedBy && route.steps.length) {
          const intercepted = { ...route, interception: rule.interceptedBy.id };
          const previous = results.get(key(route.position.q, route.position.r));
          if (!previous?.interception) results.set(key(route.position.q, route.position.r), intercepted);
        }
        continue;
      }
      const cost = route.movementCost + rule.cost;
      if (cost > unit.currentSpeed) continue;
      const consequences = [...route.consequences, ...(rule.consequences || [])];
      const next = { position: to, movementCost: cost, turnsSpent: 0, steps: [...route.steps, { from: route.position, to, heading }], consequences, path: [...route.path, { ...to }], interception: null };
      if (policy === "safe" && !isSafe(next)) continue;
      const destinationKey = key(to.q, to.r);
      if (rule.canStop) {
        const previous = results.get(destinationKey);
        if (!previous || compareRoutes(next, previous) < 0) results.set(destinationKey, next);
      }
      if ((seen.get(destinationKey) ?? Infinity) > cost) {
        seen.set(destinationKey, cost);
        queue.push(next);
      }
    }
  }
  for (const route of results.values()) {
    const adjacentEnemy = state.units.find(other => other.kind === "squadron" && other.sideId !== unit.sideId && hexDistance(route.position, other.position) === 1);
    if (adjacentEnemy) route.interception = adjacentEnemy.id;
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
  unit.evasionLocked = false;
  unit.movementEvasion = 0;
  unit.evasiveManeuver = false;
  if (unit.reactor) unit.reactor.currentEnergy = Math.min(unit.reactor.capacity, unit.reactor.currentEnergy + unit.reactor.rechargeRate);
  state.stage = "system";
  state.lifecycle = "SystemActions";
}

export function useEvasiveManeuver(state) {
  const unit = activeUnit(state);
  if (unit?.kind !== "capital" || state.stage === "attack" || unit.maneuver < 1) return false;
  unit.evasiveManeuver = !unit.evasiveManeuver;
  return true;
}

export function waitActiveUnit(state) {
  const unit = activeUnit(state);
  if (!unit || unit.hasWaited || state.stage !== "system") return false;
  unit.hasWaited = true;
  state.initiativeOrder = [...state.initiativeOrder.filter(id => id !== unit.id), unit.id];
  state.activeUnitId = state.initiativeOrder.find(id => !unitById(state, id).hasActivated) || unit.id;
  beginActivation(state);
  return true;
}

export function applyMovementStep(state, step) {
  const unit = activeUnit(state);
  if (!unit || state.lifecycle === "Finished" || !step?.to || !inside(state, step.to)) return { status: "blocked" };
  const rule = traversal(state, unit, step.to);
  if (!rule.canEnter || (rule.canStop === false && step.final)) return { status: "blocked", rule };
  unit.position = { ...step.to };
  if (unit.kind === "capital" && step.heading !== undefined) unit.heading = step.heading;
  recordEvent(state, "movement-step", { actorId: unit.id, subjectIds: [unit.id], after: { position: unit.position } });
  return { status: "moved", position: unit.position };
}

export function applyMovement(state, route, finalHeading) {
  const unit = activeUnit(state);
  if (!unit || state.lifecycle === "Finished") return false;
  unit.position = { ...route.position };
  if (unit.kind === "capital") unit.heading = finalHeading;
  unit.movementEvasion = unit.evasionLocked ? 0 : movementEvasion(route.steps.length, unit.evasiveManeuver);
  if (route.interception && unit.kind === "squadron") unit.engagedWith = [...new Set([...unit.engagedWith, route.interception])];
  state.stage = "attack";
}

export function applyStationaryRotation(state, heading) {
  const unit = activeUnit(state);
  if (unit.kind !== "capital" || !availableStationaryHeadings(unit).has(heading)) return false;
  const rotated = heading !== unit.heading;
  unit.heading = heading;
  unit.movementEvasion = 0;
  unit.evasionLocked = rotated;
  state.stage = "attack";
  return true;
}

export function skipMovement(state) {
  const unit = activeUnit(state);
  unit.movementEvasion = 0;
  state.stage = "attack";
}

export function endActivation(state) {
  const unit = activeUnit(state);
  unit.hasActivated = true;
  const nextId = state.initiativeOrder.find(id => !unitById(state, id).hasActivated);
  if (nextId) {
    state.activeUnitId = nextId;
    beginActivation(state);
    return { newRound: false };
  }
  state.roundNumber++;
  for (const candidate of state.units) {
    candidate.hasActivated = false;
    candidate.hasWaited = false;
    candidate.primaryReady = true;
    candidate.auxiliaryReady = true;
  }
  state.initiativeOrder = [...state.units].sort((a, b) => b.initiative - a.initiative || b.currentSpeed - a.currentSpeed || a.id.localeCompare(b.id)).map(candidate => candidate.id);
  state.activeUnitId = state.initiativeOrder[0];
  beginActivation(state);
  return { newRound: true };
}