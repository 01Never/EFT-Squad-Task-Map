// @ts-check
// The page's one shared, changing state: the saved data, the game data, the server's status and
// the open map. Every module reads and changes it through `app` (CODE-STYLE §10: the only global
// mutable state). Nothing here saves or draws; see app/saving.js and the features.

/**
 * @import { SavedState, GameData, MapConfig, Status, Task, Position, TrailPoint, Part,
 *   CapturedFile, MapInfo, SubTask, Objective, Stroke, SquadView } from "./types.js"
 */

/**
 * @typedef {object} ViewBox The part of the map art on screen, in SVG units.
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */

/**
 * @typedef {object} MapLayers The map's own SVG groups, bottom to top (map/layers.js).
 * @property {SVGGElement} zones
 * @property {SVGGElement} placeNames
 * @property {SVGGElement} friendDrawings
 * @property {SVGGElement} drawings
 * @property {SVGGElement} extracts
 * @property {SVGGElement} closestExtract
 * @property {SVGGElement} friendTasks
 * @property {SVGGElement} taskMarkers
 * @property {SVGGElement} player
 */

/**
 * @typedef {object} MarkerItem One marker on the map (features/tasks/map-layer.js).
 * @property {number} x SVG position
 * @property {number} y
 * @property {"exact" | "possible" | "sub"} kind
 * @property {string | null} f floor badge
 * @property {number[][]} [ol] zone outline
 * @property {Objective} [o] the objective it belongs to (not for sub-task markers)
 * @property {Task} task
 * @property {Part} part
 * @property {SubTask} [sub] for sub-task markers
 * @property {string} icon
 * @property {string} color
 * @property {string[]} [squadColors] colours of friends who also have this task (bottom-left dots)
 * @property {{ url: string, hasAlternatives: boolean } | null} [iconItem] the item picture the marker shows instead of the shape (features/icons)
 * @property {boolean} [ready] false = you're missing something it needs
 * @property {boolean} [split]
 * @property {boolean} [done]
 * @property {number} [ox] offset when markers overlap, in screen pixels
 * @property {number} [oy]
 */

/**
 * @typedef {object} PopupContent What the map popup shows: a part, or the marker that was clicked.
 * @property {Task} task
 * @property {Part} part
 * @property {SubTask} [sub]
 */

/**
 * @typedef {object} StrokeInProgress A line being drawn (features/drawing).
 * @property {number[][]} pts SVG points so far
 * @property {number} w width in SVG units
 * @property {string} c colour
 * @property {SVGPolylineElement} el
 */

/**
 * @typedef {object} MapView The open map page. Created by map/map-page.js openMap(), gone when
 * you leave the map.
 * @property {string} key
 * @property {MapConfig} config
 * @property {SVGSVGElement} svg
 * @property {ViewBox} homeView the whole map, as first shown
 * @property {ViewBox} viewBox what's on screen now
 * @property {{ toSvg: (x: number, z: number) => number[], toGame: (svgX: number, svgY: number) => number[], unit: number }} projection
 * @property {string} floor "ground" or the map art's group id of the floor shown
 * @property {"pan" | "draw" | "place"} mode
 * @property {string | null} placingSubTaskId the sub-task whose marker is being placed
 * @property {string | null} selectedPartKey
 * @property {PopupContent | MarkerItem | null} popup
 * @property {string | null} expandedPartKey the task row open in the list
 * @property {string | null} categoryMenuId the category whose ⋯ menu is open
 * @property {string | null} [openDoneCategoryId] the category whose "Done" list is open
 * @property {string} [aiScope] "map" or "all"
 * @property {Stroke[]} redoStrokes
 * @property {MapLayers} layers
 * @property {MapInfo} mapInfo extracts and transits of this map
 * @property {(event: KeyboardEvent) => void} [onKeyDown]
 * @property {ResizeObserver} [resizeObserver]
 * @property {number} [svgUnitsPerPixel] the last good scale, kept for resizes
 * @property {{ x: number, y: number, ox?: number, oy?: number }[]} [flashPoints]
 * @property {number} [pointersDown] fingers or mouse buttons down on the map
 * @property {(() => void) | null} [afterGesture]
 * @property {Record<string, MarkerItem>} [markerItemByKey]
 * @property {StrokeInProgress | null} strokeInProgress
 */

/**
 * @typedef {object} ScanCapture A task scan in progress (features/scan).
 * @property {"capture" | "reading"} phase
 * @property {CapturedFile[]} files
 * @property {number} progress screenshots read so far
 */

export const app = {
  /** @type {SavedState} */
  saved: null,
  /** @type {GameData} */
  gameData: null,
  /** @type {MapConfig[]} */
  mapConfigs: [],
  /** @type {Status} */
  status: null,
  /** @type {Record<string, Task>} */
  taskById: {},
  /** @type {{ match: (name: string, trader?: string | null) => { task: Task, fixed: boolean } | null }} */
  taskNameMatcher: null,
  /** @type {MapView | null} */
  mapView: null,
  /** @type {Position | null} your last position (features/find-me) */
  gps: null,
  /** @type {TrailPoint[]} */
  trail: [],
  /** @type {ScanCapture | null} */
  capture: null,
  /** @type {SquadView | null} the squad as the server last said (features/squad); null before it loads */
  squad: null,
  /** When the "find me" pulse last started, ms since 1970 (features/find-me). */
  findMePulseStartedAt: 0,
  /** @type {string | null} the game mode the log reported, when it differs from the setting (features/raid) */
  modePrompt: null,
  /** @type {string | null} the game mode you said "Not now" to */
  modeDismissed: null,
};
