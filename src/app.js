import { DIRECTIONS, activeUnit, axialToOffset, beginActivation, confirmDeployment, contentsAt, createBattleState, deployUnit, endActivation, executeManeuverElement, inside, key, movementEvasion, planManeuver, planRoutes, signedTurn, unitAt, unitById, useEvasiveManeuver, waitActiveUnit, deploymentZone } from "./domain.js";
import { createSvgImage, iconMarkup } from "./icons.js";
import { buildManeuverOptions, canSelectWeaponAttackTarget, headingAngle, maneuverPreviewHeading, maneuverResourcePreview, routeConsequenceRows, shouldDrawRoute, shouldHighlightOccupiedHex, shouldOutlineUnit } from "./ui-rules.js";
import { applyAttackStep, availableWeaponAttackTargets, confirmWeaponAttack, previewWeaponAttack, resolvePostEntryAA, weaponAttackArc } from "./battle.js";
import { VISUALS } from "./config/index.js";

const canvas = document.getElementById("battlefield");
const ctx = canvas.getContext("2d");
const ids = ["confirmDeploymentButton", "menuScreen", "battleScreen", "startBattleButton", "menuButton", "rulesButton", "rulesDialog", "closeRules", "dialogOkay", "resetButton", "roundNumber", "stageLabel", "initiativeList", "waitButton", "endActivationButton", "modeLabel", "coordinates", "tooltip", "unitSummary", "energyResource", "actionPlaceholders", "turnPlaceholders", "routePolicyButton", "routePolicyIcon", "routePolicyTooltip", "evasionButton", "evasionIcon", "evasionTooltip", "attackWeaponActions", "combatLog", "clearLogButton"];
const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
const tooltipTitle = el.tooltip.querySelector(".hex-tooltip-title");
const tooltipContent = el.tooltip.querySelector(".hex-tooltip-content");
const stageNames = { system: "СИСТЕМЫ", movement: "МАНЁВР", attack: "АТАКА", deployment: "РАССТАНОВКА" };
const entityImages = new Map();
let state = createBattleState();
let ui = { policy: "risky", selectedWeaponId: null, hoveredWeapon: null, routes: new Map(), selected: null, hovered: null, hoveredOption: null, optionTargets: [], tooltipHex: null, tooltipInside: false, tooltipTimer: null, animation: null, lastActiveUnit: null, geometry: { size: 38, cx: 0, cy: 0, dpr: 1 } };

function addLog(message, tone = "neutral") {
  state.log.unshift({ id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, round: state.roundNumber, message, tone });
  state.log = state.log.slice(0, 80);
  renderLog();
}

