# Wargame AR (Warhammer 40,000, 11th edition)

WebXR app (Chrome Android + ARCore) that overlays measurements on a real tabletop.

## Run on the phone (USB)

1. Phone: enable Developer options + USB debugging (MIUI: Settings > About phone > tap "MIUI version" 7 times). Plug USB, accept the prompt.
2. PC, in this folder: `node serve.js 8000`
3. PC: `& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" reverse tcp:8000 tcp:8000`
4. Phone Chrome: `http://localhost:8000` > Démarrer AR. Install "Google Play Services for AR" if asked.

`localhost` through `adb reverse` counts as a secure origin, so WebXR works without HTTPS. Phone needs internet (three.js from CDN).

## Use

Recommended order: **Calibrer**, **Repères**, then place terrain, objectives and models.

- **Calibrer**: aim at both ends of a ruler, enter its real length.
- **Repères**: aim at 2 fixed points of the table (e.g. 2 corners). The game is then saved continuously, relative to those points. Do it again to fix tracking drift, or after restarting the app to resume the saved game. "Nouvelle partie" on the start screen forgets the save.
- **Poser**: aim at a base and tap. Pick base size first (the reticle previews it). Tap an existing model to select its unit. **+ Unité** starts a new unit, **J1/J2** sets its side, **M / Portée / OC** its stats.
- Selected unit shows its move aura (green) and weapon-range aura (unit colour). Enemy models it can shoot (range + visibility) get a white halo.
- Model ring colours: red = out of coherency, orange = engaged (within 2" of an enemy).
- **Mesurer**: 2 taps, base-to-base distance.
- **Déplacer**: tap the model, then its new spot. Red if over the allowance.
- **Tirer**: shooter, then target. Checks range and visibility; tells when the target unit has the benefit of cover (BS -1).
- **Avance D6** (M + D6) / **Charge 2D6**: change the move aura. After a charge roll, the halo shows enemies within 12" that the roll can reach (roll + 2" engagement).
- **Décor**: 2 corners of one side, then the opposite side. Type: dense / light (obscuring) or exposed. **Retirer décor** removes the last one.
- **Objectif**: tap to place a 40mm marker (3" range), tap inside a terrain area to make it a terrain objective, tap a marker to remove it. Each objective shows the OC total per player and is coloured by the controlling player.

## 11th edition rules used (`rules.js`, tested by `node rules.test.mjs`)

| Rule | Value |
|---|---|
| Coherency (03.03) | within 2" of one other model, and within 9" of every other model |
| Engagement range (03.04) | 2" |
| Advance (09.06) | M + D6 |
| Charge (11.04) | 2D6, targets within 12", must end engaged |
| Obscuring (13.10) | light/dense areas block sight lines, except areas either model is within |
| Benefit of cover (13.08) | every target model within a terrain area or not fully visible: BS -1 |
| Objective marker (14.01.01) | 40mm, 3" range; terrain objective: within the area |
| Level of control (14.02) | sum of OC in range, highest wins, tie = nobody |

Simplifications: everything is 2D (heights and the 5" vertical limits ignored); sight lines are sampled between 5 points per base; target units are assumed INFANTRY for cover; Hidden (13.09), Solid gaps (13.11), secured objectives and battle-shock are not tracked; charge reach ignores pathing.

## Desktop testing

Open `http://localhost:8000/#debug` and drive the handlers from the console, e.g. `dbg.tap('place', 0.1, 0.1)` (metres).

## Not done yet

Depth occlusion, multiplayer sharing, ArUco base tracking, model/terrain heights for sight lines.
