// Package gps reads your position and heading from the names of in-raid screenshots, and keeps
// your last few positions (the trail). The app reads file names only, never the pictures.
package gps

import (
	"math"
	"regexp"
	"strconv"
)

// During a raid, Tarkov puts your position and facing into each screenshot's file name. Real names
// from the owner's screenshots folder (2026-09/10):
//
//	2026-09-23[18-47]_-67.89, 7.79, -153.62_-0.02779, -0.75464, 0.03203, -0.65477_13.51 (5).png
//	2026-10-04[15-44] (0).png          ← taken in the menus: no position
//	2026-09-30[21-12]_25.35 (0).png    ← no position either
//
// date[HH-MM]_x, y, z_qx, qy, qz, qw[_extra] (n).ext: position in game units (metres) and the
// rotation as a quaternion. The trailing "_13.51" seen in real names is ignored.
var (
	screenshotName = regexp.MustCompile(`(?i)^\d{4}-\d{2}-\d{2}\[\d{2}-\d{2}\]_?(.+?)\s*\(\d+\)\.(png|jpe?g|bmp)$`)
	positionPart   = regexp.MustCompile(`^(-?\d+\.\d+), (-?\d+\.\d+), (-?\d+\.\d+)_?(-?\d*\.\d+), (-?\d*\.\d+), (-?\d*\.\d+), (-?\d*\.\d+)`)
	imageFile      = regexp.MustCompile(`(?i)\.(png|jpe?g|bmp)$`)
)

// Fix is a position read from a screenshot name.
type Fix struct {
	X   float64 `json:"x"`
	Y   float64 `json:"y"` // height: used for the floor badge
	Z   float64 `json:"z"`
	Yaw float64 `json:"yaw"` // heading in degrees
}

// ParseFileName reads the position from an in-raid screenshot's name; ok is false for any other file.
func ParseFileName(name string) (fix Fix, ok bool) {
	nameMatch := screenshotName.FindStringSubmatch(name)
	if nameMatch == nil {
		return Fix{}, false
	}
	position := positionPart.FindStringSubmatch(nameMatch[1])
	if position == nil {
		return Fix{}, false
	}
	var numbers [7]float64
	for i := range numbers {
		value, err := strconv.ParseFloat(position[i+1], 64)
		if err != nil || math.IsInf(value, 0) || math.IsNaN(value) {
			return Fix{}, false
		}
		numbers[i] = value
	}
	return Fix{X: numbers[0], Y: numbers[1], Z: numbers[2], Yaw: YawFromQuaternion(numbers[3], numbers[4], numbers[5], numbers[6])}, true
}

// IsGPSFileName reports whether a screenshot name carries a position.
func IsGPSFileName(name string) bool {
	_, ok := ParseFileName(name)
	return ok
}

// IsImageFile reports whether a file name is a picture the game could have written.
func IsImageFile(name string) bool { return imageFile.MatchString(name) }

// YawFromQuaternion is the heading in degrees from the file's rotation. The components are taken in
// the order TarkovMonitor uses (its yaw function receives them as x, z, y, w), which is what
// tarkov.dev's map expects for its player arrow. Still to be confirmed in-game (HANDOFF §10.3).
func YawFromQuaternion(qx, qy, qz, qw float64) float64 {
	x, z, y, w := qx, qy, qz, qw
	sinYaw := 2 * (w*z + x*y)
	cosYaw := 1 - 2*(y*y+z*z)
	return math.Atan2(sinYaw, cosYaw) * 180 / math.Pi
}