function resetBattle() {
  state = createBattleState();
  ui = { ...ui, selectedWeaponId: null, routes: new Map(), selected: null, hovered: null, hoveredOption: null, optionTargets: [], tooltipHex: null, animation: null };
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

function pointerPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function pointerHex(event) {
  const point = pointerPoint(event);
  return pixelToAxial(point.x, point.y);
}

function selectedOption() {
  return ui.hoveredOption || ui.selected?.baseOption || null;
}

function selectedRoute() {
  return selectedOption()?.route || null;
}

function clearManeuverSelection() {
  ui.selected = null;
  ui.hoveredOption = null;
  ui.optionTargets = [];
  hideTooltip();
}

function optionTarget(option) {
  const target = axialToPixel(option.finalState.hex);
  const heading = maneuverPreviewHeading(activeUnit(state), option);
  if (heading === undefined) return { x: target.x, y: target.y, radius: 17, option };
  const [dq, dr] = DIRECTIONS[heading];
  const neighbor = axialToPixel({ q: option.finalState.hex.q + dq, r: option.finalState.hex.r + dr });
  const rect = canvas.getBoundingClientRect();
  const margin = 24;
  const rawInside = neighbor.x >= margin && neighbor.x <= rect.width - margin && neighbor.y >= margin + 24 && neighbor.y <= rect.height - margin;
  const distance = rawInside ? 1 : .62;
  const x = target.x + (neighbor.x - target.x) * distance;
  const y = target.y + (neighbor.y - target.y) * distance;
  return { x: Math.max(margin, Math.min(rect.width - margin, x)), y: Math.max(margin + 24, Math.min(rect.height - margin, y)), radius: 18, option };
}

function optionAtPoint(point) {
  const targets = ui.optionTargets.map(target => ({ target, distance: Math.hypot(point.x - target.x, point.y - target.y) })).filter(candidate => candidate.distance <= candidate.target.radius);
  targets.sort((a, b) => a.distance - b.distance);
  return targets[0]?.target.option || null;
}

function refreshRoutes() {
  const unit = activeUnit(state);
  ui.routes = state.stage === "attack" || state.lifecycle === "DeploymentLeft" || state.lifecycle === "DeploymentRight" ? new Map() : planRoutes(state, unit, ui.policy);
  ui.selected = null;
  ui.hoveredOption = null;
  ui.optionTargets = [];
  hideTooltip();
  if (state.stage !== "attack") ui.selectedWeaponId = null;
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
  renderResourceBar();
  renderLog();
  draw();
}

function isDeploying() {
  return state.lifecycle === "DeploymentLeft" || state.lifecycle === "DeploymentRight";
}

function currentUnit() {
  return isDeploying() || !state.initiativeOrder.length ? null : activeUnit(state);
}

function interactiveUnit() {
  return state.lifecycle === "Finished" || state.winner ? null : currentUnit();
}

function placeholderSlots(count) {
  return Array.from({ length: count }, () => '<span class="action-slot action-placeholder"></span>').join("");
}

function renderHeader() {
  const unit = currentUnit();
  const deploying = isDeploying();
  const finished = state.lifecycle === "Finished" || Boolean(state.winner);
  el.roundNumber.textContent = state.roundNumber;
  el.modeLabel.textContent = deploying ? `РАССТАНОВКА · ${state.lifecycle === "DeploymentLeft" ? "ЛЕВАЯ СТОРОНА" : "ПРАВАЯ СТОРОНА"}` : finished ? "БОЙ ЗАВЕРШЁН" : ui.animation ? "ВЫПОЛНЕНИЕ МАНЁВРА" : state.stage === "attack" ? "АТАКА · ВЫБОР ОРУДИЙ" : "ПЛАНИРОВАНИЕ МАРШРУТА";
  el.stageLabel.textContent = deploying ? "РАССТАНОВКА" : finished ? "ИТОГ" : stageNames[state.stage];
  el.confirmDeploymentButton.hidden = !deploying;
  el.confirmDeploymentButton.disabled = Boolean(ui.animation);
  el.waitButton.hidden = deploying || finished;
  el.endActivationButton.hidden = deploying || finished;
  el.turnPlaceholders.innerHTML = finished ? placeholderSlots(2) : "";
  el.actionPlaceholders.innerHTML = unit && !finished ? "" : placeholderSlots(2);
  el.routePolicyButton.hidden = !unit || finished;
  el.evasionButton.hidden = !unit || finished;
  if (!unit) return;
  const attacking = state.stage === "attack";
  const isSquadron = unit.kind === "squadron";
  el.waitButton.disabled = unit.hasWaited || unit.canWait === false || state.stage !== "system" || Boolean(ui.animation);
  el.endActivationButton.disabled = Boolean(ui.animation) || finished;
  el.routePolicyIcon.textContent = ui.policy === "safe" ? "⬡" : "⚠";
  el.routePolicyButton.classList.toggle("active", ui.policy === "safe");
  el.routePolicyTooltip.innerHTML = ui.policy === "safe" ? "<b>Безопасный маршрут</b><small>Исключает опасности. Нажмите, чтобы разрешить риск.</small>" : "<b>Рискованный маршрут</b><small>Допускает опасности. Нажмите, чтобы выбрать безопасный режим.</small>";
  el.evasionIcon.textContent = isSquadron ? "✣" : "◇";
  el.evasionTooltip.innerHTML = isSquadron ? "<b>Рассеивание</b><small>Эффект для эскадрилий будет добавлен позже.</small>" : "<b>Манёвр уклонения</b><small>1 очко манёвренности · бонус движения ×1.5</small>";
  el.routePolicyButton.disabled = attacking || Boolean(ui.animation);
  el.evasionButton.disabled = isSquadron || attacking || Boolean(ui.animation) || unit.maneuver < 1;
  el.evasionButton.classList.toggle("active", unit.evasiveManeuver);
}

function renderInitiative() {
  if (!state.initiativeOrder.length) {
    el.initiativeList.innerHTML = `<div class="deployment-note"><strong>Расстановка ${state.lifecycle === "DeploymentLeft" ? "левой" : "правой"} стороны</strong><span>Выберите корабль, затем свободный гекс.</span></div>`;
    return;
  }
  el.initiativeList.innerHTML = state.initiativeOrder.map(id => {
    const unit = unitById(state, id);
    if (!unit) return "";
    const model = unit.kind === "capital" ? unit.hullClassName : unit.squadronModelName;
    const waitMark = unit.hasWaited && !unit.hasActivated ? '<span class="queue-state" aria-label="Ожидает">◷</span>' : "";
    return `<article class="ship-card ${id === state.activeUnitId ? "active" : ""} ${unit.hasActivated ? "done" : ""}" style="--ship-color:${unit.color}"><span class="mini-ship">${iconMarkup(unit.glyph, unit.color, unit.name, unit.stack)}</span><span class="ship-info"><strong>${unit.name}</strong><small>${model} · INI ${unit.initiative}</small></span>${waitMark}</article>`;
  }).join("");
}

function healthBar(label, value, max, tone, incomingDamage = 0) {
  const percent = max ? Math.max(0, Math.min(100, value / max * 100)) : 0;
  const previewPercent = max ? Math.max(0, Math.min(percent, (value - incomingDamage) / max * 100)) : 0;
  const damagePercent = Math.max(0, percent - previewPercent);
  const damageLabel = incomingDamage > 0 ? `<em>−${incomingDamage}</em>` : "";
  return `<div class="healthbar ${tone}"><span>${label}</span><div class="healthbar-track"><i style="width:${percent}%"></i>${incomingDamage > 0 ? `<u style="left:${previewPercent}%;width:${damagePercent}%"></u>` : ""}<b>${value}/${max}${damageLabel}</b></div></div>`;
}

function effectRows(unit) {
  const effects = [];
  if (unit.evasiveManeuver) effects.push({ tone: "positive", icon: "◇", name: "Манёвр уклонения", text: "Бонус уклонения усилен", duration: "До конца активации" });
  return effects;
}

function unitModel(unit) {
  return unit.kind === "capital" ? unit.hullClassName : unit.squadronModelName;
}

function tooltipStatuses(unit) {
  const criticals = unit.criticals.length ? `<span class="tooltip-status negative">! ${unit.criticals.map(critical => critical.type).join(", ")}</span>` : "";
  const effects = effectRows(unit).map(effect => `<span class="tooltip-status ${effect.tone}">${effect.icon} ${effect.name}</span>`).join("");
  return criticals || effects ? `<div class="tooltip-statuses">${criticals}${effects}</div>` : "";
}

function statusList(items, type, emptyText) {
  if (!items.length) return `<div class="status-empty">${emptyText}</div>`;
  return `<div class="status-list">${items.map(item => `<div class="status-item ${item.tone || type}" tabindex="0"><span class="status-icon">${item.icon || (type === "critical" ? "!" : "+")}</span><span><b>${item.name || item.type}</b><small>${item.text || "Критическое повреждение"}</small></span>${item.duration ? `<em>${item.duration}</em>` : ""}<span class="status-tooltip"><b>${item.name || item.type}</b><small>${item.description || item.text || "Подробное описание появится с расширением модели эффектов."}${item.duration ? `<br>${item.duration}` : ""}</small></span></div>`).join("")}</div>`;
}

function resourceSegments(total, spent = 0, preview = 0, tone = "cyan") {
  const safeTotal = Math.max(0, Math.round(total || 0));
  return `<div class="resource-segments ${tone}">${Array.from({ length: safeTotal }, (_, index) => {
    const fromEnd = safeTotal - index;
    const className = fromEnd <= spent ? "spent" : fromEnd <= spent + preview ? "preview" : "available";
    return `<i class="${className}"></i>`;
  }).join("")}</div>`;
}

function renderUnitSummary() {
  const liveUnit = currentUnit();
  if (liveUnit) ui.lastActiveUnit = liveUnit;
  const unit = liveUnit || (state.winner ? ui.lastActiveUnit : null);
  if (!unit) {
    el.unitSummary.innerHTML = '<div class="inspector-empty"><span>◇</span><b>Ожидание начала боя</b><small>Параметры появятся после определения активного юнита.</small></div>';
    return;
  }
  const evasion = unit.evasionLocked ? 0 : (unit.baseEvasion || 0) + unit.movementEvasion;
  const model = unit.kind === "capital" ? unit.hullClassName : unit.squadronModelName;
  const previewSelection = ui.selected ? { ...ui.selected, previewOption: selectedOption() } : null;
  const { speedSpent, speedPreview, maneuverSpent, maneuverPreview } = maneuverResourcePreview(unit, previewSelection, state.stage, signedTurn);
  const routePreview = state.stage !== "attack" ? selectedRoute() : null;
  const previewOption = selectedOption();
  const previewHeading = previewOption?.finalState.heading;
  const stationaryTurn = routePreview?.steps.length === 0 && previewHeading !== undefined && previewHeading !== unit.heading;
  const previewEvasion = routePreview ? stationaryTurn ? 0 : movementEvasion(routePreview.steps.length, unit.evasiveManeuver) : 0;
  const evasionBonus = routePreview ? previewEvasion : 0;
  const speedRemaining = Math.max(0, unit.currentSpeed - speedSpent - speedPreview);
  const maneuverRemaining = Math.max(0, (unit.maneuver || 0) - maneuverSpent - maneuverPreview);
  const speedState = `<div class="resource-state"><span>Скорость <b>${speedRemaining}/${unit.currentSpeed}</b></span>${resourceSegments(unit.currentSpeed, speedSpent, speedPreview, "speed")}</div>`;
  const maneuverState = unit.maneuver !== undefined ? `<div class="resource-state"><span>Манёвренность <b>${maneuverRemaining}/${unit.maneuver}</b></span>${resourceSegments(unit.maneuver, maneuverSpent, maneuverPreview, "maneuver")}</div>` : "";
  const evasionPreview = evasionBonus > 0 ? `<em>+${evasionBonus}%</em>` : evasionBonus < 0 ? `<i>${evasionBonus}%</i>` : "";
  el.unitSummary.innerHTML = `<div class="unit-identity"><div class="unit-portrait" style="color:${unit.color}">${iconMarkup(unit.glyph, unit.color, unit.name, unit.stack)}</div><div class="unit-identity-copy"><span class="active-label">${state.winner ? "Последний активный юнит" : "Активный юнит"}</span><strong>${unit.name}</strong><small>${model}</small></div><span class="class-badge" style="color:${unit.color}">${unit.kind === "capital" ? "CAPITAL" : "SQUADRON"}</span></div><section class="inspector-section current-state"><div class="section-title"><span>Текущее состояние</span></div><div class="unit-vitals">${healthBar("Щит", unit.shield, unit.maxShield, "shield")}${healthBar("Броня", unit.armor, unit.maxArmor, "armor")}${healthBar("Целостность", unit.integrity, unit.maxIntegrity, "integrity")}</div>${speedState}${maneuverState}<div class="evasion-state"><span>Уклонение</span><b>${evasion}% ${evasionPreview}</b></div></section><section class="inspector-section status-section"><div class="section-title"><span>Критические повреждения</span><small>${unit.criticals.length}</small></div>${statusList(unit.criticals.map(item => ({ ...item, tone: "negative", icon: "!", name: item.type })), "critical", "Критических повреждений нет")}</section><section class="inspector-section status-section"><div class="section-title"><span>Активные эффекты</span><small>${effectRows(unit).length}</small></div>${statusList(effectRows(unit), "effect", "Активных эффектов нет")}</section>${state.winner ? '<div class="battle-finished">Бой завершён</div>' : ""}`;
}

const deliveryNames = { beam: "луч", projectile: "снаряд", missile: "ракета", torpedo: "торпеда" };

function effectiveShots(unit, weapon) {
  return unit.kind === "squadron" ? weapon.shots * unit.stack : weapon.shots;
}

function weaponAvailability(unit, weapon) {
  const attacking = state.stage === "attack";
  const preview = previewWeaponAttack(state, unit.id, weapon.id, "");
  const reason = preview.reasons.find(candidate => candidate !== "Цель отсутствует");
  const cooldown = weapon.cooldownRemaining > 0;
  const insufficientEnergy = reason?.startsWith("Недостаточно энергии") || reason === "Требуется реактор";
  const unavailable = !attacking || Boolean(ui.animation) || Boolean(reason);
  const status = !attacking ? "Доступно в фазе атаки" : reason || "Готово";
  return { unavailable, cooldown, insufficientEnergy, status };
}

function renderWeaponSummary() {
  const unit = interactiveUnit();
  if (!unit) {
    el.attackWeaponActions.innerHTML = placeholderSlots(3);
    return;
  }
  el.attackWeaponActions.innerHTML = unit.weapons.map(weapon => {
    const availability = weaponAvailability(unit, weapon);
    const aa = unit.kind === "capital" && weapon.targetKinds.includes("squadron") ? " · ПВО" : "";
    const icon = availability.cooldown ? weapon.cooldownRemaining : weapon.visual.projectile === "beam" ? "━" : weapon.visual.projectile === "torpedo" ? "◆" : weapon.visual.projectile === "missile" ? "➤" : "•";
    const energyIcon = availability.insufficientEnergy ? '<span class="energy-warning" aria-hidden="true">ϟ</span>' : "";
    return `<span class="action-slot-shell ${availability.unavailable ? "disabled" : ""}" data-weapon-id="${weapon.id}" tabindex="0"><button type="button" class="action-slot weapon-action ${ui.selectedWeaponId === weapon.id ? "active" : ""} ${availability.cooldown ? "cooldown" : ""}" aria-label="${weapon.name}" ${availability.unavailable ? "disabled" : ""}><span class="action-icon">${icon}</span>${energyIcon}</button><span class="action-tooltip"><b>${weapon.name}</b><small>${deliveryNames[weapon.delivery]} · ${weapon.weaponClass} · ${weapon.mount}${aa}<br>${weapon.accuracy}% точность · ${effectiveShots(unit, weapon)}×${weapon.damage} урон<br>${weapon.effectiveRange}/${weapon.maxRange} гекс. · крит ${weapon.critChance}%${weapon.energyCost ? `<br>${weapon.energyCost} энергии` : ""}<br>${availability.status}</small></span></span>`;
  }).join("");
  el.attackWeaponActions.querySelectorAll("[data-weapon-id]").forEach(slot => {
    const showPreview = () => {
      ui.hoveredWeapon = slot.dataset.weaponId;
      const tooltip = slot.querySelector(".action-tooltip");
      const rect = slot.getBoundingClientRect();
      tooltip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 198))}px`;
      renderResourceBar();
      draw();
    };
    const clearPreview = () => { ui.hoveredWeapon = null; renderResourceBar(); draw(); };
    slot.addEventListener("mouseenter", showPreview);
    slot.addEventListener("mouseleave", clearPreview);
    slot.addEventListener("focus", showPreview);
    slot.addEventListener("blur", clearPreview);
    slot.querySelector("button").addEventListener("click", () => {
      const weaponId = slot.dataset.weaponId;
      ui.selectedWeaponId = ui.selectedWeaponId === weaponId ? null : weaponId;
      ui.selected = null;
      renderAll();
    });
  });
}

function renderResourceBar() {
  const unit = interactiveUnit();
  if (!unit?.reactor) {
    el.energyResource.innerHTML = "";
    el.energyResource.classList.add("empty");
    return;
  }
  el.energyResource.classList.remove("empty");
  const weapon = unit.weapons.find(candidate => candidate.id === ui.hoveredWeapon);
  const preview = weapon ? Math.min(unit.reactor.currentEnergy, weapon.energyCost) : 0;
  el.energyResource.innerHTML = `<span class="energy-label"><b>${unit.name}</b><span>Энергия ${unit.reactor.currentEnergy}/${unit.reactor.capacity}</span></span>${resourceSegments(unit.reactor.capacity, unit.reactor.capacity - unit.reactor.currentEnergy, preview, "energy")}`;
}

function renderLog() {
  el.combatLog.innerHTML = state.log.map(entry => `<li class="${entry.tone}"><time>R${entry.round}</time><span>${entry.message}</span></li>`).join("") || '<li class="empty-log">Журнал пуст</li>';
}

function imageFor(type, color, stack) {
  const displayCount = type === "squadron" ? Math.max(1, stack ?? 3) : "static";
  const cacheKey = `${type}:${color}:${displayCount}`;
  if (!entityImages.has(cacheKey)) entityImages.set(cacheKey, createSvgImage(type, color, stack));
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
  if (ui.selected && state.stage !== "attack" && !ui.animation) {
    drawManeuverGhost();
    drawManeuverOptions();
  }
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
  if (route && state.lifecycle !== "DeploymentLeft" && state.lifecycle !== "DeploymentRight") {
    const muted = Boolean(selectedRoute() && state.stage !== "attack");
    fill = muted ? "rgba(101,244,178,.018)" : "rgba(101,244,178,.052)";
    stroke = muted ? "rgba(101,244,178,.10)" : "rgba(101,244,178,.28)";
  }
  const deploying = state.lifecycle === "DeploymentLeft" || state.lifecycle === "DeploymentRight";
  if (deploying && deploymentZone(state, state.lifecycle === "DeploymentLeft" ? "azure" : "crimson").some(cell => key(cell.q, cell.r) === key(position.q, position.r))) { fill = "rgba(101,244,178,.16)"; stroke = "rgba(101,244,178,.85)"; }
  if (state.stage === "attack" && ui.selectedWeaponId) {
    const selectedArc = weaponAttackArc(state, activeUnit(state).id, ui.selectedWeaponId);
    if (selectedArc.has(key(position.q, position.r))) {
      fill = "rgba(255,102,125,.18)";
      stroke = "rgba(255,102,125,.82)";
      width = 1.5;
    }
    const hoveredArc = ui.hoveredWeapon ? weaponAttackArc(state, activeUnit(state).id, ui.hoveredWeapon) : null;
    if (hoveredArc?.has(key(position.q, position.r))) {
      stroke = "#ffb0bb";
      width = 3;
    }
  }
  if (contents.some(content => content.kind !== "object")) { fill = "rgba(244,200,97,.10)"; stroke = "rgba(244,200,97,.45)"; }
  if (contents.some(content => content.kind === "object") || (occupant && shouldHighlightOccupiedHex(state.lifecycle))) { fill = "rgba(255,102,125,.09)"; stroke = "rgba(255,102,125,.42)"; }
  const event = selectedEventAt(position);
  if (event?.hazards.length) { fill = "rgba(244,200,97,.20)"; stroke = "rgba(244,200,97,.82)"; width = 2; }
  if (event?.interception) { fill = event.hazards.length ? fill : "rgba(255,158,94,.20)"; stroke = "#ff9e5e"; width = 2.5; }
  if (ui.hovered && key(ui.hovered.q, ui.hovered.r) === key(position.q, position.r)) {
    if (route && selectedRoute()) fill = "rgba(101,244,178,.032)";
    stroke = route ? "#65f4b2" : "#8aa0b6"; width = 2;
  }
   if (state.stage === "attack" && ui.selectedWeaponId && availableWeaponAttackTargets(state, activeUnit(state).id, ui.selectedWeaponId).some(target => key(target.position.q, target.position.r) === key(position.q, position.r))) { fill = "rgba(255,102,125,.14)"; stroke = "#ff667d"; width = 2; }
  if (ui.selected?.position && key(ui.selected.position.q, ui.selected.position.r) === key(position.q, position.r)) { fill = "rgba(102,228,255,.14)"; stroke = "#66e4ff"; width = 2.5; }

  ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = width;
  if (event?.interception) ctx.setLineDash([5, 4]);
  ctx.stroke(); ctx.setLineDash([]);
  if (event?.hazards.length) { hexPath(x, y, ui.geometry.size - 8); ctx.strokeStyle = "#f4c861"; ctx.lineWidth = 2; ctx.stroke(); }
  if (event?.interception) { hexPath(x, y, ui.geometry.size - 3); ctx.strokeStyle = "#ff9e5e"; ctx.lineWidth = 2.5; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]); }
  if (route && key(position.q, position.r) !== key(activeUnit(state).position.q, activeUnit(state).position.r)) { ctx.fillStyle = "rgba(101,244,178,.7)"; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill(); }
  const { col, row } = axialToOffset(position.q, position.r);
  ctx.fillStyle = "rgba(116,137,158,.36)"; ctx.font = "7px monospace"; ctx.textAlign = "center"; ctx.fillText(`${col}:${row}`, x, y + ui.geometry.size * .69);
}

function drawEntity(entity, glyph, color, heading = 0) {
  const position = entity.position;
  if (!inside(state, position)) return;
  const { x, y } = axialToPixel(position);
  const image = imageFor(glyph, color, entity.stack);
  ctx.save(); ctx.translate(x, y); ctx.rotate(headingAngle(heading || 0)); ctx.shadowColor = color; ctx.shadowBlur = entity.id === state.activeUnitId ? 18 : 8;
  const size = VISUALS[glyph].size;
  if (image.complete) ctx.drawImage(image, -size / 2, -size / 2, size, size); else image.onload = draw;
  ctx.restore();
  if (shouldOutlineUnit(entity.id, state.activeUnitId, ui.selected?.deploymentUnitId, state.lifecycle)) { ctx.strokeStyle = color; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(x, y, 25, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
}

function selectedEventAt(position) {
  const route = selectedRoute();
  if (!route) return null;
  const hazards = [];
  const pathVisits = route.path.filter(point => key(point.q, point.r) === key(position.q, position.r)).length;
  for (const content of contentsAt(state, position)) {
    const matches = route.consequences.filter(consequence => consequence.sourceId === content.id);
    const count = Math.max(matches.length, matches.length ? pathVisits : 0);
    for (let index = 0; index < count; index++) hazards.push(matches[index % matches.length]);
  }
  const interceptor = route.interception ? unitById(state, route.interception) : null;
  const interception = interceptor && key(position.q, position.r) === key(route.position.q, route.position.r) ? interceptor : null;
  return hazards.length || interception ? { hazards, interception } : null;
}

function firstHazardPathIndex(route) {
  return route.path.findIndex((point, index) => index > 0 && contentsAt(state, point).some(content => route.consequences.some(consequence => consequence.sourceId === content.id)));
}

function drawRouteSegment(from, to, color) {
  const a = axialToPixel(from);
  const b = axialToPixel(to);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.setLineDash([]);
}

function drawRoute() {
  const route = selectedRoute();
  if (!shouldDrawRoute({ route })) return;
  const path = route.path;
  const hazardIndex = firstHazardPathIndex(route);
  for (let index = 1; index < path.length; index++) drawRouteSegment(path[index - 1], path[index], hazardIndex >= 0 && index > hazardIndex ? "#f4c861" : "#66e4ff");
}

function drawManeuverGhost() {
  const option = selectedOption();
  if (!option) return;
  const unit = activeUnit(state);
  const previewHeading = maneuverPreviewHeading(unit, option);
  if (previewHeading === undefined) return;
  const image = imageFor(unit.glyph, unit.color, unit.stack);
  const { x, y } = axialToPixel(option.finalState.hex);
  const size = VISUALS[unit.glyph].size;
  ctx.save();
  ctx.globalAlpha = ui.hoveredOption ? .55 : .35;
  ctx.translate(x, y); ctx.rotate(headingAngle(previewHeading));
  ctx.shadowColor = unit.color; ctx.shadowBlur = 14;
  if (image.complete) ctx.drawImage(image, -size / 2, -size / 2, size, size);
  ctx.restore();
}

function drawManeuverOptions() {
  const options = ui.selected?.options || [];
  ui.optionTargets = options.map(optionTarget);
  for (const target of ui.optionTargets) {
    const active = ui.hoveredOption?.optionId === target.option.optionId;
    ctx.save();
    ctx.translate(target.x, target.y);
    if (active) ctx.scale(1.14, 1.14);
    ctx.fillStyle = active ? "rgba(102,228,255,.98)" : "rgba(8,18,28,.94)";
    ctx.strokeStyle = active ? "#d8f8ff" : "#66e4ff";
    ctx.lineWidth = active ? 2.5 : 1.5;
    ctx.shadowColor = "#66e4ff"; ctx.shadowBlur = active ? 18 : 10;
    ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = active ? "#071019" : "#66e4ff";
    ctx.font = "700 20px ui-monospace,monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const previewHeading = maneuverPreviewHeading(activeUnit(state), target.option);
    if (previewHeading === undefined) ctx.fillText("✓", 0, 1);
    else {
      ctx.rotate(headingAngle(previewHeading));
      ctx.fillText("↑", 0, 1);
    }
    ctx.restore();
  }
}

function drawAttackAnimation() {
  const animation = ui.animation;
  const elapsed = performance.now() - animation.started;
  const from = axialToPixel(animation.from);
  for (const step of animation.plan.steps.filter(candidate => elapsed >= candidate.launchTime && elapsed <= candidate.arrivalTime + 160)) {
    const progress = Math.max(0, Math.min(1, (elapsed - step.launchTime) / step.duration));
    const to = axialToPixel(step.endpoint);
    const color = step.visual.color;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = step.visual.projectile === "torpedo" ? 18 : 12;
    if (step.visual.projectile === "beam") {
      ctx.globalAlpha = Math.max(.12, Math.sin(progress * Math.PI));
      ctx.lineWidth = Math.max(1, step.visual.size * ui.geometry.size);
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    } else if (progress < 1) {
      const x = from.x + (to.x - from.x) * progress;
      const y = from.y + (to.y - from.y) * progress;
      if (step.visual.trail !== "none") {
        const trail = step.visual.trail === "smoke" ? .22 : .1;
        ctx.globalAlpha = step.visual.trail === "smoke" ? .38 : .7;
        ctx.lineWidth = Math.max(1, step.visual.size * ui.geometry.size * .6);
        ctx.beginPath(); ctx.moveTo(from.x + (to.x - from.x) * Math.max(0, progress - trail), from.y + (to.y - from.y) * Math.max(0, progress - trail)); ctx.lineTo(x, y); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, step.visual.size * ui.geometry.size), 0, Math.PI * 2); ctx.fill();
    }
      if (progress >= 1 && step.visual.impact !== "none") {
      const impactProgress = Math.min(1, (elapsed - step.arrivalTime) / 160);
      const impactScale = step.outcome === "miss" ? .45 : 1;
      const radius = step.visual.impactRadius * impactScale * ui.geometry.size * (1 + impactProgress);
      ctx.globalAlpha = 1 - impactProgress;
      ctx.lineWidth = step.visual.impact === "largeExplosion" ? 4 : 2;
      ctx.beginPath(); ctx.arc(to.x, to.y, radius, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
}

function drawAnimatedEntity() {
  const animation = ui.animation;
  const image = imageFor(animation.glyph, animation.color, animation.stack);
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
  draw();
}

function startMovement(option = selectedOption()) {
  if (!ui.selected || !option || ui.animation) return;
  const unit = activeUnit(state);
  const plan = planManeuver(state, option);
  if (!plan) { refresh(); return; }
  if (unit.evasiveManeuver) addLog(`${unit.name} применяет «Манёвр уклонения» за 1 очко манёвренности.`, unit.sideId);
  ui.animation = { kind: "movement", unitId: unit.id, unitName: unit.name, sideId: unit.sideId, glyph: unit.glyph, color: unit.color, stack: unit.stack, size: VISUALS[unit.glyph].size, plan, nextElement: 0, executedMoves: 0, lastEvasion: unit.movementEvasion };
  document.body.classList.add("animating");
  renderHeader();
  executeNextManeuverElement();
}

function executeNextManeuverElement() {
  const animation = ui.animation;
  if (!animation || animation.kind !== "movement") return;
  const result = executeManeuverElement(state, animation.plan, animation.nextElement, {
    resolvePostEntry({ state: current, unit, plan, elementIndex, causeEventId }) {
      return resolvePostEntryAA(current, unit, { planId: plan.id, elementIndex, causeEventId });
    }
  });
  for (const outcome of result.hazardOutcomes || []) {
    if (!outcome.hit) addLog(`${animation.unitName} избегает эффекта «${outcome.consequence.sourceName}».`, "safe");
    else addLog(`${animation.unitName}: ${outcome.consequence.sourceName} наносит ${outcome.damage} урона.`, "danger");
  }
  animation.lastEvasion = unitById(state, animation.unitId)?.movementEvasion ?? animation.lastEvasion;
  if (result.status === "invalid") { finishMovement(result); return; }
  if (result.transition) {
    animation.transition = result.transition;
    animation.started = performance.now();
    animation.x = axialToPixel(result.transition.before.position).x;
    animation.y = axialToPixel(result.transition.before.position).y;
    animation.heading = result.transition.before.heading ?? result.transition.after.heading ?? 0;
    if (result.transition.type === "move") animation.executedMoves++;
    animation.result = result;
    requestAnimationFrame(animate);
    return;
  }
  finishMovement(result);
}

function animate(now) {
  const animation = ui.animation;
  if (!animation?.transition) return;
  const transition = animation.transition;
  const duration = transition.type === "move" ? 320 : 280;
  const progress = Math.min(1, Math.max(0, (now - animation.started) / duration));
  const eased = 1 - Math.pow(1 - progress, 3);
  const start = axialToPixel(transition.before.position);
  const end = axialToPixel(transition.after.position);
  animation.x = start.x + (end.x - start.x) * eased;
  animation.y = start.y + (end.y - start.y) * eased;
  const fromHeading = transition.before.heading ?? animation.heading;
  const toHeading = transition.after.heading ?? fromHeading;
  animation.heading = fromHeading + signedTurn(fromHeading, toHeading) * eased;
  draw();
  if (progress < 1) { requestAnimationFrame(animate); return; }
  const result = animation.result;
  animation.transition = null;
  animation.nextElement++;
  if (result.status === "executed") executeNextManeuverElement();
  else finishMovement(result);
}

function finishMovement(result) {
  const animation = ui.animation;
  if (!animation) return;
  const unit = unitById(state, animation.unitId);
  ui.animation = null; ui.selected = null; document.body.classList.remove("animating");
  if (result?.status === "destroyed") {
    addLog(`${animation.unitName} уничтожен. На позиции появляется поле обломков.`, "danger");
    if (result.destruction?.winner) addLog(`Победа флотилии ${result.destruction.winner}.`, "system");
    refresh();
    return;
  }
  if (!unit) { refresh(); return; }
  const suffix = result?.status === "stopped" ? " досрочно" : "";
  addLog(`${unit.name} завершает манёвр${suffix}: ${animation.executedMoves} шаг., уклонение +${animation.lastEvasion}%.`, unit.sideId);
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
    const attacker = activeUnit(state);
    const target = unitAt(state, position, attacker.id);
    if (!canSelectWeaponAttackTarget(attacker, target, ui.selectedWeaponId)) return;
    ui.selected = { position, targetId: target.id };
    draw();
    return;
  }
  const routes = ui.routes.matching?.(position) || [];
  const occupant = unitAt(state, position, activeUnit(state).id);
  if (!routes.length) {
    if (!occupant) { clearManeuverSelection(); renderUnitSummary(); draw(); }
    return;
  }
  if (ui.selected?.position && key(ui.selected.position.q, ui.selected.position.r) === key(position.q, position.r)) {
    clearManeuverSelection(); renderUnitSummary(); draw(); return;
  }
  const unit = activeUnit(state);
  const options = routes.flatMap(route => buildManeuverOptions(unit, route));
  const baseOption = options[0];
  ui.selected = { position, options, baseOption, previewOption: baseOption };
  ui.hoveredOption = null;
  renderUnitSummary(); draw();
}

function cancelTooltipClose() {
  clearTimeout(ui.tooltipTimer);
  ui.tooltipTimer = null;
}

function hideTooltip() {
  cancelTooltipClose();
  el.tooltip.hidden = true;
  ui.tooltipHex = null;
}

function scheduleTooltipClose() {
  if (ui.tooltipTimer) return;
  ui.tooltipTimer = setTimeout(() => {
    ui.tooltipTimer = null;
    if (!ui.tooltipInside) hideTooltip();
  }, 140);
}

function positionTooltip(event) {
  const wrap = canvas.parentElement.getBoundingClientRect();
  const width = el.tooltip.offsetWidth || 240;
  const height = el.tooltip.offsetHeight || 140;
  const localX = event.clientX - wrap.left;
  const localY = event.clientY - wrap.top;
  const left = localX + width + 24 <= wrap.width ? localX + 14 : localX - width - 14;
  const top = localY + height + 18 <= wrap.height ? localY + 14 : localY - height - 14;
  el.tooltip.style.left = `${Math.max(8, Math.min(left, wrap.width - width - 8))}px`;
  el.tooltip.style.top = `${Math.max(44, Math.min(top, wrap.height - height - 8))}px`;
}

function eventTooltip(position) {
  const route = selectedRoute();
  if (route && key(position.q, position.r) === key(route.position.q, route.position.r)) {
    const rows = routeConsequenceRows(route);
    if (rows.length) return { title: "ПОСЛЕДСТВИЯ МАРШРУТА", content: rows.map(row => `<article class="tooltip-event ${row.kind}"><b>${row.title}</b><span>${row.detail}</span></article>`).join("") };
  }
  const contents = contentsAt(state, position);
  const event = selectedEventAt(position);
  const hazards = event?.hazards.length ? event.hazards : contents.filter(content => content.hazard).map(content => ({ sourceId: content.id, sourceName: content.label, ...content.hazard }));
  if (!hazards.length && !event?.interception) return null;
  const hazardRows = hazards.map((hazard, index) => `<article class="tooltip-event hazard"><b>${hazard.sourceName}</b><span>${event?.hazards.length ? `Прохождение ${index + 1} · ${Math.round(hazard.probability * 100)}% · ${hazard.min}–${hazard.max} · ${hazard.effect}` : `${hazard.effect}`}</span></article>`).join("");
  const interceptionRow = event?.interception ? `<article class="tooltip-event interception"><b>ПЕРЕХВАТ</b><span>${event.interception.name} · эскадрилья связывает юнит боем после манёвра</span></article>` : "";
  return { title: hazards.length && event?.interception ? "ЭФФЕКТЫ ГЕКСА" : event?.interception ? "ПЕРЕХВАТ" : "ОПАСНОСТЬ", content: `${hazardRows}${interceptionRow}` };
}

function unitTooltip(occupant, preview = null) {
  const evasion = occupant.evasionLocked ? 0 : (occupant.baseEvasion || 0) + occupant.movementEvasion;
  const vitals = `<div class="tooltip-vitals">${healthBar("Щит", occupant.shield, occupant.maxShield, "shield", preview?.layer === "shield" ? preview.potentialDamage : 0)}${healthBar("Броня", occupant.armor, occupant.maxArmor, "armor", preview?.layer === "armor" ? preview.potentialDamage : 0)}${healthBar("Целостность", occupant.integrity, occupant.maxIntegrity, "integrity", preview?.layer === "integrity" ? preview.potentialDamage : 0)}</div>`;
  return { title: occupant.name, content: `<span class="tooltip-model">${unitModel(occupant)}</span>${vitals}Уклонение ${evasion}%${tooltipStatuses(occupant)}` };
}

function attackTooltip(occupant) {
  if (!ui.selectedWeaponId) return unitTooltip(occupant);
  const preview = previewWeaponAttack(state, activeUnit(state).id, ui.selectedWeaponId, occupant.id);
  const base = unitTooltip(occupant, preview);
  const weapon = activeUnit(state).weapons.find(candidate => candidate.id === ui.selectedWeaponId);
  const weapons = weapon ? `<span><strong>${weapon.name}</strong><small>${preview.shots}×${preview.damage} · ${preview.hitChance}% попадание</small></span>` : "";
  const exclusions = preview.reasons.map(reason => `<li>${reason}</li>`).join("");
  const energy = preview.energyRequired ? `<p>Энергия: <b>${preview.energyRequired}/${preview.energyAvailable}</b></p>` : "";
  const selectedTarget = ui.selected?.targetId === occupant.id;
  const hint = !ui.selectedWeaponId ? "<p>Сначала выберите оружейный слот</p>" : !preview.canConfirm ? "<p>Атака оружием недоступна</p>" : !selectedTarget ? "<p>Выберите цель кликом</p>" : "";
  const detail = `<div class="tooltip-attack-metrics"><span><b>${weapon ? 1 : 0}</b> СЛОТ</span><span><b>${preview.shots}</b> ВЫСТР.</span><span><b>${preview.potentialDamage}</b> УРОН</span></div><div class="tooltip-attack-weapons">${weapons}</div>${energy}${exclusions ? `<ul>${exclusions}</ul>` : ""}${hint}<div class="tooltip-attack-actions"><button type="button" class="button primary" data-tooltip-action="confirm-attack" ${preview.canConfirm && selectedTarget ? "" : "disabled"}>Подтвердить атаку</button><button type="button" class="button" data-tooltip-action="cancel-attack">Отменить</button></div>`;
  return { title: base.title, content: `${base.content}<div class="tooltip-attack">${detail}</div>` };
}

function combineTooltips(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;
  return { title: primary.title, content: `${primary.content}<div class="tooltip-section">${secondary.content}</div>` };
}

function showHexTooltip(position, event) {
  const occupant = unitAt(state, position);
  const events = eventTooltip(position);
  const target = state.stage === "attack" && occupant && occupant.sideId !== activeUnit(state).sideId ? attackTooltip(occupant) : occupant ? unitTooltip(occupant) : null;
  const model = combineTooltips(target, events);
  if (!model) { scheduleTooltipClose(); return; }
  cancelTooltipClose();
  ui.tooltipHex = position;
  tooltipTitle.textContent = model.title;
  tooltipContent.innerHTML = model.content;
  el.tooltip.hidden = false;
  positionTooltip(event);
}

canvas.addEventListener("pointermove", event => {
  const point = pointerPoint(event);
  const option = !ui.animation && ui.selected && state.stage !== "attack" ? optionAtPoint(point) : null;
  if (option !== ui.hoveredOption) {
    ui.hoveredOption = option;
    renderUnitSummary();
  }
  const position = pointerHex(event);
  ui.hovered = inside(state, position) ? position : null;
  if (!ui.hovered) { scheduleTooltipClose(); draw(); return; }
  if (ui.tooltipHex && key(ui.tooltipHex.q, ui.tooltipHex.r) !== key(position.q, position.r)) scheduleTooltipClose();
  const offset = axialToOffset(position.q, position.r);
  el.coordinates.textContent = `HEX ${offset.col >= 0 ? "+" : ""}${offset.col} : ${offset.row >= 0 ? "+" : ""}${offset.row}`;
  if (option) hideTooltip(); else showHexTooltip(position, event);
  draw();
});
canvas.addEventListener("pointerleave", () => { ui.hovered = null; ui.hoveredOption = null; scheduleTooltipClose(); el.coordinates.textContent = "HEX —"; renderUnitSummary(); draw(); });
canvas.addEventListener("click", event => {
  if (ui.animation) return;
  const option = optionAtPoint(pointerPoint(event));
  if (option) { startMovement(option); return; }
  selectHex(pointerHex(event));
  if (state.stage === "attack" && ui.selected?.targetId) showHexTooltip(ui.selected.position, event);
});
el.tooltip.addEventListener("pointerenter", () => { ui.tooltipInside = true; cancelTooltipClose(); });
el.tooltip.addEventListener("pointerleave", () => { ui.tooltipInside = false; scheduleTooltipClose(); });

el.routePolicyButton.addEventListener("click", () => { if (ui.animation) return; ui.policy = ui.policy === "safe" ? "risky" : "safe"; refresh(); });
el.startBattleButton.addEventListener("click", () => { el.menuScreen.hidden = true; el.battleScreen.hidden = false; resetBattle(); requestAnimationFrame(resizeCanvas); });
el.menuButton.addEventListener("click", () => { if (ui.animation) return; el.battleScreen.hidden = true; el.menuScreen.hidden = false; });
el.rulesButton.addEventListener("click", () => el.rulesDialog.showModal());
el.closeRules.addEventListener("click", () => el.rulesDialog.close());
el.dialogOkay.addEventListener("click", () => el.rulesDialog.close());
el.resetButton.addEventListener("click", () => { if (!ui.animation) resetBattle(); });
el.confirmDeploymentButton.addEventListener("click", () => {
  const side = state.lifecycle === "DeploymentLeft" ? "azure" : "crimson";
  if (confirmDeployment(state, side)) { ui.selected = null; if (side === "azure") state.units.forEach(unit => { unit.deployed = true; }); else beginActivation(state); refresh(); }
});

el.evasionButton.addEventListener("click", () => { if (useEvasiveManeuver(state)) refresh(); });
el.waitButton.addEventListener("click", () => { const name = activeUnit(state).name; if (waitActiveUnit(state)) { addLog(`${name} ждёт и переносится в конец очереди.`, "system"); addLog(`${activeUnit(state).name} начинает активацию.`, activeUnit(state).sideId); refresh(); } });
el.endActivationButton.addEventListener("click", () => { if (ui.animation) return; const name = activeUnit(state).name; const result = endActivation(state); if (!result) return; addLog(`${name} завершает активацию.`, "system"); if (result.newRound) addLog(`Начинается раунд ${state.roundNumber}.`, "system"); addLog(`${activeUnit(state).name} начинает активацию.`, activeUnit(state).sideId); refresh(); });

function confirmAttack() {
  if (!ui.selected?.targetId || ui.animation) return;
  const target = unitById(state, ui.selected.targetId);
  const plan = confirmWeaponAttack(state, activeUnit(state).id, ui.selectedWeaponId, target.id);
  if (!plan?.steps.length) return;
  hideTooltip();
  const started = performance.now();
  ui.animation = { kind: "attack", plan, from: { ...activeUnit(state).position }, stepIndex: 0, started };
  document.body.classList.add("animating");
  renderAll();
  const frame = now => {
    const animation = ui.animation;
    if (!animation || animation.kind !== "attack") return;
    const elapsed = now - animation.started;
    while (animation.stepIndex < animation.plan.steps.length && elapsed >= animation.plan.steps[animation.stepIndex].arrivalTime) {
      const result = applyAttackStep(state, animation.plan, animation.stepIndex);
      if (result.status !== "applied") { ui.animation = null; document.body.classList.remove("animating"); refresh(); return; }
      animation.stepIndex++;
      renderUnitSummary();
      renderLog();
    }
    draw();
    if (animation.stepIndex < animation.plan.steps.length) { requestAnimationFrame(frame); return; }
    ui.animation = null;
    document.body.classList.remove("animating");
    ui.selected = null;
    ui.selectedWeaponId = null;
    refresh();
  };
  requestAnimationFrame(frame);
}

el.tooltip.addEventListener("click", event => {
  const action = event.target.closest("[data-tooltip-action]")?.dataset.tooltipAction;
  if (action === "confirm-attack") confirmAttack();
  if (action === "cancel-attack") { ui.selected = null; hideTooltip(); draw(); }
});
el.clearLogButton.addEventListener("click", () => { state.log = []; renderLog(); });
window.addEventListener("resize", resizeCanvas);
window.addEventListener("keydown", event => { if (event.key === "Escape" && !el.rulesDialog.open && !ui.animation) { clearManeuverSelection(); renderUnitSummary(); draw(); } });

renderAll();