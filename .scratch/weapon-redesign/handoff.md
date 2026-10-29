# Handoff: independent weapon catalog, targeting, cooldowns, and attack animation

## Status

The design interview is complete. The user confirmed the final frontier and asked to begin implementation in a fresh session. No implementation for this weapon redesign was performed during the interview.

The working tree already contains uncommitted changes from the preceding ship-config follow-ups. Inspect `git status`, `git diff`, and the existing tests before editing; preserve that work.

## Suggested skills

- `implement-spec` for the implementation.
- `tdd` for vertical slices through config validation, battle planning, cooldowns, targeting, and animation.
- `codebase-design` before splitting attack calculation from attack application/animation.
- `code-review` after implementation, using this handoff as the spec source.

## Existing sources to inspect

- Current weapon catalog: `src/config/weapons.js`
- Hull hardpoints and loadouts: `src/config/capital-hulls.js`, `src/config/ship-loadouts.js`
- Squadron models and loadouts: `src/config/squadron-models.js`, `src/config/squadron-loadouts.js`
- Runtime profile construction and validation: `src/config/index.js`, `src/config/validate-config.js`
- Attack rules and resolution: `src/battle.js`
- Rendering and attack animation: `src/app.js`
- Domain state/round transition: `src/domain.js`
- Current tests: `src/config.test.mjs`, `src/battle.test.mjs`, `src/firing-arcs.test.mjs`, `src/hazards.test.mjs`, `src/icons.test.mjs`
- Current terminology: `docs/design/CONTEXT.md`
- Earlier deferred work: `.scratch/ship-config-followups/handoff.md`

The files under `docs/specs/v1/` are retired. Do not treat them as normative. Historical documents under `docs/archive/legacy/` are reference material only.

## Agreed scope

Implement all of the following:

1. Replace ship-specific weapon definitions with an independent reusable catalog.
2. Use compact Russian military-SF display names and stable neutral English IDs.
3. Cover all current weapon classes, hardpoint types, single/multiple-shot weapons, AA/non-AA behavior, missiles, torpedoes, and small-craft weapons with a compact, logical dataset rather than a Cartesian product.
4. Put a forward-facing hardpoint on Atlas, replacing its current plasma turret.
5. Implement manual AA target eligibility: non-AA ship weapons cannot target squadrons.
6. Distinguish damage class, delivery, targeting, and visual presentation as separate concepts.
7. Replace category-wide primary/auxiliary readiness with per-installed-slot readiness and cooldown.
8. Split attack planning from application so animation uses fixed hit/miss results and state is applied in visual order.
9. Render missiles and torpedoes distinctly, including hit/miss-aware impact effects.
10. Update directly affected current terminology and tests.

Do not implement overwatch, missile interception, ammunition reserves, physical projectile entities, guidance after launch, AoE damage, or range penalties in this change.

## Weapon data model

### Core fields

Each catalog weapon should include at least:

- `id`
- `name`
- `compatibleHardpointTypes` (remain an array; architecture must permit several known types even though current catalog entries use one)
- `weaponClass`: `kinetic | energy | explosive`
- `delivery`: `beam | projectile | missile | torpedo`
- `targetKinds`: nonempty subset of `capital | squadron`
- `accuracy`
- `effectiveRange` (informational in this change)
- `maxRange`
- `shots`
- `damage`
- `critChance`
- `energyCost`
- `cooldownRounds` (integer >= 0; default 0)
- existing future mass data where applicable
- nested `visual` profile

### Class and delivery rules

- `missile` and `torpedo` require `weaponClass: "explosive"`.
- Explosive payload includes rockets/missiles, torpedoes, bombs, and mines conceptually, but only missile/torpedo/projectile deliveries are implemented now.
- `beam` is valid only for energy weapons.
- Kinetic weapons use `projectile`.
- Energy plasma bolts may use `projectile`.
- Explosive weapons may use `projectile`, `missile`, or `torpedo`.
- Do not add bomb or mine delivery until those mechanics exist.

### Visual profile

Store presentation in weapon data rather than inferring it from ID or class. Agreed shape:

