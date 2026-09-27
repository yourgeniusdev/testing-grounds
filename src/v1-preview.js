import { previewAttack } from "./v1-domain.js";

export function getAttackPreview(state, attackerId, targetId, weaponIndex = 0) {
  const attacker = state.units.find(unit => unit.id === attackerId);
  const target = state.units.find(unit => unit.id === targetId);
  const weapon = attacker?.weapons?.[weaponIndex];
  if (!attacker || !target || !weapon) return null;
  return { ...previewAttack(state, attacker, target, weapon), weaponId: weapon.id ?? `weapon-${weaponIndex}`, weaponIndex };
}

export function formatAttackPreview(preview) {
  if (!preview) return "Выберите доступную цель";
  if (!preview.canAttack) return "Цель недоступна для этого оружия";
  const parts = [`${preview.shots} выстр.`, `${preview.accuracy}% точность`, `${preview.damage} урон/попадание`, `${preview.totalDamage} макс. урон`];
  if (preview.cover) parts.push(`укрытие −${preview.cover}%`);
  if (preview.blockerId) parts.push(`перекрытие −${preview.blockerCover}%`);
  return parts.join(" · ");
}
