package routers

import (
	"net/http"

	"github.com/casosorg/casos/controllers"
)

// MCP serves the Model Context Protocol endpoint ahead of beego, which would
// otherwise open a cookie session for every call an agent makes and hand the
// path to the static filter.
func MCP(version string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != controllers.MCPPath || controllers.IsAppGatewayHost(r.Host) {
				next.ServeHTTP(w, r)
				return
			}
			controllers.ServeMCP(w, r, version)
		})
	}
}
