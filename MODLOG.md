
## Collision tile shapes (probe_tiles.lua, verified on oracle)
Cell 30x30, local coords. type1 full; type2 solid x+y>=30 (bottom-right tri); type3 solid x<=y (bottom-left);
type4 solid x>=y (top-right); type5 solid x+y<=30 (top-left). Outside cell = empty.

## Collision engine (src/engine/collision.ts) — verified against the oracle
- Tests: tests/collide_test.ts (hall_1, 22 cases), slope_test.ts (140 random cases on _flat_test), ray_test.ts (945 tiny-box rays on slope tiles), push_test.ts (77 push cases). All match the original (except float32 last-digit rounding).
- Sweep = SAT over x, y and slope-edge normals; an axis on which the shapes already overlap at the start does NOT limit the move (so a box overlapping a tile in x can hit its underside after moving away in x). Starting inside everything -> moves freely (the original blocks the x component in some deep-wall cases; not reproduced).
- slide: contact at t, pull back min(1, t*|d|) along d (never behind the start), remaining projected on the surface tangent; up to 4 iterations. stop: same pull back, returns hit flag.
- push (collide_and_push): only entities with PushableComponent; gap g to box along the contact normal: if 3g<d then player moves d/4 & box (5d-7g)/16, else player d/2 & box (d-g)/4 (fitted to the original; probe_push*.lua).
- Triggers: _Trigger(logic,aabb) detects after the items of its logic node update (before waits); enter/leave called on the _Triggerable fields; removing a trigger/triggerable entity does not fire leave; removing the triggerable clears its inside-set; strict overlap.
