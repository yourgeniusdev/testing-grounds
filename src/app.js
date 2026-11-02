import { cooldownLabel, systemActionVisible, DIRECTIONS, actionAvailability, activeUnit, axialToOffset, buildBattleLog, confirmDeployment, confirmDisengageAction, confirmManeuverAction, confirmSystemAction, contentsAt, createBattleState, deployUnit, endActivation, executeManeuverElement, inside, key, overwatchAvailability, planRoutes, resumeManeuverPostEntry, signedTurn, unitAt, unitById, waitActiveUnit, deploymentZone } from "./domain.js";
import { createSvgImage, iconMarkup } from "./icons.js";
import { actionPlanningPreview, planningControlsPresentation, maneuverPlanningPreview, DISPERSION_DESCRIPTION, terrainTooltipRows, actionResourcePreview, actionTilePresentation, buildManeuverOptions, canSelectWeaponAttackTarget, disengageActionPresentation, evasionPresentation, headingAngle, interceptionEffectRows, maneuverActionPresentation, maneuverPreviewHeading, maneuverResourcePreview, resourceMetricsText, resourcePresentation, routeConsequenceRows, segmentedResourcePresentation, shouldDrawRoute, shouldHighlightOccupiedHex, shouldOutlineUnit, systemActionPresentation, weaponSelectionPresentation } from "./ui-rules.js";
import { bindRulesDialog, cancelPendingAction, pendingWeaponId, recalculateActionUi, selectPendingAction } from "./ui-controller.js";
import { applyAttackStep, applyReactionStep, availableWeaponAttackTargets, confirmWeaponAttackAction, planPostEntryAA, previewWeaponAttack, weaponAttackArc } from "./battle.js";
import { VISUALS } from "./config/index.js";
import { movementAnimationContinuation, planMovementAnimationSegment, reactionAnimationContinuation, sampleMovementAnimationSegment } from "./movement-animation.js";
import { battlefieldGeometry, maneuverTargetPosition, maneuverZoneRenderCommands } from "./canvas-rendering.js";

import { createActivationTransitionGuard, adjacentTooltip, createHoldGesture, damageIndicators, impactPlacement, informationTooltipLayout, inspectionObjects, repeatedTargetTap, visualShotSchedule } from "./battle-presentation.js";

const mobileMedia = matchMedia("(pointer:coarse), (max-width:950px)");
const mobile = () => mobileMedia.matches;
let battleStarted = false;
let targetTap = null;
let pinned = false;
let holdTimer = null;
let holdOrigin = null;
const holdGesture = createHoldGesture();
const activationTransitionGuard = createActivationTransitionGuard();
const liveImpacts = new Set();
const canvas = document.getElementById("battlefield");
const ctx = canvas.getContext("2d");
const ids = ["confirmDeploymentButton", "menuScreen", "battleScreen", "startBattleButton", "menuButton", "rulesButton", "rulesDialog", "closeRules", "dialogOkay", "resetButton", "roundNumber", "initiativeList", "waitButton", "endActivationButton", "modeLabel", "coordinates", "tooltip", "unitSummary", "energyResource", "actionPlaceholders", "turnPlaceholders", "routePolicyButton", "routePolicyIcon", "routePolicyTooltip", "evasionButton", "evasionIcon", "evasionTooltip", "disengageButton", "disengageIcon", "disengageTooltip", "engineBoostButton", "engineBoostTooltip", "attackWeaponActions", "combatLog", "clearLogButton"];
const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
const tooltipTitle = el.tooltip.querySelector(".hex-tooltip-title");
const tooltipContent = el.tooltip.querySelector(".hex-tooltip-content");
const entityImages = new Map();
let state = createBattleState();
let ui = { policy: "risky", hoveredAction: null, hoveredWeapon: null, routes: new Map(), selected: null, hovered: null, hoveredOption: null, optionTargets: [], tooltipHex: null, tooltipInside: false, tooltipTimer: null, animation: null, lastActiveUnit: null, geometry: { size: 38, cx: 0, cy: 0, dpr: 1 } };

function closePanels() {
  el.battleScreen.dataset.panel = "";
}

function renderPlanning() {
  const planning = state.lifecycle === "ActionPlanning" && !ui.animation;
  const presentation = planningControlsPresentation(state, ui, mobile());
  const controls = document.getElementById("planningControls");
  const preview = document.getElementById("planningPreview");
  const confirm = document.getElementById("confirmPlan");
  controls.hidden = !presentation.visible && !presentation.cancelOnly;
  controls.classList.toggle("cancel-only", presentation.cancelOnly);
  preview.hidden = presentation.cancelOnly;
  confirm.hidden = presentation.cancelOnly;
  const option = ui.selected?.headingOption;
  const maneuver = planning && state.activeAction?.type === "maneuver" && option ? maneuverPlanningPreview(state, activeUnit(state), option) : null;
  const actionPreview = planning && state.activeAction?.type !== "maneuver" ? actionPlanningPreview(state, activeUnit(state)) : null;
  if (maneuver) {
    const gauges = [["speed", "Скорость"], ["maneuver", "Манёвренность"]].filter(([name]) => name !== "maneuver" || Number.isFinite(activeUnit(state).maneuver)).map(([name, label]) => `<div class="planning-resource"><span>${label} <b>${resourceMetricsText(maneuver.resources[name], maneuver[name])}</b></span>${resourceSegments(maneuver.resources[name], maneuver[name], name)}</div>`).join("");
    preview.innerHTML = `<strong>Маршрут и курс</strong>${gauges}<span>Уклонение ${maneuver.evasion.current}% <b style="color:var(--${maneuver.evasionDelta >= 0 ? "green" : "red"})">${maneuver.evasionDelta >= 0 ? "+" : ""}${maneuver.evasionDelta} %</b></span>`;
  } else if (actionPreview) {
    const labels = { speed: "Скорость", maneuver: "Манёвренность", energy: "Энергия" };
    const gauges = actionPreview.gauges.map(({ name, resource, preview: change, cost }) => `<div class="planning-resource"><span>${labels[name]} <b>${resourceMetricsText(resource, change)}${cost ? ` · цена ${cost}` : ""}</b></span>${resourceSegments(resource, change, name)}</div>`).join("");
    const evasion = actionPreview.evasion ? `<span>Уклонение ${actionPreview.evasion.current}% <b style="color:var(--${actionPreview.evasionDelta >= 0 ? "green" : "red"})">${actionPreview.evasionDelta >= 0 ? "+" : ""}${actionPreview.evasionDelta} %</b></span>` : "";
    preview.innerHTML = `<strong>${actionPreview.title}</strong>${gauges}${evasion}${actionPreview.notes.map(note => `<small>${note}</small>`).join("")}`;
  } else preview.textContent = "Подтвердите действие";
  document.getElementById("confirmPlan").disabled = !planning || (actionPreview && !actionPreview.canConfirm) || (state.activeAction?.type === "maneuver" && !maneuver?.canConfirm) || (state.activeAction?.type === "weapon-attack" && (!ui.selected?.targetId || !previewWeaponAttack(state, activeUnit(state).id, pendingWeaponId(state), ui.selected.targetId).canConfirm));
}

function popup(position, values) {
  if (el.battleScreen.hidden || (mobile() && matchMedia("(orientation:portrait)").matches)) return;
  const point = axialToPixel(position);
  const nodes = values.map(value => {
    const node = document.createElement("span");
    node.className = `damage-popup ${value.layer}`;
    node.textContent = value.text;
    canvas.parentElement.append(node);
    return node;
  });
  const width = Math.max(...nodes.map(node => node.offsetWidth));
  const rowHeight = Math.max(18, ...nodes.map(node => node.offsetHeight)) + 3;
  const placement = impactPlacement(point, width, values.length * rowHeight, [...liveImpacts]);
  liveImpacts.add(placement);
  nodes.forEach((node, index) => {
    node.style.left = `${placement.left}px`;
    node.style.top = `${placement.top + index * rowHeight}px`;
  });
  setTimeout(() => { nodes.forEach(node => node.remove()); liveImpacts.delete(placement); }, 1400);
}

