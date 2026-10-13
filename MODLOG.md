
## Collision tile shapes (probe_tiles.lua, verified on oracle)
Cell 30x30, local coords. type1 full; type2 solid x+y>=30 (bottom-right tri); type3 solid x<=y (bottom-left);
type4 solid x>=y (top-right); type5 solid x+y<=30 (top-left). Outside cell = empty.

## Collision engine (src/engine/collision.ts) — verified against the oracle
- Tests: tests/collide_test.ts (hall_1, 22 cases), slope_test.ts (140 random cases on _flat_test), ray_test.ts (945 tiny-box rays on slope tiles), push_test.ts (77 push cases). All match the original (except float32 last-digit rounding).
- Sweep = SAT over x, y and slope-edge normals; an axis on which the shapes already overlap at the start does NOT limit the move (so a box overlapping a tile in x can hit its underside after moving away in x). Starting inside everything -> moves freely (the original blocks the x component in some deep-wall cases; not reproduced).
- slide: contact at t, pull back min(1, t*|d|) along d (never behind the start), remaining projected on the surface tangent; up to 4 iterations. stop: same pull back, returns hit flag.
- push (collide_and_push): only entities with PushableComponent; gap g to box along the contact normal: if 3g<d then player moves d/4 & box (5d-7g)/16, else player d/2 & box (d-g)/4 (fitted to the original; probe_push*.lua).
- Triggers: _Trigger(logic,aabb) detects after the items of its logic node update (before waits); enter/leave called on the _Triggerable fields; removing a trigger/triggerable entity does not fire leave; removing the triggerable clears its inside-set; strict overlap.

## 2026-10-13 — playable port, native ghosts, release 1.0.0
- Engine runs the original bytecode end to end: opening logos, slots, menu, cutscene, all 24 maps (tools/soak.ts: random keys, 3000 ticks per map, 0 Lua errors).
- Native TC::Ghost reconstructed from the i386 disassembly (research/ghost_asm_annot.txt; Ghost::update/walk_movement/goto_position/getCardinal/changeAnim/calculateRepel): src/engine/ghost.ts. Verified with seeded traces of the real engine (research/probe/trace_ghost.lua.tpl, tg_*.lua): states, positions and animation names identical up to 1 ulp of float32.
- math.random was NOT glibc-exact; fixed (seed 1 -> 1804289383, seed 42 -> 71876166). The original also shares libc rand() with the natives.
- Positions are float32 (Math.fround on every store in collision/ghost).
- Input: down = press edge, pressed = held, up = release edge (measured). DialogManager timing measured (research/probe/probe_dialog*.lua, cap.sh).
- Web: public/game (core.pak 12.8 MB + late.pak 11.3 MB + sounds), images that have not arrived are skipped (no synchronous requests), fonts preloaded, saves in localStorage (export/import .json), touch gamepad. Desktop: copy of the Ded Rust player/installer (boo.exe, Boo-Instalador.exe), release v1.0.0 published.
- Known gaps: a box that starts inside a wall moves freely (the original blocks x in some cases); pixel-exact text vs SDL_ttf is approximate (advances rounded, same layout); audio untested on real devices; only the first levels' images are in core.pak.
