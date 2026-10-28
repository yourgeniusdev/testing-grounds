import { deepFreeze } from "./deep-freeze.js";

const fighter = (id, displayName) => ({
  id,
  displayName,
  kind: "squadron",
  craftType: "fighter",
  baseSpeed: 6,
  initiative: 4,
  stack: 3,
  unitHealth: 5,
  shield: 0,
  armor: 0,
  baseEvasion: 0,
  visualId: "squadron",
  hardpoints: [
    { id: "primary", role: "primary", mount: "squadronWeapon", type: "squadronWeapon" }
  ]
});

export const SQUADRON_MODELS = deepFreeze({
  wasp: fighter("wasp", "Оса"),
  mantis: fighter("mantis", "Мантис")
});
