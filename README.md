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
- **Poser**: aim at a base and tap. Pick base size first (the reticle previews it). Tap an existing model to select its unit. **+ Unité** starts a new unit, **J1/J2** sets its side.
- **Unit sheet** (tap the unit name): name, type (Infanterie/Bête/Nuée or Véhicule/Monstre/autre, drives cover and Hidden), M, OC, Ld, PV (W) and a list of weapons with their ranges. The weapon picker next to the unit name chooses which range the aura, halos and shots use.
- **Blesser**: set the damage, tap a model. Models with more than 1 PV show their remaining wounds; at 0 the model is removed (excess damage is lost).
- **▾** folds the tool rows, leaving only the mode bar.
- **Phase button** (`T1 J1 · Commandement ›`): ends the current phase. Objective control is settled at each phase end; after Combat the next player's turn starts (J1 plays odd turns) and the app lists the units that must take a battle-shock test.
- **Moral 2D6**: battle-shock roll for the selected unit (2D6 ≥ Ld). Battle-shocked units have OC '-'. The unit label shows `n/start`, `½` at half-strength, `ébranlée`, `cachée`.
- **Retirer fig.**: before the first phase change it fixes the deployment (starting strength follows); afterwards it is a casualty.
- Hidden models are drawn faded.
- Selected unit shows its move aura (green) and weapon-range aura (unit colour). Enemy models it can shoot (range + visibility) get a white halo.
- Model ring colours: red = out of coherency, orange = engaged (within 2" of an enemy).
- **Mesurer**: 2 taps, base-to-base distance.
- **Déplacer**: tap the model, then its new spot. Red if over the allowance.
- **Tirer**: shooter, then target. Checks range and visibility; tells when the target unit has the benefit of cover (BS -1).
- **Avance D6** (M + D6) / **Charge 2D6**: change the move aura. After a charge roll, the halo shows enemies within 12" that the roll can reach (roll + 2" engagement).
- **Décor**: 2 corners of one side, then the opposite side. Type: dense / light (obscuring) or exposed. **Retirer décor** removes the last one.
- **Objectif**: tap to place a 40mm marker (3" range), tap inside a terrain area to make it a terrain objective, tap a marker to remove it. With **Sécuriser** selected, tap an objective to secure it for its controller. Each objective shows the live OC total per player (`[S]` = secured) and is coloured by the player controlling it since the last phase end.

## 11th edition rules used (`rules.js`, tested by `node rules.test.mjs`)

| Rule | Value |
|---|---|
| Coherency (03.03) | within 2" of one other model, and within 9" of every other model |
| Engagement range (03.04) | 2" |
| Advance (09.06) | M + D6 |
| Charge (11.04) | 2D6, targets within 12", must end engaged |
| Obscuring (13.10) | light/dense areas block sight lines, except areas either model is within |
| Benefit of cover (13.08) | every target model (INFANTRY/BEASTS/SWARM) within a terrain area, or not fully visible behind terrain: BS -1 |
| Hidden (13.09) | INFANTRY/BEASTS/SWARM within a light/dense area, no ranged attack this turn or last: only visible within 15" |
| Gone to ground (13.11.01) | hidden and partly behind dense terrain: detection 12" |
| Objective marker (14.01.01) | 40mm, 3" range; terrain objective: within the area |
| Level of control (14.02) | sum of OC in range at each phase end, highest wins, tie = nobody |
| Secured (14.03) | kept until the opponent's level is greater at a phase end |
| Battle-shock (01.07, 08.03) | 2D6 ≥ Ld; tested if shocked or at/below half-strength; OC '-' |
| Half-strength (01.02.01) | models ≤ half the starting strength; single-model unit: wounds ≤ half W |

Simplifications: everything is 2D (heights and the 5" vertical limits ignored); sight lines are sampled between 5 points per base; a terrain footprint stands in for its walls, so Solid (13.11, closed gaps under 3") is treated like Obscuring; a shot made in Tirer mode counts as the unit's ranged attack for Hidden; charge reach ignores pathing; which rules secure an objective is up to the players.

## Two phones (shared game)

Open the page with the same room on both phones, e.g. `http://<PC>:8000/?room=partie1`. `serve.js` relays the game state between them.

- Each player sets the **Repères** on the same 2 physical points: positions are exchanged in that table frame, so each phone sees the other's moves in the right place.
- Only real game changes are sent (not selections); if both players edit at the same instant, the last one wins.
- The second phone also needs a secure origin for WebXR: either a second USB cable + `adb reverse`, or on that phone `chrome://flags/#unsafely-treat-insecure-origin-as-secure` with `http://<PC IP>:8000`.
- The relay has no authentication: use it on a home network only. `serve.js` never serves dot-folders (`.git`, `.claude`).

## Depth occlusion (experimental)

Tick **Occlusion par la profondeur** before starting AR. With the ARCore Depth API (the Redmi Note 11 Pro supports it), rings, auras, terrain and objectives are hidden where a real object stands in front of them (2 cm tolerance so the table itself does not hide them). If the phone does not provide depth, the app says so and works as before.

## Desktop testing

Open `http://localhost:8000/#debug` and drive the handlers from the console, e.g. `dbg.tap('place', 0.1, 0.1)` (metres). Two tabs with `?room=x#debug` test the shared game.

## Not done yet

ArUco base tracking, model/terrain heights for sight lines.
