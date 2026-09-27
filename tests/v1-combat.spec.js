import { test, expect } from "@playwright/test";

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
  await page.mouse.click(box.x + 90 + 38 * Math.sqrt(3) * 3, box.y + 90);
  await page.getByRole("button", { name: "lance" }).click();
  await expect(page.locator("#weaponSummary")).toContainText("1 выстр.");
  await expect(page.locator("#weaponSummary")).toContainText("80% точность");
  await expect(page.locator("#weaponSummary")).toContainText("3 урон/попадание");
  await expect(page.locator("#weaponSummary")).toContainText("3 макс. урон");
  await page.getByRole("button", { name: "Подтвердить залп" }).click();
  await expect(page.locator("#combatLog")).toContainText("attack-shot");
  await expect(page.locator("#initiativeList")).toContainText("Bastion");
});
