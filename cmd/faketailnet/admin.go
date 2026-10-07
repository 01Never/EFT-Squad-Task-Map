package main

// The admin API: what Tailscale's admin console lets the owner do, over HTTP on 127.0.0.1, under
// /admin/. Everything else on the same port is the coordination server. README.md lists the routes.

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// adminAPI serves /admin/….
type adminAPI struct {
	network   *tailnet
	counters  *relayCounters
	testNodes *testNodes
	mux       *http.ServeMux
}

func newAdminAPI(network *tailnet, counters *relayCounters, nodes *testNodes) *adminAPI {
	api := &adminAPI{network: network, counters: counters, testNodes: nodes, mux: http.NewServeMux()}
	api.mux.HandleFunc("GET /admin/invites", api.onInvites)
	api.mux.HandleFunc("GET /admin/nodes", api.onListNodes)
	api.mux.HandleFunc("POST /admin/nodes/{node}/delete", api.onDeleteNode)
	api.mux.HandleFunc("POST /admin/nodes/{node}/expire", api.onExpireNode)
	api.mux.HandleFunc("GET /admin/settings", api.onGetSettings)
	api.mux.HandleFunc("PUT /admin/settings", api.onChangeSettings)
	api.mux.HandleFunc("GET /admin/relay", api.onRelay)
	api.mux.HandleFunc("POST /admin/test-nodes", api.onStartTestNode)
	api.mux.HandleFunc("POST /admin/test-nodes/{name}/fetch", api.onFetchFromTestNode)
	api.mux.HandleFunc("GET /admin/test-nodes/{name}/paths", api.onTestNodePaths)
	api.mux.HandleFunc("DELETE /admin/test-nodes/{name}", api.onStopTestNode)
	return api
}

func (api *adminAPI) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	// A browser page must not drive it (the same rule as the app's own API).
	if request.Header.Get("Origin") != "" || request.Header.Get("Sec-Fetch-Site") != "" {
		http.Error(writer, "not from a browser page", http.StatusForbidden)
		return
	}
	api.mux.ServeHTTP(writer, request)
}

func (api *adminAPI) onInvites(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]string{
		"tagged": TaggedInviteCode, "expired": ExpiredInviteCode, "untagged": UntaggedInviteCode,
	})
}

func (api *adminAPI) onListNodes(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, api.network.listMachines())
}

func (api *adminAPI) onDeleteNode(writer http.ResponseWriter, request *http.Request) {
	api.answerSignOut(writer, api.network.signOutMachine(request.PathValue("node"), true))
}

func (api *adminAPI) onExpireNode(writer http.ResponseWriter, request *http.Request) {
	api.answerSignOut(writer, api.network.signOutMachine(request.PathValue("node"), false))
}

func (api *adminAPI) answerSignOut(writer http.ResponseWriter, err error) {
	if errors.Is(err, errNoSuchMachine) {
		writeJSON(writer, http.StatusNotFound, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"ok": true, "nodes": api.network.listMachines()})
}

func (api *adminAPI) onGetSettings(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, api.network.currentSettings())
}

// onChangeSettings takes any of {acl, relayOnly, logoutRemovesMachine}; fields left out keep
// their value.
func (api *adminAPI) onChangeSettings(writer http.ResponseWriter, request *http.Request) {
	var change struct {
		ACL                  *string `json:"acl"`
		RelayOnly            *bool   `json:"relayOnly"`
		LogoutRemovesMachine *bool   `json:"logoutRemovesMachine"`
	}
	if err := json.NewDecoder(request.Body).Decode(&change); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	if change.ACL != nil && *change.ACL != ACLSquadOnly && *change.ACL != ACLOpen {
		problem := map[string]any{"ok": false, "error": `acl is "squad" or "open"`}
		writeJSON(writer, http.StatusBadRequest, problem)
		return
	}
	settings := api.network.changeSettings(func(settings *tailnetSettings) {
		if change.ACL != nil {
			settings.ACL = *change.ACL
		}
		if change.RelayOnly != nil {
			settings.RelayOnly = *change.RelayOnly
		}
		if change.LogoutRemovesMachine != nil {
			settings.LogoutRemovesMachine = *change.LogoutRemovesMachine
		}
	})
	writeJSON(writer, http.StatusOK, settings)
}

func (api *adminAPI) onRelay(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, api.counters.view())
}

func (api *adminAPI) onStartTestNode(writer http.ResponseWriter, request *http.Request) {
	var start testNodeRequest
	if err := json.NewDecoder(request.Body).Decode(&start); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	started, err := api.testNodes.start(start)
	if err != nil {
		writeJSON(writer, http.StatusBadGateway, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(writer, http.StatusOK, started)
}

func (api *adminAPI) onFetchFromTestNode(writer http.ResponseWriter, request *http.Request) {
	var fetch struct {
		URL string `json:"url"`
	}
	err := json.NewDecoder(request.Body).Decode(&fetch)
	if err != nil || !strings.HasPrefix(fetch.URL, "http://") {
		problem := map[string]any{"ok": false, "error": "send {url: \"http://…\"}"}
		writeJSON(writer, http.StatusBadRequest, problem)
		return
	}
	result, err := api.testNodes.fetch(request.PathValue("name"), fetch.URL)
	if err != nil {
		writeJSON(writer, http.StatusNotFound, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (api *adminAPI) onTestNodePaths(writer http.ResponseWriter, request *http.Request) {
	rows, err := api.testNodes.paths(request.PathValue("name"))
	if err != nil {
		writeJSON(writer, http.StatusNotFound, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(writer, http.StatusOK, rows)
}

// onStopTestNode stops a test node and deletes its machine, so the console only lists the copies.
func (api *adminAPI) onStopTestNode(writer http.ResponseWriter, request *http.Request) {
	machineName, err := api.testNodes.stop(request.PathValue("name"))
	if err != nil {
		writeJSON(writer, http.StatusNotFound, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	if machineName != "" {
		_ = api.network.signOutMachine(machineName, true)
	}
	writeJSON(writer, http.StatusOK, map[string]any{"ok": true, "deletedMachine": machineName})
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}
