import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { currentEvasion, actionAvailability, planRoutes, confirmSystemAction, createBattleState, unitById } from "./domain.js";
import { SYSTEM_ACTIONS } from "./config/index.js";
import { effectiveWeapon } from "./battle.js";
import { cancelPendingAction, selectPendingAction } from "./ui-controller.js";
import { actionPlanningPreview, planningControlsPresentation, maneuverPlanningPreview, DISPERSION_DESCRIPTION, terrainTooltipRows, actionResourcePreview, actionTilePresentation, buildManeuverOptions, canSelectWeaponAttackTarget, evasionPresentation, interceptionEffectRows, maneuverActionPresentation, maneuverPreviewHeading, maneuverResourcePreview, resourceMetricsText, resourcePresentation, routeConsequenceRows, routePreviewKindsAt, segmentedResourcePresentation, shouldShowManeuverRoutes, systemActionPresentation, weaponSelectionPresentation } from "./ui-rules.js";

test("balance presentation preserves turn evasion", () => {
  const state = createBattleState();
  const unit = unitById(state, "wasps");
  unit.activationMovement.elements.push({ type: "move", evasionGain: 4 });
  assert.equal(evasionPresentation(unit, { route: { steps: [], actions: [{ type: "turn" }] } }).preview, 4);
  assert.equal(evasionPresentation(unit, { route: { steps: [{}, {}] } }).preview, 12);
});

test("selected system previews match real resolution and expose only applicable budgets", () => {
  for (const [id, systemActionId, names] of [
    ["swift", "reactor-to-engines", ["speed"]],
    ["swift", "evasive-maneuver", ["maneuver"]],
    ["hornet-azure", "interceptor-boost", ["speed"]],
    ["wasps", "dispersion", []]
  ]) {
    const state = createBattleState();
    const unit = unitById(state, id);
    state.activeUnitId = id;
    state.lifecycle = "ActionPlanning";
    state.activeAction = { type: "system-action", systemActionId, actorId: id, status: "planning" };
    unit.activationMovement = { elements: [{ type: "move" }, { type: "move" }] };
    const before = JSON.stringify(state);
    const preview = actionPlanningPreview(state, unit);
    assert.equal(JSON.stringify(state), before);
    assert.equal(preview.canConfirm, true);
    assert.deepEqual(preview.gauges.map(gauge => gauge.name), names);
    assert.ok(confirmSystemAction(state));
    for (const gauge of preview.gauges) {
      assert.equal(segmentedResourcePresentation(gauge.resource, gauge.preview).remaining, resourcePresentation(unit)[gauge.name].remaining);
    }
    if (preview.evasion) assert.equal(preview.evasion.preview, currentEvasion(unit));
    if (id === "wasps") assert.match(preview.notes.join(" "), /Без затрат/);
  }
});

test("ship boost omits only redundant confirmation energy, retaining authoritative resource preview", () => {
  const state = createBattleState();
  const unit = unitById(state, "swift");
  const action = { type: "system-action", systemActionId: "reactor-to-engines" };
  const preview = actionPlanningPreview(state, unit, action);
  const availability = actionAvailability(state, action, unit);
  assert.deepEqual(preview.gauges.map(gauge => gauge.name), ["speed"]);
  assert.equal(preview.gauges[0].preview.capacity, availability.forecast.capacityChange.speed);
  assert.ok(preview.gauges[0].preview.capacity > 0);
  assert.equal(actionResourcePreview(state, unit, action).energy, availability.forecast.cost.energy);
  assert.ok(availability.forecast.cost.energy > 0);
});

test("compact boost previews use configured cooldown and activation limit", () => {
  const state = createBattleState();
  for (const [id, systemActionId, cooldown] of [
    ["swift", "reactor-to-engines", "Без перезарядки"],
    ["hornet-azure", "interceptor-boost", `Перезарядка ${SYSTEM_ACTIONS["interceptor-boost"].cooldownRounds} раунд`]
  ]) {
    const preview = actionPlanningPreview(state, unitById(state, id), { type: "system-action", systemActionId });
    assert.ok(preview.notes.includes(cooldown));
    assert.ok(preview.notes.includes("Один раз за активацию"));
  }
});

test("compact dispersion shows only red accuracy penalty and next activation duration", () => {
  const state = createBattleState();
  const unit = unitById(state, "wasps");
  const preview = actionPlanningPreview(state, unit, { type: "system-action", systemActionId: "dispersion" });
  const penalty = SYSTEM_ACTIONS.dispersion.accuracyPenalty;
  assert.ok(preview.notes.includes(`Точность атак <b style="color:var(--red)">-${penalty}%</b> · до следующей активации`));
  assert.doesNotMatch(preview.notes.join(" "), /Уклонение/);
  assert.equal(preview.evasionDelta, 15);
  assert.equal(effectiveWeapon({ ...unit, dispersionActive: true }, unit.weapons[0]).accuracy, unit.weapons[0].accuracy - penalty);
});

