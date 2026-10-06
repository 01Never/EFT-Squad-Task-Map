package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"squadtaskmap/internal/features/updates"
)

// privateKeyVariable names the environment variable that holds the PATH of the private key file.
// The key itself never goes in the repo, in an environment variable, or in GitHub.
const privateKeyVariable = "STM_RELEASE_KEY"

// defaultKeyPath is where -init-keys writes the private key unless -key-out says otherwise:
// the user's config folder (on Windows, %AppData%), outside the repo on purpose.
func defaultKeyPath() (string, error) {
	configFolder, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("no user config folder; pass -key-out <path>: %w", err)
	}
	return filepath.Join(configFolder, "SquadTaskMap", "release-private-key.txt"), nil
}

// initKeys makes the Ed25519 key pair once. It refuses to overwrite an existing key file:
// replacing the key would make every release already installed reject your updates.
func initKeys(keyOut string, output io.Writer) error {
	if keyOut == "" {
		path, err := defaultKeyPath()
		if err != nil {
			return err
		}
		keyOut = path
	}
	publicKey, err := writeNewKeyPair(keyOut)
	if err != nil {
		return err
	}

	fmt.Fprintf(output, `Created the signing key pair.

PRIVATE key written to:
  %s
  Keep it secret and back it up (password manager or a USB stick). Never put it in the
  repo or on GitHub. If you lose it, friends have to update by hand once.

Tell the tool where it is (PowerShell, for this window; use setx to make it permanent):
  $env:%s = "%s"

PUBLIC key: paste this into internal/features/updates/rules.go, replacing the placeholder:

const EmbeddedPublicKey = %q

Then build and share that version by hand once: copies built before that can't verify updates.
`, keyOut, privateKeyVariable, keyOut, updates.EncodeKey(publicKey))
	return nil
}

// writeNewKeyPair creates the private key file (owner-only permissions) and returns the public key.
func writeNewKeyPair(path string) (ed25519.PublicKey, error) {
	if _, err := os.Stat(path); err == nil {
		return nil, fmt.Errorf("%s already exists; not overwriting a signing key (delete it yourself if you mean to start over)", path)
	}
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, []byte(updates.EncodeKey(privateKey)+"\n"), 0o600); err != nil {
		return nil, err
	}
	return publicKey, nil
}

// loadPrivateKeyFromEnvironment reads the key file named by STM_RELEASE_KEY.
func loadPrivateKeyFromEnvironment() (ed25519.PrivateKey, error) {
	path := strings.TrimSpace(os.Getenv(privateKeyVariable))
	if path == "" {
		return nil, fmt.Errorf("%s is not set. It must hold the path of your private key file (make one with -init-keys)", privateKeyVariable)
	}
	return loadPrivateKey(path)
}

func loadPrivateKey(path string) (ed25519.PrivateKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading the private key %s: %w", path, err)
	}
	key, err := updates.ParsePrivateKey(string(data))
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return key, nil
}

// appPublicKey is the key built into the app. A variable so tests can stand in for a real one.
var appPublicKey = updates.EmbeddedPublicKey

// checkKeyMatchesApp refuses to release with a key whose public half isn't the one built into the
// app: every installed copy would reject the update ("This update isn't from the owner").
func checkKeyMatchesApp(privateKey ed25519.PrivateKey) error {
	publicKey := privateKey.Public().(ed25519.PublicKey)
	embedded, err := updates.ParsePublicKey(appPublicKey)
	if err != nil {
		return errors.New("the app has no public key yet: paste the one printed by -init-keys into EmbeddedPublicKey (internal/features/updates/rules.go), then release")
	}
	if !publicKey.Equal(embedded) {
		return fmt.Errorf("this private key doesn't match the public key built into the app, so installed copies would reject the update. "+
			"Its public key is %q", updates.EncodeKey(publicKey))
	}
	return nil
}
