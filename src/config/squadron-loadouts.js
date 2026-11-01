import { deepFreeze } from "./deep-freeze.js";

export const SQUADRON_LOADOUTS = deepFreeze({
  wasps: {
    id: "wasps", modelId: "wasp",
    weapons: { autocannon: { id: "wasps-autocannon", weaponId: "twinNeedleAutocannon" } }
  },
  mantis: {
    id: "mantis", modelId: "mantis",
    weapons: {
      autocannon: { id: "mantis-autocannon", weaponId: "needleAutocannon" },
      torpedo: { id: "mantis-torpedo", weaponId: "hammerTorpedo" }
    }
  },
  hornet: {
    id: "hornet", modelId: "hornet",
    weapons: {
      "left-autocannon": { id: "hornet-left", weaponId: "twinNeedleAutocannon" },
      "right-autocannon": { id: "hornet-right", weaponId: "twinNeedleAutocannon" }
    }
  },
  kiro: {
    id: "kiro", modelId: "kiro",
    weapons: { "beam-turret": { id: "kiro-beam", weaponId: "lanceBeam" } }
  }
});
