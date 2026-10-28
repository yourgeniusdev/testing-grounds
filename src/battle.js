import { DIRECTIONS, activeUnit, applyDamage, destroyUnit, hexDistance, inside, key, unitById } from "./domain.js";

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

function rotatePosition(position, turns) {
  let { q, r } = position;
  for (let turn = 0; turn < turns; turn++) [q, r] = [q + r, -q];
  return { q, r };
}

export function isPositionInFiringArc(origin, heading, target, mount, orientation) {
  const relative = { q: target.q - origin.q, r: target.r - origin.r };
  if (relative.q === 0 && relative.r === 0) return false;
  if (mount === "turret" || mount === "squadronWeapon") return true;
  const local = rotatePosition(relative, (6 - heading) % 6);
  if (mount === "line") return local.q > 0 && local.r === 0;
  if (mount === "battery-left") return local.q >= 0 && local.r < 0 && local.q + local.r <= 0;
  if (mount === "battery-right") return local.q <= 0 && local.r > 0 && local.q + local.r >= 0;
  if (mount === "forward") {
    if (orientation === "aft") {
      const aft = rotatePosition(local, 3);
      return aft.q >= 0 && aft.q + aft.r >= 0;
    }
    return orientation === "fore" && local.q >= 0 && local.q + local.r >= 0;
  }
  return false;
}

function inArc(attacker, target, weapon) {
  return isPositionInFiringArc(attacker.position, attacker.heading || 0, target.position, weapon.mount, weapon.orientation);
}

function readyWeapons(attacker) {
  return attacker.weapons.filter(weapon => {
    if (weapon.role === "primary") return attacker.primaryReady;
    return attacker.auxiliaryReady && attacker.reactor?.currentEnergy >= weapon.energyCost;
  });
}

const COVER_MODIFIERS = { nebula: 15, debrisField: 10, asteroidField: 20 };
const BLOCKER_COVER = { small: 25, medium: 50, large: 100 };

function cube(position) { return { x: position.q, z: position.r, y: -position.q - position.r }; }
function axial(c) { return { q: c.x, r: c.z }; }
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
  const add = c => cells.set(key(c.x, c.z), { q: c.x, r: c.z });
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
function lineBlocker(state, attacker, target) {
  const cells = supercoverLine(attacker.position, target.position).slice(1, -1);
  const candidates = state.units.filter(unit => unit.id !== attacker.id && unit.id !== target.id && unit.kind !== "squadron" && cells.some(cell => cell.q === unit.position.q && cell.r === unit.position.r));
  return candidates.sort((a, b) => hexDistance(attacker.position, a.position) - hexDistance(attacker.position, b.position) || String(a.id).localeCompare(String(b.id)))[0] || null;
}

function validWeapon(attacker, target, weapon) {
  return hexDistance(attacker.position, target.position) <= weapon.maxRange && inArc(attacker, target, weapon);
}

export function targetEvasion(target) {
  return target.evasionLocked ? 0 : (target.baseEvasion || 0) + (target.movementEvasion || 0);
}

export function hitChance(weapon, target, cover = 0) {
  return Math.max(0, Math.min(100, weapon.accuracy - targetEvasion(target) - cover));
}

export function attackGeometry(state, targetId, weapon) {
  const attacker = activeUnit(state), target = unitById(state, targetId);
  const blocker = target ? lineBlocker(state, attacker, target) : null;
  const cover = blocker ? Math.min(100, BLOCKER_COVER[blockerSize(blocker)]) : 0;
  const endpoint = target ? endpointCover(state, target) : 0;
  return { line: target ? supercoverLine(attacker.position, target.position) : [], blocker, cover, endpointCover: endpoint };
}

export function activeLayer(target) {
  if ((target.shield || 0) > 0) return "shield";
  if ((target.armor || 0) > 0) return "armor";
  return "integrity";
}

function selectedReadyWeapons(attacker, selection) {
  const ready = readyWeapons(attacker).map(weapon => weapon.mount === "squadronWeapon" ? { ...weapon, shots: weapon.shots * attacker.stack } : weapon);
  if (selection instanceof Set) return ready.filter(weapon => selection.has(weapon.id));
  if (selection === "auxiliary") return ready.filter(weapon => weapon.role === "auxiliary").slice(0, 1);
  if (selection === "primary") return ready.filter(weapon => weapon.role === "primary");
  return ready;
}

export function attackPreview(state, targetId, selection) {
  const attacker = activeUnit(state);
  const target = unitById(state, targetId);
  const all = selectedReadyWeapons(attacker, selection);
  const included = target ? all.filter(weapon => validWeapon(attacker, target, weapon)) : [];
  const excluded = target ? all.filter(weapon => !included.includes(weapon)).map(weapon => ({ ...weapon, reason: hexDistance(attacker.position, target.position) > weapon.maxRange ? "Вне дальности" : "Вне сектора" })) : all.map(weapon => ({ ...weapon, reason: "Цель отсутствует" }));
  const geometry = target ? attackGeometry(state, targetId) : { blocker: null, cover: 0, endpointCover: 0 };
  const layer = target ? activeLayer(target) : null;
  const ordered = [...included].sort((a, b) => MULTIPLIERS[b.weaponClass][layer] - MULTIPLIERS[a.weaponClass][layer] || a.id.localeCompare(b.id));
  const shots = ordered.reduce((total, weapon) => total + weapon.shots, 0);
  const potentialDamage = layer ? ordered.reduce((total, weapon) => total + weapon.shots * Math.max(1, Math.floor(weapon.damage * MULTIPLIERS[weapon.weaponClass][layer])), 0) : 0;
  return { attacker, target, included, excluded, ordered, layer, shots, potentialDamage, blocker: geometry.blocker, cover: geometry.cover, endpointCover: geometry.endpointCover, hitChance: ordered[0] ? hitChance(ordered[0], target, geometry.cover + geometry.endpointCover) : null };
}