function collectTerrainDamage() {
  const events = state.events.slice(ui.damageCursor || 0);
  ui.damageCursor = state.events.length;
  for (const event of events) {
    if (event.action !== "damage" || String(event.cause).startsWith("weapon:")) continue;
    const id = event.subjectIds[0];
    const unit = unitById(state, id);
    const move = [...state.events].reverse().find(candidate => candidate.action === "maneuver-move" && candidate.actorId === id && candidate.eventOrder <= event.eventOrder);
    const position = event.position || move?.after.position || unit?.position;
    if (!position) continue;
    const unitHealth = event.unitHealth || unit?.unitHealth || ui.animation?.unitHealth;
    const before = { ...event.before, stack: unitHealth ? Math.ceil(event.before.integrity / unitHealth) : 0 };
    const after = { ...event.after, stack: unitHealth ? Math.ceil(event.after.integrity / unitHealth) : 0 };
    const item = { position, values: damageIndicators(before, after) };
    if (ui.animation?.kind === "movement") (ui.animation.damagePending ||= []).push(item);
    else popup(position, item.values);
  }
}

function flushTerrainDamage(animation) {
  collectTerrainDamage();
  for (const item of animation.damagePending || []) popup(item.position, item.values);
  animation.damagePending = [];
}

function applyVisualStep(plan, index, apply) {
  const step = plan.steps[index];
  const recipient = unitById(state, step.hitUnitId || plan.targetId);
  const before = recipient ? { ...recipient } : null;
  const result = apply(state, plan.domainPlan || plan, index);
  if (result.status === "applied") popup(before?.position || step.endpoint, damageIndicators(before, recipient, step.outcome === "miss" ? "miss" : "hit"));
  return result;
}

function addLog(message, tone = "neutral") {
  const journalOrder = state.journalSequence = (state.journalSequence ?? 0) + 1;
  state.log.unshift({ id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, journalOrder, round: state.roundNumber, message, tone });
  state.log = state.log.slice(0, 80);
  renderLog();
}

