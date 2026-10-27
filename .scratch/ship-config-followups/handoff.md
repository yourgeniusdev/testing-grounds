# Handoff: follow-up work after ship configuration extraction

## Context

The current session extracted ship, system, weapon, loadout, and visual data from inline runtime objects into `src/config/`. The implementation preserves the current battle behavior except that squadron weapons are explicitly 360-degree mounts.

This handoff covers deliberately deferred work only. Inspect the completed configuration refactor and its tests before changing these mechanics.

## Suggested skills

- `diagnosing-bugs` for the squadron stack inconsistency.
- `tdd` for the follow-ups.
- `codebase-design` before formalizing firing-arc geometry.
- `code-review` after implementation.

## Follow-up 1: dynamic squadron rendering

Current runtime squadrons have `stack = 5`, while the legacy static SVG always shows three craft. The agreed visual behavior is:

- render one craft centered for display count 1;
- render two craft grouped symmetrically around center;
- render three craft around center, matching the existing composition in spirit;
- cap the visual display at three for stacks above three;
- keep the true stack visible textually in the existing UI;
- use the shared visual configuration and renderer everywhere current stack is available;
- static previews without runtime stack show the three-craft formation.

The configuration refactor provides formation offsets for counts 1–3 in `src/config/visuals.js`. Update `src/icons.js` and `src/app.js` locally without changing battle rules. Cover formation selection and generation with tests.

## Follow-up 2: stack recalculation after hazards

`src/app.js` currently applies movement-hazard damage directly to `unit.integrity`, bypassing `applyDamage()`. For squadrons this can leave `stack` inconsistent with `integrity` and `unitHealth`.

Expected result:

- all applicable hazard damage keeps squadron stack consistent with integrity;
- destruction and battle logging continue to work;
- do not accidentally change the intentionally deferred layered/cascade damage behavior;
- add tests for nonlethal and lethal hazard damage to a squadron.

## Follow-up 3: firing-arc geometry and forward hardpoints

The configuration model uses these current compatibility types:

- `turret`: 360 degrees;
- `battery`: left or right broadside according to the hardpoint mount;
- `spinal`: straight forward line;
- `squadronWeapon`: 360 degrees and only compatible with small craft.

The existing battery and spinal firing sectors are known to be geometrically incorrect. Formalize and fix them in a separate change. Also add the deferred `forward` hardpoint type:

- orientation is `fore` or `aft`;
- sector is a diverging cone along the bow or stern axis;
- angular width should be analogous to the intended battery cone, rotated onto the longitudinal axis.

Required tests:

- every boundary cell of each sector;
- rotations for all six ship headings;
- left and right battery symmetry;
- fore and aft forward-hardpoint symmetry;
- spinal weapon constrained to the exact longitudinal line;
- turret and squadron weapon remain 360 degrees;
- compatibility validation rejects weapons installed in an unsupported hardpoint type.

Do not combine these sector changes with balancing, minimum range, squadron shot degradation, thrust/mass formulas, or energy-management work.
