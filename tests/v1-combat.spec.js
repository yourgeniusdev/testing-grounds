import { test, expect } from "@playwright/test";

test("ships start visible and can be repositioned during deployment", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Перейти к бою" }).click();
  const positions = await page.evaluate(async () => (await import("/src/v1-ui.js")).store.getState().units.map(unit => unit.position));
  expect(positions.every(Boolean)).toBe(true);
  const canvas = page.locator("#battlefield");
  const box = await canvas.boundingBox();
  const points = await page.evaluate(async () => { const { renderer } = await import("/src/v1-ui.js"); return [renderer.pointForHex({ q: 0, r: 1 }), renderer.pointForHex({ q: 1, r: 2 })]; });
  await page.mouse.click(box.x + points[0].x, box.y + points[0].y);
  await page.mouse.click(box.x + points[1].x, box.y + points[1].y);
  const moved = await page.evaluate(async () => (await import("/src/v1-ui.js")).store.getState().units.find(unit => unit.id === "left-cap").position);
  expect(moved).toEqual({ q: 1, r: 2 });
});

test("battlefield legend explains terrain, cover, and route states", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Перейти к бою" }).click();
  const legend = page.locator("#battlefieldLegend");
  await expect(legend).toBeVisible();
  await expect(legend).toContainText("Туманность");
  await expect(legend).toContainText("−15 п.п.");
  await expect(legend).toContainText("Астероид");
  await expect(legend).toContainText("−20 п.п.");
  await expect(legend).toContainText("Обломки");
  await expect(legend).toContainText("маршрут недоступны");
});

test("battlefield canvas covers the visible central panel", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Перейти к бою" }).click();
  const dimensions = await page.locator("#battlefield").evaluate(canvas => ({ width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight, ratio: devicePixelRatio }));
  expect(dimensions.width).toBe(Math.round(dimensions.clientWidth * dimensions.ratio));
  expect(dimensions.height).toBe(Math.round(dimensions.clientHeight * dimensions.ratio));
});

test("capital heading changes only when the planned maneuver is confirmed", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Перейти к бою" }).click();
  await page.evaluate(async () => {
    const { store } = await import("/src/v1-ui.js");
    store.replace({ ...store.getState(), lifecycle: "Maneuver", activeUnitId: "left-cap", units: store.getState().units.map(unit => unit.id === "left-cap" ? { ...unit, position: { q: 0, r: 0 }, heading: 0 } : unit) });
  });
  await page.evaluate(async () => { const { controller, renderer } = await import("/src/v1-ui.js"); controller.view.selectedUnitId = "left-cap"; controller.view.plannedRoute = [{ q: 0, r: 1 }]; controller.view.plannedPosition = { q: 0, r: 1 }; controller.render(); });
  await page.locator("#headingButtons [data-heading='0']").dispatchEvent("click");
  expect(await page.evaluate(async () => (await import("/src/v1-ui.js")).store.getState().units.find(unit => unit.id === "left-cap").heading)).toBe(0);
  await page.locator("#confirmMoveButton").click();
  expect(await page.evaluate(async () => (await import("/src/v1-ui.js")).store.getState().units.find(unit => unit.id === "left-cap").heading)).toBe(0);
  await expect(page.locator("#combatLog")).toContainText("heading-change");
});

test("browser confirms a stationary turn and preserves an explicit final heading while selecting a route", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Перейти к бою" }).click();
  await page.evaluate(async () => { const { store, controller } = await import("/src/v1-ui.js"); store.replace({ ...store.getState(), lifecycle: "Maneuver", activeUnitId: "left-cap", units: store.getState().units.map(unit => unit.id === "left-cap" ? { ...unit, position: { q: 0, r: 0 }, heading: 0, maneuver: 2, turnsSpent: 0, evasion: 12 } : unit) }); controller.view.selectedUnitId = "left-cap"; controller.view.plannedHeading = 0; controller.render(); });
  await page.locator("#headingButtons [data-heading='1']").click();
  await page.locator("#confirmMoveButton").click();
  expect(await page.evaluate(async () => { const unit = (await import("/src/v1-ui.js")).store.getState().units.find(candidate => candidate.id === "left-cap"); return { heading: unit.heading, evasion: unit.evasion }; })).toEqual({ heading: 1, evasion: 0 });
  await page.evaluate(async () => { const { store, controller } = await import("/src/v1-ui.js"); const state = store.getState(); store.replace({ ...state, units: state.units.map(unit => unit.id === "left-cap" ? { ...unit, heading: 0, turnsSpent: 0 } : unit) }); controller.view.selectedUnitId = "left-cap"; controller.view.plannedHeading = 1; controller.view.headingSelected = true; controller.render(); });
  const canvas = page.locator("#battlefield"); const box = await canvas.boundingBox();
  const destination = await page.evaluate(async () => (await import("/src/v1-ui.js")).renderer.pointForHex({ q: 1, r: 0 }));
  await page.mouse.click(box.x + destination.x, box.y + destination.y);
  await expect(page.locator("#headingButtons [data-heading='1']")).toHaveClass(/active/);
});

