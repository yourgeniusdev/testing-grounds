import { createBattleController } from "./v1-controller.js";
import { createBattleRenderer } from "./v1-renderer.js";
import { createBattleStore, createLocalPersistence } from "./v1-store.js";

const store = createBattleStore({ persistence: createLocalPersistence("v1-combat-ui"), initial: {
  id: "v1-ui", bounds: { minCol: 0, maxCol: 7, minRow: 0, maxRow: 5 }, units: [
    { id: "left-cap", side: "left", kind: "capital", name: "Aegis", initiative: 5, integrity: 12, armor: 3, shield: 2, mass: 3, speed: 2, position: null, weapons: [{ id: "battery", accuracy: 100, damage: 2, shots: 1, maxRange: 5 }, { id: "lance", accuracy: 80, damage: 3, shots: 1, minRange: 2, maxRange: 5 }] },
    { id: "left-squad", side: "left", kind: "squadron", name: "Lance", initiative: 4, integrity: 6, unitHealth: 2, stack: 3, speed: 3, position: null },
    { id: "right-cap", side: "right", kind: "capital", name: "Bastion", initiative: 3, integrity: 12, armor: 3, shield: 2, mass: 3, speed: 2, position: null, weapons: [{ id: "battery", accuracy: 100, damage: 2, shots: 1, maxRange: 5 }] },
    { id: "right-squad", side: "right", kind: "squadron", name: "Raptor", initiative: 2, integrity: 6, unitHealth: 2, stack: 3, speed: 3, position: null }
  ]
} });

const renderer = createBattleRenderer(document);
const controller = createBattleController({ document, store, renderer });
export { controller, renderer, store };
