// Downloading the exe of a release and checking it against the signed manifest. Only runs after
// the user clicked "Download and restart"; the file is not used until verification passed.
package updates

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
)

// downloadChunkBytes is how much is read between progress reports and cancel checks.
const downloadChunkBytes = 64 * 1024

// ProgressFunc is told how many bytes have arrived so far, out of the size the manifest announced.
type ProgressFunc func(bytesDone, bytesTotal int64)

// DownloadExe fetches the release's exe into destination, streaming, and checks it:
//   - at most manifest size + 10% is read (a bigger file is cut off and refused);
//   - the size must equal the manifest's, and the SHA-256 must match;
//   - on any failure, or when ctx is cancelled, the partial file is deleted.
//
// Errors are *Error values. The caller owns the destination path (SquadTaskMap.download.exe).
func (source Source) DownloadExe(ctx context.Context, manifest Manifest, destination string, progress ProgressFunc) error {
	err := source.downloadExe(ctx, manifest, destination, progress)
	if err != nil {
		_ = os.Remove(destination) // never leave a half-downloaded or unverified file behind
	}
	return err
}

func (source Source) downloadExe(ctx context.Context, manifest Manifest, destination string, progress ProgressFunc) error {
	response, err := source.get(ctx, ExeURL(source.Base, manifest.Version))
	if err != nil {
		return classifyDownloadError(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return errDownloadFailed(fmt.Sprintf("GitHub answered HTTP %d", response.StatusCode))
	}
	limit := MaxExeBytes(manifest.File.Size)
	if response.ContentLength > limit {
		return errBadSize()
	}

	file, err := os.Create(destination)
	if err != nil {
		return errDownloadFailed("couldn't write " + destination)
	}
	defer file.Close()

	hash := sha256.New()
	received, err := copyWithLimit(ctx, io.MultiWriter(file, hash), response.Body, limit, func(done int64) {
		if progress != nil {
			progress(done, manifest.File.Size)
		}
	})
	if err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return errDownloadFailed("couldn't finish writing the file")
	}
	if err := checkDownload(received, hex.EncodeToString(hash.Sum(nil)), manifest.File); err != nil {
		return err
	}
	// A new exe must be runnable where the executable bit exists (Linux, for tests). On Windows
	// this only keeps the file writable, which it already is.
	_ = os.Chmod(destination, 0o755)
	return nil
}

// copyWithLimit copies in chunks, reporting progress, and stops with bad-size once more than
// limit bytes have arrived. It returns how many bytes were copied.
func copyWithLimit(ctx context.Context, destination io.Writer, source io.Reader, limit int64, onProgress func(done int64)) (int64, error) {
	buffer := make([]byte, downloadChunkBytes)
	var done int64
	for {
		if ctx.Err() != nil {
			return done, errCancelled()
		}
		count, readErr := source.Read(buffer)
		if count > 0 {
			done += int64(count)
			if done > limit {
				return done, errBadSize()
			}
			if _, writeErr := destination.Write(buffer[:count]); writeErr != nil {
				return done, errDownloadFailed("couldn't write the file")
			}
			onProgress(done)
		}
		if errors.Is(readErr, io.EOF) {
			return done, nil
		}
		if readErr != nil {
			return done, classifyDownloadError(readErr)
		}
	}
}

// checkDownload compares what arrived with the signed manifest: size first, then SHA-256.
func checkDownload(receivedBytes int64, receivedSHA256 string, expected FileInfo) error {
	if receivedBytes != expected.Size {
		return errBadSize()
	}
	if receivedSHA256 != expected.SHA256 {
		return errBadHash()
	}
	return nil
}

// VerifyFile re-checks a downloaded file on disk against the manifest. Apply does this again
// right before replacing the exe, because the file sits in a folder other programs can write to.
func VerifyFile(path string, expected FileInfo) error {
	file, err := os.Open(path)
	if err != nil {
		return errNothingToApply()
	}
	defer file.Close()
	hash := sha256.New()
	size, err := io.Copy(hash, file)
	if err != nil {
		return errDownloadFailed("couldn't read the downloaded file")
	}
	return checkDownload(size, hex.EncodeToString(hash.Sum(nil)), expected)
}

// classifyDownloadError is classifyNetworkError, but a failure while downloading says so.
func classifyDownloadError(err error) error {
	classified := classifyNetworkError(err)
	var apiError *Error
	if errors.As(classified, &apiError) && apiError.Code == CodeGitHubUnreachable {
		return errDownloadFailed("the connection to GitHub broke")
	}
	return classified
}
