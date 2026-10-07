package squad

// Reading and writing squad-task-map-squad.json: my last share (so friends get it again after a
// restart) and each friend's last share with when we last saw them (so offline friends still show).
// Nothing here talks to the network.

import (
	"encoding/json"
	"fmt"
	"log"
	"os"

	"squadtaskmap/internal/storage"
)

// cacheFileVersion is the "v" of squad-task-map-squad.json.
const cacheFileVersion = 1

// CachedFriend is one friend's last share and when we last saw them.
type CachedFriend struct {
	LastSeen int64 `json:"lastSeen"` // ms since 1970: last share received or stream closed
	Share    Share `json:"share"`
}

// cacheFile is the file's shape.
type cacheFile struct {
	Version int                     `json:"v"`
	Mine    *Share                  `json:"mine"`
	Friends map[string]CachedFriend `json:"friends"` // by player id
}

// readCache loads the file. A missing or broken file gives an empty cache; a friend whose share no
// longer passes the checks is left out.
func readCache(path string) (*Share, map[string]CachedFriend) {
	friends := map[string]CachedFriend{}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, friends
	}
	var file struct {
		Mine    json.RawMessage            `json:"mine"`
		Friends map[string]json.RawMessage `json:"friends"`
	}
	if json.Unmarshal(data, &file) != nil {
		log.Printf("squad: %s isn't readable; starting with an empty squad cache", path)
		return nil, friends
	}
	var mine *Share
	if share, err := DecodeShare(file.Mine); err == nil {
		mine = &share
	}
	for playerID, raw := range file.Friends {
		friend, ok := decodeCachedFriend(playerID, raw)
		if ok {
			friends[playerID] = friend
		}
	}
	return mine, friends
}

func decodeCachedFriend(playerID string, raw json.RawMessage) (CachedFriend, bool) {
	var entry struct {
		LastSeen int64           `json:"lastSeen"`
		Share    json.RawMessage `json:"share"`
	}
	if json.Unmarshal(raw, &entry) != nil {
		return CachedFriend{}, false
	}
	share, err := DecodeShare(entry.Share)
	if err != nil || share.Player.ID != playerID {
		return CachedFriend{}, false
	}
	return CachedFriend{LastSeen: entry.LastSeen, Share: share}, true
}

// writeCache saves the file whole (atomic write).
func writeCache(path string, mine *Share, friends map[string]CachedFriend) error {
	if friends == nil {
		friends = map[string]CachedFriend{}
	}
	data, err := json.Marshal(cacheFile{Version: cacheFileVersion, Mine: mine, Friends: friends})
	if err != nil {
		return fmt.Errorf("encoding the squad cache: %w", err)
	}
	if err := storage.WriteFileAtomic(path, data); err != nil {
		return fmt.Errorf("writing the squad cache %s: %w", path, err)
	}
	return nil
}
