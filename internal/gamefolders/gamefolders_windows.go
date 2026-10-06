//go:build windows

package gamefolders

import (
	"os"
	"path/filepath"
	"sync"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

var (
	documentsOnce sync.Once
	documentsDir  string
)

// DocumentsDir is the real Documents folder, asked from Windows (FOLDERID_Documents). OneDrive
// often moves Documents, so %USERPROFILE%\Documents can be wrong. Looked up once.
func DocumentsDir() string {
	documentsOnce.Do(func() {
		path, err := windows.KnownFolderPath(windows.FOLDERID_Documents, 0)
		if err == nil && IsDir(path) {
			documentsDir = path
			return
		}
		if home, err := os.UserHomeDir(); err == nil {
			documentsDir = filepath.Join(home, "Documents")
		}
	})
	return documentsDir
}

// The launcher registers EFT under this uninstall key (in either registry view, per user or machine).
var uninstallKeys = []string{
	`SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\EscapeFromTarkov`,
	`SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\EscapeFromTarkov`,
}

func launcherInstallFolders() []string {
	var folders []string
	for _, root := range []registry.Key{registry.CURRENT_USER, registry.LOCAL_MACHINE} {
		for _, path := range uninstallKeys {
			if value := readRegistryString(root, path, "InstallLocation"); value != "" {
				folders = append(folders, value)
			}
		}
	}
	return folders
}

func steamRoots() []string {
	var roots []string
	for _, lookup := range []struct {
		root  registry.Key
		path  string
		value string
	}{
		{registry.CURRENT_USER, `Software\Valve\Steam`, "SteamPath"},
		{registry.LOCAL_MACHINE, `SOFTWARE\WOW6432Node\Valve\Steam`, "InstallPath"},
		{registry.LOCAL_MACHINE, `SOFTWARE\Valve\Steam`, "InstallPath"},
	} {
		if value := readRegistryString(lookup.root, lookup.path, lookup.value); value != "" {
			roots = append(roots, filepath.FromSlash(value))
		}
	}
	return roots
}

func readRegistryString(root registry.Key, path, name string) string {
	key, err := registry.OpenKey(root, path, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer key.Close()
	value, _, err := key.GetStringValue(name)
	if err != nil {
		return ""
	}
	return value
}