test("evasive bonus range follows ship speed, spent movement, capacity and lock", () => {
  for (const [speed, spent, steps, locked, capacity, range] of [
    [0, 0, 0, false, 0, "0–0"],
    [1, 0, 0, false, 1, "0–4"],
    [2, 0, 0, false, 2, "0–8"],
    [3, 0, 0, false, 3, "0–12"],
    [4, 0, 0, false, 4, "0–16"],
    [8, 0, 0, false, 8, "0–25"],
    [4, 2, 2, false, 4, "6–14"],
    [4, 4, 2, false, 4, "6–6"],
    [4, 0, 0, false, 2, "0–8"],
    [4, 1, 0, true, 4, "0–12"]
  ]) {
    const state = createBattleState();
    const unit = unitById(state, "swift");
    Object.assign(unit, { currentSpeed: speed, speedSpent: spent, activationSpeedCapacity: capacity, activationResourceCounters: true, evasionLocked: locked, activationMovement: { elements: Array.from({ length: steps }, () => ({ type: "move" })) } });
    const preview = actionPlanningPreview(state, unit, { type: "system-action", systemActionId: "evasive-maneuver" });
    assert.ok(preview.notes.includes(`Бонус уклонения от движения +${range} п.п. · зависит от пройденного пути`));
  }
});

test("evasive preview includes speed from resolved engine boost", () => {
  const state = createBattleState();
  const unit = unitById(state, "swift");
  Object.assign(unit, { currentSpeed: 2, speedRemaining: 2 });
  state.activeUnitId = unit.id;
  state.lifecycle = "ActionPlanning";
  state.activeAction = { type: "system-action", systemActionId: "reactor-to-engines", actorId: unit.id, status: "planning" };
  assert.ok(confirmSystemAction(state));
  const preview = actionPlanningPreview(state, unit, { type: "system-action", systemActionId: "evasive-maneuver" });
  assert.ok(preview.notes.includes("Бонус уклонения от движения +0–12 п.п. · зависит от пройденного пути"));
});

test("unavailable previews do not promise bonuses and retain full required cost", () => {
  const state = createBattleState();
  const unit = unitById(state, "swift");
  state.activeUnitId = unit.id;
  state.lifecycle = "ActionPlanning";
  state.activeAction = { type: "system-action", systemActionId: "reactor-to-engines" };
  unit.reactor.currentEnergy = 0;
  const preview = actionPlanningPreview(state, unit);
  assert.equal(preview.canConfirm, false);
  assert.deepEqual(preview.gauges.map(gauge => gauge.name), ["speed"]);
  assert.equal(actionResourcePreview(state, unit).energy, 1);
  assert.ok(preview.gauges.every(gauge => Object.keys(gauge.preview).length === 0));
  assert.match(preview.notes.join(" "), /Недостаточно/);
});

test("weapon previews show only actual energy cost without unrelated stats", () => {
  const state = createBattleState();
  for (const unit of state.units) {
    for (const weapon of unit.weapons || []) {
      const preview = actionPlanningPreview(state, unit, { type: "weapon-attack", slotId: weapon.id });
      assert.equal(preview.evasion, null);
      assert.deepEqual(preview.gauges.map(gauge => gauge.name), weapon.energyCost && unit.reactor ? ["energy"] : []);
      if (preview.gauges.length) assert.equal(preview.gauges[0].cost, weapon.energyCost);
    }
  }
});

test("rules markup links four accessible tabs and panels with only activation initially visible", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const dialog = html.match(/<dialog id="rulesDialog"[\s\S]*?<\/dialog>/)[0];
  assert.match(dialog, /aria-labelledby="rulesTitle"/);
  assert.match(dialog, /id="rulesTitle">Правила стенда/);
  assert.match(dialog, /role="tablist" aria-label="Разделы правил"/);
  const tabs = [...dialog.matchAll(/<button type="button" id="([^"]+)" role="tab" aria-controls="([^"]+)" aria-selected="([^"]+)" tabindex="([^"]+)">([^<]+)<\/button>/g)];
  assert.deepEqual(tabs.map(tab => tab[5]), ["Активация", "Движение", "Бой", "Местность и риски"]);
  tabs.forEach((tab, index) => {
    assert.equal(tab[3], String(index === 0));
    assert.equal(tab[4], index === 0 ? "0" : "-1");
    assert.ok(dialog.includes(`id="${tab[2]}" role="tabpanel" aria-labelledby="${tab[1]}" tabindex="0"${index ? " hidden" : ""}>`));
  });
  assert.doesNotMatch(dialog, /MOVEMENT PLAYTEST 1|0–3|до 25 п\.п\.|капиталь/i);
  for (const fact of [/60° — 1 Манёвренность/, /Последовательные повороты разрешены/, /эскадрильям 4 п\.п\./, /25 п\.п\./, /Повороты не добавляют и не стирают/, /не гарантирует защиту от скрытых угроз/, /не проходит через другую эскадрилью/, /У Шершня Форсаж бесплатный/, /у Киро башня/]) assert.match(dialog, fact);
});

