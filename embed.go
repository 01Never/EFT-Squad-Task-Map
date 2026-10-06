package main

import "embed"

// builtInFiles are compiled into the exe: the page (served as-is, no bundler: index.html, the shared
// stylesheets in web/css, the modules and feature stylesheets in web/js), the map art, map
// settings, fonts and the game-data snapshot used when there's no download yet.
// (go:embed paths are relative to this file, so it must sit at the repo root.)
//
//go:embed web/index.html web/css web/js assets/*.svg assets/maps-config.json assets/fonts.json assets/game-data.json
var builtInFiles embed.FS
