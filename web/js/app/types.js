// @ts-check
// The shapes the page works with, as JSDoc types (checked by VS Code and `npm run typecheck`,
// no build step). Nothing runs here. Game data comes from /api/data ("stm-v2", made by
// internal/gamedata); the saved data is what the page stores with PUT /api/state.

export {};

// ---------------------------------------------------------------- game data (/api/data)

/**
 * @typedef {object} Item Anything with an id and a name: an item, a key, a quest item.
 * @property {string} id
 * @property {string} name
 */

/**
 * @typedef {object} Zone Where an objective happens on a map. Game units are metres.
 * @property {string} m map key
 * @property {number} x
 * @property {number} y height
 * @property {number} z
 * @property {number | null} [top]
 * @property {number | null} [bottom]
 * @property {number[][]} [ol] outline: [x, z] points
 */

/**
 * @typedef {object} PossibleSpots Spots on one map where a quest item may be.
 * @property {string} m map key
 * @property {number[][]} p [x, y, z] points
 */

/**
 * @typedef {object} Gear What must be used or worn for a kill objective.
 * @property {Item[]} weapons any one of these
 * @property {Item[][]} mods any one of these sets
 * @property {Item[][]} wearing single items (all needed) or outfits (any one), see readiness
 * @property {number} notWearing how many items must NOT be worn
 */

/**
 * @typedef {object} Objective One line of a task.
 * @property {string} id
 * @property {string} type tarkov.dev's objective type: visit, mark, shoot, plantItem…
 * @property {string} d the text shown in the game
 * @property {number} n how many (kills, items…)
 * @property {boolean} fir items must be found in raid
 * @property {boolean} opt optional objective
 * @property {string[]} maps
 * @property {Zone[]} zones
 * @property {PossibleSpots[]} poss
 * @property {Item[][]} keys every group is needed; inside a group any one key will do
 * @property {Item[]} items alternatives (find, hand in, plant)
 * @property {Item | null} marker the marker item of a "mark" objective
 * @property {string | null} qi quest item name
 * @property {string[]} targets kill targets
 * @property {Gear | null} gear
 * @property {number[] | null} time [from hour, until hour]
 */

/**
 * @typedef {object} Task One quest.
 * @property {string} id
 * @property {string} name
 * @property {string} trader
 * @property {string | null} map the task's own map key
 * @property {string | null} wiki wiki page URL
 * @property {number} minLevel
 * @property {boolean} kappa
 * @property {boolean} lk
 * @property {Objective[]} objs
 */

/**
 * @typedef {object} MapExtract An exit (from the game data).
 * @property {string} n name
 * @property {string} fa faction: "pmc", "scav", "shared" or ""
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number[][]} [ol] outline: [x, z] points
 */

/**
 * @typedef {object} MapTransit A transit point to another map.
 * @property {string} n name ("Transit to …")
 * @property {number} x
 * @property {number} y
 * @property {number} z
 */

/**
 * @typedef {object} MapInfo A map's extracts and transits.
 * @property {string} key
 * @property {MapExtract[]} extracts
 * @property {MapTransit[]} transits
 */

/**
 * @typedef {object} GameData What /api/data sends.
 * @property {string} format always "stm-v2"
 * @property {string | null} generated
 * @property {string} mode "regular", "pve" or "pvp-season"
 * @property {Task[]} tasks
 * @property {MapInfo[]} maps
 */

/**
 * @typedef {object} MapConfig One map from assets/maps-config.json (values from tarkov.dev).
 * @property {string} key
 * @property {string} name
 * @property {string} svg the map art's file name
 * @property {number[]} transform [a, b, c, d] of tarkov.dev's projection
 * @property {number} [rotation] degrees
 * @property {number[][]} bounds
 * @property {number[][]} [svgBounds]
 * @property {string} baseLayer
 * @property {number[]} [heightRange]
 * @property {MapFloorLayer[]} layers
 * @property {MapLabel[]} labels
 */

/**
 * @typedef {object} MapFloorLayer A floor (or underground level) of a map.
 * @property {string} name
 * @property {string} [svgLayer] the map art's group id with this floor's layout
 * @property {{ height: number[], bounds?: number[][][] }[]} extents
 */

