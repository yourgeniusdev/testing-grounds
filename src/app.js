import { ARROWS, activeUnit, applyMovement, applyStationaryRotation, availableFinalHeadings, availableStationaryHeadings, axialToOffset, beginActivation, confirmDeployment, contentsAt, createBattleState, deployUnit, destroyUnit, endActivation, inside, key, movementEvasion, planRoutes, signedTurn, skipMovement, unitAt, unitById, useEvasiveManeuver, waitActiveUnit, deploymentZone } from "./domain.js";
import { createSvgImage, iconMarkup } from "./icons.js";
import { headingAngle, shouldDrawRoute } from "./ui-rules.js";
import { attackAnimationPlan, attackArc, attackPreview, availableAttackTargets, resolveAttack, skipAttack } from "./battle.js";
import { VISUALS } from "./config/index.js";

const canvas = document.getElementById("battlefield");
const ctx = canvas.getContext("2d");
const ids = ["confirmDeploymentButton", "menuScreen", "battleScreen", "startBattleButton", "menuButton", "rulesButton", "rulesDialog", "closeRules", "dialogOkay", "resetButton", "roundNumber", "stageLabel", "initiativeList", "waitButton", "endActivationButton", "modeLabel", "coordinates", "tooltip", "maneuverPopup", "maneuverBadge", "maneuverDetails", "attackPopup", "unitClassBadge", "unitSummary", "weaponSummary", "routePolicyButton", "routePolicyIcon", "routePolicyTooltip", "evasionButton", "evasionIcon", "evasionTooltip", "attackWeaponActions", "actionTitle", "routeBadge", "routeDetails", "headingPicker", "headingButtons", "confirmManeuverButton", "cancelManeuverButton", "confirmButton", "cancelButton", "combatLog", "clearLogButton"];
const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
const stageNames = { system: "СИСТЕМЫ", movement: "МАНЁВР", attack: "АТАКА", deployment: "РАССТАНОВКА" };
const entityImages = new Map();
let state = createBattleState();
let ui = { policy: "risky", selectedWeapons: new Set(), hoveredWeapon: null, routes: new Map(), selected: null, hovered: null, animation: null, geometry: { size: 38, cx: 0, cy: 0, dpr: 1 } };

function addLog(message, tone = "neutral") {
  state.log.unshift({ id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, round: state.roundNumber, message, tone });
  state.log = state.log.slice(0, 80);
  renderLog();
}

function resetBattle() {
  state = createBattleState();
  ui = { ...ui, selectedWeapons: new Set(), routes: new Map(), selected: null, hovered: null, animation: null };
  state.activeUnitId = state.units.find(unit => unit.sideId === "azure")?.id || null;
  state.stage = "deployment";
  addLog("Фаза расстановки: разместите и подтвердите левую сторону.", "system");
  refresh();
}

function axialToPixel(position) {
  const { size, cx, cy } = ui.geometry;
  return { x: cx + size * Math.sqrt(3) * (position.q + position.r / 2), y: cy + size * 1.5 * position.r };
}