test("rules dialog integration protects battle planning and supplies narrow-screen styling", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(app, /bindRulesDialog\(el.rulesDialog, el.rulesButton, \[el.closeRules, el.dialogOkay\]\)/);
  assert.doesNotMatch(app, /shouldCancelDocumentAction\(/);
  assert.match(app, /event.key !== "Escape" \|\| el.rulesDialog.open/);
  assert.match(css, /\.rules-panel\[hidden\] \{ display:none; \}/);
  assert.match(css, /#rulesDialog \{ max-height:calc\(100dvh - 32px\); overflow-y:auto;/);
  assert.match(css, /@media \(max-width:520px\)/);
});

test("terrain tooltip describes nebula and station without fabricated unit data", () => {
  assert.deepEqual(terrainTooltipRows([{ type: "nebula", label: "Туманность" }, { type: "station", label: "Станция" }]), [
    { title: "Туманность", detail: "Стоимость входа 1 · −15 п.п. к попаданию по любому юниту в туманности" },
    { title: "Станция", detail: "Непроходимый объект" }
  ]);
  assert.match(DISPERSION_DESCRIPTION, /после атаки включить нельзя/);
  assert.match(DISPERSION_DESCRIPTION, /включая Наблюдение/);
});

const signedTurn = (from, to) => {
  let delta = (to - from + 6) % 6;
  if (delta > 3) delta -= 6;
  return delta;
};

function route(overrides = {}) {
  return {
    position: { q: 2, r: -1 },
    heading: 0,
    movementCost: 2,
    turnsSpent: 1,
    steps: [{}, {}],
    path: [],
    consequences: [],
    ...overrides
  };
}

test("maneuver confirmation requires a tapped heading, not a destination or hover", () => {
  const state = { lifecycle: "ActionPlanning", activeAction: { type: "maneuver" } };
  const ui = { selected: null, animation: null };
  assert.deepEqual(planningControlsPresentation(state, ui, true), { visible: false, cancelOnly: true });
  ui.selected = { baseOption: {}, options: [{}] };
  ui.hoveredOption = {};
  assert.equal(planningControlsPresentation(state, ui, true).visible, false);
  ui.selected.headingOption = {};
  assert.deepEqual(planningControlsPresentation(state, ui, true), { visible: true, cancelOnly: false });
  ui.animation = {};
  assert.deepEqual(planningControlsPresentation(state, ui, true), { visible: false, cancelOnly: false });
  ui.animation = null;
  ui.selected = { baseOption: {} };
  assert.equal(planningControlsPresentation(state, ui, true).visible, false);
  state.activeAction = { type: "weapon-attack" };
  assert.deepEqual(planningControlsPresentation(state, ui, true), { visible: false, cancelOnly: false });
  state.lifecycle = "ActionChoice";
  assert.deepEqual(planningControlsPresentation(state, ui, true), { visible: false, cancelOnly: false });
});

test("desktop hides all planning controls including cancel-only without changing selection", () => {
  for (const action of [
    { type: "maneuver" }, { type: "weapon-attack" }, { type: "disengage" },
    ...Object.keys(SYSTEM_ACTIONS).map(systemActionId => ({ type: "system-action", systemActionId }))
  ]) {
    for (const selected of [null, { targetId: "enemy" }, { headingOption: {} }]) {
      const state = { lifecycle: "ActionPlanning", activeAction: action };
      const ui = { selected, animation: null };
      const before = JSON.stringify({ state, ui });
      assert.deepEqual(planningControlsPresentation(state, ui, false), { visible: false, cancelOnly: false });
      assert.deepEqual(planningControlsPresentation(state, ui), { visible: false, cancelOnly: false });
      const compact = planningControlsPresentation(state, ui, true);
      if (action.type === "weapon-attack") assert.deepEqual(compact, { visible: false, cancelOnly: false });
      else assert.ok(compact.visible || compact.cancelOnly);
      assert.deepEqual(planningControlsPresentation(state, ui, false), { visible: false, cancelOnly: false });
      assert.equal(JSON.stringify({ state, ui }), before);
    }
  }
});

test("planning controls share the mobile breakpoint and update on resize and pointer changes", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const breakpoint = "(pointer:coarse), (max-width:950px)";
  const [desktop, compact] = css.split(`@media ${breakpoint} {`);
  assert.match(desktop, /#planningControls \{[^}]*display:none;/);
  assert.match(compact, /#planningControls \{[^}]*display:flex;/);
  assert.match(css, /\[hidden\] \{ display:none !important; \}/);
  assert.ok(app.includes(`const mobileMedia = matchMedia("${breakpoint}")`));
  assert.match(app, /planningControlsPresentation\(state, ui, mobile\(\)\)/);
  assert.match(app, /function resizeCanvas\(\) \{\s*renderPlanning\(\);/);
  for (const source of ["window", "mobileMedia"]) {
    assert.ok(app.includes(`${source}.addEventListener("${source === "window" ? "resize" : "change"}", () => { closeInformationPopover(); resizeCanvas(); });`));
  }
  assert.match(app, /if \(pinned && ui.selected\?\.position\) positionTooltip\(\{\}\)/);
  assert.match(app, /else startMovement\(option\)/);
  assert.match(app, /if \(selected\) \{[\s\S]*?confirmSystemAction\(state, \{ systemActionId \}\)/);
  assert.match(app, /if \(action === "confirm-attack"\) confirmAttack\(\)/);
});

test("mobile arrow selection stays pending and explicit confirmation uses the tapped option", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const mobileSelection = app.match(/if \(mobile\(\)\) \{ ui.selected.headingOption = option;[^}]+\}/)[0];
  assert.doesNotMatch(mobileSelection, /startMovement/);
  assert.match(mobileSelection, /renderPlanning\(\)/);
  assert.match(app, /startMovement\(ui.selected.headingOption\)/);
  assert.match(app, /return ui.selected\?\.headingOption \|\| ui.hoveredOption/);
});

test("compact maneuver preview matches domain costs, remaining budgets and evasion", () => {
  const state = createBattleState();
  const unit = unitById(state, "swift");
  state.activeUnitId = unit.id;
  state.lifecycle = "ActionChoice";
  state.units = [unit];
  state.scenario.contents = [];
  unit.position = { q: 0, r: 0 };
  unit.currentSpeed = 4;
  unit.maneuver = 3;
  unit.speedSpent = 1;
  unit.maneuverSpent = 1;
  unit.activationResourceCounters = true;
  unit.activationMovement = { elements: [{ type: "move" }], steps: 1, turns: 0 };
  assert.equal(selectPendingAction(state, {}, { type: "maneuver", reason: "player-choice" }), true);
  const routes = planRoutes(state, unit, "risky");
  const options = [...routes.values()].flatMap(route => buildManeuverOptions(unit, route));
  assert.ok(options.some(option => option.route.steps.length > 0));
  assert.ok(options.some(option => option.route.steps.length === 0));
  for (const option of options) {
    const preview = maneuverPlanningPreview(state, unit, option);
    const cost = actionAvailability(state, { type: "maneuver", option }, unit).forecast.cost;
    assert.equal(preview.speed.spend, cost.speed);
    assert.equal(preview.maneuver.spend, cost.maneuver);
    for (const name of ["speed", "maneuver"]) {
      const gauge = segmentedResourcePresentation(preview.resources[name], preview[name]);
      assert.equal(gauge.remaining, Math.max(0, preview.resources[name].remaining - cost[name]));
    }
    assert.deepEqual(preview.evasion, evasionPresentation(unit, { route: option.route }, state));
    assert.equal(preview.evasionDelta, Math.round((preview.evasion.preview - preview.evasion.current) * 10) / 10);
  }
});

test("UI resource presentation uses authoritative activation remainders", () => {
  const unit = {
    currentSpeed: 1,
    maneuver: 0,
    speedSpent: 2,
    maneuverSpent: 1,
    energySpent: 2,
    activationEnergyBudget: 4,
    reactor: { capacity: 3, currentEnergy: 1 }
  };

  assert.deepEqual(resourcePresentation(unit), {
    speed: { spent: 2, remaining: 0, capacity: 1 },
    maneuver: { spent: 1, remaining: 0, capacity: 0 },
    energy: { spent: 2, remaining: 1, capacity: 3 }
  });
});

test("UI Evasion presentation derives current and preview values from accumulated domain facts", () => {
  const unit = {
    hullType: "cruiser",
    baseEvasion: 6,
    evasiveManeuver: false,
    evasionLocked: false,
    activationMovement: {
      steps: 2,
      turns: 1,
      elements: [
        { type: "move" },
        { type: "turn" },
        { type: "move" }
      ]
    }
  };
  const selected = { route: route({ steps: [{}, {}], movementCost: 3 }) };
  const turnOnly = { route: route({ position: { q: 0, r: 0 }, steps: [], movementCost: 0, turnsSpent: 1, actions: [{ type: "turn" }] }) };

  assert.deepEqual(evasionPresentation(unit, selected), { current: 4, movement: 4, preview: 8, previewMovement: 8 });
  assert.deepEqual(evasionPresentation(unit, turnOnly), { current: 4, movement: 4, preview: 4, previewMovement: 4 });
  assert.deepEqual(evasionPresentation(unit, null), { current: 4, movement: 4, preview: 4, previewMovement: 4 });
  assert.deepEqual(evasionPresentation({ ...unit, evasionLocked: true }, selected), { current: 4, movement: 4, preview: 8, previewMovement: 8 });
});

test("dispersion evasion preview follows hover and selection without mutation or double counting", () => {
  const state = createBattleState();
  const unit = unitById(state, "wasps");
  state.activeUnitId = unit.id;
  state.lifecycle = "ActionChoice";
  unit.activationMovement = { elements: [{ type: "move" }, { type: "move" }] };
  const action = { type: "system-action", systemActionId: "dispersion", reason: "player-choice" };
  const ui = { hoveredAction: action };
  const present = () => evasionPresentation(unit, null, state, ui.hoveredAction);
  const baseline = evasionPresentation(unit);
  const before = structuredClone({ ...state, rng: null });

  assert.deepEqual(present(), { ...baseline, preview: baseline.current + 15 });
  assert.deepEqual({ ...state, rng: null }, before);
  ui.hoveredAction = null;
  assert.deepEqual(present(), baseline);
  assert.equal(selectPendingAction(state, ui, action), true);
  assert.equal(present().preview, baseline.current + 15);
  ui.hoveredAction = { type: "system-action", systemActionId: "interceptor-boost" };
  assert.deepEqual(present(), baseline);
  ui.hoveredAction = null;
  assert.equal(present().preview, baseline.current + 15);
  ui.hoveredAction = action;
  assert.equal(cancelPendingAction(state, ui), true);
  assert.deepEqual(present(), baseline);
  assert.deepEqual(unit, before.units.find(candidate => candidate.id === unit.id));

  unit.attackedThisRound = true;
  ui.hoveredAction = action;
  assert.deepEqual(present(), baseline);
  unit.attackedThisRound = false;
  assert.equal(selectPendingAction(state, ui, action), true);
  assert.ok(confirmSystemAction(state));
  ui.hoveredAction = action;
  assert.equal(present().current, baseline.current + 15);
  assert.equal(present().preview, present().current);
  ui.hoveredAction = null;
  assert.equal(present().preview, present().current);
});

test("action tile presentation distinguishes instant confirmation, field confirmation, and resolved effects", () => {
  assert.deepEqual(actionTilePresentation({ selected: true, confirmation: "tile", icon: "◇" }), {
    selected: true, pendingConfirmation: true, resolved: false, icon: "✓", className: "pending-confirmation", ariaPressed: "true"
  });
  assert.deepEqual(actionTilePresentation({ selected: true, confirmation: "field", icon: "⚠" }), {
    selected: true, pendingConfirmation: false, resolved: false, icon: "⚠", className: "field-selected", ariaPressed: "true"
  });
  assert.deepEqual(actionTilePresentation({ selected: true, confirmation: "field", icon: "◆", resolved: true }), {
    selected: true, pendingConfirmation: false, resolved: true, icon: "◆", className: "field-selected resolved", ariaPressed: "true"
  });
  assert.deepEqual(actionTilePresentation({ selected: false, confirmation: "tile", icon: "»", resolved: true }), {
    selected: false, pendingConfirmation: false, resolved: true, icon: "»", className: "resolved", ariaPressed: "false"
  });
});

test("fixed action preview metadata gives engine boost speed capacity and generic maneuver capacity without mutation", () => {
  const state = { lifecycle: "ActionPlanning", activeAction: { type: "system-action", systemActionId: "preview-fixture", preview: { maneuverCapacity: 2 } } };
  const unit = { weapons: [{ id: "selected", energyCost: 2 }, { id: "hovered", energyCost: 3 }] };
  const before = structuredClone({ state, unit });

  assert.deepEqual(actionResourcePreview(state, unit, { type: "system-action", systemActionId: "reactor-to-engines" }), { energy: 1, speedCapacity: 1, maneuverCapacity: 0 });
  assert.deepEqual(actionResourcePreview(state, unit, { type: "system-action", systemActionId: "evasive-maneuver" }), { energy: 0, speedCapacity: 0, maneuverCapacity: 0, maneuver: 1 });
  assert.deepEqual(actionResourcePreview(state, unit, { type: "weapon-attack", slotId: "hovered", preview: { maneuverCapacity: 2 } }), { energy: 3, speedCapacity: 0, maneuverCapacity: 2 });
  assert.deepEqual(actionResourcePreview(state, unit), { energy: 0, speedCapacity: 0, maneuverCapacity: 2 });
  assert.deepEqual({ state, unit }, before);
});

test("hovered action preview takes precedence and selected preview persists after hover leaves", () => {
  const state = { lifecycle: "ActionPlanning", activeAction: { type: "system-action", systemActionId: "reactor-to-engines" } };
  const unit = { weapons: [{ id: "gun", energyCost: 2 }] };

  assert.deepEqual(actionResourcePreview(state, unit, { type: "weapon-attack", slotId: "gun" }), { energy: 2, speedCapacity: 0, maneuverCapacity: 0 });
  assert.deepEqual(actionResourcePreview(state, unit), { energy: 1, speedCapacity: 1, maneuverCapacity: 0 });
});

test("segmented resource preview clamps spending and distinguishes bonus capacity", () => {
  assert.deepEqual(segmentedResourcePresentation({ spent: 2, remaining: 1, capacity: 3 }, { spend: 4, capacity: 1 }), {
    spent: 2, spendPreview: 1, capacity: 4, capacityPreview: 1, remaining: 1, segments: ["preview", "spent", "spent", "bonus"]
  });
  assert.deepEqual(segmentedResourcePresentation({ spent: 1, remaining: 2, capacity: 3 }, { capacity: 2 }), {
    spent: 1, spendPreview: 0, capacity: 5, capacityPreview: 2, remaining: 4, segments: ["available", "available", "spent", "bonus", "bonus"]
  });
});

test("resource UI consistently exposes current maximum, cumulative spend, and remaining including over-budget spend", () => {
  const reduced = { spent: 4, remaining: 0, capacity: 2 };
  assert.deepEqual(segmentedResourcePresentation(reduced), {
    spent: 4, spendPreview: 0, capacity: 2, capacityPreview: 0, remaining: 0, segments: ["spent", "spent"]
  });
  assert.equal(resourceMetricsText(reduced), "макс. 2 · расход 4 · остаток 0");
  assert.equal(resourceMetricsText({ spent: 1, remaining: 2, capacity: 3 }, { spend: 1, capacity: 1 }), "макс. 4 · расход 2 · остаток 2");
});

test("weapon selection presentation follows activeAction rather than UI shadow state", () => {
  assert.deepEqual(weaponSelectionPresentation({ lifecycle: "ActionPlanning", activeAction: { type: "weapon-attack", slotId: "left" } }, "left"), { selected: true, ariaPressed: "true" });
  assert.deepEqual(weaponSelectionPresentation({ lifecycle: "ActionPlanning", activeAction: { type: "weapon-attack", slotId: "left" } }, "right"), { selected: false, ariaPressed: "false" });
  assert.deepEqual(weaponSelectionPresentation({ lifecycle: "ActionChoice", activeAction: null }, "left"), { selected: false, ariaPressed: "false" });
});

test("system action tiles show authoritative cooldown rounds without confusing activation usage or dispersion", () => {
  const state = { lifecycle: "ActionChoice", activeAction: null };
  const unit = { kind: "squadron", craftType: "interceptor", interceptorBoostCooldown: 2, usedSystemActions: ["interceptor-boost"], engineBoostActive: true };
  const present = (systemActionId = "interceptor-boost", icon = "»") => {
    const action = systemActionPresentation(state, unit, systemActionId);
    return { action, tile: actionTilePresentation({ ...action, confirmation: "tile", icon, resolved: unit.engineBoostActive }) };
  };

  for (const rounds of [2, 1]) {
    unit.interceptorBoostCooldown = rounds;
    const { action, tile } = present();
    assert.equal(action.cooldownRemaining, rounds);
    assert.equal(action.canSelect, false);
    assert.equal(action.canConfirm, false);
    assert.ok(action.reasons.includes(`Перезарядка ${rounds} ${rounds === 1 ? "раунд" : "раунда"}`));
    assert.equal(tile.icon, rounds);
    assert.equal(tile.className, "resolved cooldown");
    const dispersion = present("dispersion", "✣");
    assert.equal(dispersion.tile.icon, "✣");
    assert.equal(dispersion.action.cooldownRemaining, undefined);
  }

  unit.interceptorBoostCooldown = 0;
  assert.equal(present().tile.icon, "»");
  assert.equal(present().tile.className, "resolved");
  assert.equal(present().action.canSelect, false);
  assert.deepEqual(present().action.reasons, ["Уже использовано в этой активации"]);
  unit.usedSystemActions = [];
  unit.engineBoostActive = false;
  assert.equal(present().action.canSelect, true);
  assert.equal(present().tile.icon, "»");
  assert.equal(present().tile.className, "");

  const capital = { kind: "capital", reactor: { currentEnergy: 2 }, engineId: "engine", interceptorBoostCooldown: 2, usedSystemActions: ["reactor-to-engines"] };
  const action = systemActionPresentation(state, capital, "reactor-to-engines");
  assert.equal(action.cooldownRemaining, undefined);
  assert.equal(actionTilePresentation({ ...action, icon: "»" }).icon, "»");
});

test("system action presentation exposes domain affordability reasons", () => {
  const unit = { kind: "capital", hullId: "swiftFrigate", maneuver: 2, maneuverSpent: 2, reactor: { capacity: 1, currentEnergy: 0 }, engineId: "engine", energySpent: 1 };
  assert.deepEqual(systemActionPresentation({ lifecycle: "ActionChoice", activeAction: null }, unit, "evasive-maneuver"), {
    selected: false, canSelect: false, canConfirm: false, canCancel: false, reasons: ["Недостаточно Манёвренности: требуется 1, доступно 0"]
  });
  assert.deepEqual(systemActionPresentation({ lifecycle: "ActionChoice", activeAction: null }, unit, "reactor-to-engines"), {
    selected: false, canSelect: false, canConfirm: false, canCancel: false, reasons: ["Недостаточно энергии: требуется 1, доступно 0"]
  });
});

test("system action presentation exposes selection, preview, confirm, and cancel states", () => {
  const unit = { kind: "capital", hullId: "swiftFrigate", maneuver: 2, maneuverSpent: 0, reactor: { currentEnergy: 2 } };
  assert.deepEqual(systemActionPresentation({ lifecycle: "ActionChoice", activeAction: null }, unit, "evasive-maneuver"), {
    selected: false, canSelect: true, canConfirm: false, canCancel: false
  });
  assert.deepEqual(systemActionPresentation({ lifecycle: "ActionPlanning", activeAction: { type: "system-action", systemActionId: "evasive-maneuver" } }, unit, "evasive-maneuver"), {
    selected: true, canSelect: false, canConfirm: true, canCancel: true
  });
  assert.deepEqual(systemActionPresentation({ lifecycle: "ActionPlanning", activeAction: { type: "weapon-attack" } }, unit, "evasive-maneuver"), {
    selected: false, canSelect: true, canConfirm: false, canCancel: false
  });
});

test("maneuver action presentation remains selectable while another plan is pending", () => {
  const state = createBattleState();
  const unit = unitById(state, "atlas");
  state.units = [unit];
  state.activeUnitId = unit.id;
  state.lifecycle = "ActionPlanning";
  state.activeAction = { type: "weapon-attack", slotId: unit.weapons[0].id };
  state.scenario.contents = [];
  unit.position = { q: 0, r: 0 };

  assert.deepEqual(maneuverActionPresentation(state, unit), { selected: false, canSelect: true, canConfirm: false, canCancel: false });
});

test("maneuver action presentation exposes domain resource reasons", () => {
  const state = createBattleState();
  const unit = unitById(state, "atlas");
  state.units = [unit];
  state.activeUnitId = unit.id;
  state.lifecycle = "ActionChoice";
  state.activeAction = null;
  state.scenario.contents = [];
  unit.position = { q: 0, r: 0 };
  unit.speedSpent = unit.currentSpeed;
  unit.maneuverSpent = unit.maneuver;
  assert.deepEqual(maneuverActionPresentation(state, unit), {
    selected: false,
    canSelect: false,
    canConfirm: false,
    canCancel: false,
    reasons: ["Недостаточно Скорости и Манёвренности"]
  });
  unit.currentSpeed++;
  state.lifecycle = "ActionPlanning";
  state.activeAction = { type: "maneuver" };
  assert.deepEqual(maneuverActionPresentation(state, unit), {
    selected: true,
    canSelect: false,
    canConfirm: true,
    canCancel: true
  });
});

test("maneuver action availability requires an actual nonempty legal route without exposing route data", () => {
  const state = createBattleState();
  const swift = unitById(state, "wasps");
  state.units = [swift];
  state.activeUnitId = swift.id;
  state.lifecycle = "ActionChoice";
  state.activeAction = null;
  state.scenario.contents = [];
  swift.position = { q: 0, r: 0 };
  swift.heading = 0;
  swift.speedSpent = 0;
  swift.speedRemaining = swift.currentSpeed;
  swift.maneuverSpent = 0;
  swift.maneuverRemaining = swift.maneuver;

  const available = maneuverActionPresentation(state, swift);
  assert.deepEqual(available, { selected: false, canSelect: true, canConfirm: false, canCancel: false });
  assert.equal("routes" in available, false);

  swift.engagedWith = ["enemy"];
  assert.deepEqual(maneuverActionPresentation(state, swift), {
    selected: false,
    canSelect: true,
    canConfirm: false,
    canCancel: false
  });

  swift.engagedWith = [];
  swift.maneuverSpent = swift.maneuver;
  swift.maneuverRemaining = 0;
  state.scenario.contents = [
    { id: "blocked-forward", kind: "object", type: "station", position: { q: 1, r: 0 } }
  ];
  assert.equal(maneuverActionPresentation(state, swift).canSelect, false);
});

test("interception effects enumerate every current reciprocal link", () => {
  const unit = { id: "actor", kind: "squadron", position: { q: 0, r: 0 }, sideId: "azure", engagedWith: ["enemy-z", "stale", "enemy-a"] };
  const state = { units: [
    unit,
    { id: "enemy-z", name: "Enemy Z", kind: "squadron", canIntercept: true, position: { q: 1, r: 0 }, sideId: "crimson", engagedWith: [unit.id] },
    { id: "enemy-a", name: "Enemy A", kind: "squadron", canIntercept: true, position: { q: 1, r: 0 }, sideId: "crimson", engagedWith: [unit.id] },
    { id: "stale", name: "Stale", kind: "squadron", position: { q: 4, r: 0 }, sideId: "crimson", engagedWith: [] }
  ] };

  assert.deepEqual(interceptionEffectRows(state, unit).map(effect => effect.name), ["Перехват · Enemy A", "Перехват · Enemy Z"]);
});

test("maneuver routes exist only while a chosen maneuver is being planned", () => {
  assert.equal(shouldShowManeuverRoutes({ lifecycle: "ActionChoice", activeAction: null }), false);
  assert.equal(shouldShowManeuverRoutes({ lifecycle: "ActionPlanning", activeAction: { type: "weapon-attack" } }), false);
  assert.equal(shouldShowManeuverRoutes({ lifecycle: "ActionPlanning", activeAction: { type: "maneuver" } }), true);
  assert.equal(shouldShowManeuverRoutes({ lifecycle: "ActionResolution", activeAction: { type: "maneuver" } }), false);
});

test("buildManeuverOptions creates one stable option per available final heading", () => {
  const unit = { heading: 0, currentSpeed: 4, maneuver: 3, evasiveManeuver: false };
  const plannedRoute = route();

  const options = buildManeuverOptions(unit, plannedRoute, new Set([5, 0, 1]), signedTurn);

  assert.deepEqual(options.map(option => option.optionId), ["maneuver:2:-1:heading:5", "maneuver:2:-1:heading:0", "maneuver:2:-1:heading:1"]);
  assert.deepEqual(options.map(option => option.finalState), [
    { hex: { q: 2, r: -1 }, heading: 5 },
    { hex: { q: 2, r: -1 }, heading: 0 },
    { hex: { q: 2, r: -1 }, heading: 1 }
  ]);
  assert.ok(options.every(option => option.route === plannedRoute));
  assert.deepEqual(options.map(option => option.resources.maneuver.spent), [1, 1, 1]);
});

test("buildManeuverOptions always exposes the route heading", () => {
  const plannedRoute = route({ heading: 3, movementCost: 3, turnsSpent: 0, interceptions: ["enemy-flight"] });
  const options = buildManeuverOptions({ heading: 3, currentSpeed: 5, maneuver: 4 }, plannedRoute);

  assert.deepEqual(options, [{
    optionId: "maneuver:2:-1:heading:3",
    finalState: { hex: { q: 2, r: -1 }, heading: 3 },
    route: plannedRoute,
    resources: { speed: { spent: 3, remaining: 2, capacity: 5 }, maneuver: { spent: 0, remaining: 4, capacity: 4 } },
    consequences: [],
    interceptions: ["enemy-flight"]
  }]);
});

test("heading-free squadron previews retain the runtime heading without mutation", () => {
  const unit = { heading: 3 };
  const option = { finalState: { hex: { q: 2, r: -1 } } };

  assert.equal(maneuverPreviewHeading(unit, option), 3);
  assert.deepEqual(unit, { heading: 3 });
  assert.deepEqual(option, { finalState: { hex: { q: 2, r: -1 } } });
});

test("buildManeuverOptions preserves an explicitly empty set of legal options", () => {
  const plannedRoute = route();

  assert.deepEqual(buildManeuverOptions({ currentSpeed: 5, maneuver: 2 }, plannedRoute, new Set(), signedTurn), []);
});

test("stationary route reports the turns already present in the common plan", () => {
  const unit = { heading: 0, currentSpeed: 3, maneuver: 4, maneuverSpent: 1 };
  const plannedRoute = route({ position: { q: -3, r: 4 }, heading: 3, movementCost: 0, turnsSpent: 3, steps: [] });

  const [option] = buildManeuverOptions(unit, plannedRoute);

  assert.deepEqual(option.finalState, { hex: { q: -3, r: 4 }, heading: 3 });
  assert.deepEqual(option.resources, {
    speed: { spent: 0, remaining: 3, capacity: 3 },
    maneuver: { spent: 4, remaining: 0, capacity: 4 }
  });
});

test("options expose route consequences and interception without transforming them", () => {
  const consequences = [{ sourceName: "Debris", probability: 0.5, min: 1, max: 2, effect: "damage" }];
  const plannedRoute = route({ movementCost: 7, consequences, interceptions: ["wasps"] });

  const [option] = buildManeuverOptions({ currentSpeed: 5 }, plannedRoute);

  assert.equal(option.consequences, consequences);
  assert.deepEqual(option.interceptions, ["wasps"]);
  assert.deepEqual(option.resources.speed, { spent: 7, remaining: 0, capacity: 5 });
});

test("options expose the full interception preview without a singular adapter", () => {
  const plannedRoute = route({ interceptions: ["enemy-a", "enemy-z"] });

  const [option] = buildManeuverOptions({ currentSpeed: 5 }, plannedRoute);

  assert.deepEqual(option.interceptions, ["enemy-a", "enemy-z"]);
  assert.equal("interception" in option, false);
});

test("route preview kinds distinguish AA, interception, hazard, and overlaps per known hex", () => {
  const routePreview = route({ previewConsequences: [
    { kind: "aa", position: { q: 1, r: 0 } },
    { kind: "interception", position: { q: 1, r: 0 } },
    { kind: "hazard", position: { q: 2, r: 0 } }
  ] });

  assert.deepEqual(routePreviewKindsAt(routePreview, { q: 1, r: 0 }), { aa: true, interception: true, hazard: false });
  assert.deepEqual(routePreviewKindsAt(routePreview, { q: 2, r: 0 }), { aa: false, interception: false, hazard: true });
  assert.deepEqual(routePreviewKindsAt(routePreview, { q: 3, r: 0 }), { aa: false, interception: false, hazard: false });
});

test("route consequence rows visibly describe hazards, AA, guaranteed effects, and every interception", () => {
  const routePreview = route({
    previewConsequences: [
      { kind: "hazard", sourceId: "mines", sourceName: "Minefield", effect: "integrity damage", probability: 0.5, min: 2, max: 6, expectedHarm: 2, guaranteed: false },
      { kind: "aa", sourceId: "escort", sourceName: "Escort", slotId: "aa", effect: "AA reaction", probability: 0.4, min: 0, max: 4, expectedHarm: 1.6, guaranteed: false },
      { kind: "effect", sourceId: "gravity", sourceName: "Gravity Well", effect: "speed lock", probability: 1, min: 0, max: 0, expectedHarm: 0, guaranteed: true },
      { kind: "interception", sourceId: "enemy-a", sourceName: "Enemy A", effect: "Interception", probability: 1, min: 0, max: 0, expectedHarm: 0, guaranteed: true },
      { kind: "interception", sourceId: "enemy-z", sourceName: "Enemy Z", effect: "Interception", probability: 1, min: 0, max: 0, expectedHarm: 0, guaranteed: true }
    ]
  });

  assert.deepEqual(routeConsequenceRows(routePreview), [
    { kind: "hazard", title: "Minefield", detail: "50% · 2–6 · integrity damage · expected harm 2" },
    { kind: "aa", title: "ПВО · Escort", detail: "40% · 0–4 · AA reaction · expected harm 1.6" },
    { kind: "effect", title: "Gravity Well", detail: "Guaranteed · speed lock" },
    { kind: "interception", title: "Перехват · Enemy A", detail: "Guaranteed · Interception" },
    { kind: "interception", title: "Перехват · Enemy Z", detail: "Guaranteed · Interception" }
  ]);
});

test("maneuverResourcePreview uses the hovered preview option before the selected option", () => {
  const unit = { speedSpent: 1, maneuverSpent: 1 };
  const option = {
    resources: {
      speed: { spent: 3, remaining: 1, capacity: 4 },
      maneuver: { spent: 2, remaining: 1, capacity: 3 }
    }
  };
  const previewOption = {
    resources: {
      speed: { spent: 4, remaining: 0, capacity: 4 },
      maneuver: { spent: 3, remaining: 0, capacity: 3 }
    }
  };

  assert.deepEqual(maneuverResourcePreview(unit, { option, previewOption }, signedTurn), {
    speedSpent: 1,
    speedPreview: 3,
    maneuverSpent: 1,
    maneuverPreview: 2
  });
  assert.deepEqual(maneuverResourcePreview(unit, { option }, signedTurn), {
    speedSpent: 1,
    speedPreview: 2,
    maneuverSpent: 1,
    maneuverPreview: 1
  });
  assert.deepEqual(maneuverResourcePreview(unit, { previewOption: { resources: { speed: 4, maneuver: 3 } } }, signedTurn), {
    speedSpent: 1,
    speedPreview: 3,
    maneuverSpent: 1,
    maneuverPreview: 2
  });
});

test("selected weapon permits any enemy target so domain preview can explain invalid attacks", () => {
  const attacker = { id: "attacker", sideId: "azure" };
  assert.equal(canSelectWeaponAttackTarget(attacker, { id: "enemy", sideId: "crimson" }, "slot-a"), true);
  assert.equal(canSelectWeaponAttackTarget(attacker, { id: "ally", sideId: "azure" }, "slot-a"), false);
  assert.equal(canSelectWeaponAttackTarget(attacker, { id: "enemy", sideId: "crimson" }, null), false);
});

test("maneuverResourcePreview keeps route selections independent of action labels", () => {
  const unit = { heading: 0, speedSpent: 1, maneuverSpent: 1, evasiveManeuver: true };
  const selected = { heading: 2, route: route({ heading: 1, movementCost: 4, turnsSpent: 1 }) };

  assert.deepEqual(maneuverResourcePreview(unit, selected, signedTurn), {
    speedSpent: 1,
    speedPreview: 3,
    maneuverSpent: 1,
    maneuverPreview: 2
  });
  assert.deepEqual(maneuverResourcePreview(unit, null, signedTurn), {
    speedSpent: 1,
    speedPreview: 0,
    maneuverSpent: 1,
    maneuverPreview: 0
  });
});
