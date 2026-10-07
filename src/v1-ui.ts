import { createBattleController } from "./v1-controller.ts";
import { createBattleRenderer } from "./v1-renderer.ts";
import { createBattleStore, createLocalPersistence } from "./v1-store.ts";

const store = createBattleStore({ persistence: createLocalPersistence("v1-combat-ui-3"), initial: {
  id: "v1-ui", bounds: { minCol: 0, maxCol: 7, minRow: 0, maxRow: 5 }, units: [
    { id: "left-cap", side: "left", kind: "capital", name: "Aegis", initiative: 5, integrity: 12, armor: 3, shield: 2, mass: 3, speed: 2, maneuver: 2, position: { q: 0, r: 1 }, heading: 2, weapons: [{ id: "battery", accuracy: 100, damage: 2, shots: 1, maxRange: 5 }, { id: "lance", accuracy: 80, damage: 3, shots: 1, minRange: 2, maxRange: 5 }] },
    { id: "left-squad", side: "left", kind: "squadron", name: "Lance", initiative: 4, integrity: 6, unitHealth: 2, stack: 3, speed: 3, position: { q: 0, r: 3 } },
    { id: "right-cap", side: "right", kind: "capital", name: "Bastion", initiative: 3, integrity: 12, armor: 3, shield: 2, mass: 3, speed: 2, maneuver: 2, position: { q: 7, r: 1 }, heading: 5, weapons: [{ id: "battery", accuracy: 100, damage: 2, shots: 1, maxRange: 5 }] },
    { id: "right-squad", side: "right", kind: "squadron", name: "Raptor", initiative: 2, integrity: 6, unitHealth: 2, stack: 3, speed: 3, position: { q: 7, r: 3 } }
   ], contents: [
     { id: "asteroid-1", kind: "object", type: "asteroid", position: { q: 3, r: 1 } },
      { id: "nebula-1", kind: "terrain", type: "nebula", cover: "nebula", position: { q: 3, r: 4 } }
   ]
 } });

const renderer = createBattleRenderer(document);
const controller = createBattleController({ document, store, renderer });
export { controller, renderer, store };
