# Wargame AR (MVP 40k)

WebXR app (Chrome Android + ARCore) that overlays measurements on a real tabletop.

## Run on the phone (USB)

1. Phone: enable Developer options + USB debugging (MIUI: Settings > About phone > tap "MIUI version" 7 times). Plug USB, accept the prompt.
2. PC, in this folder: `node serve.js 8000`
3. PC: `& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" reverse tcp:8000 tcp:8000`
4. Phone Chrome: `http://localhost:8000` > Démarrer AR. Install "Google Play Services for AR" if asked.

`localhost` through `adb reverse` counts as a secure origin, so WebXR works without HTTPS. Phone needs internet (three.js from CDN).

## Use

- **Calibrer**: aim at both ends of a ruler, enter its real length. Do it first: models placed before calibration shift.
- **Poser**: aim at a base and tap. Pick base size first (the reticle previews it). Tap an existing model to select its unit. **+ Unité** starts a new unit.
- Selected unit shows its move aura (green) and weapon-range aura (unit colour). Enemy models in range get a white halo. Out-of-coherency models turn red (2", 2 neighbours at 7+ models).
- **Mesurer**: 2 taps, base-to-base distance.
- **Déplacer**: tap the model, then its new spot. Red if over M.
- **Tirer**: shooter, then target. Tracer if in range.

Rule maths are in `rules.js`, checked by `node rules.test.mjs`.

## Not done yet

Line of sight / terrain volumes, depth occlusion, multi-player sharing, saving a game, ArUco base tracking.
