# Alpine Grand Prix

A browser Formula racing game in a single HTML file: a procedural 5 km alpine circuit with a lake and mountains, a 6-DOF vehicle physics model, AI opponents, DRS, timing and a broadcast-style HUD.

**Play:** open the GitHub Pages link for this repository (or `index.html` locally). It needs a desktop browser with WebGL2 and an internet connection to load Three.js from jsDelivr.

## Controls
| Key | Action |
|---|---|
| W / ↑ | Throttle |
| S / ↓ | Brake |
| A D / ← → | Steer |
| F | DRS |
| E / Q | Gear up / down |
| M | Automatic / manual |
| C | Camera |
| R | Reset car |
| Esc | Pause |
| F3 or ` | Debug overlay |

Gamepads are supported.

## Building
The game is edited as modules in `src/`; `./build.sh` concatenates them into `index.html` and `alpine-grand-prix.html`.