```js
visual: {
  projectile: "beam" | "tracer" | "missile" | "torpedo",
  color,
  size,
  speedHexesPerSecond,
  launchIntervalMs,
  trail: "none" | "short" | "smoke",
  impact: "none" | "spark" | "smallExplosion" | "largeExplosion",
  impactRadius
}
```

The validator should enforce valid values and reasonable numeric ranges. Class/delivery provides constraints, while each weapon supplies concrete values. Flight duration must be calculated from actual hex distance and `speedHexesPerSecond`.

Missile and torpedo projectile size and impact radius are separate. Torpedo projectile size and visual impact radius should be about 1.5 times the missile values. Both explosions must remain visibly smaller than a large ship and have no gameplay radius. A reasonable starting point is approximately `impactRadius` 0.22 hex for missiles and 0.33 for torpedoes.

### Weapon variants

Support code-level variants without runtime inheritance:

```js
const base = weapon({...});
const variant = weaponVariant(base, { id, name, shots: 2 });
```

- The final catalog contains fully materialized independent frozen objects.
- Preserve `variantOf` for provenance/UI.
- Deep-merge nested `visual` overrides.
- Require a unique overridden `id` and `name`.
- Disallow variant chains deeper than one level.
- A variant may change numeric values, visuals, name, and targets.
- A variant must not change `weaponClass` or `compatibleHardpointTypes`; that would be a new weapon model.
- Validation must ensure the parent exists, is not itself a variant, and is compatible.
- Keep `compatibleHardpointTypes` as an array and add a validator test showing multiple known types are structurally supported; no current real weapon needs multiple types.

## Independent catalog and names

Use the following compact display-name style and neutral English IDs:

1. `Автопушка «Игла»` — base small-craft kinetic autocannon, 1 shot per craft.
2. `Спаренная автопушка «Игла»` — variant of the base, `shots: 2` per craft.
3. `Зенитная автопушка «Страж»` — turret, kinetic, multiple shots, AA.
4. `Зенитный лазер «Луч»` — turret, energy beam, one shot, AA.
5. `Плазменное орудие «Факел»` — heavy non-AA turret, energy projectile, one powerful shot.
6. `Кинетическая батарея «Шторм»` — battery, kinetic, multiple shots, non-AA.
7. `Ракетная батарея «Град»` — battery, explosive missile, about 3 shots, non-AA.
8. `Линейный рельсотрон «Титан»` — spinal, kinetic projectile, strongest/longest-range, one shot, non-AA.
9. `Курсовой излучатель «Фокус»` — forward, energy, weaker than battery/spinal.
10. `Курсовая ракета «Копьё»` — forward, explosive missile, one heavier/lower-accuracy shot, non-AA; catalog-only for now.
11. `Энергетическая башня «Импульс»` — light ordinary non-AA turret for Raptor.
12. `Противокорабельная торпеда «Молот»` — small-craft torpedo, one shot per craft, capital-only.

Exact numerical values are delegated to implementation. Use logical playtest values and encode structural balance invariants in tests:

- spinal is strongest and longest-range;
- batteries have high total output and cannot be AA;
- turret/forward weapons are generally weaker than batteries/spinal;
- AA has high accuracy but modest damage/range;
- torpedo is slow, inaccurate, powerful, and capital-only;
- missile may have one or several shots; delivery does not determine salvo count.

Do not claim final balance; balancing is a later phase.

## Hull and squadron loadouts

### Capital ships

- Atlas: two `Шторм` batteries; replace its current plasma turret with a `forward`, `orientation: "fore"` hardpoint mounting `Фокус`.
- Swift: `Страж` and `Луч`; establish it as the escort/AA ship.
- Bastion: `Титан`, two `Град` batteries, and `Факел`.
- Raptor: one `Град` battery and `Импульс` turret.
- `Копьё` remains catalog-only to cover forward + explosive + missile.

### Squadrons

- Wasp becomes the fast fighter: speed 6, initiative 5, base evasion 10, stack 3, unit health 5; one slot with the twin `Игла`. Full stack fires `2 × 3 = 6` shots.
- Mantis becomes the slower bomber: speed 4, initiative 3, base evasion 4, stack 3, unit health 5; one slot with base `Игла` plus a second slot with `Молот`.
- All weapons on `squadronWeapon` hardpoints scale as `weapon.shots × current stack`.

