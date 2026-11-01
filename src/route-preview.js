import { attackGeometry, effectiveWeapon, hitChance, isPositionInFiringArc, weaponHitDamage } from "./battle.js";
import { hexDistance, overwatchAvailability } from "./domain.js";

export function isKnownTo(entity, sideId) {
  if (!entity || entity.hidden === true || entity.known === false) return false;
  if (Array.isArray(entity.knownTo)) return entity.knownTo.includes(sideId);
  if (Array.isArray(entity.visibleTo)) return entity.visibleTo.includes(sideId);
  return true;
}

export function hazardPreviewDescriptor(content, unit) {
  if (!isKnownTo(content, unit.sideId) || !content.hazard || (unit.kind === "squadron" && ["asteroidField", "debrisField"].includes(content.type))) return null;
  const { probability, min, max, effect } = content.hazard;
  return {
    kind: "hazard",
    sourceId: content.id,
    sourceName: content.label,
    effect,
    probability,
    min,
    max,
    expectedHarm: probability * (min + max) / 2,
    negative: true,
    guaranteed: probability === 1
  };
}

export function guaranteedEffectPreviewDescriptor(content, unit) {
  if (!isKnownTo(content, unit.sideId)) return null;
  const effect = content.routeEffect || content.previewEffect;
  if (!effect?.guaranteed || !effect.execute) return null;
  return {
    kind: "effect",
    sourceId: content.id,
    sourceName: content.label,
    effect: effect.effect || effect.label || content.label,
    probability: 1,
    min: effect.min || 0,
    max: effect.max || effect.min || 0,
    expectedHarm: effect.expectedHarm ?? effect.harm ?? effect.max ?? effect.min ?? 0,
    negative: effect.negative !== false,
    guaranteed: true
  };
}

export function aaPreviewDescriptors(state, target, position) {
  if (target.kind !== "squadron") return [];
  const previewTarget = { ...target, position };
  const initiative = new Map((state.initiativeOrder || []).map((id, index) => [id, index]));
  const candidates = state.units
    .filter(owner => owner.id !== target.id && owner.sideId !== target.sideId && (owner.integrity ?? 1) > 0 && isKnownTo(owner, target.sideId))
    .sort((left, right) => (initiative.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (initiative.get(right.id) ?? Number.MAX_SAFE_INTEGER) || String(left.id).localeCompare(String(right.id)));
  const descriptors = [];
  for (const owner of candidates) {
    const weapons = [...(owner.weapons || [])].sort((left, right) => (left.slotOrder || 0) - (right.slotOrder || 0) || String(left.id).localeCompare(String(right.id)));
    for (const weapon of weapons) {
      if (!isKnownTo(weapon, target.sideId) || !overwatchAvailability(owner, weapon).available) continue;
      if (hexDistance(owner.position, position) > weapon.maxRange || !isPositionInFiringArc(owner.position, owner.heading || 0, position, weapon.firingArc ?? weapon.mount, weapon.orientation)) continue;
      const geometry = attackGeometry({ ...state, units: state.units.map(unit => unit.id === target.id ? previewTarget : unit) }, target.id, new Set(), owner);
      const effective = effectiveWeapon(owner, weapon);
      const probability = Math.max(0, hitChance(effective, previewTarget, geometry.endpointCover) - geometry.cover) / 100;
      const shots = effective.shots;
      const simulated = { ...previewTarget };
      let max = 0;
      for (let shot = 0; shot < shots && simulated.integrity > 0; shot++) {
        for (const { layer, damage } of weaponHitDamage(simulated, effective)) {
          max += damage;
          simulated[layer] -= damage;
        }
      }
      descriptors.push({
        kind: "aa",
        sourceId: owner.id,
        sourceName: owner.name,
        slotId: weapon.id,
        effect: "AA reaction",
        probability,
        min: 0,
        max,
        expectedHarm: Math.round(probability * max * 1000000) / 1000000,
        negative: true,
        guaranteed: probability === 1
      });
    }
  }
  return descriptors;
}

export function interceptionPreviewDescriptors(state, unit, position) {
  if (unit.kind !== "squadron") return [];
  return [...new Set(state.units
    .filter(other => other.id !== unit.id && other.kind === "squadron" && other.sideId !== unit.sideId && isKnownTo(other, unit.sideId) && hexDistance(position, other.position) === 1)
    .map(other => other.id))]
    .sort((left, right) => left.localeCompare(right))
    .map(sourceId => ({ kind: "interception", sourceId, sourceName: state.units.find(unit => unit.id === sourceId)?.name || sourceId, effect: "Interception", probability: 1, min: 0, max: 0, expectedHarm: 0, negative: true, guaranteed: true }));
}