test("browser shows planned multi-cell route and ordered event log", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Перейти к бою" }).click();
  await page.evaluate(async () => { const { store, controller } = await import("/src/v1-ui.js"); store.replace({ ...store.getState(), lifecycle: "Maneuver", activeUnitId: "left-cap", units: store.getState().units.map(unit => unit.id === "left-cap" ? { ...unit, position: { q: 0, r: 0 }, heading: 0 } : unit) }); controller.view.selectedUnitId = "left-cap"; controller.render(); });
  const canvas = page.locator("#battlefield"); const box = await canvas.boundingBox();
  const destination = await page.evaluate(async () => (await import("/src/v1-ui.js")).renderer.pointForHex({ q: 2, r: 0 }));
  await page.mouse.click(box.x + destination.x, box.y + destination.y);
  await expect(page.locator("#maneuverDetails")).toContainText("Маршрут");
   await expect(page.locator("#maneuverDetails")).toContainText("2 шаг");
   await expect(page.locator("#maneuverDetails")).toContainText("стоимость 2");
   await expect(page.locator("#maneuverDetails")).toContainText("курс 1");
  await page.locator("#confirmMoveButton").click();
  await expect(page.locator("#combatLog [data-event-action='movement-step']").first()).toBeVisible();
});

test("browser blocks routes through obstacles and records final position", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Перейти к бою" }).click();
  await page.evaluate(async () => {
    const { store, controller } = await import("/src/v1-ui.js");
    store.replace({ ...store.getState(), lifecycle: "Maneuver", activeUnitId: "left-cap", units: store.getState().units.map(unit => unit.id === "left-cap" ? { ...unit, position: { q: 0, r: 0 }, heading: 0 } : unit), contents: [...store.getState().contents, { id: "route-blocker", kind: "object", type: "asteroid", position: { q: 1, r: 0 } }] });
    controller.view.selectedUnitId = "left-cap";
    controller.render();
  });
  const canvas = page.locator("#battlefield");
  const box = await canvas.boundingBox();
  const blockedDestination = await page.evaluate(async () => (await import("/src/v1-ui.js")).renderer.pointForHex({ q: 2, r: 0 }));
  await page.mouse.click(box.x + blockedDestination.x, box.y + blockedDestination.y);
  await expect(page.locator("#maneuverDetails")).toContainText("Маршрут заблокирован объектом: asteroid");
  const destination = await page.evaluate(async () => (await import("/src/v1-ui.js")).renderer.pointForHex({ q: 0, r: 2 }));
  await page.mouse.click(box.x + destination.x, box.y + destination.y);
  await expect(page.locator("#maneuverDetails")).toContainText("2 шаг");
  await page.locator("#headingButtons [data-heading='0']").click();
  await page.locator("#confirmMoveButton").click();
  const events = await page.evaluate(async () => (await import("/src/v1-ui.js")).store.getState().events.slice(-6).map(event => ({ action: event.action, position: event.position, heading: event.heading })));
  expect(events).toEqual([
    { action: "entry-attempt", position: { q: 0, r: 1 }, heading: undefined },
    { action: "heading-change", position: undefined, heading: 5 },
    { action: "movement-step", position: { q: 0, r: 1 }, heading: 5 },
    { action: "entry-attempt", position: { q: 0, r: 2 }, heading: undefined },
    { action: "movement-step", position: { q: 0, r: 2 }, heading: 5 },
    { action: "heading-change", position: undefined, heading: 0 }
  ]);
  expect(await page.evaluate(async () => (await import("/src/v1-ui.js")).store.getState().units.find(unit => unit.id === "left-cap").position)).toEqual({ q: 0, r: 2 });
});

