# Alpine Grand Prix — Nürburgring Nordschleife

A browser racing game in a single HTML file. You drive the full 20.6 km Nürburgring Nordschleife, rebuilt from real map and height data, against AI opponents. It has a 6-DOF vehicle physics model, timing and a broadcast-style HUD.

**Play:** open the GitHub Pages link for this repository (or `index.html` locally). It runs in desktop and phone browsers with WebGL (Chrome, Edge, Firefox, Safari, Android, iPhone and iPad). It needs an internet connection to load Three.js from jsDelivr.

## Cars
Pick one of five cars. Every car shifts automatically.

| Car | Engine | Drive | Gearbox |
|---|---|---|---|
| Hyundai i30 N DCT | 2.0 turbo I4, 280 PS | FWD | 8-speed DCT |
| Hyundai i20 N Rally1 (WRC car, tarmac set-up; more grip on grass and gravel) | 1.6 turbo I4 + hybrid, about 500 PS | AWD | 5-speed sequential, shifted automatically |
| Nissan GT-R NISMO (R35) | 3.8 twin-turbo V6, 600 PS | AWD | 6-speed DCT |
| BMW M3 CS | 3.0 twin-turbo I6, 550 PS | AWD | 8-speed automatic |
| Porsche 911 GT3 RS | 4.0 flat-six, 525 PS | RWD | 7-speed PDK, DRS wing |

Opponents can drive the same car as you or a mixed field.

The car names and published figures (power, torque, mass, dimensions, gearing) describe real models. The bodies are simple procedural shapes, and no manufacturer logos or badges are used. This is a fan project, not affiliated with or endorsed by any carmaker or the Nürburgring.

## Controls
| Key | Action |
|---|---|
| W / ↑ | Throttle |
| S / ↓ | Brake |
| A D / ← → | Steer |
| F | DRS (911 GT3 RS only) |
| C | Camera |
| R | Reset car |
| Esc | Pause |
| F3 or ` | Debug overlay |

Gamepads are supported. On phones, on-screen touch controls appear.

## Data credits
- Track centreline: © OpenStreetMap contributors, available under the Open Database License (ODbL 1.0), route relation 38566.
- Elevation: EU-DEM v1.1 (25 m), © European Union, Copernicus Land Monitoring Service, accessed through OpenTopoData.

## Building
The game is edited as modules in `src/`; `./build.sh` concatenates them into `index.html` and `alpine-grand-prix.html`.
