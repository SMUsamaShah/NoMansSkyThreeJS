# No Man's Sky in three.js — Requirements & Goals

This is the project's goal document, compiled from everything the owner has asked for
so far. Treat it as the source of truth for what the project is meant to do.
When reviewing code or planning work: check the implementation against every
requirement here, call out gaps honestly (including "technically done but doesn't
*feel* done" — see Quality Bar), and prefer improving weak areas over adding
unrequested features. Update the Status section and this doc when requirements are
added or met — but never delete or water down a requirement without the owner
saying so.

## 1. Core vision

Recreate the *experience* of No Man's Sky in the browser with three.js:

- A **universe-scale**, seamless, explorable space: fly from deep space to any
  star, approach any planet, land, walk, swim, take off again — no loading
  screens, no cuts.
- **Everything procedural and seeded.** No hand-made or downloaded assets.
  Every planet, plant, sky, and (future) station is generated from the seed, and
  the same seed always produces the same world down to the individual prop
  ("walk away and come back, the same rock is waiting").
- **Every world different.** Planet types, palettes, terrain, flora species and
  skies must vary enough that arriving somewhere new feels like discovery.
- The owner's benchmark comment when only scale was in place: *"Remember this
  project is called no man's sky in three js. Only thing matching so far is the
  size of the universe."* — i.e. scale alone is not the goal; the **feel** of
  NMS (alien worlds, lushness, atmosphere, wonder) is the goal.

## 2. Feature requirements

### 2.1 Universe & travel
- Seeded galaxy with many reachable star systems; warp and manual interstellar
  flight both work.
- Full state machine: space flight → fly-to → landing → walking → takeoff →
  warp, all seamless.
- Underwater: planets with seas are divable (walk the seabed).
- Camera-relative rendering so float precision holds from interstellar space
  down to boot level.

### 2.2 Terrain & LOD — "perfectly seamless"
- Owner's words: moving close to a planet and taking off must *"not show any
  sudden changes in terrain AT ALL. Perfectly seemless."*
- No hard LOD swaps, no popping, geomorphed transitions; verified by the seam
  test (pixel-static parked frames at many altitudes; zero unmorphed level
  changes during descent/landing/takeoff).
- Owner's correction to keep in mind: *"It is not as seemless as you are
  claiming"* — passing the counters is not enough; detail resolving into view
  must also be **perceptually** invisible (prefetch exists for this; keep
  pushing perceived seamlessness).

### 2.3 Atmosphere, clouds, lighting
- Volumetric raymarched clouds near planets (owner asked for them explicitly),
  consistent with the impostor cloud deck, cloud shadows, and transit fog —
  one coverage field drives all of them.
- Modern lighting techniques where three.js supports them (GTAO exists behind
  `?gtao=1`, needs tuning for the log depth buffer before default-on).
- Sky dome (horizon glow, zenith gradient, sun halo), day/night cycle, sunset
  scenes, star dimming in daylight, headlamp at night.

### 2.4 Flora — alien, lush, visible everywhere
- *"Really cool weird trees because these are alien and different worlds. What
  about lush grass? Plants?"*
- Every planet grows its **own species** (seeded grammar): weird trunks and
  canopies (orbs / mushroom caps / fronds / tentacles), shrubs, glowing pod
  plants, real multi-blade grass. Colors derive from the planet's palette with
  alien hue drift; pods glow their accent color at night.
- **No creatures. Ever.** (Owner: "no creatures".)
- **Visible at every distance** — owner's acceptance criterion: *"if this land
  is full of purple trees, it should also look like it has purple trees from
  any distance."* Concretely:
  - No vegetation growing in front of the player's eyes.
  - Near bubble (detailed props) must hand off invisibly to the far tier
    (proxy trees to ~4.5 km), which fades at its rim into canopy-tinted
    terrain, which carries the color all the way to orbit.
  - Tree density/scale at the handoff must match so the forest doesn't thin
    or pop at any boundary.
- **Professional, not bare-bones** — owner: the world looked *"all low poly
  and a bare bones demo, I now want it to look more professional."* Baked
  shading gradients (fake AO), root-to-tip grass gradients, field-soft grass
  normals, contrast between vegetation and ground. When unsure how something
  is done well, **research prior art on the internet** (owner explicitly asked
  for this — e.g. the beautiful three.js grass demos).

### 2.5 Sky backdrop — nebulae and deep space
- Owner: "there should be something like nebula or gas clouds in the space
  too. I dont see that currently." Deep space must have visible **gas
  structure**: filaments, dust lanes, star-forming knots, a galactic band.
- Implemented as a GPU-baked cubemap (`src/nebula.js`) installed as
  `scene.background` — baked once per universe so the shader can be lavish
  while costing one texture fetch per frame. Seeded palette; re-baked on
  "new universe"; fades with `scene.backgroundIntensity` in daylight.
- **Restraint is the requirement**, not decoration: space is mostly black.
  If the sky reads as fog, or objects silhouette black against it, the
  nebula is too bright — structure only reads where most of the sky has
  none. `?nebula=0` disables it for tests.

### 2.5b Legacy sky artifacts (never regress)
- Nebulae and the galaxy band must read as natural scenery, not artifacts.
  Owner's bug report to never regress: *"white halos all around in a circle"*
  (the band segments showing as blobs) and *"coloured spherical halos"*
  (radial-gradient nebulae). Cloudy/streaky generated textures, subtle
  opacity. They are camera-fixed like a real sky (light-years away) — that's
  intended; looking artificial is the bug.

### 2.6 Space stations — PENDING
- *"Space stations should be procedural generated and different from each
  other."*
- Seeded per system; genuinely varied topology (e.g. ring / spine / cross /
  cluster grammars), emissive windows/lights that bloom can pick up, visible
  from space near a planet. No two alike.

### 2.7 Biome-specific audio — built, but OFF by default
- Owner approved the idea, then judged the v0.21 synthesized mix "horrible —
  it was better when there was no sound." Standing rule: **ambience ships
  disabled** (`?audio=1` or the M key opts in) until it genuinely sounds
  good. Raw oscillators/noise won't cut it — the bar is: would you leave it
  on? Prefer fewer, softer, well-filtered layers (convolution/reverb, real
  envelopes) over more layers. Respect autoplay policies; M mutes.

### 2.8 The ship
- Owner: the original blocky ship "looks like a toy" — the ship must read as
  a real spacecraft. Lofted fuselage (not primitive cylinders), glass canopy,
  swept tapered wings with thickness, engine nacelles with visible nozzles,
  plated hull texturing (seams/rivets/streaks as map+bump+roughness),
  navigation strobes. Materials brushed, not chromed — flat panels must not
  mirror-flash the HDR sun into bloom blowouts.
- Stations carry the same bar: untextured hulls are "ugly" (owner) — plating
  with panel seams, vents, hazard markings, at consistent panel scale across
  pieces of very different sizes.

### 2.9 Controls & platforms
- **Flight is throttle-based** (owner: "scroll to zoom/move forward does not
  make sense anymore"). Scroll or W/S sets a persistent cruise throttle the
  ship *accelerates into* — never a teleport-forward impulse. A/D strafe,
  Q/E roll, R/F vertical thrusters, Shift boost, Space brake. Engine
  response acts along the heading while dampeners bleed lateral velocity —
  that asymmetry is what makes it feel like a ship. A visible HUD throttle
  bar is mandatory: a persistent setting must never be invisible. Any jump
  (teleport/land/vista) resets the throttle.
- Desktop: WASD walking on foot, mouse look, click-to-travel, L to land,
  T to take off, jump.
- Touch/mobile: fully playable — drag look, pinch fly, tap-to-travel, virtual
  joystick, jump/takeoff buttons; verified by the touch test suite.
- Performance must stay reasonable on modest GPUs (`?quality=low` path,
  instancing everywhere, capped draw calls).

## 3. Quality bar (how the owner judges work)

1. **Perceptual truth beats metrics.** "The test passes" is not done if the
   eye still catches it. The owner tests by flying around and looking.
2. **Artifacts are bugs** even when they're by-design (see the halo report).
   If it reads wrong, it is wrong.
3. **Worlds must feel alive and varied** — lushness, color, atmosphere.
   "Bare-bones demo" is the failure mode to avoid.
4. **The fidelity north star is Star Citizen's planet look** (owner's
   benchmark). Within the no-assets/procedural constraint, chase it with:
   detail octaves at every scale (micro grain → mid-scale patchiness →
   continental swathes), micro-relief normal work, material response
   (roughness variation, specular life at low sun), aerial perspective,
   and surface texturing on every artificial object. Removing a feature is
   acceptable when it can't yet meet the bar (see audio).
5. Honest reporting: if something is only partially achieved, say so plainly
   (the owner notices overclaiming).

## 3b. The AAA gap — what "Star Citizen in a browser" actually means

The owner asked: *do you understand what look I want, and how far is the
current look from it, and why?* This section is the answer, and it is meant to
be re-derived from real screenshots (`node tools/lookbook.mjs`) rather than
from memory. Update it as items close.

**The target, stated as a rule.** A frame should look *photographed*, not
*rendered*: light behaves physically everywhere, the camera is a physical
instrument with its own flaws, scale is legible through atmosphere, and no
surface is ever a flat untextured colour. "AAA" is not more polygons — it is
the absence of tells. Every item below is a tell.

**Diagnosed from actual frames (v0.21, 2026-07-26).** Ranked by how much
damage each does to the illusion:

0. ~~**Every colour in the project was converted sRGB→linear TWICE.**~~ FIXED
   in v0.25. This one bug is behind most of the "childish / not AAA" verdict.
   three.js ColorManagement is enabled, so `new THREE.Color(hex)` and
   `setHSL()` already store LINEAR working values — and twelve sites then
   called `.convertSRGBToLinear()` on top, squaring the transfer function.
   Effects, measured: terrain land stops arrived at 0.008-0.09 luminance
   instead of 0.09-0.33; rock at ~0.01 instead of ~0.10; sky red at 0.037
   instead of 0.212, i.e. a sky roughly 7x over-saturated in blue. Since
   `skyColorLin` drives the hemisphere light, the fog, the sky dome AND the
   aerial haze colour, everything in frame was tinted by an over-blue, too-dark
   sky while sitting on near-black ground — so the only thing left with colour
   was haze, and every lush world arrived blue-grey whatever its palette said.
   Removing the twelve conversions puts sky R:B at 0.21 (Earth ~0.28), rock at
   0.087-0.111 and snow at 0.49-0.72 with no compensation of any kind. The
   albedo "floor" added earlier was compensating for this and is now a low
   safety net only.
   **Two lessons, both expensive: measure before theorising — this was chased
   through lighting balance, hemisphere intensity, flora saturation and three
   stacked haze terms, all wrong. And when a fix needs a big magic multiplier
   to look right, suspect a double transform rather than tuning the multiplier.**
1. ~~**Metal is black in space.**~~ FIXED in v0.22. `scene.environment` was
   never set; a `metalness: 0.58` hull has no diffuse and gets its entire
   specular from the environment map, so the ship's shadow side was
   arithmetically zero — the hero object was a black paper cutout in every
   space frame. See `src/env.js`.
2. ~~**Nothing casts a contact shadow.**~~ FIXED in v0.22. `shadow.normalBias`
   was a flat 2.0 m — wider than a whole trunk — so every prop pushed its own
   shadow off itself, and the shadow box wasted 2048 texels on ±300 m. Trees
   floated. Box now fits view distance; bias tracks texel size.
3. ~~**No aerial perspective.**~~ FIXED in v0.22. Fog density was 1e-5 above
   2.5 km: an 8% wash over a 30 km vista. Mountains 30 km out arrived as
   saturated as the ground underfoot and the world read diorama-sized. See
   `src/scattering.js` — sun-dependent Mie lobe, so haze goes warm toward the
   sun and cool away from it.
4. ~~**Faceted low-poly canopies.**~~ FIXED in v0.22. Canopies were
   `IcosahedronGeometry(r, 1)` as triangle soup — flat-shaded 80-tri balls on
   sticks, the single loudest "tech demo" signal in every surface frame, and
   exactly what the owner rejected in §2.4. Now indexed, noise-displaced,
   smooth-shaded, occlusion baked, clustered into a crown.
5. ~~**No lens.**~~ FIXED in v0.22 (`src/postfx.js`): sun shafts, anamorphic
   streak, ghosts, vignette, aberration, grain.
5b. ~~**Lush worlds render blue-grey, whatever their palette says.**~~ RESOLVED
   (v0.25). Verified on the exact seed and camera that showed the problem
   (`SEED=ATLAS-7 node tools/_vista.mjs`, 220 m and 1500 m): green hills, blue
   river, aerial perspective grading correctly to blue only on the far ridges.
   No single fix did it — four compounding causes, in rough order of weight:
   the double sRGB→linear conversion (§3b 0); the baked shadow multiplying
   ALBEDO by 0.42, which crushed the sky's contribution everywhere, not just
   in shadow (§3b 12); the hemisphere light cut to 0.62x when IBL landed; and
   three separate blue washes all doing distance haze at once. Each looked
   like "the" cause on its own and none of them was. Original diagnosis kept
   below for the record.
   OPEN, and
   the most important unsolved item. Across two seeds and every altitude, land
   arrives in a narrow blue band. Three stacked blue washes were found and cut
   (legacy FogExp2, valley mist, and the new aerial term all doing distance
   haze at once) which helped only marginally — so the dominant cause is
   elsewhere. Leading suspicion: across most terrain slopes the blue sky
   ambient out-competes the direct sun, and the terrain albedo is dark to
   begin with, so shadowed-facing ground dominates the frame and it is all
   sky-coloured. Compare reference/star-citizen/dunboro-aerial-view-microtech.jpg,
   which is warm and green at the same sun angle. Do NOT attack this by
   desaturating or re-tinting flora: that was tried, and since planet.js
   blends floraPal.canopy into the terrain's forest tint it drained the
   landscape further.
5c. ~~**Hard dark patches on 'cap'-style canopies.**~~ FIXED in v0.23. They were
   `offsetHSL` with a negative LIGHTNESS term applied to lobe colours. That term
   is absolute and clamps at zero, and foliage colours are dark to begin with
   (a lifted canopy sits near 0.06 HSL lightness), so an offset of
   `(rng()-0.55)*0.13` clamped whole lobes to pure black. Found by bisection
   after five wrong guesses: the patches survived with shadow mapping entirely
   disabled, which ruled out self-shadowing and pointed at albedo. Lobe tinting
   now varies value MULTIPLICATIVELY (`lobeTint`), which cannot reach zero.
   Zero sub-0.02 vertices across three seeds and all three species, down from
   171. **Lesson worth keeping: never use offsetHSL's lightness term to darken
   an already-dark colour.**
6. **Vegetation silhouettes do not break up.** Partly addressed — canopies now
   carry rim clumps and scalloped lathes, so the outline is overlapping masses
   rather than one arc. Still far from needle-level break-up. Canopies are smooth solids with
   scalloped rims; SC conifers dissolve into needles at the outline. This is a
   geometry/instancing problem, not a shader one, and is the remaining
   structural gap on vegetation.
7. **The sun is a featureless white disc.** No limb darkening, no corona
   structure. It blows to flat white and stays there. OPEN.
8. **Clouds are flat blobs with visible polygon edges.** A straight seam cuts
   through the deck at altitude — a plane edge showing through. OPEN.
9. ~~**Ground is an untextured colour ramp.**~~ Largely addressed. Two relief
   bands were missing, not one: sub-metre grain inside 25 m (the metre a
   standing player looks down at), and ~26 m relief from 160 m out to a couple
   of km. The existing normal perturbation ran at ~3 m, which is sub-pixel past
   a few hundred metres and averaged away to nothing, so every hill between
   100 m and 2 km shaded like a smooth shell. That was much of why vistas read
   soft next to daymar-122019-min.jpg, where erosion texture is legible at
   every range. The two bands hand over rather than stack. The foreground metre of
   a surface frame — the part closest to the eye — is the emptiest part of the
   image. OPEN.
10. **The star field is uniform dots.** Real skies have a steep magnitude
   distribution, colour by spectral class, and clustering. OPEN.
11. **The HUD is a web overlay**, not an instrument: rounded rectangles and
    body text floating over the world. OPEN.

**Standing method.** Look at the game before and after every change
(`tools/lookbook.mjs` is the stable spread; `tools/harness.mjs` makes new
probes cheap). Judge the image, not the counter — and judge it *against a
reference*, not against memory. `reference/` holds 18 frames each from Star
Citizen and Elite Dangerous, indexed by the property each one demonstrates
(aerial perspective, limb, eye-level ground, vegetation scale, hardware,
sky restraint, clouds); `reference/README.md` says what to look for in each
and which requirement it backs. Refresh with `node tools/fetch_reference.mjs`.

12. ~~**Shadow-to-ambient contrast is too high.**~~ LARGELY FIXED (v0.25).
    The measured light balance was already healthy — sun 2.75 against ambient
    1.05, a 0.275 shadowed/lit ratio. The culprit was the baked shadow term
    multiplying *diffuseColor* by 0.42, which darkens the surface's response to
    every light source including the sky, which a shadow does not block. At
    0.72 shadowed ground reads as shadowed grass rather than black. Original
    finding kept below.
    Shadowed ground drops to
    near-black; in `reference/star-citizen/dunboro-aerial-view-microtech.jpg`
    shadowed grass stays green and readable, because it is still lit by the
    whole sky. This is the real defect behind the big dark region on surface
    frames — which is itself NOT an artifact, see below. OPEN, and it is a
    lighting-balance problem, not a shadowing bug.

**Closed by bisection, recorded so it is not re-investigated.** A large
hard-edged dark region on surface frames (`screenshots/darkbisect/`) is a
*legitimate cast shadow* from a ridge out of frame — a long straight crest
casts a long straight shadow. `?shadow=0` removes it only because it removes
all shadows. Ruled out first, each costing a round trip: the shadow-box
boundary (70 m → 150 m, no change), the sea (grass is visible *inside* the
region), water opacity (Fresnel alpha added, no visible change), and shadow
depth precision (near/far tightened from an 8.4 km span to ~2.5 km, no change —
though that is a genuine quality improvement and was kept). Four wrong
structural guesses preceded the bisect; `tools/_darkbisect.mjs` settled it in
three shots. **Bisect first.**

## 3c. Terrain/vegetation research report — what we take, what we reject

A research report ("Building a Procedural Ground-to-Space Terrain System in
Three.js") was supplied 2026-07-26. It was scoped to a *greenfield* project with
a no-build/CDN constraint, so much of it describes work already done here. The
useful residue is real, though, and is recorded below so it is not re-derived.

**Rejected — its headline recommendation.** The report's central advice is
"build a flat CDLOD/clipmap heightfield, NOT a cube-sphere planet," to dodge
cube-face seams and float breakdown. **We do not take this.** It is sound advice
for its stated brief and wrong for ours: §2.1 requires flying from deep space to
any star and orbiting real planets, and the cube-sphere quadtree with geomorphed
LOD, seam tests and camera-relative rendering is the most mature system in this
repo. Its own "thresholds that change the plan" note concedes the point —
curvature and true orbit mean cube-sphere. The two problems it warns about are
already solved here (camera-relative rendering *is* the floating origin;
`npm run seamtest` guards the faces).

**Already done, no action:** logarithmic depth buffer; floating origin;
vegetation folded into terrain albedo at distance (§2.4's far tier → canopy
tint, which the report calls its single most important insight); Whittaker-style
biomes; seeded simplex fBm/ridged/domain-warped noise; macro+detail blending;
triplanar on terrain; instanced everything.

**Correction to a first reading of this report.** Two items were initially
logged here as gaps and are not: `height()` *already* has a province field
(`belt` / `plainsCalm`) that is exactly the Minecraft-1.18 erosion axis — calm
plains against rugged belts — and it *already* carves dendritic drainage via
`canyonAmp` plus a finer tributary pass. Check the code before believing a
report about it, including this section.

**Taken — ranked. Items 1–2 are done; the rest are not started.**
1. **DONE (v0.23) — ground litter at many sizes.** The real gap against
   `reference/star-citizen/daymar-122019-min.jpg` was not terrain shape, it was
   that the ground was *bare*. Scatter density is the probability a 9 m cell
   picks a kind at all, so `sand` summing to 0.135 left 86% of the surface
   empty. Stone now spawns several per cell over a wide size range which
   `propScale`'s skew turns into a power law — mostly grit, occasional
   boulder — and lies at a random angle instead of standing on end.
2. **DONE (v0.23) — one size distribution across both flora tiers.**
   `propScale` is exported and used by the near bubble *and* the far proxy
   tier, because §2.4 requires their mean scale to agree. Tree ranges widened
   to ~0.5–2.3 so one geometry reads as saplings through giants.
3. **View-space thickening for grass** (Ghost of Tsushima): rotate near-edge-on
   blades toward the camera so they never vanish. Our blades are real
   `frond()` geometry rendered DoubleSide, so this applies directly — but the
   grass normals are overwritten to +Y for field-soft lighting, so it needs a
   per-vertex blade-facing attribute added in `buildGrassTuft`.
4. **Stochastic / hex tiling** (Quílez texture-repetition) on the detail
   texture. At the near-field octave (~0.35 m) the 256px tile repeats hundreds
   of times across a vista. Costs extra samples — measure.
5. **Octahedral impostors** for the far flora tier, replacing ~40-triangle
   proxies. Would raise achievable density enough to attack the
   "monoculture at one scale" gap (§3b item 4's successor).
6. **More than two tree species per planet.** The deepest cause of the
   monoculture look: `buildFlora` builds exactly `tree0`/`tree1`, and one
   recipe entry usually dominates a biome.
7. **Hydraulic/thermal erosion** as a *detail* pass — the province and canyon
   systems give large-scale character, but there are no sediment fans or fine
   rill networks. Erosion is a grid simulation, not a closed-form function of
   a direction, so the report's bake-into-tiling-detail-heightmaps route is
   the only one compatible with our LOD/determinism rules.
8. **Web Workers for chunk generation.** We build on the main thread against a
   millisecond budget; transferable `ArrayBuffer`s would remove the hitch
   ceiling rather than manage it.
9. **`BatchedMesh`** (r156+) to consolidate draw calls (currently 850–1000).

**To verify, not assume:** the report claims the logarithmic depth buffer
degrades MSAA where geometry intersects (three.js #22017) and recommends
post-process FXAA/SMAA instead. We run `logarithmicDepthBuffer: true` *and* a
4-sample MSAA composer target, so if true this affects us directly — check it
before acting. Its Ghost of Tsushima LOD numbers are second-hand (it says so),
and several performance claims are sourced to vendor blog posts.

## 4. Engineering constraints & practices

- **Determinism**: generation is a pure function of the seed. Never let placement
  or species depend on camera path, draw order, or rng draw-order drift. The
  sanity suite enforces walk-stability and rebuild determinism — keep it green.
- **No assets**: geometry, textures, and (future) audio are all generated in
  code at runtime.
- **three.js**: currently vendored r170 (`vendor/three.module.js`); an upgrade
  to latest (r18x/WebGPU) is a future task — the owner expects modern renderer
  capabilities where they help.
- **Test suites** (all must stay green before a release):
  - `node tools/sanity.js` — node-side: terrain sanity, LOD consistency,
    geomorph settling, scatter/far-flora determinism, instance caps.
  - `npm run seamtest` — descent/landing/takeoff seam counters + pixel diffs.
  - `npm run shots` — ~24 fixed scenarios, screenshot + no page errors.
  - `npm run touchtest` — 13 mobile gesture checks.
  - Visual probes (`tools/_*probe*.mjs`) for flora/sky/approach — review the
    actual images, not just exit codes (SwiftShader headless with
    `--enable-unsafe-swiftshader`; the shader-validation console dump that
    mentions `isPerspectiveMatrix`/`VALIDATE_STATUS` for the *sky dome* was a
    real bug, now fixed — don't assume console errors are benign).
- **Versioning**: bump `src/version.js` + `package.json` on every pushed change
  that affects the app, so the owner can confirm which build they're looking at
  (shown bottom-left in the UI; stale caches lie).
- **Screenshot-verify changes in many different settings** (owner asked for
  breadth explicitly): multiple seeds, planet types, altitudes, times of day —
  `tools/explore.js`, `tools/_flora_probe.mjs`, `tools/_v20_probe.mjs`.
- Commit and push in small increments (the remote container can revert the
  working tree without warning; origin is the source of truth).

## 5. Status snapshot (v0.25.0, 2026-07-27)

Done and verified this pass (see §3b for the full ranked gap list):
- **Colour space corrected.** Twelve sites were converting sRGB to linear a
  second time on values three.js had already converted. This was the single
  biggest defect in the project and the cause of the "childish / not AAA"
  verdict — see §3b item 0.
- Image-based lighting (`src/env.js`); metals are no longer black in space.
- Aerial perspective with a sun-dependent Mie lobe (`src/scattering.js`).
- A cinematic lens pass (`src/postfx.js`): shafts, anamorphic streak, ghosts,
  vignette, aberration, grain.
- Integrated single-scattering planetary limb replacing a Fresnel rim.
- Shadows that actually land (normalBias was wider than a tree trunk).
- Flora: smooth noise-displaced canopies, three species per world with
  guaranteed-distinct silhouettes, rim clumps breaking the outline, triplanar
  surface detail, muted colour.
- Ground litter at power-law sizes; per-kind scatter reach.
- Terrain relief in three bands (sub-metre, ~3 m, ~26 m) instead of one.

Tools added, all of which earned their keep by finding bugs no screenshot
review had: `NMS.lightProbe()` (found the black albedo), `?shadow=0` (found the
canopy patches), `?farflora=0` (found the confetti source), `NMS.vista()`,
`tools/harness.mjs`, `tools/lookbook.mjs`, `tools/_smoke.mjs`,
`reference/` + `tools/fetch_reference.mjs`.

Pending / next (owner's priority order, detail in §3b and §3c):
1. Far-tier confetti — spacing-bound, needs octahedral impostors.
2. Vegetation silhouette break-up beyond rim clumps.
3. Clouds: flat blobs with visible polygon edges.
4. Station and ship greeble density against `reference/`.
5. Star field magnitude/colour distribution; the HUD as an instrument.
6. three.js upgrade / WebGPU evaluation.

Known cosmetic issues (logged, not blocking): faint parallel streaks over
horizon suns; moon landings can spawn in dense forest; ice plains featureless
up close.
