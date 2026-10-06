package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// projectVersions is every place the app's version is written down.
type projectVersions struct {
	RunGo                string // Version in internal/app/run.go
	PackageJSON          string // "version" in package.json
	WinresFileFixed      string // RT_VERSION fixed file_version, "2.6.0.0"
	WinresProductFixed   string // RT_VERSION fixed product_version, "2.6.0.0"
	WinresFileVersion    string // RT_VERSION info FileVersion
	WinresProductVersion string // RT_VERSION info ProductVersion
}

var runGoVersionPattern = regexp.MustCompile(`(?m)^const Version = "([^"]+)"`)

// readProjectVersions reads the version from internal/app/run.go, package.json and
// winres/winres.json.
func readProjectVersions(root string) (projectVersions, error) {
	var found projectVersions

	runGo, err := os.ReadFile(filepath.Join(root, "internal", "app", "run.go"))
	if err != nil {
		return found, fmt.Errorf("reading run.go (run this from the repo root, or pass -root): %w", err)
	}
	match := runGoVersionPattern.FindSubmatch(runGo)
	if match == nil {
		return found, fmt.Errorf(`internal/app/run.go has no line like: const Version = "2.6.0"`)
	}
	found.RunGo = string(match[1])

	packageJSON, err := os.ReadFile(filepath.Join(root, "package.json"))
	if err != nil {
		return found, fmt.Errorf("reading package.json: %w", err)
	}
	var packageFile struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(packageJSON, &packageFile); err != nil {
		return found, fmt.Errorf("package.json: %w", err)
	}
	found.PackageJSON = packageFile.Version

	return readWinresVersions(root, found)
}

func readWinresVersions(root string, found projectVersions) (projectVersions, error) {
	data, err := os.ReadFile(filepath.Join(root, "winres", "winres.json"))
	if err != nil {
		return found, fmt.Errorf("reading winres/winres.json: %w", err)
	}
	var winres struct {
		Version struct {
			Entry map[string]struct {
				Fixed struct {
					FileVersion    string `json:"file_version"`
					ProductVersion string `json:"product_version"`
				} `json:"fixed"`
				Info map[string]struct {
					FileVersion    string `json:"FileVersion"`
					ProductVersion string `json:"ProductVersion"`
				} `json:"info"`
			} `json:"#1"`
		} `json:"RT_VERSION"`
	}
	if err := json.Unmarshal(data, &winres); err != nil {
		return found, fmt.Errorf("winres/winres.json: %w", err)
	}
	for _, entry := range winres.Version.Entry {
		found.WinresFileFixed = entry.Fixed.FileVersion
		found.WinresProductFixed = entry.Fixed.ProductVersion
		for _, info := range entry.Info {
			found.WinresFileVersion = info.FileVersion
			found.WinresProductVersion = info.ProductVersion
		}
	}
	return found, nil
}

// checkVersionsMatch fails, listing every place that disagrees, unless all of them say the
// requested version. (winres' fixed versions carry a fourth number: 2.6.0 is "2.6.0.0".)
func checkVersionsMatch(requested string, found projectVersions) error {
	expected := []struct {
		where string
		got   string
		want  string
	}{
		{"internal/app/run.go Version", found.RunGo, requested},
		{"package.json version", found.PackageJSON, requested},
		{"winres.json file_version", found.WinresFileFixed, requested + ".0"},
		{"winres.json product_version", found.WinresProductFixed, requested + ".0"},
		{"winres.json FileVersion", found.WinresFileVersion, requested},
		{"winres.json ProductVersion", found.WinresProductVersion, requested},
	}
	var problems []string
	for _, place := range expected {
		if place.got != place.want {
			problems = append(problems, fmt.Sprintf("  %s is %q, expected %q", place.where, place.got, place.want))
		}
	}
	if len(problems) > 0 {
		return fmt.Errorf("the version isn't %s everywhere (release checklist in docs/HANDOFF.md, §3):\n%s",
			requested, strings.Join(problems, "\n"))
	}
	return nil
}