/**
 * @typedef {object} MapLabel A place name.
 * @property {string} t text
 * @property {number} x
 * @property {number} z
 * @property {number} [r] rotation in degrees
 * @property {number} [top]
 * @property {number} [bottom]
 */

// ---------------------------------------------------------------- parts and categories

/**
 * @typedef {"boss" | "pmc" | "scav" | "mark" | "plant" | "retrieve" | "go" | "offmap"} Action
 * The kind of work an objective is (features/tasks/rules.js).
 */

/**
 * @typedef {object} Part A task, or one kind-of-work slice of it (features/tasks/rules.js).
 * @property {string} key "<taskId>:*" when whole, "<taskId>:<action>" when split
 * @property {Action} action
 * @property {Objective[]} objs in the task's order
 * @property {boolean} split
 * @property {number} index
 * @property {number} total
 */

/**
 * @typedef {object} Category A group in the task list (saved).
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {string} icon a marker shape (map/marker-shapes.js)
 * @property {boolean} [visible]
 * @property {string | null} builtin the action it collects by default, "unsorted", or null
 */

/**
 * @typedef {object} PartOnMap A part shown on the open map, with what the list and markers need.
 * @property {Task} task
 * @property {Part} part
 * @property {Category} cat
 * @property {boolean} done
 * @property {boolean} pinned
 */

// ---------------------------------------------------------------- saved data (PUT /api/state)

/**
 * @typedef {object} PartCategoryChoice Where the owner (or AI Categorize) put a part.
 * @property {string} cat category id
 * @property {boolean} manual
 */

/**
 * @typedef {object} TaskEntry A task's saved entry.
 * @property {boolean} active on your list
 * @property {string} source "scan", "log" or "manual": how it was added
 * @property {number} addedAt ms since 1970
 * @property {number | null} gamePct progress read by a scan
 * @property {number | null} scannedAt
 * @property {boolean} noSplit "Don't split"
 * @property {boolean} pinned
 * @property {Record<string, PartCategoryChoice>} partCats by part key ("*" = v1 carry-over)
 */

/**
 * @typedef {object} SubTask A note under a task, optionally pinned on a map.
 * @property {string} id
 * @property {string} task task id
 * @property {string} text
 * @property {boolean} done
 * @property {string | null} map
 * @property {number | null} x
 * @property {number | null} z
 * @property {string} f floor badge ("" = ground)
 */

/**
 * @typedef {object} Stroke A drawn line, in game coordinates so it survives map art changes.
 * @property {string} c colour
 * @property {number} w width in game units
 * @property {number[][]} pts [x, z] points
 */

/**
 * @typedef {object} MapPrefs Per-map choices.
 * @property {Record<string, boolean>} ext which extract kinds are shown (pmc, scav, shared, transit)
 * @property {Record<string, unknown>} extMarked extracts you marked as yours (name → truthy)
 * @property {boolean} labels place names shown
 * @property {boolean} drawOn drawings shown
 */

/**
 * @typedef {object} SavedState Everything the page saves (squad-task-map-data.json, version 2).
 * @property {number} version
 * @property {Category[]} cats
 * @property {Record<string, TaskEntry>} tasks by task id
 * @property {Record<string, true | number>} ticks by objective id: done, or a count
 * @property {Record<string, number>} have bag counts by requirement key
 * @property {Record<string, number>} [used] what each ticked objective took from the bag
 * @property {SubTask[]} subs
 * @property {Record<string, Stroke[]>} draw by map key
 * @property {Record<string, MapPrefs>} prefs by map key
 * @property {Record<string, boolean>} collapsed by category id
 * @property {boolean} pinnedOnly
 * @property {string} panelTab "tasks" or "bring"
 * @property {boolean} panelHidden
 * @property {string} dcolor drawing colour
 * @property {number} dwidth drawing width in screen pixels
 * @property {boolean} aiOpen
 * @property {boolean} [showScanBanner]
 * @property {number} [migratedFrom]
 */

// ---------------------------------------------------------------- server status (/api/status)