## Target eligibility / AA

Use explicit `targetKinds`, not a stored `antiAir` boolean.

Agreed matrix:

- ordinary ship weapons: `["capital"]`;
- ship AA: `["capital", "squadron"]`;
- Wasp twin autocannon: `["capital", "squadron"]`;
- Mantis defensive base autocannon: `["capital", "squadron"]`;
- Mantis torpedo: `["capital"]`.

A ship weapon is presented as `ПВО` when its `targetKinds` includes `squadron`. Do not show this badge for squadron-mounted weapons.

Enforce targeting at all layers:

1. available-target calculation;
2. preview/exclusion reasons;
3. attack-plan creation, so UI bypass cannot violate the rule.

For a mixed selection against a squadron, keep incompatible selected slots visible, report the exclusion reason, and disable confirmation rather than silently changing selection.

Validate nonempty target lists and known target kinds. AA is valid only on turret and squadron-weapon hardpoint types; batteries, spinal, and forward weapons cannot be AA.

## Remove primary/auxiliary roles

Remove the primary/auxiliary distinction completely from:

- hardpoints and loadouts;
- runtime weapon model;
- `primaryReady` / `auxiliaryReady` state;
- battle filtering and selection APIs;
- UI labels/tooltips;
- tests;
- directly affected current terminology in `docs/design/CONTEXT.md`.

All selection should use explicit `Set` values of installed slot IDs. Remove compatibility with string selectors such as `"primary"` and `"auxiliary"`.

A salvo may include any subset of ready slots against one target. Constraints are target kind, arc, range, per-slot readiness/cooldown, and total energy. One confirmed manual salvo still ends the attack phase even if some slots did not fire.

`energyCost` applies to any weapon. Cost 0 does not require a reactor. Positive cost is unavailable without a reactor. Permit selecting a salvo whose maximum total cost exceeds available energy, but disable confirmation and show required/available energy. At execution, charge only slots that actually begin firing.

## Per-slot readiness and cooldown

Each runtime installed weapon should hold its own state, e.g.:

```js
ready: true,
cooldownRemaining: 0
```

Also isolate cooldown transition logic in named functions to avoid off-by-one errors.

Semantics for `cooldownRounds: 1`:

- fired in round 1;
- unavailable through round 2;
- ready again in round 3.

Keep ordinary once-per-round readiness separate from prolonged cooldown (for example `firedThisRound` plus `cooldownRemaining`, or an equivalent clear representation).

Agreed cooldown examples:

- `Титан`: 1;
- `Факел`: 1;
- `Молот`: 1;
- `Копьё`: 1;
- `Град`: 0;
- other weapons: 0 unless logically justified.

An unused slot remains ready but does not accumulate charges. If the target is destroyed before a selected slot begins firing, that slot spends no readiness, energy, or cooldown. A second manual salvo is still not allowed in the same activation.

Cooldown UI:

- keep unavailable weapon tiles visible;
- dim and disable the tile;
- replace the normal weapon icon in the center with the remaining cooldown number;
- tooltip may state the remaining reload time.

## Attack planning, resolution, and animation

Split current resolution into an immutable planned result and sequential application, for example:

- `planAttack(...)`
- animation consumes the plan;
- `applyAttackStep(...)` applies each fixed result after its visual step.

Planning an attack confirms it immediately: disable controls, do not allow cancellation after rolls are known, play the plan, and apply exactly that plan.

The plan must:

- fix every hit/miss roll, miss offset, damage, critical result, layer transitions, and destruction outcome;
- simulate layers on a copy of the target;
- stop planning further shots/weapons after predicted destruction;
- select the next weapon from remaining slots according to effectiveness against the current simulated layer;
- use stable hardpoint order as tie-breaker, not alphabetical ID.

Execution must:

- process weapons sequentially;
- process shots within a weapon using `launchIntervalMs`;
- log each result in sync with its visual step;
- apply damage/state after that visual hit/miss step;
- stop on destruction and create debris/victory at the corresponding point;
- spend readiness, cooldown, and energy only when a weapon actually begins firing.

