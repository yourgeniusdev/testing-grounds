import assert from "node:assert/strict";
import test from "node:test";
import { createSvgImage, iconMarkup } from "./icons.js";

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
  assert.ok(markup.indexOf("detail-fill") < markup.indexOf("data-squadron-craft"));
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

test("non-squadron icons preserve configured markup", () => {
  const markup = iconMarkup("cruiser", "#fff", "Cruiser", 1);
  assert.equal(craftCount(markup), 0);
  assert.match(markup, /M48 5 69 26/);
});
