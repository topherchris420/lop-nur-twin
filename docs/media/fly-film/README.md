# A Life Three Millimeters Long

A 58-second animated field film for the digital fly, by Vers3Dynamics.

- [Landscape film](a-life-three-millimeters-long.mp4): 1920 × 1080, 30 fps, stereo sound, visible captions and a selectable subtitle track.
- [Vertical social edition](a-life-three-millimeters-long-vertical.mp4): 1080 × 1920, individually composed layouts.
- [JavaScript player](index.html): explicit sound control, pause, scrub, captions, transcript and reduced motion.
- [Watch the fly live](http://150.136.49.49/).
- [WebVTT](captions.vtt) · [SRT](captions.srt) · [Poster](poster.jpg).

GitHub displays a linked poster in the repository README. It does not execute the
JavaScript film inside Markdown. Download the MP4 to play it, or serve this folder
from any static server. The local player needs no model key or build step.

```sh
# From the repository root; open http://localhost:8080/docs/media/fly-film/
python -m http.server 8080 --bind 127.0.0.1
```

## The story and its limits

An enormous world, experienced by something extraordinarily small. The film moves
from an illustrated garden to an enlarged fruit fly, small needs, learning through
movement, server-side continuity, and an invitation to observe it.

The live garden at `http://150.136.49.49/` and the repository's richer 3D Bethesda
fly are distinct implementations. The approximately 3 mm body length comes from
`docs/DIGITAL_FLY.md`; the garden's displayed fly is a stylized illustration.
The film does not claim city-wide physical interaction, biological equivalence,
a neural simulation, or consciousness.

Most scenes are an illustrated interpretation, and the looped route is explicitly
marked illustrative. Scene 6 draws the deployed garden's actual Canvas routines
against a recorded public state (`observation.json`), clipped inside a postcard.
It is neither live footage nor a recording of the 3D research interface. No
pedestrian-swat scene is attributed to the garden implementation.

Two read-only observations of `/api/state` retained the same `life_id` and
`born_at` while `ticks` and `updated_at` advanced. Their relevant fields and the
scope of this check are in `verification.json`. The deployed UI also describes
server-side state and saved memories. This supports the continuity theme for
that deployed garden; it does not establish uninterrupted future uptime,
restart recovery, consciousness, or indefinite survival.

## Production and rights

- Original garden plate: AI-generated for this film, compressed as `garden.jpg`.
  Prompt: hand-inked gouache and cut-paper Bethesda garden, bench, maple leaves,
  asters, pear and rain saucer; ivory, botanical green, copper and spectral teal;
  insect-height viewpoint; no text, humans or insect in the background plate.
- Original fly artwork, motion, camera drift, botanical parallax, typography,
  transitions, layouts and captions: deterministic Canvas 2D in `film.js`.
- Public garden drawing routines in `garden-observation.js`: from the project
  owner's deployed UI, retrieved October 25, 2026. The inset uses recorded state
  without advancing or writing to the server.
- Synthetic documentary narration: Microsoft Edge voice `en-GB-RyanNeural`,
  generated using `edge-tts`. Vers3Dynamics is spoken as “Verse Dynamics.”
- Music and effects: original procedural composition in `compose.py`; no borrowed
  music, sampled recording or third-party soundtrack.
- Source and film deliverables follow the repository's Apache-2.0 license,
  subject to applicable rights in generated and synthetic assets.

Only promotional files and the main README are changed. The film does not import
into the simulator bundle or change its state, API, behavior, or deployment.
The requested rendered media are isolated in this folder.

## Rebuild

The browser player uses browser-native JavaScript, Canvas 2D and a local audio file.
The offline exporter uses the same drawing code, with `@napi-rs/canvas` and FFmpeg.
Install optional production dependencies outside the simulator package:

```sh
npm install --prefix /tmp/fly-film-tools @napi-rs/canvas
export CODEX_PRIMARY_RUNTIME_NODE_MODULES=/tmp/fly-film-tools/node_modules
node docs/media/fly-film/render.mjs --preview
node docs/media/fly-film/render.mjs
node docs/media/fly-film/render.mjs --vertical
```

The checked-in `soundtrack.m4a` is all the renderer needs. To regenerate speech
and music, install `edge-tts`, `numpy` and `scipy` in an isolated Python environment,
then run `narration.py` and `compose.py`. Narration generation requires network
access; no API key is embedded. Voice chunks and intermediate PCM are ignored.
FFmpeg must be on PATH.

The MP4s last 58 seconds. Every scene has its own landscape and portrait composition.
Audio cues use `cues.json`; the score targets −16 LUFS with a −1.5 dBTP ceiling.
The player synchronizes frames to the audio clock. With reduced motion enabled,
it displays still scene compositions. Its explicit switch can override the system
preference for the current page.
