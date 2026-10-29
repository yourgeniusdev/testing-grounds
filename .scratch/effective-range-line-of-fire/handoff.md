# Handoff: effective range and line of fire

## Status

`effectiveRange` is catalog data and remains informational in the weapon redesign. Current attacks continue to use `maxRange` as the hard range limit.

## Future integration

Implement effective range together with the prospective line-of-fire overhaul:

- impose range-based accuracy penalties and expose every penalty in attack preview;
- make long-range weapons perform worse at close range;
- make short-range and plasma-style weapons degrade with distance;
- choose the exact range-profile representation and penalty values during that design pass;
- solve range profiles alongside line of fire, intervening blockers, cover, and hex supercover behavior so preview and resolution use one geometry result.

AoE and splash damage are outside this handoff.
