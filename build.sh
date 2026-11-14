#!/bin/sh
# Concatenate source modules into the single deliverable HTML file.
# index.html is the same file, so GitHub Pages serves the game at the site root.
cd "$(dirname "$0")"
cat src/00_head.html src/01_core.js src/02_track.js src/03_world.js src/04_facilities.js src/05_car.js src/06_physics.js src/07_systems.js src/08_main.js > alpine-grand-prix.html
cp alpine-grand-prix.html index.html