Use each weapon’s effective runtime shot count consistently in preview, potential damage, attack plan, animation, and resolution. Squadron weapons multiply base shots by current stack.

The visual plan may show every projectile up to a hard cap of 12. Mechanical resolution remains exact; more than 12 visual shots is not expected in the current design.

Hit/miss visuals:

- All deliveries use the same fixed plan.
- Hits terminate at the target center.
- Miss endpoints are deterministically offset within/near the target hex and stored in the plan.
- Beam misses use the offset endpoint.
- Missile/torpedo hits show their configured impact effect at the target.
- Misses may show a smaller offset explosion according to the configured effect, never a target-centered hit explosion.
- Each missile/torpedo shot has its own trajectory and effect.
- AoE is not implemented; impact radius is visual only.

## Forward hardpoint

Geometry and validation for `forward` with `fore | aft` already exist in the current working tree. Integrate the real Atlas forward hardpoint and forward-compatible catalog weapons with that implementation; preserve exhaustive firing-arc tests.

## Config validation improvements

In addition to the fields above, strengthen validation for:

- known weapon classes and deliveries;
- valid class/delivery combinations;
- known target kinds and nonempty target lists;
- positive integer shots and damage;
- finite/bounded accuracy and critical chance;
- valid `effectiveRange <= maxRange` (effective range remains informational);
- integer cooldown >= 0;
- valid visual fields/ranges;
- variant parent/provenance constraints;
- target eligibility / AA mount constraints;
- hardpoint/loadout references after role removal.

Preserve the existing small-craft-only restriction for `squadronWeapon` hardpoints.

## Deferred `effectiveRange` integration handoff

Create one separate workspace handoff during implementation for a future session integrating `effectiveRange` with a broader line-of-fire/cover overhaul. It must mention:

- `effectiveRange` remains informational in this change;
- the future mechanic should impose range-based accuracy penalties and surface them in preview;
- long-range weapons should be worse at close range;
- short-range/plasma-style weapons should degrade at distance;
- the exact profile representation and penalty values remain open;
- solve it together with the prospective line-of-fire, blockers, cover, and supercover integration.

Do not include AoE in that handoff. The user explicitly considers AoE distant gameplay enrichment, not current foundational work.

## Documentation

Update `docs/design/CONTEXT.md` only where directly affected:

- retain the weapon-slot concept;
- remove primary/auxiliary weapon terms;
- describe independent slot readiness/cooldown, delivery, and allowed target kinds as appropriate.

Do not rewrite retired specs or the entire design document in this implementation.

## Explicitly deferred / excluded

- automatic AA overwatch;
- movement-triggered reaction attacks;
- missile interception;
- missile entities on the board;
- ammunition capacity/replenishment;
- post-launch guidance;
- AoE or splash damage;
- size/mass bonuses for torpedoes;
- effective-range penalties;
- minimum range;
- final numerical balance.

## Acceptance criteria

- Independent catalog and variants validate and are deeply frozen.
- No ship-specific weapon IDs/names remain.
- All agreed hull and squadron loadouts build correctly.
- Atlas uses a forward hardpoint in real gameplay.
- `role`, `primaryReady`, and `auxiliaryReady` are removed.
- Selection uses explicit slot-ID sets.
- Per-slot readiness and cooldown work across round transitions with correct off-by-one behavior.
- Target-kind restrictions are enforced in availability, preview, and attack planning.
- Preview, plan, animation, and applied salvo use the same effective shot counts.
- Squadron losses reduce both primary gun and torpedo salvos.
- Missile and torpedo travel and impacts are visibly distinct and data-driven.
- Hit/miss animation corresponds to fixed attack results.
- Energy, readiness, and cooldown are spent only by slots that actually begin firing.
- Existing geometry, damage, destruction, hazard, and rendering behavior remains covered.
- Tests cover catalog constraints, variant behavior, AA restrictions, cooldowns, energy, early destruction, squadron scaling, animation-plan data, and real loadouts.
- `npm.cmd test`, `npm.cmd run lint`, `npm.cmd run typecheck`, and `npm.cmd run build` pass on Windows.
