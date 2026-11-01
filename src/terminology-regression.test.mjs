import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createBattleState, recordEvent } from "./domain.js";

const root = new URL("..", import.meta.url);
const rootPath = fileURLToPath(root);
const currentDocs = [
  "docs/adr/0001-free-order-unit-activation.md",
  "docs/game_systems/activation-and-weapon-attacks.md",
  "docs/game_systems/free-activation-migration-plan.md",
  "docs/game_systems/maneuvers.md"
];
const forbiddenEnglish = ["sal" + "vo", "ph" + "ase", "sta" + "ge"];
const forbiddenRussian = ["зал" + "п", "фа" + "з"];
const forbidden = new RegExp(`\\b(?:${forbiddenEnglish.join("|")})\\b|(?:${forbiddenRussian.join("|")})[а-яё]*`, "giu");

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [path];
  }).filter(path => [".js", ".mjs"].includes(extname(path)) && !path.endsWith("terminology-regression.test.mjs"));
}

test("current runtime, UI, and maintained rules contain no obsolete action-sequencing terminology or adapters", () => {
  const files = [
    ...sourceFiles(fileURLToPath(new URL("./", import.meta.url))).map(path => new URL(`file:///${path.replaceAll("\\", "/")}`)),
    new URL("index.html", root),
    new URL("styles.css", root),
    ...currentDocs.map(path => new URL(path, root))
  ];
  const findings = files.flatMap(file => {
    const text = readFileSync(file, "utf8");
    return [...text.matchAll(forbidden)].map(match => `${relative(rootPath, fileURLToPath(file))}:${text.slice(0, match.index).split("\n").length}:${match[0]}`);
  });
  assert.deepEqual(findings, []);
});

test("current events expose technical lifecycle and action context without obsolete duplicate fields", () => {
  const state = createBattleState();
  const event = recordEvent(state, "regression-event", { actorId: state.activeUnitId, actionType: "maneuver" });
  const [obsoleteEventField, obsoleteRuntimeField] = ["ph" + "ase", "sta" + "ge"];
  assert.equal(event.lifecycle, "DeploymentLeft");
  assert.equal(event.actionType, "maneuver");
  assert.equal(obsoleteEventField in event, false);
  assert.equal(obsoleteRuntimeField in event, false);
  assert.equal(obsoleteRuntimeField in state, false);
});