/**
 * @typedef {object} Settings What /api/status says about the settings.
 * @property {string} gameMode
 * @property {string} logsPath
 * @property {string} screenshotsPath
 * @property {boolean} followPosition switch to the raid's map on a new position
 * @property {boolean} autoCenter centre on each new position (ticket 02)
 */

/**
 * @typedef {object} FolderStatus
 * @property {boolean} ok
 * @property {string} [dir]
 * @property {string} [message]
 */

/**
 * @typedef {object} RaidStatus
 * @property {boolean} active
 * @property {string | null} map
 * @property {string | null} [sessionMode]
 */

/**
 * @typedef {object} AiStatus
 * @property {boolean} hasKey
 * @property {string | null} key masked
 * @property {string} model
 * @property {string} [effort]
 */

/**
 * @typedef {object} GameDataStatus
 * @property {string} origin "live", "cache" or "built-in"
 * @property {string} mode
 * @property {string | null} generated
 * @property {number | null} fetchedAt
 * @property {string | null} error
 * @property {boolean} refreshing
 * @property {number} tasks
 */

/**
 * @typedef {object} Position Your position from the last GPS screenshot.
 * @property {string | null} map
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} yaw heading in degrees
 * @property {number} t when it arrived, ms since 1970
 */

/**
 * @typedef {object} TrailPoint
 * @property {number} x
 * @property {number} z
 * @property {number} t
 */

/**
 * @typedef {object} Status /api/status
 * @property {string} version
 * @property {string} statePath
 * @property {GameDataStatus} data
 * @property {Settings} settings
 * @property {FolderStatus} logs
 * @property {FolderStatus} screenshots
 * @property {{ ok: boolean, warning: string } | null} keybind
 * @property {RaidStatus} raid
 * @property {Position | null} gps
 * @property {TrailPoint[] | null} trail
 * @property {AiStatus} ai
 * @property {UpdatesStatus} [updates] Check for updates (features/updates)
 */

/** @typedef {{ bytesDone: number, bytesTotal: number }} UpdateDownload */

/**
 * @typedef {object} UpdatesStatus The server's "Check for updates" state (internal/features/updates).
 * @property {string} currentVersion
 * @property {boolean} canApply false under `go run`
 * @property {string} cannotApplyMessage
 * @property {"idle" | "checking" | "downloading" | "ready" | "applying"} phase
 * @property {string | null} lastChecked RFC 3339; null until a manual check has finished
 * @property {"" | "up-to-date" | "available"} result
 * @property {{ version: string, released: string, notes: string, sizeBytes: number, releaseUrl: string } | null} available
 * @property {UpdateDownload | null} download
 * @property {{ code: string, message: string, releaseUrl?: string } | null} error
 * @property {{ from: string, to: string, released: string, notes: string } | null} justUpdated
 */

// ---------------------------------------------------------------- live events (app/live-events.js)

/**
 * @typedef {object} CapturedFile A screenshot captured for a task scan.
 * @property {string} name
 * @property {number} t
 * @property {number} size
 */

/** @typedef {{ type: "task", id?: number, taskId: string, status: "started" | "failed" | "finished" }} TaskEvent */
/** @typedef {{ type: "raidEnd", id?: number, map: string | null, deleted: number }} RaidEndEvent */
/** @typedef {{ type: "gps", gps: Position, trail: TrailPoint[] }} GpsEvent */
/** @typedef {{ type: "capture", files: CapturedFile[], done?: boolean, cancelled?: boolean }} CaptureEvent */
/** @typedef {{ type: "raidStart", map: string | null }} RaidStartEvent */
/** @typedef {{ type: "raidMap", map: string | null }} RaidMapEvent */
/** @typedef {{ type: "mode", mode: string, dataMode: string }} ModeEvent */
/** @typedef {{ type: "keybind", ok: boolean, warning: string }} KeybindEvent */
/** @typedef {{ type: "data", status: GameDataStatus }} DataEvent */
/** @typedef {{ type: "updates", status: UpdatesStatus }} UpdatesEvent */

/**
 * @typedef {TaskEvent | RaidEndEvent | GpsEvent | CaptureEvent | RaidStartEvent | RaidMapEvent
 *   | ModeEvent | KeybindEvent | DataEvent | UpdatesEvent} LiveEvent
 */
