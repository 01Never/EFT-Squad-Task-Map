package extracts

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	"image/draw"
	"image/jpeg"
	_ "image/png" // Tarkov's default screenshot format
)

// jpegQuality matches the task scan's shrink (0.9 in the page).
const jpegQuality = 90

// ErrUnsupportedImage is returned for pictures the standard library can't read (e.g. BMP).
var ErrUnsupportedImage = errors.New("unsupported screenshot format")

// ShrinkToJPEG decodes a PNG or JPEG screenshot, fits it into MaxImageEdgePixels on the long side
// (averaging the pixels it merges, so small text stays readable) and returns it as a JPEG.
func ShrinkToJPEG(data []byte) ([]byte, error) {
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, ErrUnsupportedImage
	}
	bounds := decoded.Bounds()
	source := image.NewRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	draw.Draw(source, source.Bounds(), decoded, bounds.Min, draw.Src)

	width, height := ShrunkSize(bounds.Dx(), bounds.Dy())
	picture := image.Image(source)
	if width != bounds.Dx() || height != bounds.Dy() {
		picture = averageDownscale(source, width, height)
	}
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, picture, &jpeg.Options{Quality: jpegQuality}); err != nil {
		return nil, err
	}
	return encoded.Bytes(), nil
}

// averageDownscale makes a smaller picture where each pixel is the average of the source pixels
// it covers.
func averageDownscale(source *image.RGBA, width, height int) *image.RGBA {
	result := image.NewRGBA(image.Rect(0, 0, width, height))
	sourceWidth, sourceHeight := source.Bounds().Dx(), source.Bounds().Dy()
	for y := 0; y < height; y++ {
		fromY, toY := y*sourceHeight/height, max((y+1)*sourceHeight/height, y*sourceHeight/height+1)
		for x := 0; x < width; x++ {
			fromX, toX := x*sourceWidth/width, max((x+1)*sourceWidth/width, x*sourceWidth/width+1)
			var red, green, blue, count int
			for sourceY := fromY; sourceY < toY; sourceY++ {
				row := source.Pix[sourceY*source.Stride:]
				for sourceX := fromX; sourceX < toX; sourceX++ {
					red += int(row[sourceX*4])
					green += int(row[sourceX*4+1])
					blue += int(row[sourceX*4+2])
					count++
				}
			}
			offset := y*result.Stride + x*4
			result.Pix[offset] = uint8(red / count)
			result.Pix[offset+1] = uint8(green / count)
			result.Pix[offset+2] = uint8(blue / count)
			result.Pix[offset+3] = 255
		}
	}
	return result
}

// dataURL wraps JPEG bytes the way the vision API wants an inline picture.
func dataURL(jpegData []byte) string {
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(jpegData)
}
