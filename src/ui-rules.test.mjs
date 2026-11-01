import assert from "node:assert/strict";
import test from "node:test";
import { createBattleState, unitById } from "./domain.js";
import { actionResourcePreview, actionTilePresentation, buildManeuverOptions, canSelectWeaponAttackTarget, evasionPresentation, maneuverActionPresentation, maneuverPreviewHeading, maneuverResourcePreview, resourcePresentation, routeConsequenceRows, segmentedResourcePresentation, shouldShowManeuverRoutes, systemActionPresentation, weaponSelectionPresentation } from "./ui-rules.js";

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

  assert.deepEqual(evasionPresentation(unit, selected), { current: 15, movement: 9, preview: 20, previewMovement: 14 });
  assert.deepEqual(evasionPresentation(unit, turnOnly), { current: 15, movement: 9, preview: 0, previewMovement: 0 });
  assert.deepEqual(evasionPresentation(unit, null), { current: 15, movement: 9, preview: 15, previewMovement: 9 });
  assert.deepEqual(evasionPresentation({ ...unit, evasionLocked: true }, selected), { current: 0, movement: 0, preview: 0, previewMovement: 0 });
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

test("weapon selection presentation follows activeAction rather than UI shadow state", () => {
  assert.deepEqual(weaponSelectionPresentation({ lifecycle: "ActionPlanning", activeAction: { type: "weapon-attack", slotId: "left" } }, "left"), { selected: true, ariaPressed: "true" });
  assert.deepEqual(weaponSelectionPresentation({ lifecycle: "ActionPlanning", activeAction: { type: "weapon-attack", slotId: "left" } }, "right"), { selected: false, ariaPressed: "false" });
  assert.deepEqual(weaponSelectionPresentation({ lifecycle: "ActionChoice", activeAction: null }, "left"), { selected: false, ariaPressed: "false" });
});

test("system action presentation exposes domain affordability reasons", () => {
  const unit = { kind: "capital", maneuver: 2, maneuverSpent: 2, reactor: { capacity: 1, currentEnergy: 0 }, engineId: "engine", energySpent: 1 };
  assert.deepEqual(systemActionPresentation({ lifecycle: "ActionChoice", activeAction: null }, unit, "evasive-maneuver"), {
    selected: false, canSelect: false, canConfirm: false, canCancel: false, reasons: ["Недостаточно Манёвренности: требуется 1, доступно 0"]
  });
  assert.deepEqual(systemActionPresentation({ lifecycle: "ActionChoice", activeAction: null }, unit, "reactor-to-engines"), {
    selected: false, canSelect: false, canConfirm: false, canCancel: false, reasons: ["Недостаточно энергии: требуется 1, доступно 0"]
  });
});

test("system action presentation exposes selection, preview, confirm, and cancel states", () => {
  const unit = { kind: "capital", maneuver: 2, maneuverSpent: 0, reactor: { currentEnergy: 2 } };
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
    canSelect: false,
    canConfirm: false,
    canCancel: false,
    reasons: ["Нет допустимого маршрута"]
  });

  swift.engagedWith = [];
  swift.maneuverSpent = swift.maneuver;
  swift.maneuverRemaining = 0;
  state.scenario.contents = [
    { id: "blocked-forward", kind: "object", type: "station", position: { q: 1, r: 0 } }
  ];
  assert.equal(maneuverActionPresentation(state, swift).canSelect, false);
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
    { kind: "aa", title: "AA · Escort", detail: "40% · 0–4 · AA reaction · expected harm 1.6" },
    { kind: "effect", title: "Gravity Well", detail: "Guaranteed · speed lock" },
    { kind: "interception", title: "Interception · Enemy A", detail: "Guaranteed · Interception" },
    { kind: "interception", title: "Interception · Enemy Z", detail: "Guaranteed · Interception" }
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

  assert.deepEqual(maneuverResourcePreview(unit, { option, previewOption }, "movement", signedTurn), {
    speedSpent: 1,
    speedPreview: 3,
    maneuverSpent: 1,
    maneuverPreview: 2
  });
  assert.deepEqual(maneuverResourcePreview(unit, { option }, "movement", signedTurn), {
    speedSpent: 1,
    speedPreview: 2,
    maneuverSpent: 1,
    maneuverPreview: 1
  });
  assert.deepEqual(maneuverResourcePreview(unit, { previewOption: { resources: { speed: 4, maneuver: 3 } } }, "movement", signedTurn), {
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

  assert.deepEqual(maneuverResourcePreview(unit, selected, "movement", signedTurn), {
    speedSpent: 1,
    speedPreview: 3,
    maneuverSpent: 1,
    maneuverPreview: 2
  });
  assert.deepEqual(maneuverResourcePreview(unit, null, "action-choice", signedTurn), {
    speedSpent: 1,
    speedPreview: 0,
    maneuverSpent: 1,
    maneuverPreview: 0
  });
});
