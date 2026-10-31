import { activeUnit, applyDamage, beginWeaponCooldown, destroyUnit, hexDistance, inside, key, recordEvent, unitById } from "./domain.js";

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

function assertSelection(selection) {
  if (!(selection instanceof Set)) throw new TypeError("Weapon selection must be a Set of installed slot IDs");
}

function effectiveWeapon(attacker, weapon) {
  return attacker.kind === "squadron" ? { ...weapon, shots: weapon.shots * attacker.stack } : { ...weapon };
}

function selectedWeapons(attacker, selection) {
  assertSelection(selection);
  return attacker.weapons.filter(weapon => selection.has(weapon.id)).map(weapon => effectiveWeapon(attacker, weapon));
}

function unavailableReason(attacker, target, weapon) {
  if (weapon.firedThisRound) return "Уже стреляло в этом раунде";
  if (weapon.cooldownRemaining > 0) return `Перезарядка: ${weapon.cooldownRemaining}`;
  if (weapon.energyCost > 0 && !attacker.reactor) return NO_REACTOR;
  if (!target) return "Цель отсутствует";
  if (target.sideId === attacker.sideId) return "Союзная цель";
  if (!weapon.targetKinds.includes(target.kind)) return INVALID_TARGET;
  if (hexDistance(attacker.position, target.position) > weapon.maxRange) return "Вне дальности";
  if (!inArc(attacker, target, weapon)) return "Вне сектора";
  return null;
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
  return target.evasionLocked ? 0 : (target.baseEvasion || 0) + (target.movementEvasion || 0);
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

function compareForLayer(layer) {
  return (a, b) => effectiveness(b, layer) - effectiveness(a, layer) || a.slotOrder - b.slotOrder;
}

export function attackPreview(state, targetId, selection, explicitAttacker = null, options = {}) {
  const attacker = explicitAttacker || activeUnit(state);
  const target = unitById(state, targetId);
  if (!attacker) throw new Error("No active unit");
  const selected = selectedWeapons(attacker, selection);
  const selectedIds = new Set(selected.map(weapon => weapon.id));
  const missingSlotIds = [...selection].filter(id => !selectedIds.has(id));
  const included = [];
  const excluded = [];
  for (const weapon of selected) {
    const reason = unavailableReason(attacker, target, weapon);
    if (reason) excluded.push({ ...weapon, reason });
    else included.push(weapon);
  }
  const geometry = target ? attackGeometry(state, targetId, new Set(), attacker) : { blocker: null, cover: 0, endpointCover: 0 };
  const layer = target ? activeLayer(target) : null;
  const ordered = layer ? [...included].sort(compareForLayer(layer)) : [];
  const shots = ordered.reduce((total, weapon) => total + weapon.shots, 0);
  const potentialDamage = layer ? ordered.reduce((total, weapon) => total + weapon.shots * weaponDamage(weapon, layer), 0) : 0;
  const energyRequired = selected.reduce((total, weapon) => total + weapon.energyCost, 0);
  const energyAvailable = attacker.reactor?.currentEnergy || 0;
  const enoughEnergy = energyRequired <= energyAvailable;
  const salvoAvailable = options.reaction || !attacker.salvoCommitted;
  const hitChances = Object.fromEntries(ordered.map(weapon => [weapon.id, hitChance(weapon, target, geometry.cover + geometry.endpointCover)]));
  const canConfirm = Boolean(target && selected.length && !missingSlotIds.length && included.length === selected.length && enoughEnergy && salvoAvailable);
  return { attacker, target, selected, missingSlotIds, included, excluded, ordered, layer, shots, potentialDamage, energyRequired, energyAvailable, enoughEnergy, salvoAvailable, canConfirm, blocker: geometry.blocker, cover: geometry.cover, endpointCover: geometry.endpointCover, hitChances };
}

export function attackArc(state, selection, explicitAttacker = null) {
  const attacker = explicitAttacker || activeUnit(state);
  const weapons = selectedWeapons(attacker, selection).filter(weapon => !unavailableReason(attacker, null, weapon) || unavailableReason(attacker, null, weapon) === "Цель отсутствует");
  const positions = new Set();
  const maxRange = Math.max(0, ...weapons.map(weapon => weapon.maxRange));
  for (let q = attacker.position.q - maxRange; q <= attacker.position.q + maxRange; q++) {
    for (let r = attacker.position.r - maxRange; r <= attacker.position.r + maxRange; r++) {
      const position = { q, r };
      if (!inside(state, position) || (q === attacker.position.q && r === attacker.position.r)) continue;
      if (weapons.some(weapon => hexDistance(attacker.position, position) <= weapon.maxRange && inArc(attacker, { position }, weapon))) positions.add(key(q, r));
    }
  }
  return positions;
}

export function availableAttackTargets(state, selection, explicitAttacker = null) {
  assertSelection(selection);
  const attacker = explicitAttacker || activeUnit(state);
  return state.units.filter(target => target.sideId !== attacker.sideId && attackPreview(state, target.id, selection, attacker).included.length > 0);
}

function cloneCombatant(unit) {
  return { id: unit.id, kind: unit.kind, shield: unit.shield || 0, armor: unit.armor || 0, integrity: unit.integrity || 0, stack: unit.stack, unitHealth: unit.unitHealth };
}

function snapshot(unit) {
  return Object.freeze({ shield: unit.shield, armor: unit.armor, integrity: unit.integrity, stack: unit.stack });
}

function simulatedDamage(unit, damage, layer) {
  unit[layer] = Math.max(0, unit[layer] - damage);
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

export function planAttack(state, targetId, selection, rollD100 = () => Math.floor(Math.random() * 100) + 1, random = Math.random, explicitAttacker = null, options = {}) {
  if ((!options.reaction && state.stage !== "attack") || explicitAttacker && !options.reaction || state.winner) return null;
  const preview = attackPreview(state, targetId, selection, explicitAttacker, options);
  if (!preview.canConfirm) return null;
  const { attacker, target } = preview;
  const simulatedTarget = cloneCombatant(target);
  const simulatedBlockers = new Map();
  const destroyedBlockerIds = new Set();
  const remaining = [...preview.included];
  const weapons = [];
  const steps = [];
  let elapsedMs = 0;
  while (remaining.length && simulatedTarget.integrity > 0) {
    const layer = activeLayer(simulatedTarget);
    remaining.sort(compareForLayer(layer));
    const weapon = remaining.shift();
    const weaponPlan = { slotId: weapon.id, weaponId: weapon.weaponId, slotOrder: weapon.slotOrder, energyCost: weapon.energyCost, cooldownRounds: weapon.cooldownRounds, firstStepIndex: steps.length, shotCount: 0 };
    weapons.push(weaponPlan);
    const weaponLaunchTime = elapsedMs;
    let weaponEndTime = weaponLaunchTime;
    for (let shot = 1; shot <= weapon.shots && simulatedTarget.integrity > 0; shot++) {
      const geometry = attackGeometry(state, targetId, destroyedBlockerIds, attacker);
      const chance = hitChance(weapon, target, geometry.cover + geometry.endpointCover);
      const roll = rollD100();
      const targetBefore = snapshot(simulatedTarget);
      let outcome = "miss";
      let hitUnitId = null;
      let hitLayer = null;
      let damage = 0;
      let multiplier = null;
      let critical = null;
      let criticalRoll = null;
      let destroyed = false;
      let layerDestroyed = false;
      let targetAfter = targetBefore;
      if (geometry.blocker && roll <= geometry.cover) {
        outcome = "blocked";
        hitUnitId = geometry.blocker.id;
        const simulatedBlocker = simulatedBlockers.get(hitUnitId) || cloneCombatant(geometry.blocker);
        simulatedBlockers.set(hitUnitId, simulatedBlocker);
        hitLayer = activeLayer(simulatedBlocker);
        multiplier = effectiveness(weapon, hitLayer);
        damage = weaponDamage(weapon, hitLayer);
        simulatedDamage(simulatedBlocker, damage, hitLayer);
        destroyed = simulatedBlocker.integrity === 0;
        if (destroyed) destroyedBlockerIds.add(hitUnitId);
      } else if (roll <= geometry.cover + chance) {
        outcome = "hit";
        hitUnitId = target.id;
        hitLayer = activeLayer(simulatedTarget);
        multiplier = effectiveness(weapon, hitLayer);
        damage = weaponDamage(weapon, hitLayer);
        const beforeLayer = simulatedTarget[hitLayer];
        simulatedDamage(simulatedTarget, damage, hitLayer);
        layerDestroyed = beforeLayer > 0 && simulatedTarget[hitLayer] === 0 && hitLayer !== "integrity";
        destroyed = simulatedTarget.integrity === 0;
        if (hitLayer === "integrity" && damage > 0) {
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
      const launchTime = weaponLaunchTime + (shot - 1) * (weapon.visual?.launchIntervalMs || 0);
      const arrivalTime = launchTime + duration;
      steps.push({ index: steps.length, slotId: weapon.id, weaponId: weapon.weaponId, weaponName: weapon.name, weaponClass: weapon.weaponClass, delivery: weapon.delivery, visual: weapon.visual, shot, roll, chance, cover: geometry.cover, endpointCover: geometry.endpointCover, outcome, hitUnitId, layer: hitLayer, multiplier, damage, criticalRoll, critical: critical ? { ...critical, round: state.roundNumber } : null, layerDestroyed, destroyed, targetBefore, targetAfter, endpoint, launchTime, arrivalTime, duration });
      weaponPlan.shotCount++;
      weaponEndTime = Math.max(weaponEndTime, arrivalTime);
    }
    elapsedMs = weaponEndTime;
  }
  const plan = deepFreeze({ id: `${state.scenario.id}:${state.roundNumber}:${attacker.id}:${target.id}:${state.sequence || 0}`, attackerId: attacker.id, targetId: target.id, round: state.roundNumber, selection: [...selection], energyRequired: weapons.reduce((total, item) => total + item.energyCost, 0), weapons, steps, duration: Math.max(0, ...steps.map(step => step.arrivalTime)), predictedDestruction: simulatedTarget.integrity === 0, targetAfter: snapshot(simulatedTarget), explicitAttacker: Boolean(explicitAttacker), reaction: Boolean(options.reaction), context: options.context || null });
  if (!options.reaction) attacker.salvoCommitted = true;
  return plan;
}

export function attackAnimationPlan(state, targetId, selection, rollD100, random) {
  return planAttack(state, targetId, selection, rollD100, random)?.steps || [];
}

function log(state, message, tone = "neutral") {
  state.log.unshift({ id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, round: state.roundNumber, message, tone });
}

function destroyTarget(state, target, context = {}) {
  const result = destroyUnit(state, target, context);
  if (!result) return;
  log(state, `${target.name} уничтожен. На позиции появляется поле обломков.`, "danger");
  if (result.winner) log(state, `Победа флотилии ${result.winner}.`, "system");
}

function progressFor(state, plan) {
  if (!state.attackApplication || state.attackApplication.planId !== plan.id) state.attackApplication = { planId: plan.id, nextStep: 0, startedSlots: [] };
  return state.attackApplication;
}

export function applyAttackStep(state, plan, stepIndex) {
  const step = plan?.steps?.[stepIndex];
  if (!plan || plan.round !== state.roundNumber || !plan.reaction && (plan.explicitAttacker || plan.attackerId !== activeUnit(state)?.id)) return { status: "invalid" };
  const progress = progressFor(state, plan);
  if (!step || progress.nextStep !== stepIndex) return { status: "invalid" };
  const attacker = unitById(state, plan.attackerId);
  const target = unitById(state, plan.targetId);
  if (!attacker || (!target && step.hitUnitId === plan.targetId)) return { status: "stopped" };
  if (!progress.startedSlots.includes(step.slotId) && !plan.reaction) {
    const weapon = attacker.weapons.find(item => item.id === step.slotId);
    if (!weapon || weapon.firedThisRound || weapon.cooldownRemaining > 0 || (weapon.energyCost > 0 && (!attacker.reactor || attacker.reactor.currentEnergy < weapon.energyCost))) return { status: "invalid" };
    if (weapon.energyCost > 0) attacker.reactor.currentEnergy -= weapon.energyCost;
    beginWeaponCooldown(weapon);
    progress.startedSlots.push(step.slotId);
    log(state, `${weapon.name}: открыт огонь.`, attacker.sideId);
  }
  const hitUnit = step.hitUnitId ? unitById(state, step.hitUnitId) : null;
  if (step.outcome === "miss") log(state, `${step.weaponName}, выстрел ${step.shot}: ${step.roll}/${step.chance}, промах.`);
  else if (hitUnit) {
    const context = plan.context ? { planId: plan.context.planId, elementIndex: plan.context.elementIndex, causeEventId: progress.declarationEventId || plan.context.declarationEventId || plan.context.causeEventId } : {};
    applyDamage(state, hitUnit, step.damage, `weapon:${step.slotId}`, step.layer, context);
    log(state, `${step.weaponName} [${step.weaponClass}], выстрел ${step.shot}: ${step.roll}/${step.chance}, попадание; ${step.damage} урона по ${step.layer}.`, attacker.sideId);
    if (step.critical) {
      hitUnit.criticals.push({ ...step.critical });
      log(state, `Крит ${step.criticalRoll}: ${step.critical.type}.`, "danger");
    }
    if (step.layerDestroyed) log(state, `${hitUnit.name}: слой «${step.layer}» разрушен.`, "danger");
    if (hitUnit.integrity === 0) destroyTarget(state, hitUnit, plan.context ? { planId: plan.context.planId, elementIndex: plan.context.elementIndex, causeEventId: state.events.at(-1)?.eventId } : {});
  }
  progress.nextStep++;
  return { status: "applied", step, destroyed: step.destroyed };
}

export function resolveAttack(state, targetId, selection, rollD100, random, explicitAttacker = null, options = {}) {
  const plan = planAttack(state, targetId, selection, rollD100, random, explicitAttacker, options);
  if (!plan) return false;
  const attacker = explicitAttacker || activeUnit(state);
  log(state, `${attacker.name} объявляет залп по цели ${unitById(state, targetId).name}.`, attacker.sideId);
  for (let index = 0; index < plan.steps.length; index++) {
    const result = applyAttackStep(state, plan, index);
    if (result.status !== "applied") break;
  }
  return true;
}

function reactionCandidates(state, target) {
  if (!state.units.includes(target) || target.kind !== "squadron") return [];
  const initiative = new Map(state.initiativeOrder.map((id, index) => [id, index]));
  return state.units
    .filter(owner => owner.id !== target.id && owner.sideId !== target.sideId && owner.integrity > 0)
    .sort((left, right) => (initiative.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (initiative.get(right.id) ?? Number.MAX_SAFE_INTEGER) || String(left.id).localeCompare(String(right.id)))
    .flatMap(owner => owner.weapons
      .filter(slot => slot.overwatch && slot.targetKinds.includes("squadron") && !slot.firedThisRound && slot.cooldownRemaining <= 0)
      .sort((left, right) => left.slotOrder - right.slotOrder || String(left.id).localeCompare(String(right.id)))
      .map(slot => ({ owner, slot })));
}

export function resolvePostEntryAA(state, target, context = {}, rollD100 = () => Math.floor(Math.random() * 100) + 1, random = Math.random) {
  if (state.stage === "attack") return [];
  const outcomes = [];
  for (const candidate of reactionCandidates(state, target)) {
    if (!state.units.includes(target)) break;
    const { owner, slot } = candidate;
    const selection = new Set([slot.id]);
    const preview = attackPreview(state, target.id, selection, owner, { reaction: true });
    if (!preview.canConfirm || preview.included.length !== 1) continue;
    const plan = planAttack(state, target.id, selection, rollD100, random, owner, { reaction: true, context });
    if (!plan) continue;
    const declaration = recordEvent(state, "aa-reaction-declare", {
      actorId: owner.id,
      subjectIds: [target.id],
      slotId: slot.id,
      planId: context.planId,
      elementIndex: context.elementIndex,
      causeEventId: context.causeEventId
    });
    if (slot.energyCost > 0) owner.reactor.currentEnergy -= slot.energyCost;
    beginWeaponCooldown(slot);
    const progress = progressFor(state, plan);
    progress.declarationEventId = declaration.eventId;
    progress.startedSlots.push(slot.id);
    for (let index = 0; index < plan.steps.length; index++) {
      const result = applyAttackStep(state, plan, index);
      if (result.status !== "applied") break;
    }
    outcomes.push({ ownerId: owner.id, slotId: slot.id, steps: plan.steps });
  }
  return outcomes;
}

export function skipAttack(state) {
  if (state.stage !== "attack") return false;
  log(state, `${activeUnit(state).name} пропускает атаку.`, "system");
  return true;
}