export function attackAnimationPlan(state, targetId, selection) {
  const preview = attackPreview(state, targetId, selection);
  return preview.ordered.map((weapon, index) => ({ weaponId: weapon.id, weaponClass: weapon.weaponClass, shots: weapon.shots, delay: index * 420, duration: weapon.weaponClass === "energy" ? 360 : 520 }));
}

export function attackArc(state, selection) {
  const attacker = activeUnit(state);
  const weapons = selectedReadyWeapons(attacker, selection);
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

export function availableAttackTargets(state, selection) {
  const attacker = activeUnit(state);
  return state.units.filter(target => target.sideId !== attacker.sideId && attackPreview(state, target.id, selection).included.length);
}

function log(state, message, tone = "neutral") {
  state.log.unshift({ id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, round: state.roundNumber, message, tone });
}

function destroyTarget(state, target) {
  const result = destroyUnit(state, target);
  if (!result) return;
  log(state, `${target.name} уничтожен. На позиции появляется поле обломков.`, "danger");
  if (result.winner) log(state, `Победа флотилии ${result.winner}.`, "system");
}

export function resolveAttack(state, targetId, selection, rollD100 = () => Math.floor(Math.random() * 100) + 1, random = Math.random) {
  if (state.stage !== "attack" || state.winner) return false;
  const preview = attackPreview(state, targetId, selection);
  const { attacker, target } = preview;
  if (!preview.included.length) return false;
  const auxiliaryCost = preview.included.filter(weapon => weapon.role === "auxiliary").reduce((total, weapon) => total + weapon.energyCost, 0);
  if (attacker.reactor && attacker.reactor.currentEnergy < auxiliaryCost) return false;
  if (attacker.reactor) attacker.reactor.currentEnergy -= auxiliaryCost;
  if (preview.included.some(weapon => weapon.role === "primary")) attacker.primaryReady = false;
  if (preview.included.some(weapon => weapon.role === "auxiliary")) attacker.auxiliaryReady = false;
  log(state, `${attacker.name} объявляет залп по цели ${target.name}.`, attacker.sideId);
  const unused = [...preview.included];
  while (unused.length && state.units.includes(target)) {
    const layer = activeLayer(target);
    unused.sort((a, b) => MULTIPLIERS[b.weaponClass][layer] - MULTIPLIERS[a.weaponClass][layer] || a.id.localeCompare(b.id));
    const weapon = unused.shift();
    log(state, `${weapon.name}: выбран против слоя «${layer}».`, attacker.sideId);
    for (let shot = 1; shot <= weapon.shots && state.units.includes(target); shot++) {
      const geometry = attackGeometry(state, targetId, weapon);
      const chance = hitChance(weapon, target, geometry.cover + geometry.endpointCover);
      const roll = rollD100();
      if (geometry.blocker && roll <= geometry.cover) {
        const blocker = unitById(state, geometry.blocker.id);
        if (blocker) {
          const layer = activeLayer(blocker);
          blocker[layer] = Math.max(0, blocker[layer] - Math.max(1, Math.floor(weapon.damage * MULTIPLIERS[weapon.weaponClass][layer])));
          if (blocker.integrity === 0) destroyTarget(state, blocker);
        }
        continue;
      }
      if (roll > geometry.cover + chance) { log(state, `${weapon.name}, выстрел ${shot}: ${roll}/${chance}, промах.`); continue; }
      const currentLayer = activeLayer(target);
      const multiplier = MULTIPLIERS[weapon.weaponClass][currentLayer];
      const damage = Math.max(1, Math.floor(weapon.damage * multiplier));
      const before = target[currentLayer];
      applyDamage(state, target, damage, `weapon:${weapon.id}`, currentLayer);
      log(state, `${weapon.name} [${weapon.weaponClass}], выстрел ${shot}: ${roll}/${chance}, попадание; ${weapon.damage} × ${multiplier} = ${damage} урона по ${currentLayer}.`, attacker.sideId);
      if (before > 0 && target[currentLayer] === 0 && currentLayer !== "integrity") log(state, `${target.name}: слой «${currentLayer}» разрушен.`, "danger");
      if (currentLayer === "integrity" && damage > 0) {
        const critRoll = rollD100();
        if (critRoll <= weapon.critChance) {
          const pool = CRITICALS[weapon.weaponClass];
          const type = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
          target.criticals.push({ id: globalThis.crypto?.randomUUID?.() || `critical-${Date.now()}-${shot}`, type, weaponClass: weapon.weaponClass, attackerId: attacker.id, weaponId: weapon.id, round: state.roundNumber });
          log(state, `Крит ${critRoll}/${weapon.critChance}: ${type}.`, "danger");
        } else log(state, `Проверка крита ${critRoll}/${weapon.critChance}: без крита.`);
      }
      if (target.integrity === 0) destroyTarget(state, target);
    }
  }
  return true;
}

export function skipAttack(state) {
  if (state.stage !== "attack") return false;
  log(state, `${activeUnit(state).name} пропускает атаку.`, "system");
  return true;
}