test("browser completes a lethal salvo and reaches Finished", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Перейти к бою" }).click();
  await page.evaluate(async () => {
    const { store } = await import("/src/v1-ui.js");
    const state = store.getState();
    store.replace({
      ...state,
      units: state.units.filter(unit => unit.id === "left-cap" || unit.id === "right-cap").map(unit => unit.id === "left-cap"
        ? { ...unit, position: { q: 1, r: 1 }, heading: 2 }
        : { ...unit, position: { q: 6, r: 1 }, shield: 0, armor: 0, integrity: 2 }),
      contents: []
    });
  });
  await page.getByRole("button", { name: "Завершить расстановку" }).click();
  await page.getByRole("button", { name: "Завершить расстановку" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  const canvas = page.locator("#battlefield");
  const box = await canvas.boundingBox();
  const target = await page.evaluate(async () => (await import("/src/v1-ui.js")).renderer.pointForHex({ q: 6, r: 1 }));
  await page.mouse.click(box.x + target.x, box.y + target.y);
  await page.getByRole("button", { name: "battery" }).click();
  await page.getByRole("button", { name: "Подтвердить залп" }).click();
  await expect(page.locator("#stageLabel")).toHaveText("Finished");
  await expect(page.locator("#modeLabel")).toHaveText("ПОБЕДА: left");
  const result = await page.evaluate(async () => {
    const state = (await import("/src/v1-ui.js")).store.getState();
    return {
      units: state.units.map(unit => unit.id),
      debris: state.contents.some(item => item.kind === "debris" && item.position.q === 6 && item.position.r === 1),
      events: state.events.slice(-5).map(event => ({ action: event.action, after: event.after }))
    };
  });
  expect(result).toEqual({
    units: ["left-cap"],
    debris: true,
    events: [
      { action: "attack-shot", after: { hitId: "right-cap" } },
      { action: "damage-packet", after: { shield: 0, armor: 0, integrity: 0 } },
      { action: "unit-destroyed", after: { debris: true } },
      { action: "debris-created", after: undefined },
      { action: "victory", after: { winner: "left" } }
    ]
  });
  const continueButton = page.getByRole("button", { name: "Продолжить" });
  await expect(continueButton).toBeDisabled();
  const eventCount = await page.evaluate(async () => (await import("/src/v1-ui.js")).store.getState().events.length);
  await continueButton.dispatchEvent("click");
  expect(await page.evaluate(async () => (await import("/src/v1-ui.js")).store.getState().events.length)).toBe(eventCount);
});

test("browser preview shows friendly-fire distribution without resolving a shot", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Перейти к бою" }).click();
  const before = await page.evaluate(async () => {
    const { store, controller } = await import("/src/v1-ui.js");
    const state = store.getState();
    store.replace({ ...state, lifecycle: "Attack", activeUnitId: "left-cap", contents: [{ kind: "terrain", cover: "nebula", position: { q: 3, r: 0 } }], units: state.units.map(unit => unit.id === "left-cap" ? { ...unit, position: { q: 0, r: 0 }, weapons: [{ id: "test-gun", accuracy: 80, damage: 2, shots: 2, maxRange: 5 }] } : unit.id === "left-squad" ? { ...unit, kind: "capital", size: "medium", position: { q: 1, r: 0 } } : unit.id === "right-cap" ? { ...unit, position: { q: 3, r: 0 } } : { ...unit, position: null }) });
    controller.render();
    return structuredClone(store.getState());
  });
  const canvas = page.locator("#battlefield");
  const box = await canvas.boundingBox();
  const targetPoint = await page.evaluate(async () => (await import("/src/v1-ui.js")).renderer.pointForHex({ q: 3, r: 0 }));
  await page.mouse.click(box.x + targetPoint.x, box.y + targetPoint.y);
  await page.getByRole("button", { name: "test-gun" }).click();
  await expect(page.locator("#weaponSummary")).toContainText("15% в цель");
  await expect(page.locator("#weaponSummary")).toContainText("50% в left-squad");
  await expect(page.locator("#weaponSummary")).toContainText("35% промах");
  await expect(page.locator("#weaponSummary")).toContainText("friendly fire: left-squad");
  expect(await page.evaluate(async () => structuredClone((await import("/src/v1-ui.js")).store.getState()))).toEqual(before);
});

test("browser renders selectable weapons and a complete salvo preview", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Перейти к бою" }).click();
  await page.evaluate(async () => {
    const { store } = await import("/src/v1-ui.js");
    store.replace({ ...store.getState(), lifecycle: "Attack", activeUnitId: "left-cap", units: store.getState().units.map(unit => unit.id === "left-cap" ? { ...unit, position: { q: 0, r: 0 } } : unit.id === "right-cap" ? { ...unit, position: { q: 3, r: 0 } } : unit) });
  });
  const canvas = page.locator("#battlefield");
  const box = await canvas.boundingBox();
  const targetPoint = await page.evaluate(async () => (await import("/src/v1-ui.js")).renderer.pointForHex({ q: 3, r: 0 }));
  await page.mouse.click(box.x + targetPoint.x, box.y + targetPoint.y);
  await page.getByRole("button", { name: "lance" }).click();
  await expect(page.locator("#weaponSummary")).toContainText("1 выстр.");
  await expect(page.locator("#weaponSummary")).toContainText("80% в цель");
  await expect(page.locator("#weaponSummary")).toContainText("20% промах");
  await expect(page.locator("#weaponSummary")).toContainText("3 урон/попадание");
  await expect(page.locator("#weaponSummary")).toContainText("3 макс. урон");
  await page.getByRole("button", { name: "Подтвердить залп" }).click();
  await expect(page.locator("#combatLog")).toContainText("attack-shot");
  await expect(page.locator("#initiativeList")).toContainText("Bastion");
});
