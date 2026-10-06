package gps

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func TestScreenshotNamesMatchTheV2Results(t *testing.T) {
	// The owner's real screenshot names plus a few synthetic ones, parsed by v2 (testdata/golden).
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "testdata", "golden", "gps-names.json"))
	if err != nil {
		t.Fatal(err)
	}
	var golden []struct {
		Name string `json:"name"`
		Fix  *Fix   `json:"fix"`
	}
	if err := json.Unmarshal(data, &golden); err != nil {
		t.Fatal(err)
	}
	withPosition := 0
	for _, want := range golden {
		fix, ok := ParseFileName(want.Name)
		if ok != (want.Fix != nil) {
			t.Errorf("%q: parsed=%v, v2 parsed=%v", want.Name, ok, want.Fix != nil)
			continue
		}
		if !ok {
			continue
		}
		withPosition++
		if fix.X != want.Fix.X || fix.Y != want.Fix.Y || fix.Z != want.Fix.Z || math.Abs(fix.Yaw-want.Fix.Yaw) > 1e-9 {
			t.Errorf("%q: got %+v, v2 got %+v", want.Name, fix, *want.Fix)
		}
	}
	if withPosition < 40 {
		t.Errorf("only %d names had a position; the fixture should have the owner's 43 in-raid shots", withPosition)
	}
}

func TestPositionAndHeadingFromAName(t *testing.T) {
	fix, ok := ParseFileName("2026-10-01[14-05]_-120.53, 3.10, 210.77_0.00000, 0.70711, 0.00000, 0.70711 (0).png")
	if !ok || fix.X != -120.53 || fix.Y != 3.10 || fix.Z != 210.77 {
		t.Fatalf("got %+v ok=%v", fix, ok)
	}
}

func TestMenuScreenshotsHaveNoPosition(t *testing.T) {
	for _, name := range []string{"2026-10-04[15-44] (0).png", "2026-09-30[21-12]_25.35 (0).png", "notes.txt"} {
		if IsGPSFileName(name) {
			t.Errorf("%q was read as a position", name)
		}
	}
}

func TestTheIdentityRotationFacesZeroDegrees(t *testing.T) {
	if yaw := YawFromQuaternion(0, 0, 0, 1); math.Abs(yaw) > 1e-12 {
		t.Errorf("yaw = %v, want 0", yaw)
	}
}
