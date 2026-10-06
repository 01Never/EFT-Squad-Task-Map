# Drawing

**What it does (player's view):** ✎ Draw on the map toolbar turns the map into a whiteboard: pick
a colour and a line width, draw with the mouse or a finger, undo / redo (also Ctrl+Z /
Ctrl+Shift+Z), clear the map's drawings, or hide them with Show. Drawings are per map and saved.

**Where the data comes from:** the saved data (`draw[map]`, `dcolor`, `dwidth`, `prefs[map].drawOn`).

**The rules** (`rules.js`):
- A line is saved in game coordinates (2 decimals), so it stays put if the map art changes, with
  its width in game units (`strokeForSaving()`).
- The width you pick is in screen pixels at the zoom you draw at (`DRAW_WIDTH_MIN_PIXELS` = 2 to
  `DRAW_WIDTH_MAX_PIXELS` = 16).
- Lines are simplified before saving (Douglas–Peucker, `simplifyStroke()`): points closer than a
  quarter of the line's width to the simplified line are dropped.
- A click without moving draws a dot.
- A second finger (pinch) drops the line being drawn. Redo history is lost when you draw a new line
  and isn't saved.

**Flow:** pointer down / move / up on the map in draw mode → `map/input.js` → `startStroke()`,
`extendStroke()`, `finishStroke()` → save → `renderDrawings()` and `renderDrawingBar()`.

**Saved data / settings:** `draw{map: [{c, w, pts}]}`, `dcolor`, `dwidth`, `prefs[map].drawOn`.

**Files:**
- `rules.js`: simplifying, the saved form, colours and width limits.
- `map-layer.js`: the drawings layer, the drawing bar, drawing a line, undo/redo.
- `drawing.css`: the drawing bar's swatches, colour picker and slider.

**Tests:** `rules.test.js` (simplifying keeps both ends; a click is a dot, in game units). Not
covered by the browser suite. **Needs an in-game check:** nothing.