function resetBattle() {
  document.body.classList.remove("animating");
  closePanels();
  targetTap = null;
  canvas.parentElement.querySelectorAll(".damage-popup").forEach(node => node.remove());
  state = createBattleState();
  ui = { ...ui, hoveredAction: null, hoveredWeapon: null, routes: new Map(), selected: null, hovered: null, hoveredOption: null, optionTargets: [], tooltipHex: null, animation: null, logEventCursor: 0, damageCursor: 0 };
  state.activeUnitId = state.units.find(unit => unit.sideId === "azure")?.id || null;
  addLog("Расстановка: разместите и подтвердите левую сторону.", "system");
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
  return ui.selected?.headingOption || ui.hoveredOption || ui.selected?.baseOption || null;
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

function cancelActionSelection() {
  pinned = false;
  targetTap = null;
  closePanels();
  cancelPendingAction(state, ui);
  hideTooltip();
}

function chooseAction(action) {
  const selected = selectPendingAction(state, ui, action);
  if (selected) { pinned = false; targetTap = null; hideTooltip(); closePanels(); }
  return selected;
}

function bindActionPreview(element, action) {
  const show = () => { ui.hoveredAction = typeof action === "function" ? action() : action; renderResourceBar(); renderUnitSummary(); draw(); };
  const clear = () => { ui.hoveredAction = null; renderResourceBar(); renderUnitSummary(); draw(); };
  element.addEventListener("mouseenter", show);
  element.addEventListener("mouseleave", clear);
  element.addEventListener("focus", show);
  element.addEventListener("blur", clear);
}

function optionTarget(option) {
  const target = axialToPixel(option.finalState.hex);
  const heading = maneuverPreviewHeading(activeUnit(state), option);
  if (heading === undefined) return { x: target.x, y: target.y, radius: 17 * Math.min(1, ui.geometry.size / 38), option };
  const [dq, dr] = DIRECTIONS[heading];
  const neighbor = axialToPixel({ q: option.finalState.hex.q + dq, r: option.finalState.hex.r + dr });
  const rect = canvas.getBoundingClientRect();
  return { ...maneuverTargetPosition(target, neighbor, rect.width, rect.height), radius: 20 * Math.min(1, ui.geometry.size / 38), option };
}

function optionAtPoint(point) {
  const targets = ui.optionTargets.map(target => ({ target, distance: Math.hypot(point.x - target.x, point.y - target.y) })).filter(candidate => candidate.distance <= candidate.target.radius);
  targets.sort((a, b) => a.distance - b.distance);
  return targets[0]?.target.option || null;
}

function refreshRoutes() {
  const unit = activeUnit(state);
  const selected = pinned ? ui.selected : null;
  recalculateActionUi(state, ui, unit, planRoutes, ui.policy);
  if (selected && pendingWeaponId(state) && unitById(state, selected.targetId)) ui.selected = selected;
  else pinned = false;
  hideTooltip();
}

function refresh() {
  refreshRoutes();
  renderAll();
}

function renderAll() {
  if (ui.panelUnit !== state.activeUnitId) { closePanels(); ui.panelUnit = state.activeUnitId; }
  renderPlanning();
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
  el.roundNumber.textContent = `${state.roundNumber}${mobile() && unit ? ` · ${unit.sideId === "azure" ? "Л" : "П"}` : ""}`;
  el.modeLabel.textContent = deploying ? `РАССТАНОВКА · ${state.lifecycle === "DeploymentLeft" ? "ЛЕВАЯ СТОРОНА" : "ПРАВАЯ СТОРОНА"}` : finished ? "БОЙ ЗАВЕРШЁН" : ui.animation ? "ВЫПОЛНЕНИЕ МАНЁВРА" : state.lifecycle === "ActionChoice" ? "ВЫБОР ДЕЙСТВИЯ" : state.activeAction?.type === "weapon-attack" ? "АТАКА ОРУЖИЕМ" : state.activeAction?.type === "system-action" ? "СИСТЕМНОЕ ДЕЙСТВИЕ" : state.activeAction?.type === "maneuver" ? "ПЛАНИРОВАНИЕ МАНЁВРА" : "АКТИВАЦИЯ";
  document.getElementById("mobileRoundNumber").textContent = `РАУНД ${el.roundNumber.textContent}`;
  document.getElementById("mobileModeLabel").textContent = el.modeLabel.textContent;
  el.confirmDeploymentButton.hidden = !deploying;
  el.confirmDeploymentButton.disabled = Boolean(ui.animation);
  el.waitButton.hidden = deploying || finished || !unit?.canWait || unit.hasWaited || !["ActionChoice", "ActionPlanning"].includes(state.lifecycle);
  el.endActivationButton.hidden = deploying || finished;
  const endAvailability = actionAvailability(state, { type: "end-activation" });
  const endReason = endAvailability.reasons.map(reason => reason.message).join(" · ");
  el.endActivationButton.innerHTML = `<span class="action-icon">■</span><span class="action-tooltip"><b>Завершить активацию</b><small>${endReason || "Завершить текущую активацию."}</small></span>`;
  el.turnPlaceholders.innerHTML = finished ? placeholderSlots(2) : "";
  el.actionPlaceholders.innerHTML = unit && !finished ? "" : placeholderSlots(2);
  el.routePolicyButton.hidden = !unit || finished;
  el.evasionButton.hidden = !unit || finished || !systemActionVisible(unit, evasionActionId());
  el.disengageButton.hidden = !unit || finished || unit.kind !== "squadron" || !unit.engagedWith?.length;
  el.engineBoostButton.hidden = !unit || finished || !systemActionVisible(unit, boostActionId());
  el.routePolicyButton.setAttribute("aria-label", state.lifecycle === "ActionChoice" ? "Совершить манёвр" : "Настроить маршрут манёвра");
  if (!unit) return;
  const isSquadron = unit.kind === "squadron";
  el.waitButton.disabled = Boolean(ui.animation);
  el.endActivationButton.disabled = Boolean(ui.animation) || !endAvailability.available || !["ActionChoice", "ActionPlanning"].includes(state.lifecycle);
  const maneuver = maneuverActionPresentation(state, unit);
  const evasive = systemActionPresentation(state, unit, evasionActionId());
  const disengage = disengageActionPresentation(state, unit);
  const engineBoost = systemActionPresentation(state, unit, boostActionId());
  const maneuverTile = actionTilePresentation({ selected: maneuver.selected, confirmation: "field", icon: ui.policy === "safe" ? "⬡" : "⚠" });
  const evasiveTile = actionTilePresentation({ selected: evasive.selected, confirmation: "tile", icon: isSquadron ? "✣" : "◇", resolved: unit.evasiveManeuver || unit.dispersionActive, cooldownRemaining: evasive.cooldownRemaining });
  const disengageTile = actionTilePresentation({ selected: disengage.selected, confirmation: "tile", icon: "↝" });
  const engineBoostTile = actionTilePresentation({ selected: engineBoost.selected, confirmation: "tile", icon: "»", resolved: unit.engineBoostActive, cooldownRemaining: engineBoost.cooldownRemaining });
  el.routePolicyIcon.textContent = maneuverTile.icon;
  el.routePolicyButton.className = `action-slot ${maneuverTile.className}`.trim();
  el.routePolicyButton.setAttribute("aria-pressed", maneuverTile.ariaPressed);
  const maneuverReason = maneuver.reasons?.join(" · ");
  el.routePolicyTooltip.innerHTML = maneuverReason ? `<b>Совершить манёвр</b><small>${maneuverReason}</small>` : maneuver.selected ? (ui.policy === "safe" ? "<b>Безопасный маршрут</b><small>Выберите конечный гекс. Другая плитка или клик вне маршрута переключит/отменит выбор.</small>" : "<b>Рискованный маршрут</b><small>Выберите конечный гекс. Другая плитка или клик вне маршрута переключит/отменит выбор.</small>") : "<b>Совершить манёвр</b><small>Выберите действие, затем конечный гекс маршрута. Фиксированная цена появится после выбора маршрута.</small>";
  el.evasionIcon.textContent = evasiveTile.icon;
  el.evasionTooltip.innerHTML = isSquadron ? `<b>Рассеивание</b><small>${DISPERSION_DESCRIPTION}${evasive.reasons?.length ? `<br>${evasive.reasons.join(" · ")}` : evasive.selected ? "<br>Нажмите ещё раз для подтверждения." : ""}</small>` : evasive.reasons?.length ? `<b>Манёвр уклонения</b><small>${evasive.reasons.join(" · ")}</small>` : evasive.selected ? "<b>Манёвр уклонения</b><small>Нажмите ещё раз, чтобы подтвердить. Другая плитка переключит выбор; клик вне действий или Esc отменит.</small>" : "<b>Манёвр уклонения</b><small>1 очко манёвренности · бонус движения ×1.5</small>";
  el.disengageIcon.textContent = disengageTile.icon;
  const linkedNames = disengage.preview?.linkedNames?.join(", ") || "нет";
  el.disengageTooltip.innerHTML = disengage.reasons?.length ? `<b>Отрыв</b><small>${disengage.reasons.join(" · ")} · текущие связи: ${linkedNames}</small>` : disengage.selected ? `<b>Отрыв</b><small>Подтвердить: ${disengage.preview.chance}% · Скорость ${disengage.preview.speedCost} · связи: ${linkedNames} · Уклонение −10 независимо от результата.</small>` : `<b>Отрыв</b><small>${disengage.preview?.chance}% · Скорость ${disengage.preview?.speedCost} · связи: ${linkedNames}.</small>`;
  el.engineBoostButton.querySelector(".action-icon").textContent = engineBoostTile.icon;
  el.engineBoostTooltip.innerHTML = engineBoost.reasons?.length ? `<b>Форсаж двигателя</b><small>${engineBoost.reasons.join(" · ")}</small>` : engineBoost.selected ? "<b>Форсаж двигателя</b><small>Нажмите ещё раз, чтобы подтвердить. Другая плитка переключит выбор; клик вне действий или Esc отменит.</small>" : `<b>Форсаж двигателя</b><small>${isSquadron ? "Без энергии · Перезарядка 1 раунд" : "1 энергия"} · Скорость +1 до конца активации</small>`;
  el.routePolicyButton.disabled = Boolean(ui.animation) || !(maneuver.canSelect || maneuver.selected);
  el.evasionButton.disabled = Boolean(ui.animation) || !(evasive.canSelect || evasive.canConfirm);
  el.disengageButton.disabled = Boolean(ui.animation) || !(disengage.canSelect || disengage.canConfirm);
  el.engineBoostButton.disabled = Boolean(ui.animation) || !(engineBoost.canSelect || engineBoost.canConfirm);
  el.evasionButton.className = `action-slot ${evasiveTile.className}`.trim();
  el.disengageButton.className = `action-slot ${disengageTile.className}`.trim();
  el.engineBoostButton.className = `action-slot ${engineBoostTile.className}`.trim();
  el.evasionButton.setAttribute("aria-pressed", evasiveTile.ariaPressed);
  el.disengageButton.setAttribute("aria-pressed", disengageTile.ariaPressed);
  el.engineBoostButton.setAttribute("aria-pressed", engineBoostTile.ariaPressed);
}

function renderInitiative() {
  if (!state.initiativeOrder.length) {
    el.initiativeList.innerHTML = `<div class="deployment-note"><strong>Расстановка ${state.lifecycle === "DeploymentLeft" ? "левой" : "правой"} стороны</strong><span>Выберите корабль, затем свободный гекс.</span></div>`;
    return;
  }
  el.initiativeList.innerHTML = state.initiativeOrder.map(id => {
    const unit = unitById(state, id);
    if (!unit) return "";
    const model = unit.kind === "capital" ? unit.hullClassName : unit.craftType === "interceptor" ? `Перехватчик · ${unit.squadronModelName}` : unit.squadronModelName;
    const waitMark = unit.hasWaited && !unit.hasActivated ? '<span class="queue-state" aria-label="Ожидает">◷</span>' : "";
    return `<article data-unit-id="${id}" tabindex="0" role="button" aria-label="${unit.name}" class="ship-card ${id === state.activeUnitId ? "active" : ""} ${unit.hasActivated ? "done" : ""}" style="--ship-color:${unit.color}"><span class="mini-ship">${iconMarkup(unit.glyph, unit.color, unit.name, unit.stack)}</span><span class="ship-info"><strong>${unit.name}</strong><small>${model} · INI ${unit.initiative}</small></span>${waitMark}</article>`;
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
  const effects = interceptionEffectRows(state, unit);
  if (unit.dispersionActive) effects.push({ tone: "positive", icon: "✣", name: "Рассеивание", text: "Уклонение +15 п.п. · точность всех атак −15 п.п.", duration: "До начала следующей собственной активации", description: DISPERSION_DESCRIPTION });
  if (unit.evasiveManeuver) effects.push({ tone: "positive", icon: "◇", name: "Манёвр уклонения", text: "Бонус уклонения усилен", duration: "До конца активации" });
  return effects;
}

function unitModel(unit) {
  return unit.kind === "capital" ? unit.hullClassName : unit.craftType === "interceptor" ? `Перехватчик · ${unit.squadronModelName}` : unit.squadronModelName;
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

function resourceSegments(resource, preview = {}, tone = "cyan") {
  const presentation = segmentedResourcePresentation(resource, preview);
  return `<div class="resource-segments ${tone}">${presentation.segments.map(className => `<i class="${className}"></i>`).join("")}</div>`;
}

function renderUnitSummary() {
  const liveUnit = currentUnit();
  if (liveUnit) ui.lastActiveUnit = liveUnit;
  const unit = liveUnit || (state.winner ? ui.lastActiveUnit : null);
  if (!unit) {
    el.unitSummary.innerHTML = '<div class="inspector-empty"><span>◇</span><b>Ожидание начала боя</b><small>Параметры появятся после определения активного юнита.</small></div>';
    return;
  }
  const model = unit.kind === "capital" ? unit.hullClassName : unit.craftType === "interceptor" ? `Перехватчик · ${unit.squadronModelName}` : unit.squadronModelName;
  const previewSelection = ui.selected ? { ...ui.selected, previewOption: selectedOption() } : null;
  const routeOption = previewSelection?.previewOption || previewSelection?.option || null;
  const routeAvailability = state.activeAction?.type === "maneuver" && routeOption ? actionAvailability(state, { type: "maneuver", option: routeOption }) : null;
  const routeResources = routeAvailability ? { speedPreview: routeAvailability.forecast.cost.speed, maneuverPreview: routeAvailability.forecast.cost.maneuver } : maneuverResourcePreview(unit, null, signedTurn);
  const fixedPreview = actionResourcePreview(state, unit, ui.hoveredAction);
  const speedSpendPreview = Math.max(routeResources.speedPreview, fixedPreview.speed || 0);
  const maneuverSpendPreview = Math.max(routeResources.maneuverPreview, fixedPreview.maneuver || 0);
  const routePreview = !(state.activeAction?.type === "weapon-attack" && state.lifecycle === "ActionPlanning") ? selectedRoute() : null;
  const { current: evasion, preview: previewEvasion } = evasionPresentation(unit, routePreview ? { route: routePreview } : null, state, ui.hoveredAction);
  const evasionBonus = previewEvasion - evasion;
  const resources = resourcePresentation(unit);
  const speedPreview = { spend: speedSpendPreview, capacity: fixedPreview.speedCapacity };
  const maneuverPreview = { spend: maneuverSpendPreview, capacity: fixedPreview.maneuverCapacity };
  const speedState = `<div class="resource-state"><span>Скорость <b>${resourceMetricsText(resources.speed, speedPreview)}</b></span>${resourceSegments(resources.speed, speedPreview, "speed")}</div>`;
  const maneuverState = unit.maneuver !== undefined ? `<div class="resource-state"><span>Манёвренность <b>${resourceMetricsText(resources.maneuver, maneuverPreview)}</b></span>${resourceSegments(resources.maneuver, maneuverPreview, "maneuver")}</div>` : "";
  const evasionPreview = evasionBonus > 0 ? `<em>+${evasionBonus}%</em>` : evasionBonus < 0 ? `<i>${evasionBonus}%</i>` : "";
  el.unitSummary.innerHTML = `<div class="unit-identity"><div class="unit-portrait" style="color:${unit.color}">${iconMarkup(unit.glyph, unit.color, unit.name, unit.stack)}</div><div class="unit-identity-copy"><span class="active-label">${state.winner ? "Последний активный юнит" : "Активный юнит"}</span><strong>${unit.name}</strong><small>${model}</small>${unit.kind === "capital" ? `<small>Требуется экипажа ${unit.crewRequirement}</small>` : ""}</div><span class="class-badge" style="color:${unit.color}">${unit.kind === "capital" ? "CAPITAL" : "SQUADRON"}</span></div><section class="inspector-section current-state"><div class="section-title"><span>Текущее состояние</span></div><div class="unit-vitals">${healthBar("Щит", unit.shield, unit.maxShield, "shield")}${healthBar("Броня", unit.armor, unit.maxArmor, "armor")}${healthBar("Целостность", unit.integrity, unit.maxIntegrity, "integrity")}</div>${speedState}${maneuverState}<div class="evasion-state"><span>Уклонение</span><b>${evasion}% ${evasionPreview}</b></div></section><section class="inspector-section status-section"><div class="section-title"><span>Критические повреждения</span><small>${unit.criticals.length}</small></div>${statusList(unit.criticals.map(item => ({ ...item, tone: "negative", icon: "!", name: item.type })), "critical", "Критических повреждений нет")}</section><section class="inspector-section status-section"><div class="section-title"><span>Активные эффекты</span><small>${effectRows(unit).length}</small></div>${statusList(effectRows(unit), "effect", "Активных эффектов нет")}</section>${state.winner ? '<div class="battle-finished">Бой завершён</div>' : ""}`;
}

const deliveryNames = { beam: "луч", projectile: "снаряд", missile: "ракета", torpedo: "торпеда" };

function effectiveShots(unit, weapon) {
  return unit.kind === "squadron" ? weapon.shots * unit.stack : weapon.shots;
}

function weaponAvailability(unit, weapon) {
  const attacking = state.activeAction?.type === "weapon-attack" && state.lifecycle === "ActionPlanning";
  const availability = actionAvailability(state, { type: "weapon-attack", slotId: weapon.id }, unit);
  const reason = availability.reasons[0]?.message;
  const cooldown = availability.readiness?.state === "cooldown";
  const insufficientEnergy = availability.reasons.some(candidate => candidate.code === "resource.insufficient" && candidate.params.resource === "energy" || candidate.code === "resource.unavailable");
  const unavailable = Boolean(ui.animation) || !availability.available;
  const selected = state.activeAction?.type === "weapon-attack" && state.activeAction.slotId === weapon.id;
  const status = reason || (selected ? "Выбрано · выберите цель; другая плитка переключит, повторный клик отменит" : attacking ? "Переключить планирование на это оружие" : "Начать планирование атаки");
  return { unavailable, cooldown, insufficientEnergy, status, availability };
}

function renderWeaponSummary() {
  const unit = interactiveUnit();
  if (!unit) {
    el.attackWeaponActions.innerHTML = placeholderSlots(3);
    return;
  }
  el.attackWeaponActions.innerHTML = unit.weapons.map(weapon => {
    const availability = weaponAvailability(unit, weapon);
    const selection = weaponSelectionPresentation(state, weapon.id);
    const overwatch = overwatchAvailability(unit, weapon);
    const aa = weapon.targetKinds.includes("squadron") ? ` · ПВО · ${overwatch.readiness.active ? "Наблюдение" : overwatch.readiness.eligible && overwatch.readiness.ready ? "сохранится при завершении" : overwatch.readiness.reason}` : "";
    const icon = availability.cooldown ? weapon.cooldownRemaining : weapon.visual.projectile === "beam" ? "━" : weapon.visual.projectile === "torpedo" ? "◆" : weapon.visual.projectile === "missile" ? "➤" : "•";
    const tile = actionTilePresentation({ selected: selection.selected, confirmation: "field", icon });
    const energyIcon = availability.insufficientEnergy ? '<span class="energy-warning" aria-hidden="true">ϟ</span>' : "";
    return `<span class="action-slot-shell ${availability.unavailable ? "disabled" : ""}" data-weapon-id="${weapon.id}" tabindex="0"><button type="button" class="action-slot weapon-action ${tile.className} ${availability.cooldown ? "cooldown" : ""} ${overwatch.readiness.active ? "overwatch" : ""}" aria-label="${weapon.name}" aria-pressed="${tile.ariaPressed}" ${availability.unavailable ? "disabled" : ""}><span class="action-icon">${tile.icon}</span>${overwatch.readiness.active ? '<span class="overwatch-indicator">Н</span>' : ""}${energyIcon}</button><span class="action-tooltip"><b>${weapon.name}</b><small>${deliveryNames[weapon.delivery]} · ${weapon.weaponClass} · ${weapon.mount}${aa}<br>${weapon.accuracy}% точность · ${effectiveShots(unit, weapon)}×${weapon.damage} урон<br>${weapon.effectiveRange}/${weapon.maxRange} гекс. · крит ${weapon.critChance}%${weapon.energyCost ? `<br>${weapon.energyCost} энергии` : ""}${weapon.cooldownRounds && !availability.cooldown ? `<br>${cooldownLabel(weapon.cooldownRounds)}` : ""}<br>${availability.status}</small></span></span>`;
  }).join("");
  el.attackWeaponActions.querySelectorAll("[data-weapon-id]").forEach(slot => {
    const showPreview = () => {
      ui.hoveredWeapon = slot.dataset.weaponId;
      ui.hoveredAction = { type: "weapon-attack", slotId: slot.dataset.weaponId };
      const tooltip = slot.querySelector(".action-tooltip");
      const rect = slot.getBoundingClientRect();
      tooltip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 198))}px`;
      renderResourceBar();
      renderUnitSummary();
      draw();
    };
    const clearPreview = () => { ui.hoveredWeapon = null; ui.hoveredAction = null; renderResourceBar(); renderUnitSummary(); draw(); };
    slot.addEventListener("mouseenter", showPreview);
    slot.addEventListener("mouseleave", clearPreview);
    slot.addEventListener("focus", showPreview);
    slot.addEventListener("blur", clearPreview);
    slot.querySelector("button").addEventListener("click", () => {
      const weaponId = slot.dataset.weaponId;
      const cancelSelected = pendingWeaponId(state) === weaponId;
      if (cancelSelected) cancelActionSelection();
      else chooseAction({ type: "weapon-attack", reason: "player-choice", slotId: weaponId });
      refresh();
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
  const energy = resourcePresentation(unit).energy;
  const fixedPreview = actionResourcePreview(state, unit, ui.hoveredAction);
  const preview = Math.min(energy.remaining, fixedPreview.energy);
  const energyPreview = { spend: preview };
  el.energyResource.innerHTML = `<span class="energy-label"><b>${unit.name}</b><span>Энергия<span class="energy-details"> · ${resourceMetricsText(energy, energyPreview)}</span></span></span><div role="img" aria-label="Энергия: ${resourceMetricsText(energy, energyPreview)}">${resourceSegments(energy, energyPreview, "energy")}</div>`;
}

function renderLog() {
  collectTerrainDamage();
  const entries = buildBattleLog(state, ui.logEventCursor || 0);
  el.combatLog.innerHTML = entries.map(entry => `<li class="${entry.tone}"><time>R${entry.round}</time><span>${entry.message}</span></li>`).join("") || '<li class="empty-log">Журнал пуст</li>';
}

function imageFor(type, color, stack) {
  const displayCount = VISUALS[type].formationOffsets ? Math.max(1, stack ?? 3) : "static";
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
  if (ui.selected && !(state.activeAction?.type === "weapon-attack" && state.lifecycle === "ActionPlanning") && !ui.animation) {
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
    const muted = Boolean(selectedRoute() && !(state.activeAction?.type === "weapon-attack" && state.lifecycle === "ActionPlanning"));
    fill = muted ? "rgba(101,244,178,.018)" : "rgba(101,244,178,.052)";
    stroke = muted ? "rgba(101,244,178,.10)" : "rgba(101,244,178,.28)";
  }
  const deploying = state.lifecycle === "DeploymentLeft" || state.lifecycle === "DeploymentRight";
  if (deploying && deploymentZone(state, state.lifecycle === "DeploymentLeft" ? "azure" : "crimson").some(cell => key(cell.q, cell.r) === key(position.q, position.r))) { fill = "rgba(101,244,178,.16)"; stroke = "rgba(101,244,178,.85)"; }
  const selectedWeaponId = pendingWeaponId(state);
  if (selectedWeaponId) {
    const selectedArc = weaponAttackArc(state, activeUnit(state).id, selectedWeaponId);
    if (selectedArc.has(key(position.q, position.r))) {
      fill = "rgba(255,102,125,.18)";
      stroke = "rgba(255,102,125,.82)";
      width = 1.5;
    }
  }
  const hoveredArc = ui.hoveredWeapon ? weaponAttackArc(state, activeUnit(state).id, ui.hoveredWeapon) : null;
  if (hoveredArc?.has(key(position.q, position.r))) {
    stroke = "#ffb0bb";
    width = 3;
  }
  if (contents.some(content => content.kind !== "object")) { fill = "rgba(244,200,97,.10)"; stroke = "rgba(244,200,97,.45)"; }
  if (contents.some(content => content.kind === "object") || (occupant && shouldHighlightOccupiedHex(state.lifecycle))) { fill = "rgba(255,102,125,.09)"; stroke = "rgba(255,102,125,.42)"; }
  const event = selectedEventAt(position);
  const zoneCommands = maneuverZoneRenderCommands({ plannedRoutes: ui.routes, selectedRoute: selectedRoute(), position, event });
  if (event?.hazards.length) { fill = "rgba(244,200,97,.20)"; stroke = "rgba(244,200,97,.82)"; width = 2; }
  if (zoneCommands.base) {
    fill = zoneCommands.base.fillStyle ?? fill;
    stroke = zoneCommands.base.strokeStyle;
    width = zoneCommands.base.lineWidth;
  }
  if (ui.hovered && key(ui.hovered.q, ui.hovered.r) === key(position.q, position.r)) {
    if (route && selectedRoute()) fill = "rgba(101,244,178,.032)";
    stroke = route ? "#65f4b2" : "#8aa0b6"; width = 2;
  }
   if (selectedWeaponId && availableWeaponAttackTargets(state, activeUnit(state).id, selectedWeaponId).some(target => key(target.position.q, target.position.r) === key(position.q, position.r))) { fill = "rgba(255,102,125,.14)"; stroke = "#ff667d"; width = 2; }
  if (ui.selected?.position && key(ui.selected.position.q, ui.selected.position.r) === key(position.q, position.r)) { fill = "rgba(102,228,255,.14)"; stroke = "#66e4ff"; width = 2.5; }

  ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = width;
  ctx.setLineDash(zoneCommands.base?.lineDash || []);
  ctx.stroke(); ctx.setLineDash([]);
  if (event?.hazards.length) { hexPath(x, y, ui.geometry.size - 8); ctx.strokeStyle = "#f4c861"; ctx.lineWidth = 2; ctx.stroke(); }
  for (const outline of zoneCommands.outlines) {
    hexPath(x, y, ui.geometry.size - outline.inset);
    ctx.strokeStyle = outline.strokeStyle;
    ctx.lineWidth = outline.lineWidth;
    ctx.setLineDash(outline.lineDash);
    ctx.stroke();
    ctx.setLineDash([]);
  }
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
  const size = VISUALS[glyph].size * Math.min(1, ui.geometry.size / 38);
  if (image.complete) ctx.drawImage(image, -size / 2, -size / 2, size, size); else image.onload = draw;
  ctx.restore();
  if (shouldOutlineUnit(entity.id, state.activeUnitId, ui.selected?.deploymentUnitId, state.lifecycle)) { ctx.strokeStyle = color; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(x, y, 25 * Math.min(1, ui.geometry.size / 38), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
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
  const interceptions = (route.interceptions || []).map(id => unitById(state, id)).filter(Boolean);
  const interceptors = key(position.q, position.r) === key(route.position.q, route.position.r) ? interceptions : [];
  return hazards.length || interceptors.length ? { hazards, interceptors } : null;
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
  const size = VISUALS[unit.glyph].size * Math.min(1, ui.geometry.size / 38);
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
    const active = (ui.selected?.headingOption || ui.hoveredOption)?.optionId === target.option.optionId;
    ctx.save();
    ctx.translate(target.x, target.y);
    ctx.scale(Math.min(1, ui.geometry.size / 38), Math.min(1, ui.geometry.size / 38));
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
  const size = animation.size * Math.min(1, ui.geometry.size / 38);
  if (image.complete) ctx.drawImage(image, -size / 2, -size / 2, size, size);
  ctx.restore();
}

function resizeCanvas() {
  renderPlanning();
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  ui.geometry = battlefieldGeometry(rect.width, rect.height, dpr);
  if (pinned && ui.selected?.position) positionTooltip({});
  if (mobile() && matchMedia("(orientation:portrait)").matches) canvas.parentElement.querySelectorAll(".damage-popup").forEach(node => node.remove());
  draw();
}

function startMovement(option = selectedOption()) {
  if (!ui.selected || !option || ui.animation) return;
  const unit = activeUnit(state);
  const plan = confirmManeuverAction(state, option);
  if (!plan) { refresh(); return; }
  ui.animation = { kind: "movement", unitId: unit.id, unitName: unit.name, sideId: unit.sideId, glyph: unit.glyph, color: unit.color, stack: unit.stack, unitHealth: unit.unitHealth, size: VISUALS[unit.glyph].size, plan, nextElement: 0 };
  document.body.classList.add("animating");
  closePanels();
  hideTooltip();
  renderPlanning();
  renderHeader();
  executeNextManeuverElement();
}

function movementEffects() {
  return {
    resolvePostEntry({ state: current, unit, plan, elementIndex, causeEventId }) {
      const reactionPlan = planPostEntryAA(current, unit, { ...plan.actionContext, planId: plan.id, elementIndex, causeEventId });
      return reactionPlan ? { pending: true, plan: reactionPlan } : [];
    }
  };
}

function executeNextManeuverElement() {
  const animation = ui.animation;
  if (!animation || animation.kind !== "movement") return;
  const segment = planMovementAnimationSegment(animation.plan, animation.nextElement, elementIndex => executeManeuverElement(state, animation.plan, elementIndex, movementEffects()));
  const result = segment.result;
  if (result.status === "invalid") { finishMovement(result); return; }
  if (segment.transitions.length) {
    animation.segment = segment;
    animation.started = performance.now();
    animation.x = axialToPixel(segment.transitions[0].before.position).x;
    animation.y = axialToPixel(segment.transitions[0].before.position).y;
    animation.heading = segment.transitions[0].before.heading ?? segment.transitions[0].after.heading ?? 0;
    animation.result = result;
    requestAnimationFrame(animate);
    return;
  }
  finishMovement(result);
}

function animate(now) {
  const animation = ui.animation;
  if (!animation?.segment) return;
  const segment = animation.segment;
  const turnOnly = segment.transitions.length === 1 && segment.transitions[0].type !== "move";
  const duration = turnOnly ? 280 : 320 * segment.transitions.length;
  const progress = Math.min(1, Math.max(0, (now - animation.started) / duration));
  const sample = sampleMovementAnimationSegment(segment, turnOnly ? 1 - Math.pow(1 - progress, 3) : progress);
  const transition = sample.transition;
  const start = axialToPixel(transition.before.position);
  const end = axialToPixel(transition.after.position);
  animation.x = start.x + (end.x - start.x) * sample.progress;
  animation.y = start.y + (end.y - start.y) * sample.progress;
  const fromHeading = transition.before.heading ?? animation.heading;
  const toHeading = transition.after.heading ?? fromHeading;
  animation.heading = fromHeading + signedTurn(fromHeading, toHeading) * sample.progress;
  draw();
  if (progress < 1) { requestAnimationFrame(animate); return; }
  flushTerrainDamage(animation);
  const result = animation.result;
  animation.segment = null;
  const continuation = movementAnimationContinuation(result);
  if (continuation === "reaction") { startReactionAnimation(result.reactionPlan); return; }
  animation.nextElement += segment.elementCount;
  if (continuation === "next") executeNextManeuverElement();
  else finishMovement(result);
}

function startReactionAnimation(plan) {
  const movement = ui.animation;
  if (!movement || movement.kind !== "movement" || !plan) { finishMovement({ status: "invalid" }); return; }
  movement.reaction = { plan: visualShotSchedule(plan), from: { ...unitById(state, plan.attackerId).position }, stepIndex: 0, started: performance.now() };
  requestAnimationFrame(animateReaction);
}

function finishReactionAnimation(movement, reaction) {
  movement.reaction = null;
  const effects = unitById(state, movement.unitId) ? movementEffects() : {};
  const resumed = resumeManeuverPostEntry(state, movement.plan, effects);
  const continuation = reactionAnimationContinuation(resumed);
  if (continuation === "reaction") { startReactionAnimation(resumed.reactionPlan); return; }
  if (continuation === "next") {
    movement.nextElement = resumed.executedElements;
    executeNextManeuverElement();
  } else finishMovement(resumed.status === "invalid" ? reaction.terminalResult : resumed);
}

function animateReaction(now) {
  const movement = ui.animation;
  const reaction = movement?.reaction;
  if (!movement || movement.kind !== "movement" || !reaction) return;
  const previous = ui.animation;
  ui.animation = { kind: "attack", ...reaction };
  draw();
  ui.animation = previous;
  const elapsed = now - reaction.started;
  while (!reaction.terminalResult && reaction.stepIndex < reaction.plan.steps.length && elapsed >= reaction.plan.steps[reaction.stepIndex].arrivalTime) {
    const result = applyVisualStep(reaction.plan, reaction.stepIndex, applyReactionStep);
    reaction.stepIndex++;
    renderUnitSummary();
    renderLog();
    if (result.status !== "applied" || !unitById(state, movement.unitId)) reaction.terminalResult = result;
  }
  if (elapsed < reaction.plan.duration + 160 && (reaction.stepIndex < reaction.plan.steps.length || reaction.terminalResult || reaction.stepIndex === reaction.plan.steps.length)) { requestAnimationFrame(animateReaction); return; }
  finishReactionAnimation(movement, reaction);
}

function finishMovement(result) {
  const animation = ui.animation;
  if (!animation) return;
  flushTerrainDamage(animation);
  const unit = unitById(state, animation.unitId);
  ui.animation = null; ui.selected = null; document.body.classList.remove("animating");
  if (result?.status === "destroyed" || !unit) { refresh(); return; }
  refresh();
}

function selectHex(position, targetId = null) {
  if (state.lifecycle === "DeploymentLeft" || state.lifecycle === "DeploymentRight") {
    const side = state.lifecycle === "DeploymentLeft" ? "azure" : "crimson";
    const occupant = unitAt(state, position);
    if (occupant?.sideId === side) { ui.selected = { deploymentUnitId: occupant.id }; renderAll(); return; }
    const selected = unitById(state, ui.selected?.deploymentUnitId);
    if (selected && !occupant && deployUnit(state, selected.id, position, selected.heading)) refresh();
    return;
  }
  if (state.activeAction?.type === "weapon-attack" && state.lifecycle === "ActionPlanning") {
    const attacker = activeUnit(state);
    const eligible = state.units.filter(unit => key(unit.position.q, unit.position.r) === key(position.q, position.r) && unit.sideId !== attacker.sideId);
    if (!targetId && eligible.length > 1) {
      const dialog = document.createElement("dialog");
      for (const unit of eligible) {
        const button = document.createElement("button");
        button.className = "button"; button.textContent = unit.name;
        button.onclick = () => { dialog.close(); selectHex(position, unit.id); showHexTooltip(position, {}); };
        dialog.append(button);
      }
      document.body.append(dialog); dialog.addEventListener("close", () => dialog.remove()); dialog.showModal(); return;
    }
    const target = targetId ? unitById(state, targetId) : eligible[0];
    if (!canSelectWeaponAttackTarget(attacker, target, pendingWeaponId(state))) return;
    const now = performance.now();
    if (mobile() && previewWeaponAttack(state, attacker.id, pendingWeaponId(state), target.id).canConfirm && repeatedTargetTap(targetTap, target.id, now)) { confirmAttack(); return; }
    targetTap = { targetId: target.id, time: now };
    ui.selected = { position, targetId: target.id };
    pinned = true;
    renderPlanning();
    draw();
    return;
  }
  const routes = ui.routes.matching?.(position) || [];
  if (!routes.length) return;
  if (ui.selected?.position && key(ui.selected.position.q, ui.selected.position.r) === key(position.q, position.r)) {
    return;
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
  if (pinned && state.lifecycle === "ActionPlanning") return;
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
  if (pinned && ui.selected?.position) {
    const bounds = canvas.getBoundingClientRect();
    const layout = adjacentTooltip(axialToPixel(ui.selected.position), ui.geometry.size, bounds, mobile() ? 220 : 280, Math.min(el.tooltip.offsetHeight, bounds.height - 16));
    el.tooltip.style.width = `${layout.width}px`;
    const measured = adjacentTooltip(axialToPixel(ui.selected.position), ui.geometry.size, bounds, mobile() ? 220 : 280, el.tooltip.offsetHeight);
    el.tooltip.style.left = `${measured.left}px`;
    el.tooltip.style.top = `${measured.top}px`;
    return;
  }
  el.tooltip.style.width = "";
  const wrap = canvas.parentElement.getBoundingClientRect();
  const width = el.tooltip.offsetWidth || 240;
  const height = el.tooltip.offsetHeight || 140;
  const localX = event.clientX - wrap.left;
  const localY = event.clientY - wrap.top;
  const left = localX + width + 24 <= wrap.width ? localX + 14 : localX - width - 14;
  const top = localY + height + 18 <= wrap.height ? localY + 14 : localY - height - 14;
  el.tooltip.style.left = `${Math.max(8, Math.min(left, wrap.width - width - 8))}px`;
  el.tooltip.style.top = `${Math.max(mobile() ? 8 : 44, Math.min(top, wrap.height - height - 8))}px`;
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
  if (!hazards.length && !event?.interceptors.length) return null;
  const hazardRows = hazards.map((hazard, index) => `<article class="tooltip-event hazard"><b>${hazard.sourceName}</b><span>${event?.hazards.length ? `Прохождение ${index + 1} · ${Math.round(hazard.probability * 100)}% · ${hazard.min}–${hazard.max} · ${hazard.effect}` : `${hazard.effect}`}</span></article>`).join("");
  const interceptionRows = (event?.interceptors || []).map(interceptor => `<article class="tooltip-event interception"><b>ПЕРЕХВАТ</b><span>${interceptor.name} · эскадрилья связывает юнит боем после манёвра</span></article>`).join("");
  return { title: hazards.length && event?.interceptors.length ? "ЭФФЕКТЫ ГЕКСА" : event?.interceptors.length ? "ПЕРЕХВАТ" : "ОПАСНОСТЬ", content: `${hazardRows}${interceptionRows}` };
}

function unitTooltip(occupant, preview = null) {
  const { current: evasion } = evasionPresentation(occupant);
  const vitals = `<div class="tooltip-vitals">${healthBar("Щит", occupant.shield, occupant.maxShield, "shield", preview?.potentialDamageByLayer.shield || 0)}${healthBar("Броня", occupant.armor, occupant.maxArmor, "armor", preview?.potentialDamageByLayer.armor || 0)}${healthBar("Целостность", occupant.integrity, occupant.maxIntegrity, "integrity", preview?.potentialDamageByLayer.integrity || 0)}</div>`;
  return { title: occupant.name, content: `<span class="tooltip-model">${unitModel(occupant)}</span>${vitals}Уклонение ${evasion}%${tooltipStatuses(occupant)}` };
}

function attackTooltip(occupant) {
  const selectedWeaponId = pendingWeaponId(state);
  if (!selectedWeaponId) return unitTooltip(occupant);
  const preview = previewWeaponAttack(state, activeUnit(state).id, selectedWeaponId, occupant.id);
  const base = unitTooltip(occupant, preview);
  const modifiers = [...(preview.cover ? [`Укрытие ${preview.cover}%`] : []), ...(preview.endpointCover ? [`Местность ${preview.endpointCover}%`] : []), ...(occupant.dispersionActive ? ["Рассеивание +15% уклонения"] : [])].join(" · ");
  const exclusions = preview.reasons.map(reason => `<li>${reason}</li>`).join("");
  const selectedTarget = ui.selected?.targetId === occupant.id;
  const hint = !selectedWeaponId ? "<p>Сначала выберите оружейный слот</p>" : !preview.canConfirm ? "<p>Атака оружием недоступна</p>" : !selectedTarget ? "<p>Выберите цель кликом</p>" : "";
  const detail = `<div class="tooltip-attack-metrics"><span><b>${preview.hitChance}%</b> ПОПАДАНИЕ</span><span><b>${preview.shots}</b> ВЫСТР.</span><span><b>${preview.potentialDamage}</b> ПРОГНОЗ</span></div>${exclusions ? `<ul>${exclusions}</ul>` : ""}${hint}<div class="tooltip-attack-actions"><button type="button" class="button primary" data-tooltip-action="confirm-attack" ${preview.canConfirm && selectedTarget ? "" : "disabled"}>Подтвердить атаку</button><button type="button" class="button" data-tooltip-action="cancel-attack">Отменить</button></div>`;
  return { title: base.title, content: `${base.content}<div>${modifiers}</div><div class="tooltip-attack">${detail}</div>` };
}

function combineTooltips(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;
  return { title: primary.title, content: `${primary.content}<div class="tooltip-section">${secondary.content}</div>` };
}

let informationPopover = null;

function closeInformationPopover() {
  informationPopover?.remove();
  informationPopover = null;
}

function showInformationPopover(content, event) {
  closeInformationPopover();
  const popover = document.createElement("div");
  popover.className = "information-popover";
  popover.setAttribute("role", "tooltip");
  popover.innerHTML = content;
  document.body.append(popover);
  informationPopover = popover;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const anchor = { x: event.clientX, y: event.clientY };
  const layout = informationTooltipLayout(anchor, viewport);
  popover.style.width = `${layout.width}px`;
  popover.style.maxHeight = `${layout.maxHeight}px`;
  const measured = informationTooltipLayout(anchor, viewport, popover.offsetHeight);
  popover.style.left = `${measured.left}px`;
  popover.style.top = `${measured.top}px`;
}

function inspectHex(position, event = null) {
  if (event) {
    const objects = inspectionObjects(state.units, state.scenario.contents, position);
    const models = objects.map(object => state.units.includes(object) ? unitTooltip(object) : { title: object.label || object.type, content: terrainTooltipRows([object]).map(row => `<p>${row.detail}</p>`).join("") });
    const consequences = eventTooltip(position);
    if (consequences) models.push(consequences);
    if (!models.length) return false;
    showInformationPopover(models.map(model => `<section><b>${model.title}</b>${model.content}</section>`).join(""), event);
    return true;
  }
  const objects = inspectionObjects(state.units, state.scenario.contents, position);
  if (!objects.length) return false;
  const dialog = document.createElement("dialog");
  const show = object => {
    const model = state.units.includes(object) ? unitTooltip(object) : { title: object.label || object.type, content: terrainTooltipRows([object]).map(row => `<p>${row.detail}</p>`).join("") };
    detail.innerHTML = `<h3>${model.title}</h3>${model.content}`;
  };
  const detail = document.createElement("section");
  if (objects.length > 1) {
    const list = document.createElement("nav");
    for (const object of objects) {
      const button = document.createElement("button");
      button.className = "button";
      button.textContent = object.name || object.label || object.type;
      button.onclick = () => show(object);
      list.append(button);
    }
    dialog.append(list);
  }
  dialog.append(detail);
  show(objects[0]);
  const close = document.createElement("button");
  close.className = "button"; close.textContent = "Закрыть";
  close.onclick = () => dialog.close(); dialog.append(close);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
  return true;
}

function showHexTooltip(position, event) {
  if (pinned && ui.selected?.targetId && key(position.q, position.r) !== key(ui.selected.position.q, ui.selected.position.r)) return;
  const occupant = pinned ? unitById(state, ui.selected?.targetId) : unitAt(state, position);
  const events = eventTooltip(position);
  const target = state.activeAction?.type === "weapon-attack" && state.lifecycle === "ActionPlanning" && occupant && occupant.sideId !== activeUnit(state).sideId ? attackTooltip(occupant) : occupant ? unitTooltip(occupant) : null;
  const terrainRows = terrainTooltipRows(contentsAt(state, position));
  const terrain = terrainRows.length ? { title: terrainRows[0].title, content: terrainRows.map(row => `<article class="tooltip-event"><b>${row.title}</b><span>${row.detail}</span></article>`).join("") } : null;
  const model = pinned ? target : combineTooltips(combineTooltips(target, terrain), events);
  if (!model) { scheduleTooltipClose(); return; }
  cancelTooltipClose();
  ui.tooltipHex = position;
  tooltipTitle.textContent = model.title;
  tooltipContent.innerHTML = model.content;
  el.tooltip.hidden = false;
  positionTooltip(event);
}

canvas.addEventListener("pointermove", event => {
  if (event.pointerType !== "mouse") return;
  const point = pointerPoint(event);
  const option = !ui.animation && ui.selected && !(state.activeAction?.type === "weapon-attack" && state.lifecycle === "ActionPlanning") ? optionAtPoint(point) : null;
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
  if (!state.activeAction && !isDeploying()) { inspectHex(pointerHex(event)); return; }
  const position = pointerHex(event);
  const option = optionAtPoint(pointerPoint(event));
  if (option) {
    if (mobile()) { ui.selected.headingOption = option; ui.hoveredOption = null; renderPlanning(); renderUnitSummary(); draw(); }
    else startMovement(option);
    return;
  }
  selectHex(position);
  renderPlanning();
  if (state.activeAction?.type === "weapon-attack" && state.lifecycle === "ActionPlanning" && ui.selected?.targetId) showHexTooltip(ui.selected.position, event);
});
el.tooltip.addEventListener("pointerenter", () => { ui.tooltipInside = true; cancelTooltipClose(); });
el.tooltip.addEventListener("pointerleave", () => { ui.tooltipInside = false; scheduleTooltipClose(); });

el.routePolicyButton.addEventListener("click", () => {
  if (ui.animation) return;
  if (state.lifecycle === "ActionPlanning" && state.activeAction?.type === "maneuver") ui.policy = ui.policy === "safe" ? "risky" : "safe";
  else chooseAction({ type: "maneuver", reason: "player-choice" });
  refresh();
});
function enterBattle() {
  el.menuScreen.hidden = true; el.battleScreen.hidden = false;
  if (!battleStarted) { resetBattle(); battleStarted = true; }
  el.startBattleButton.textContent = "Продолжить бой";
  document.getElementById("newBattleButton").hidden = false;
  requestAnimationFrame(resizeCanvas);
}
function exitBattle() {
  el.battleScreen.hidden = true; el.menuScreen.hidden = false;
  canvas.parentElement.querySelectorAll(".damage-popup").forEach(node => node.remove());
}
el.startBattleButton.addEventListener("click", enterBattle);
el.menuButton.addEventListener("click", exitBattle);
document.getElementById("mobileMenuButton").addEventListener("click", exitBattle);
document.getElementById("portraitMenu").addEventListener("click", exitBattle);
document.getElementById("newBattleButton").addEventListener("click", () => {
  if (!window.confirm("Начать новый бой? Текущий бой будет потерян.")) return;
  ui.animation = null; pinned = false; battleStarted = false; enterBattle();
});
bindRulesDialog(el.rulesDialog, el.rulesButton, [el.closeRules, el.dialogOkay]);
el.resetButton.addEventListener("click", () => { if (!ui.animation && window.confirm("Начать новый бой?")) { pinned = false; resetBattle(); } });
el.confirmDeploymentButton.addEventListener("click", () => {
  const side = state.lifecycle === "DeploymentLeft" ? "azure" : "crimson";
  if (activationTransitionGuard.run(mobile(), () => confirmDeployment(state, side))) { ui.selected = null; if (side === "azure") state.units.forEach(unit => { unit.deployed = true; }); refresh(); }
});

function evasionActionId() {
  return activeUnit(state)?.kind === "squadron" ? "dispersion" : "evasive-maneuver";
}

function boostActionId() {
  return activeUnit(state)?.kind === "squadron" ? "interceptor-boost" : "reactor-to-engines";
}

function chooseSystemAction(systemActionId) {
  if (ui.animation) return;
  const selected = state.activeAction?.type === "system-action" && state.activeAction.systemActionId === systemActionId;
  if (selected) {
    const unit = activeUnit(state);
    const resolved = confirmSystemAction(state, { systemActionId });
    if (resolved) addLog(`${unit.name} применяет системное действие.`, unit.sideId);
  } else chooseAction({ type: "system-action", systemActionId, reason: "player-choice" });
  refresh();
}

bindActionPreview(el.evasionButton, () => ({ type: "system-action", systemActionId: evasionActionId() }));
bindActionPreview(el.disengageButton, { type: "disengage" });
bindActionPreview(el.engineBoostButton, () => ({ type: "system-action", systemActionId: boostActionId() }));
el.evasionButton.addEventListener("click", () => chooseSystemAction(evasionActionId()));
el.disengageButton.addEventListener("click", () => {
  if (ui.animation) return;
  if (state.activeAction?.type === "disengage") confirmDisengageAction(state);
  else chooseAction({ type: "disengage", reason: "player-choice" });
  refresh();
});
el.engineBoostButton.addEventListener("click", () => chooseSystemAction(boostActionId()));
el.waitButton.addEventListener("click", () => {
  const unit = activeUnit(state);
  if (activationTransitionGuard.run(mobile(), () => waitActiveUnit(state))) addLog(`${unit.name} ждёт и переносится в конец очереди.`, "system");
  refresh();
});
el.endActivationButton.addEventListener("click", () => {
  if (ui.animation) return;
  const unit = activeUnit(state);
  const result = activationTransitionGuard.run(mobile(), () => endActivation(state));
  if (!result) return;
  ui.selected = null;
  addLog(`${unit.name} завершает активацию.`, "system");
  if (result.newRound) addLog(`Начинается раунд ${state.roundNumber}.`, "system");
  refresh();
});

function confirmAttack() {
  if (!ui.selected?.targetId || ui.animation) return;
  const target = unitById(state, ui.selected.targetId);
  const committed = confirmWeaponAttackAction(state, activeUnit(state).id, pendingWeaponId(state), target.id);
  if (!committed?.steps.length) return;
  const plan = visualShotSchedule(committed);
  pinned = false;
  targetTap = null;
  closePanels();
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
      const result = applyVisualStep(animation.plan, animation.stepIndex, applyAttackStep);
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
    refresh();
  };
  requestAnimationFrame(frame);
}

el.tooltip.addEventListener("click", event => {
  const action = event.target.closest("[data-tooltip-action]")?.dataset.tooltipAction;
  if (action === "confirm-attack") confirmAttack();
  if (action === "cancel-attack") {
    cancelActionSelection();
    refresh();
  }
});
el.initiativeList.addEventListener("click", event => {
  const unit = unitById(state, event.target.closest("[data-unit-id]")?.dataset.unitId);
  if (!unit) return;
  if (mobile()) {
    const card = event.target.closest("[data-unit-id]").getBoundingClientRect();
    const content = document.createElement("span");
    content.textContent = `${unit.name} · Инициатива ${unit.initiative}`;
    showInformationPopover(content.outerHTML, { clientX: card.right, clientY: card.top });
    return;
  }
  const model = unitTooltip(unit);
  const dialog = document.createElement("dialog");
  dialog.innerHTML = `<h3>${model.title}</h3>${model.content}<button class="button">Закрыть</button>`;
  document.body.append(dialog);
  dialog.querySelector("button").onclick = () => dialog.close();
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
});
el.clearLogButton.addEventListener("click", () => { state.log = []; ui.logEventCursor = state.sequence; renderLog(); });
document.addEventListener("click", event => {
  const held = holdGesture.click();
  const outside = informationPopover && !informationPopover.contains(event.target);
  if (outside && !held) closeInformationPopover();
  if (held || outside) { event.preventDefault(); event.stopImmediatePropagation(); }
}, true);
window.addEventListener("resize", () => { closeInformationPopover(); resizeCanvas(); });
mobileMedia.addEventListener("change", () => { closeInformationPopover(); resizeCanvas(); });
window.addEventListener("keydown", event => {
  if (event.key === "Escape" && informationPopover) { closeInformationPopover(); event.preventDefault(); return; }
  if (event.key !== "Escape" || el.rulesDialog.open || document.querySelector("dialog[open]") || ui.animation) return;
  if (state.lifecycle === "ActionPlanning") cancelActionSelection();
  else clearManeuverSelection();
  refresh();
});

document.querySelectorAll("[data-panel]").forEach(button => button.addEventListener("click", () => {
  const panel = button.dataset.panel;
  el.battleScreen.dataset.panel = el.battleScreen.dataset.panel === panel ? "" : panel;
}));
document.getElementById("cancelPlan").addEventListener("click", () => { cancelActionSelection(); refresh(); });
document.getElementById("confirmPlan").addEventListener("click", () => {
  if (ui.animation) return;
  closePanels();
  const action = state.activeAction;
  if (action?.type === "weapon-attack") confirmAttack();
  else if (action?.type === "maneuver" && ui.selected?.headingOption) startMovement(ui.selected.headingOption);
  else if (action?.type === "system-action") chooseSystemAction(action.systemActionId);
  else if (action?.type === "disengage") { confirmDisengageAction(state); refresh(); }
});
document.addEventListener("pointerdown", event => {
  holdGesture.begin();
  clearTimeout(holdTimer);
  if (informationPopover) {
    if (!informationPopover.contains(event.target)) {
      closeInformationPopover();
      holdGesture.consume();
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    return;
  }
  if (event.pointerType === "mouse") return;
  holdOrigin = { x: event.clientX, y: event.clientY };
  const control = event.target.closest(".action-slot-shell,.action-slot,.status-item");
  if (!control && event.target !== canvas) return;
  holdTimer = setTimeout(() => {
    if (control) {
      const description = (control.closest(".action-slot-shell") || control).querySelector(".action-tooltip,.status-tooltip");
      if (!description) return;
      holdGesture.consume();
      showInformationPopover(description.innerHTML, event);
    } else {
      if (inspectHex(pointerHex(event), event)) holdGesture.consume();
    }
  }, 450);
}, true);
document.addEventListener("pointermove", event => {
  if (holdOrigin && Math.hypot(event.clientX - holdOrigin.x, event.clientY - holdOrigin.y) > 10) clearTimeout(holdTimer);
}, true);
for (const name of ["pointerup", "pointercancel"]) document.addEventListener(name, () => { clearTimeout(holdTimer); holdOrigin = null; if (name === "pointercancel") holdGesture.cancel(); }, true);

renderAll();