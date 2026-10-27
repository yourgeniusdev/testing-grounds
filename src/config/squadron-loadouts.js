import { deepFreeze } from "./deep-freeze.js";

export const SQUADRON_LOADOUTS = deepFreeze({
  wasps: {
    id: "wasps", modelId: "wasp",
    weapons: { primary: { id: "wasps-front", weaponId: "squadronKinetic" } }
  },
  mantis: {
    id: "mantis", modelId: "mantis",
    weapons: { primary: { id: "mantis-front", weaponId: "squadronKinetic" } }
  }
});
