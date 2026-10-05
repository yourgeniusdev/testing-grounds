import { previewAttack } from "./v1-domain.js";

export function getWeaponSelection(attacker, weaponIndex = 0) {
  const slot = (attacker?.weapons ?? attacker?.weaponSlots)?.[weaponIndex];
  const weapon = slot?.weapon ?? slot;
  const available = Boolean(weapon && slot?.destroyed !== true && slot?.ready !== false && slot?.overwatch !== true && (slot?.ammo ?? weapon?.ammo ?? 1) > 0);
  return { slot, weapon, available };
}

export function getAttackPreview(state, attackerId, targetId, weaponIndex = 0) {
  const attacker = state.units.find(unit => unit.id === attackerId);
  const target = state.units.find(unit => unit.id === targetId);
  const { weapon, available } = getWeaponSelection(attacker, weaponIndex);
  if (!attacker || !target || !available) return null;
  return { ...previewAttack(state, attacker, target, weapon), weaponId: weapon.id ?? `weapon-${weaponIndex}`, weaponIndex };
}

export function formatAttackPreview(preview) {
  if (!preview) return "Выберите доступную цель";
  if (!preview.canAttack) return "Цель недоступна для этого оружия";
  const parts = [`${preview.shots} выстр.`, `${preview.hitMain}% в цель`];
  if (preview.blockerId) parts.push(`${preview.hitBlocker}% в ${preview.blockerId}`, `${preview.miss}% промах`, `${preview.friendlyFire ? "friendly fire" : "перекрытие"}: ${preview.blockerId}`, "распределение первого выстрела");
  else parts.push(`${preview.miss}% промах`);
  parts.push(`${preview.damage} урон/попадание`, `${preview.totalDamage} макс. урон`);
  if (preview.cover) parts.push(`укрытие −${preview.cover}%`);
  return parts.join(" · ");
}
