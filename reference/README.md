# Reference frames — the bar

36 frames from **Star Citizen** and **Elite Dangerous**, the two games named as
this project's fidelity north star (requirements §3.4). They are here so that
"does this look AAA yet?" is answered by putting two images side by side, not
by anyone's memory of what those games look like.

Refresh or extend with `node tools/fetch_reference.mjs`. Provenance for every
file — original wiki title and source URL — is in `manifest.json`.

## Rights

These are **copyrighted screenshots** of commercial games: Star Citizen ©
Cloud Imperium Games, Elite Dangerous © Frontier Developments. They are
included as unmodified visual reference for development comparison, downscaled
to 1600 px. They are not project assets, nothing here is redistributed as our
own work, and nothing here is used in the build — the no-assets rule (§4) is
untouched, since every pixel the game ships is still generated in code. If this
repository ever goes public and that is a concern, delete the two image
directories; `tools/fetch_reference.mjs` reproduces them on demand.

## How to use these

Pick the reference that matches the shot you are judging, put it beside the
matching frame from `tools/lookbook.mjs`, and look for the specific thing the
reference is filed under. Vague comparison produces vague work.

### Aerial perspective and scale
`star-citizen/microtech-01-122019-min.jpg` · `daymar-122019-min.jpg` ·
`dunboro-aerial-view-microtech.jpg` · `elite-dangerous/canyon-planet.jpg`

Count the depth planes. There are five or six, each lighter and flatter than
the one in front. The far valley is nearly gone into pale haze while the
foreground is fully saturated. This one property does most of the work of
making a planet feel planet-sized, and it is the reason our vistas used to
read as a diorama.

### The limb and terminator
`elite-dangerous/ed-odyssey-atmospheric-planet.jpg` · `sunset-on-aquari.jpg` ·
`star-rise-over-a-planet.jpg` · `star-citizen/arccorp-area18-low-orbit.jpg` ·
`pyro-i-from-orbit.jpg`

The atmosphere glows across kilometres — white-hot against the surface, out
through cyan to deep blue to black — and it is far brighter on the sun side.
Note in `sunset-on-aquari` how much of the frame is *black*, and how the limb
still reads. That restraint is the target for §2.5 too.

### Ground at eye level
`star-citizen/drifters-microtech.jpg` · `daymar-122019-min.jpg` ·
`elite-dangerous/oxygen-atmosphere-2-srv.jpg`

There is no flat colour anywhere. Wind ripples in snow, scattered stones at
four or five sizes, erosion channels, and long hard cast shadows off every
rock. The nearest metre of ground is the most detailed part of the frame, not
the emptiest.

### Vegetation
`star-citizen/dunboro-aerial-view-microtech.jpg` · `microtech-01-122019-min.jpg`

Trees are **small relative to the terrain** and vary enormously in size — many
young and short, a few tall. Density falls off naturally into the haze rather
than ending at a bubble. Ours are still closer to a monoculture at one scale.

### Hardware
`elite-dangerous/ed-odyssey-desert-planet-cobra-mk3.jpg` ·
`ed-odyssey-atmospheric-planet.jpg` · `star-citizen/syulen-leaving-microtech.jpg`

The shadow side of a hull is never black — it is filled by the environment and
carries a bright rim where the sun grazes it. Panel-line and greeble density is
far beyond ours. Engine plumes are long and soft, not short stubs.

### Sky, nebulae, rings
`elite-dangerous/horsehead-nebula.jpg` · `california-nebula-2.jpg` ·
`gas-giant-planetary-ring-col-359-sector-mw-v-d2-62.jpg` ·
`planetary-ring-imperial-clipper.jpg`

Structure lives in a few regions and the rest of the sky is genuinely black,
with a steep star magnitude distribution — most stars are barely there. This
is the standing argument for the restraint rule in §2.5.

### Clouds
`star-citizen/aresion-microtech-volumetricclouds.jpg` · `arccorp-clouds.jpg`

Volume, self-shadowing, and a lit rim facing the sun. No flat blobs, and never
a visible polygon edge.
