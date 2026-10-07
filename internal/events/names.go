// Package events sends live updates from the server to the open page over Server-Sent Events.
//
// There are two kinds of delivery:
//   - Deliver: events that change the page's saved data (a task started or finished, a raid ended).
//     They're queued in squad-task-map-pending.json and sent again until the page acknowledges
//     them, so a task accepted while the browser was closed still lands.
//   - Broadcast: live-only events (your position, scan progress, raid start…). If no page is
//     open they're simply dropped.
package events

// Event names. The page spells them identically in web/js/app/event-names.js, and its router
// (web/js/app/live-events.js) maps each one to a handler; names_test.go checks the two lists match.
const (
	Task      = "task"      // deliver: a task was started, finished or failed in the game
	RaidEnd   = "raidEnd"   // deliver: the raid ended; reset bag counts, extract marks and the trail
	GPS       = "gps"       // broadcast: a new position from an in-raid screenshot
	Capture   = "capture"   // broadcast: the list of screenshots captured for a task scan changed
	RaidStart = "raidStart" // broadcast: a raid started
	RaidMap   = "raidMap"   // broadcast: the game is loading this map
	Mode      = "mode"      // broadcast: the game reported which game mode it's in
	Keybind   = "keybind"   // broadcast: whether a screenshot key is bound in the game
	Data      = "data"      // broadcast: the game data changed (new download, mode switch)
	Updates   = "updates"   // broadcast: the update state changed (check result, download progress, install)
	Squad     = "squad"     // broadcast: the squad view changed (status, a friend's share, online, profile)
)
