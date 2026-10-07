package httpapi

import (
	"net/http"
	"os"

	"squadtaskmap/internal/features/icons"
)

// icon answers GET /icons/<24-hex id>.webp. A missing icon is a plain 404 that browsers must not
// keep: the page then draws its fallback, and asks again after a reload.
func (server *Server) icon(writer http.ResponseWriter, request *http.Request) {
	itemID, isIconName := icons.ItemIDFromFileName(request.PathValue("file"))
	if !isIconName {
		http.Error(writer, "Not found", http.StatusNotFound)
		return
	}
	path, err := server.backend.IconPath(request.Context(), itemID)
	if err != nil {
		writer.Header().Set("Cache-Control", "no-store")
		http.Error(writer, "Not found", http.StatusNotFound)
		return
	}
	file, err := os.Open(path)
	if err != nil {
		writer.Header().Set("Cache-Control", "no-store")
		http.Error(writer, "Not found", http.StatusNotFound)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		http.Error(writer, "Not found", http.StatusNotFound)
		return
	}
	// The type is set here because Go's mime lookup reads the Windows registry.
	writer.Header().Set("Content-Type", "image/webp")
	writer.Header().Set("Cache-Control", "max-age=86400")
	http.ServeContent(writer, request, "", info.ModTime(), file)
}
