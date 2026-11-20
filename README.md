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
- **Tirer**: shooter, then target. Checks range and line of sight, tells if the target has cover. Tracer if the shot is legal.
- **Décor**: aim at 2 corners of one side of a ruin, then the opposite side. "Bloque la vue" on = obscuring (can see into, not through), off = cover only. **Retirer décor** removes the last one.
- **J1 / J2**: side of the selected or next unit. Halos only show enemy models.
- **Avance D6**: move aura becomes M + D6. **Charge 2D6**: move aura becomes the roll, and enemies reachable within roll + 1" get a halo. The roll is cleared when you select another unit.

Rule maths are in `rules.js`, checked by `node rules.test.mjs`.

Line of sight is 2D: footprints only, heights ignored. It tests 5 points per base (centre + rim), so it is close to "any part of the model" but not exact.

## Not done yet

Depth occlusion, multi-player sharing, saving a game, ArUco base tracking, model/terrain heights for LoS.
