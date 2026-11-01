import assert from "node:assert/strict";
import test from "node:test";
import { VISUALS } from "./config/index.js";
import { createSvgImage, iconMarkup } from "./icons.js";

test("hornet has its own two-cannon silhouette and dynamic two-to-one formation", () => {
  for (const stack of [1, 2]) {
    const markup = iconMarkup("interceptor", "#fff", "Шершень", stack);
    assert.equal((markup.match(/data-squadron-kind="interceptor"/g) || []).length, stack);
    assert.equal((markup.match(/class="barrel"/g) || []).length, stack);
    assert.match(markup, /M41 56V42m18 14V42/);
  }
  assert.notEqual(VISUALS.interceptor.svg, VISUALS.squadron.svg);
});

const craftCount = markup => (markup.match(/data-squadron-craft=""/g) || []).length;

for (const [stack, expected] of [[undefined, 3], [1, 1], [2, 2], [3, 3]]) {
  test(`squadron icon renders ${expected} craft for stack ${stack ?? "preview"}`, () => {
    const markup = iconMarkup("squadron", "#fff", "Squadron", stack);
    assert.equal(craftCount(markup), expected);
  });
}

test("squadron icon uses configured symmetric two-craft formation", () => {
  const markup = iconMarkup("squadron", "#fff", "Squadron", 2);
  assert.match(markup, /transform="translate\(-19 8\)"/);
  assert.match(markup, /transform="translate\(19 8\)"/);
});

test("squadron craft render above the center marker", () => {
  const markup = iconMarkup("squadron", "#fff", "Squadron", 3);
  assert.ok(markup.indexOf("turret-core") < markup.indexOf("data-squadron-craft"));
});

test("canvas image uses the same dynamic squadron renderer", () => {
  const PreviousImage = globalThis.Image;
  globalThis.Image = class {};
  try {
    const image = createSvgImage("squadron", "#fff", 1);
    const svg = decodeURIComponent(image.src.split(",")[1]);
    assert.equal(craftCount(svg), 1);
  } finally {
    globalThis.Image = PreviousImage;
  }
});

test("non-formation icons preserve configured markup", () => {
  for (const type of ["cruiser", "assaultCraft"]) {
    const markup = iconMarkup(type, "#fff", type, 1);
    assert.equal(craftCount(markup), 0);
    assert.ok(markup.includes(VISUALS[type].svg));
  }
});

test("Mantis bombers use their own formation craft design", () => {
  const markup = iconMarkup("bomber", "#fff", "Mantis", 3);
  assert.equal(craftCount(markup), 3);
  assert.match(markup, /data-squadron-kind="bomber"/);
});