function cubeRound(q, r) {
  const x = q;
  const z = r;
  const y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

function pixelToAxial(x, y) {
  const px = x - ui.geometry.cx;
  const py = y - ui.geometry.cy;
  return cubeRound((Math.sqrt(3) / 3 * px - py / 3) / ui.geometry.size, (2 / 3 * py) / ui.geometry.size);
}

function pointerHex(event) {
  const rect = canvas.getBoundingClientRect();
  return pixelToAxial(event.clientX - rect.left, event.clientY - rect.top);
}

function refreshRoutes() {
  const unit = activeUnit(state);
  ui.routes = state.stage === "attack" || state.lifecycle === "DeploymentLeft" || state.lifecycle === "DeploymentRight" ? new Map() : planRoutes(state, unit, ui.policy);
  ui.selected = null;
  if (state.stage !== "attack") ui.selectedWeapons = new Set();
}

function refresh() {
  refreshRoutes();
  renderAll();
}

function renderAll() {
  renderHeader();
  renderInitiative();
  renderUnitSummary();
  renderWeaponSummary();
  renderRouteInspector();
  renderLog();
  draw();
}

function renderHeader() {
  const unit = unitById(state, ui.selected?.deploymentUnitId) || activeUnit(state);
  const deploying = state.lifecycle === "DeploymentLeft" || state.lifecycle === "DeploymentRight";
  el.roundNumber.textContent = state.roundNumber;
  el.stageLabel.textContent = stageNames[state.stage];
  el.modeLabel.textContent = deploying ? `РАССТАНОВКА · ${state.lifecycle === "DeploymentLeft" ? "ЛЕВАЯ СТОРОНА" : "ПРАВАЯ СТОРОНА"}` : ui.animation ? "ВЫПОЛНЕНИЕ МАНЁВРА" : state.stage === "attack" ? "АТАКА · ВЫБОР ОРУДИЙ" : "ПЛАНИРОВАНИЕ МАРШРУТА";
  const energy = unit.reactor ? `${unit.reactor.currentEnergy}/${unit.reactor.capacity} энергии` : `${unit.stack} аппаратов`;
  el.waitButton.disabled = unit.hasWaited || state.stage !== "system" || Boolean(ui.animation);
  el.endActivationButton.disabled = Boolean(ui.animation) || Boolean(state.winner) || deploying;
  const isSquadron = unit.kind === "squadron";
  el.routePolicyIcon.textContent = ui.policy === "safe" ? "⬡" : "⚠";
  el.routePolicyButton.classList.toggle("active", ui.policy === "safe");
  el.routePolicyTooltip.innerHTML = ui.policy === "safe" ? "<b>Безопасный маршрут</b><small>Исключает опасности. Нажмите, чтобы разрешить риск.</small>" : "<b>Рискованный маршрут</b><small>Допускает опасности. Нажмите, чтобы выбрать безопасный режим.</small>";
  el.evasionIcon.textContent = isSquadron ? "✣" : "◇";
  el.evasionTooltip.innerHTML = isSquadron ? "<b>Рассеивание</b><small>Увеличивает уклонение, снижает урон. Эффект будет добавлен позже.</small>" : "<b>Манёвр уклонения</b><small>1 очко манёвренности · бонус движения ×1.5</small>";
  el.stageLabel.textContent = deploying ? "РАССТАНОВКА" : stageNames[state.stage];
  const attacking = state.stage === "attack";
  el.confirmDeploymentButton.hidden = !deploying;
  el.confirmDeploymentButton.disabled = false;
  el.routePolicyButton.hidden = attacking || deploying;
  el.evasionButton.hidden = attacking;
  el.evasionButton.disabled = isSquadron || attacking || Boolean(ui.animation) || unit.maneuver < 1;
  el.evasionButton.classList.toggle("active", unit.evasiveManeuver);
}

function renderInitiative() {
  if (!state.initiativeOrder.length) { el.initiativeList.innerHTML = `<div class="mission-card"><strong>Расстановка ${state.lifecycle === "DeploymentLeft" ? "левой" : "правой"} стороны</strong><span>Выберите корабль, затем свободный гекс.</span></div>`; return; }
  el.initiativeList.innerHTML = state.initiativeOrder.map((id, index) => {
    const unit = unitById(state, id);
    const stateLabel = id === state.activeUnitId ? "ACTIVE" : unit.hasActivated ? "DONE" : unit.hasWaited ? "WAIT" : `#${index + 1}`;
    const typeLabel = unit.kind === "capital" ? "Капитальный корабль" : "Эскадрилья";
    const energy = unit.reactor ? `Энергия ${unit.reactor.currentEnergy}/${unit.reactor.capacity}` : `Состав ${unit.stack} аппаратов`;
    const tooltip = `${unit.name} · ${typeLabel} · ${unit.sideId === "player" ? "Союзный" : "Вражеский"}\nСостояние: ${stateLabel}\nЩит ${unit.shield}/${unit.maxShield} · Броня ${unit.armor}/${unit.maxArmor} · Целостность ${unit.integrity}/${unit.maxIntegrity}\nСкорость ${unit.currentSpeed} · ${energy}`;
    const subtitle = unit.kind === "squadron" ? `Звено истребителей «${unit.squadronModelName}»` : `${stateLabel} · INI ${unit.initiative}`;
    return `<article class="ship-card ${id === state.activeUnitId ? "active" : ""} ${unit.hasActivated ? "done" : ""}" style="--ship-color:${unit.color}" title="${tooltip}"><span class="mini-ship">${iconMarkup(unit.glyph, unit.color, unit.name)}</span><span class="ship-info"><strong>${unit.name}</strong><small>${subtitle}</small></span></article>`;
  }).join("");
}

function healthBar(label, value, max, tone, incomingDamage = 0) {
  const percent = max ? Math.max(0, Math.min(100, value / max * 100)) : 0;
  const previewPercent = max ? Math.max(0, Math.min(percent, (value - incomingDamage) / max * 100)) : 0;
  const damagePercent = Math.max(0, percent - previewPercent);
  const damageLabel = incomingDamage > 0 ? `<em>−${incomingDamage}</em>` : "";
  return `<div class="healthbar ${tone}"><span>${label}</span><div class="healthbar-track"><i style="width:${percent}%"></i>${incomingDamage > 0 ? `<u style="left:${previewPercent}%;width:${damagePercent}%"></u>` : ""}<b>${value}/${max}${damageLabel}</b></div></div>`;
}

function renderUnitSummary() {
  const selectedDeployment = unitById(state, ui.selected?.deploymentUnitId);
  const unit = selectedDeployment || activeUnit(state);
  if (!unit) return;
  el.unitClassBadge.textContent = unit.kind === "capital" ? "CAPITAL" : "SQUADRON";
  el.unitClassBadge.style.color = unit.color;
  const evasion = unit.evasionLocked ? 0 : (unit.baseEvasion || 0) + unit.movementEvasion;
  el.unitSummary.innerHTML = `<div class="unit-portrait" style="color:${unit.color}">${iconMarkup(unit.glyph, unit.color, unit.name)}</div><div class="unit-vitals">${healthBar("Щит", unit.shield, unit.maxShield, "shield")} ${healthBar("Броня", unit.armor, unit.maxArmor, "armor")} ${healthBar("Целостность", unit.integrity, unit.maxIntegrity, "integrity")}<div class="stat-grid"><div><span>Энергия</span><b>${unit.reactor ? `${unit.reactor.currentEnergy}/${unit.reactor.capacity}` : "—"}</b></div><div><span>Уклонение</span><b>${evasion}%</b></div><div><span>Криты</span><b>${unit.criticals.length}</b></div></div></div>`;
}

function weaponMarkup(weapon) {
  return `<article><b>${weapon.name}</b><span>${weapon.mount} · ${weapon.weaponClass}</span><span>${weapon.accuracy}% · ${weapon.shots}×${weapon.damage} · дальность ${weapon.effectiveRange}/${weapon.maxRange}${weapon.role === "auxiliary" ? ` · ${weapon.energyCost} энергии` : ""}</span></article>`;
}

function renderWeaponSummary() {
  const unit = activeUnit(state);
  el.weaponSummary.innerHTML = "";
  const readyWeapons = unit.weapons.filter(weapon => weapon.role === "primary" ? unit.primaryReady : unit.auxiliaryReady && unit.reactor?.currentEnergy >= weapon.energyCost);
  el.attackWeaponActions.innerHTML = state.stage === "attack" ? readyWeapons.map(weapon => `<button type="button" class="action-slot weapon-action ${ui.selectedWeapons.has(weapon.id) ? "active" : ""}" data-weapon-id="${weapon.id}" aria-label="${weapon.name}" title="${weapon.name}"><span class="action-icon">${weapon.role === "primary" ? "◈" : "✦"}</span><span class="action-tooltip"><b>${weapon.name}</b><small>${weapon.role === "primary" ? "Основное орудие" : `Вспомогательное орудие · ${weapon.energyCost} энергии`}<br>${weapon.weaponClass} · ${weapon.mount}<br>${weapon.accuracy}% точность · ${weapon.shots}×${weapon.damage} урон<br>${weapon.effectiveRange}/${weapon.maxRange} гекс. · крит ${weapon.critChance}%</small></span></button>`).join("") : "";
  el.attackWeaponActions.querySelectorAll("[data-weapon-id]").forEach(button => {
    button.addEventListener("mouseenter", () => { ui.hoveredWeapon = button.dataset.weaponId; draw(); });
    button.addEventListener("mouseleave", () => { ui.hoveredWeapon = null; draw(); });
    button.addEventListener("click", () => {
      const weaponId = button.dataset.weaponId;
      if (ui.selectedWeapons.has(weaponId)) ui.selectedWeapons.delete(weaponId); else ui.selectedWeapons.add(weaponId);
      renderAll();
    });
  });
}

function consequenceMarkup(consequence) {
  return `<li><b>${consequence.sourceName}</b><span>${Math.round(consequence.probability * 100)}% · ${consequence.min}–${consequence.max} · ${consequence.effect}</span></li>`;
}

function positionPopup(popup, position) {
  const wrap = canvas.parentElement.getBoundingClientRect();
  const target = axialToPixel(position);
  const popupWidth = popup.offsetWidth || 220;
  const popupHeight = popup.offsetHeight || 100;
  const gap = ui.geometry.size + 12;
  const left = Math.max(10, Math.min(target.x + gap, wrap.width - popupWidth - 10));
  const top = Math.max(44, Math.min(target.y - popupHeight / 2, wrap.height - popupHeight - 74));
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

function positionManeuverPopup() {
  if (!ui.selected?.position || state.stage === "attack" || state.lifecycle === "DeploymentLeft" || state.lifecycle === "DeploymentRight") { el.maneuverPopup.hidden = true; return; }
  positionPopup(el.maneuverPopup, ui.selected.position);
}

function positionAttackPopup() {
  if (state.stage !== "attack") { el.attackPopup.hidden = true; return; }
  positionPopup(el.attackPopup, ui.selected?.position || activeUnit(state).position);
}

function renderRouteInspector() {
  const unit = activeUnit(state);
  const selected = ui.selected;
  const attacking = state.stage === "attack";
  const deploying = state.lifecycle === "DeploymentLeft" || state.lifecycle === "DeploymentRight";
  el.maneuverPopup.hidden = deploying || attacking || !selected?.position || Boolean(ui.animation);
   el.attackPopup.hidden = !attacking || !selected || Boolean(ui.animation);
  el.attackPopup.setAttribute("aria-label", attacking ? "Фаза атаки: выберите орудия и цель" : "Фаза атаки");
  el.actionTitle.textContent = attacking ? "План атаки" : "План манёвра";
  if (deploying) {
    el.headingPicker.hidden = true;
    el.confirmButton.hidden = true;
    el.cancelButton.hidden = true;
    return;
  }
   if (attacking) {
    el.headingPicker.hidden = true;
    el.confirmButton.hidden = false;
    el.cancelButton.hidden = false;
    el.cancelButton.disabled = false;
      if (!selected) return;
      const preview = attackPreview(state, selected.targetId, ui.selectedWeapons);
    el.routeBadge.textContent = preview.included.length ? "ГОТОВ" : "НЕДОСТУПНО";
      el.routeDetails.innerHTML = `<div class="attack-vitals">${healthBar("Щит", preview.target.shield, preview.target.maxShield, "shield", preview.layer === "shield" ? preview.potentialDamage : 0)}${healthBar("Броня", preview.target.armor, preview.target.maxArmor, "armor", preview.layer === "armor" ? preview.potentialDamage : 0)}${healthBar("Целостность", preview.target.integrity, preview.target.maxIntegrity, "integrity", preview.layer === "integrity" ? preview.potentialDamage : 0)}</div><div class="maneuver-metrics"><span><b>${preview.included.length}</b> ОРУД.</span><span><b>${preview.shots}</b> ВЫСТР.</span><span><b>${preview.potentialDamage}</b> УРОН</span></div><div class="attack-weapons">${preview.ordered.map(weapon => `<span><strong>${weapon.name}</strong><small>${weapon.weaponClass} · ${weapon.shots}×${weapon.damage} · ${Math.max(5, Math.min(95, weapon.accuracy - ((preview.target.baseEvasion || 0) + preview.target.movementEvasion)))}% попадание · крит ${weapon.critChance}%</small></span>`).join("")}</div><p class="attack-summary">Слой: <b>${preview.layer}</b> · уклонение цели: <b>${preview.target.baseEvasion + preview.target.movementEvasion}%</b></p>${preview.target.criticals.length ? `<p class="route-warning">Криты: ${preview.target.criticals.map(critical => critical.type).join(", ")}</p>` : ""}${preview.excluded.length ? `<p class="route-warning">Исключено: ${preview.excluded.length}</p>` : ""}`;
     el.confirmButton.disabled = !preview.included.length || preview.included.length !== ui.selectedWeapons.size;
    positionAttackPopup();
    return;
  }
  if (!selected) {
    el.headingPicker.hidden = true;
    el.confirmButton.hidden = true;
    el.cancelButton.hidden = true;
    return;
  }
  const route = selected.route;
  const stationary = route.steps.length === 0;
  const evasion = stationary && selected.heading !== unit.heading ? 0 : movementEvasion(route.steps.length, unit.evasiveManeuver);
  const maneuverBudget = unit.kind === "capital" ? unit.maneuver - (unit.evasiveManeuver ? 1 : 0) : 0;
  const remainingTurns = unit.kind === "capital" ? maneuverBudget - route.turnsSpent - (selected.heading !== route.heading ? 1 : 0) : 0;
  el.maneuverBadge.textContent = route.consequences.length ? "РИСК" : "ГОТОВ";
  el.maneuverDetails.innerHTML = `<div class="maneuver-metrics"><span><b>${route.movementCost}/${unit.currentSpeed}</b> SPD</span><span><b>${unit.kind === "capital" ? route.turnsSpent : route.steps.length}</b> ${unit.kind === "capital" ? "ПОВ." : "ШАГ."}</span><span><b>+${evasion}%</b> УКЛ.</span>${unit.kind === "capital" ? `<span><b>${Math.max(0, remainingTurns)}</b> ОСТ.</span>` : ""}</div>${route.interception ? '<p class="route-warning">После манёвра: перехват</p>' : ""}${route.consequences.length ? `<ul class="consequence-list">${route.consequences.map(consequenceMarkup).join("")}</ul>` : ""}`;
  if (unit.kind === "capital") {
    el.headingPicker.hidden = false;
    const options = stationary ? availableStationaryHeadings(unit) : availableFinalHeadings(unit, route);
    el.headingButtons.innerHTML = ARROWS.map((arrow, heading) => `<button class="heading-button ${heading === selected.heading ? "active" : ""}" data-heading="${heading}" ${options.has(heading) ? "" : "disabled"}>${arrow}</button>`).join("");
    el.headingButtons.querySelectorAll("button:not(:disabled)").forEach(button => button.addEventListener("click", () => {
      ui.selected.heading = Number(button.dataset.heading);
      renderRouteInspector();
      draw();
    }));
  } else el.headingPicker.hidden = true;
  el.confirmButton.hidden = true;
  el.cancelButton.hidden = true;
  el.confirmManeuverButton.disabled = false;
  positionManeuverPopup();
}

function renderLog() {
  el.combatLog.innerHTML = state.log.map(entry => `<li class="${entry.tone}"><time>R${entry.round}</time><span>${entry.message}</span></li>`).join("") || '<li class="empty-log">Журнал пуст</li>';
}

function imageFor(type, color) {
  const cacheKey = `${type}:${color}`;
  if (!entityImages.has(cacheKey)) entityImages.set(cacheKey, createSvgImage(type, color));
  return entityImages.get(cacheKey);
}

function hexPath(x, y, size = ui.geometry.size - 2) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i - 30);
    const px = x + size * Math.cos(angle);
    const py = y + size * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function draw() {
  const rect = canvas.getBoundingClientRect();
  ctx.setTransform(ui.geometry.dpr, 0, 0, ui.geometry.dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  drawStars(rect.width, rect.height);
  const bounds = state.scenario.bounds;
  for (let row = bounds.minRow; row <= bounds.maxRow; row++) for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
    const position = { q: col - (row - (row & 1)) / 2, r: row };
    drawHex(position);
  }
  drawRoute();
  for (const content of state.scenario.contents) drawEntity(content, content.type, content.kind === "object" ? "#ff667d" : content.type === "nebula" ? "#c98ff0" : "#f4c861");
  for (const unit of state.units) if (ui.animation?.unitId !== unit.id) drawEntity(unit, unit.glyph, unit.color, unit.heading);
  if (ui.animation?.kind === "movement") drawAnimatedEntity();
  if (ui.animation?.kind === "attack") drawAttackAnimation();
}

function drawStars(width, height) {
  ctx.fillStyle = "rgba(160,195,222,.22)";
  for (let i = 0; i < 90; i++) ctx.fillRect((i * 97 + 31) % width, (i * 53 + 17) % height, i % 7 === 0 ? 1.4 : .7, i % 7 === 0 ? 1.4 : .7);
}

function drawHex(position) {
  const { x, y } = axialToPixel(position);
  const route = ui.routes.get(key(position.q, position.r));
  const contents = contentsAt(state, position);
  const occupant = unitAt(state, position, activeUnit(state).id);
  hexPath(x, y);
  let fill = "rgba(18,30,44,.34)";
  let stroke = "rgba(67,89,112,.36)";
  let width = 1;
  if (route && state.lifecycle !== "DeploymentLeft" && state.lifecycle !== "DeploymentRight") { fill = "rgba(101,244,178,.052)"; stroke = "rgba(101,244,178,.28)"; }
  const deploying = state.lifecycle === "DeploymentLeft" || state.lifecycle === "DeploymentRight";
  if (deploying && deploymentZone(state, state.lifecycle === "DeploymentLeft" ? "azure" : "crimson").some(cell => key(cell.q, cell.r) === key(position.q, position.r))) { fill = "rgba(101,244,178,.16)"; stroke = "rgba(101,244,178,.85)"; }
  if (state.stage === "attack" && ui.selectedWeapons.size) {
    const selectedArcs = [...ui.selectedWeapons].map(id => attackArc(state, new Set([id])));
    const coverage = selectedArcs.filter(arc => arc.has(key(position.q, position.r))).length;
    if (coverage) {
      fill = `rgba(255,102,125,${Math.min(.34, .10 + coverage * .08)})`;
      stroke = "rgba(255,102,125,.82)";
      width = 1.5;
    }
    const hoveredArc = ui.hoveredWeapon ? attackArc(state, new Set([ui.hoveredWeapon])) : null;
    if (hoveredArc?.has(key(position.q, position.r))) {
      stroke = "#ffb0bb";
      width = 3;
    }
  }
  if (contents.some(content => content.kind !== "object")) { fill = "rgba(244,200,97,.10)"; stroke = "rgba(244,200,97,.45)"; }
  if (contents.some(content => content.kind === "object") || occupant) { fill = "rgba(255,102,125,.09)"; stroke = "rgba(255,102,125,.42)"; }
  if (ui.hovered && key(...Object.values(ui.hovered)) === key(position.q, position.r)) { stroke = route ? "#65f4b2" : "#8aa0b6"; width = 2; }
   if (state.stage === "attack" && ui.selectedWeapons.size && availableAttackTargets(state, ui.selectedWeapons).some(target => key(target.position.q, target.position.r) === key(position.q, position.r))) { fill = "rgba(255,102,125,.14)"; stroke = "#ff667d"; width = 2; }
  if (ui.selected?.position && key(ui.selected.position.q, ui.selected.position.r) === key(position.q, position.r)) { fill = "rgba(102,228,255,.14)"; stroke = "#66e4ff"; width = 2.5; }

  ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke();
  if (route && key(position.q, position.r) !== key(activeUnit(state).position.q, activeUnit(state).position.r)) { ctx.fillStyle = "rgba(101,244,178,.7)"; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill(); }
  const { col, row } = axialToOffset(position.q, position.r);
  ctx.fillStyle = "rgba(116,137,158,.36)"; ctx.font = "7px monospace"; ctx.textAlign = "center"; ctx.fillText(`${col}:${row}`, x, y + ui.geometry.size * .69);
}

function drawEntity(entity, glyph, color, heading = 0) {
  const position = entity.position;
  if (!inside(state, position)) return;
  const { x, y } = axialToPixel(position);
  const image = imageFor(glyph, color);
  ctx.save(); ctx.translate(x, y); ctx.rotate(headingAngle(heading || 0)); ctx.shadowColor = color; ctx.shadowBlur = entity.id === state.activeUnitId ? 18 : 8;
  const size = VISUALS[glyph].size;
  if (image.complete) ctx.drawImage(image, -size / 2, -size / 2, size, size); else image.onload = draw;
  ctx.restore();
  if (entity.id === state.activeUnitId || entity.id === ui.selected?.deploymentUnitId) { ctx.strokeStyle = color; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(x, y, 25, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
}

function drawRoute() {
  if (!shouldDrawRoute(ui.selected)) return;
  ctx.strokeStyle = "#66e4ff"; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.beginPath();
  ui.selected.route.path.forEach((point, index) => { const pixel = axialToPixel(point); if (!index) ctx.moveTo(pixel.x, pixel.y); else ctx.lineTo(pixel.x, pixel.y); });
  ctx.stroke(); ctx.setLineDash([]);
}

function drawAttackAnimation() {
  const animation = ui.animation;
  const elapsed = performance.now() - animation.started;
  const step = animation.plan.find(item => elapsed >= item.delay && elapsed <= item.delay + item.duration) || animation.plan[animation.plan.length - 1];
  if (!step) return;
  const progress = Math.max(0, Math.min(1, (elapsed - step.delay) / step.duration));
  const from = axialToPixel(animation.from);
  const to = axialToPixel(animation.to);
  ctx.save();
  if (step.weaponClass === "energy") {
    ctx.strokeStyle = `rgba(102,228,255,${Math.sin(progress * Math.PI)})`;
    ctx.lineWidth = 3;
    ctx.shadowColor = "#66e4ff";
    ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
  } else {
    const shotCount = Math.min(step.shots, 6);
    for (let shot = 0; shot < shotCount; shot++) {
      const shotProgress = Math.max(0, Math.min(1, progress * 1.35 - shot * .08));
      const x = from.x + (to.x - from.x) * shotProgress;
      const y = from.y + (to.y - from.y) * shotProgress;
      ctx.fillStyle = step.weaponClass === "explosive" ? "#ff9e5e" : "#f4c861";
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(x, y, step.weaponClass === "explosive" ? 4 : 2, 0, Math.PI * 2); ctx.fill();
    }
    if (step.weaponClass === "explosive" && progress > .82) {
      ctx.strokeStyle = `rgba(255,158,94,${1 - progress})`; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(to.x, to.y, 8 + progress * 18, 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawAnimatedEntity() {
  const animation = ui.animation;
  const image = imageFor(animation.glyph, animation.color);
  ctx.save(); ctx.translate(animation.x, animation.y); ctx.rotate(headingAngle(animation.heading)); ctx.shadowColor = animation.color; ctx.shadowBlur = 18;
  if (image.complete) ctx.drawImage(image, -animation.size / 2, -animation.size / 2, animation.size, animation.size);
  ctx.restore();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  const heightSize = (rect.height - 56) / 16;
  const widthSize = (rect.width - 32) / (Math.sqrt(3) * 14);
  ui.geometry = { dpr, size: Math.max(18, Math.min(44, heightSize, widthSize)), cx: rect.width / 2, cy: rect.height / 2 - 4 };
  positionManeuverPopup();
  positionAttackPopup();
  draw();
}

function startMovement() {
  if (!ui.selected || ui.animation) return;
  el.maneuverPopup.hidden = true;
  const unit = activeUnit(state);
  if (unit.evasiveManeuver) addLog(`${unit.name} применяет «Манёвр уклонения» за 1 очко манёвренности.`, unit.sideId);
  const route = ui.selected.route;
  const finalHeading = ui.selected.heading;
  let path = [...route.path];
  if (unit.kind === "squadron") {
    path = path.map((point, index) => ({ ...point, heading: index ? route.steps[index - 1].heading : 0 }));
    if (path.length > 1) path.push({ ...route.position, heading: 0 });
  }
  if (unit.kind === "capital" && (path.length === 1 || finalHeading !== route.heading)) path.push({ ...route.position, heading: finalHeading });
  if (path.length === 1) path.push({ ...path[0], heading: finalHeading ?? 0 });
  const origin = axialToPixel(path[0]);
  const movingPath = path.filter((point, index) => index === 0 || point.q !== path[index - 1].q || point.r !== path[index - 1].r);
  const finalPoint = path[path.length - 1];
  const finalTurn = finalPoint.heading ?? movingPath[movingPath.length - 1].heading ?? unit.heading ?? 0;
  ui.animation = { kind: "movement", unitId: unit.id, glyph: unit.glyph, color: unit.color, size: VISUALS[unit.glyph].size, path, movingPath, started: performance.now(), x: origin.x, y: origin.y, heading: unit.heading || 0, finalTurn, route, finalHeading };
  document.body.classList.add("animating");
  renderHeader();
  requestAnimationFrame(animate);
}

function animate(now) {
  const animation = ui.animation;
  if (!animation) return;
  const moveDuration = animation.movingPath.length > 1 ? Math.max(440, (animation.movingPath.length - 1) * 320) : 0;
  const turnDuration = 280;
  const elapsed = now - animation.started;
  const moving = animation.movingPath.length > 1;
  const moveProgress = moving ? Math.min(1, Math.max(0, elapsed / moveDuration)) : 1;
  const routePosition = moveProgress * Math.max(0, animation.movingPath.length - 1);
  const segment = Math.max(0, Math.min(Math.floor(routePosition), animation.movingPath.length - 2));
  const segmentProgress = Math.min(1, routePosition - segment);
  const from = animation.movingPath[segment];
  const to = animation.movingPath[Math.min(segment + 1, animation.movingPath.length - 1)];
  const start = axialToPixel(from);
  const end = axialToPixel(to);
  animation.x = start.x + (end.x - start.x) * segmentProgress;
  animation.y = start.y + (end.y - start.y) * segmentProgress;
  const fromHeading = from.heading ?? animation.heading;
  const travelHeading = to.heading ?? fromHeading;
  animation.heading = fromHeading + signedTurn(fromHeading, travelHeading) * segmentProgress;
  if (moveProgress >= 1) {
    const turnProgress = Math.min(1, Math.max(0, (elapsed - moveDuration) / turnDuration));
    const turnEase = 1 - Math.pow(1 - turnProgress, 3);
    const arrivalHeading = animation.movingPath[animation.movingPath.length - 1].heading ?? animation.heading;
    animation.heading = arrivalHeading + signedTurn(arrivalHeading, animation.finalTurn) * turnEase;
  }
  draw();
  const complete = moveProgress >= 1 && (animation.finalTurn === animation.heading || elapsed >= moveDuration + turnDuration);
  if (!complete) requestAnimationFrame(animate);
  else finishMovement();
}

function resolveConsequences(route, unit) {
  for (const consequence of route.consequences) {
    const roll = Math.random();
    if (roll <= consequence.probability) {
      const damage = Math.floor(Math.random() * (consequence.max - consequence.min + 1)) + consequence.min;
      unit.integrity = Math.max(0, unit.integrity - damage);
      addLog(`${unit.name}: ${consequence.sourceName} наносит ${damage} урона.`, "danger");
      if (unit.integrity === 0) {
        const result = destroyUnit(state, unit);
        addLog(`${unit.name} уничтожен. На позиции появляется поле обломков.`, "danger");
        if (result?.winner) addLog(`Победа флотилии ${result.winner}.`, "system");
        break;
      }
    } else addLog(`${unit.name} избегает эффекта «${consequence.sourceName}».`, "safe");
  }
}

function finishMovement() {
  const animation = ui.animation;
  const unit = activeUnit(state);
  if (animation.route.steps.length === 0) {
    if (unit.kind === "capital" && animation.finalHeading !== unit.heading) applyStationaryRotation(state, animation.finalHeading);
    else skipMovement(state);
  } else applyMovement(state, animation.route, animation.finalHeading);
  resolveConsequences(animation.route, unit);
  if (!state.units.includes(unit)) {
    ui.animation = null; ui.selected = null; document.body.classList.remove("animating");
    refresh();
    return;
  }
  const suffix = animation.route.interception ? " и попадает в перехват" : "";
  addLog(`${unit.name} завершает манёвр: ${animation.route.steps.length} шаг., уклонение +${unit.movementEvasion}%${suffix}.`, unit.sideId);
  ui.animation = null; ui.selected = null; document.body.classList.remove("animating");
  addLog(`${unit.name}: начинается фаза атаки.`, "azure");
  refresh();
}

function selectHex(position) {
  if (state.lifecycle === "DeploymentLeft" || state.lifecycle === "DeploymentRight") {
    const side = state.lifecycle === "DeploymentLeft" ? "azure" : "crimson";
    const occupant = unitAt(state, position);
    if (occupant?.sideId === side) { ui.selected = { deploymentUnitId: occupant.id }; renderAll(); return; }
    const selected = unitById(state, ui.selected?.deploymentUnitId);
    if (selected && !occupant && deployUnit(state, selected.id, position, selected.heading)) refresh();
    return;
  }
  if (state.stage === "attack") {
    const target = unitAt(state, position, activeUnit(state).id);
    if (!ui.selectedWeapons.size || !target || !availableAttackTargets(state, ui.selectedWeapons).includes(target)) return;
    ui.selected = { position, targetId: target.id };
    renderRouteInspector(); draw();
    return;
  }
  const route = ui.routes.get(key(position.q, position.r));
  if (!route) return;
  const unit = activeUnit(state);
  ui.selected = { position, route, heading: unit.kind === "capital" ? route.heading ?? unit.heading : null };
  renderRouteInspector(); draw();
}

canvas.addEventListener("pointermove", event => {
  if (ui.animation) return;
  const position = pointerHex(event);
  ui.hovered = inside(state, position) ? position : null;
  if (!ui.hovered) { el.tooltip.hidden = true; draw(); return; }
  const offset = axialToOffset(position.q, position.r);
  el.coordinates.textContent = `HEX ${offset.col >= 0 ? "+" : ""}${offset.col} : ${offset.row >= 0 ? "+" : ""}${offset.row}`;
  const route = ui.routes.get(key(position.q, position.r));
  const occupant = unitAt(state, position);
  const contents = contentsAt(state, position);
  if (state.stage === "attack" && occupant && occupant.sideId !== activeUnit(state).sideId) {
    const preview = attackPreview(state, occupant.id, ui.selectedWeapons);
    const weapons = preview.ordered.map(weapon => `${weapon.name}: ${weapon.shots}×${weapon.damage}, ${Math.max(5, Math.min(95, weapon.accuracy - ((occupant.baseEvasion || 0) + occupant.movementEvasion)))}%`).join("<br>");
    const selectionHint = ui.selectedWeapons.size ? "" : "<br><em>Сначала выберите плитки орудий</em>";
    const vitals = `<div class="tooltip-vitals">${healthBar("Щит", occupant.shield, occupant.maxShield, "shield", preview.layer === "shield" ? preview.potentialDamage : 0)}${healthBar("Броня", occupant.armor, occupant.maxArmor, "armor", preview.layer === "armor" ? preview.potentialDamage : 0)}${healthBar("Целостность", occupant.integrity, occupant.maxIntegrity, "integrity", preview.layer === "integrity" ? preview.potentialDamage : 0)}</div>`;
    el.tooltip.innerHTML = preview.included.length ? `<b>${occupant.name}</b>${vitals}<em>${weapons}</em><br>До ${preview.potentialDamage} урона по слою «${preview.layer}» · ${preview.shots} выстр.` : `<b>${occupant.name}</b>${vitals}${selectionHint || "<br><em>Недопустимая цель: вне сектора или дальности</em>"}`;
  } else if (occupant) {
    const evasion = occupant.evasionLocked ? 0 : (occupant.baseEvasion || 0) + occupant.movementEvasion;
    const energy = occupant.reactor ? `<br>Энергия ${occupant.reactor.currentEnergy}/${occupant.reactor.capacity}` : `<br>Состав эскадрильи: ${occupant.stack}`;
    const criticals = occupant.criticals.length ? `<br><em>Криты: ${occupant.criticals.map(critical => critical.type).join(", ")}</em>` : "";
    const vitals = `<div class="tooltip-vitals">${healthBar("Щит", occupant.shield, occupant.maxShield, "shield")}${healthBar("Броня", occupant.armor, occupant.maxArmor, "armor")}${healthBar("Целостность", occupant.integrity, occupant.maxIntegrity, "integrity")}</div>`;
    el.tooltip.innerHTML = `<b>${occupant.name}</b><br>${occupant.sideId === activeUnit(state).sideId ? "Союзный" : "Вражеский"} ${occupant.kind === "capital" ? "капитальный корабль" : "юнит"}${vitals}Уклонение ${evasion}%${energy}${criticals}`;
  } else if (route) {
    const destination = contents.length ? `<br>${contents.map(item => item.label).join(", ")}` : "";
    const consequences = route.consequences.length ? `<br><em>${route.consequences.map(item => `${item.sourceName}: ${Math.round(item.probability * 100)}%, ${item.min}–${item.max} ${item.effect}`).join("<br>")}</em>` : "<br>Опасностей нет";
    el.tooltip.innerHTML = `<b>МАРШРУТ ДОСТУПЕН</b><br>${route.movementCost}/${activeUnit(state).currentSpeed} Speed · ${route.steps.length} шаг. · ${route.turnsSpent} повор.${destination}${consequences}`;
  } else {
    const details = occupant ? `${occupant.name}<br>Щит ${occupant.shield} · Броня ${occupant.armor} · Целостность ${occupant.integrity}` : contents.length ? contents.map(item => `${item.label}${item.hazard ? ` · ${Math.round(item.hazard.probability * 100)}%, ${item.hazard.min}–${item.hazard.max}` : ""}`).join("<br>") : "Пустой гекс";
    el.tooltip.innerHTML = `<b>НЕДОСТУПНО</b><br>${details}`;
  }
  el.tooltip.hidden = false;
  const wrap = canvas.parentElement.getBoundingClientRect(); el.tooltip.style.left = `${Math.min(event.clientX - wrap.left + 14, wrap.width - 200)}px`; el.tooltip.style.top = `${Math.min(event.clientY - wrap.top + 14, wrap.height - 110)}px`;
  draw();
});
canvas.addEventListener("pointerleave", () => { ui.hovered = null; el.tooltip.hidden = true; el.coordinates.textContent = "HEX —"; draw(); });
canvas.addEventListener("click", event => { if (!ui.animation) selectHex(pointerHex(event)); });

el.routePolicyButton.addEventListener("click", () => { ui.policy = ui.policy === "safe" ? "risky" : "safe"; refresh(); });
el.startBattleButton.addEventListener("click", () => { el.menuScreen.hidden = true; el.battleScreen.hidden = false; resetBattle(); requestAnimationFrame(resizeCanvas); });
el.menuButton.addEventListener("click", () => { el.battleScreen.hidden = true; el.menuScreen.hidden = false; });
el.rulesButton.addEventListener("click", () => el.rulesDialog.showModal());
el.closeRules.addEventListener("click", () => el.rulesDialog.close());
el.dialogOkay.addEventListener("click", () => el.rulesDialog.close());
el.resetButton.addEventListener("click", resetBattle);
el.confirmDeploymentButton.addEventListener("click", () => {
  const side = state.lifecycle === "DeploymentLeft" ? "azure" : "crimson";
  if (confirmDeployment(state, side)) { ui.selected = null; if (side === "azure") state.units.forEach(unit => { unit.deployed = true; }); else beginActivation(state); refresh(); }
});

el.evasionButton.addEventListener("click", () => { if (useEvasiveManeuver(state)) refresh(); });
el.waitButton.addEventListener("click", () => { const name = activeUnit(state).name; if (waitActiveUnit(state)) { addLog(`${name} ждёт и переносится в конец очереди.`, "system"); addLog(`${activeUnit(state).name} начинает активацию.`, activeUnit(state).sideId); refresh(); } });
el.endActivationButton.addEventListener("click", () => { const name = activeUnit(state).name; if (state.stage === "attack") skipAttack(state); const result = endActivation(state); addLog(`${name} завершает активацию.`, "system"); if (result.newRound) addLog(`Начинается раунд ${state.roundNumber}.`, "system"); addLog(`${activeUnit(state).name} начинает активацию.`, activeUnit(state).sideId); refresh(); });

el.confirmManeuverButton.addEventListener("click", startMovement);
el.cancelManeuverButton.addEventListener("click", () => { ui.selected = null; renderRouteInspector(); draw(); });
el.confirmButton.addEventListener("click", () => {
  if (!ui.selected || ui.animation) return;
  const target = unitById(state, ui.selected.targetId);
  const plan = attackAnimationPlan(state, target.id, ui.selectedWeapons);
   if (!plan.length) return;
   const targetId = target.id;
   const selection = new Set(ui.selectedWeapons);
  const duration = Math.max(...plan.map(step => step.delay + step.duration));
  el.attackPopup.hidden = true;
  ui.animation = { kind: "attack", plan, from: { ...activeUnit(state).position }, to: { ...target.position }, started: performance.now() };
  document.body.classList.add("animating");
  el.modeLabel.textContent = "ВЕДЕНИЕ ОГНЯ";
  const frame = () => {
    if (!ui.animation || ui.animation.kind !== "attack") return;
    if (performance.now() - ui.animation.started < duration) { draw(); requestAnimationFrame(frame); return; }
    ui.animation = null;
    document.body.classList.remove("animating");
     if (!resolveAttack(state, targetId, selection)) { refresh(); return; }
    if (!state.winner) {
      const result = endActivation(state);
      if (result.newRound) addLog(`Начинается раунд ${state.roundNumber}.`, "system");
      addLog(`${activeUnit(state).name} начинает активацию.`, activeUnit(state).sideId);
    }
    ui.selected = null;
    refresh();
  };
  requestAnimationFrame(frame);
});
el.cancelButton.addEventListener("click", () => { ui.selected = null; renderRouteInspector(); draw(); });
el.clearLogButton.addEventListener("click", () => { state.log = []; renderLog(); });
window.addEventListener("resize", resizeCanvas);
window.addEventListener("keydown", event => { if (event.key === "Escape" && !el.rulesDialog.open) { ui.selected = null; renderRouteInspector(); draw(); } });

renderAll();