package routers

import (
	"net/http"
	"strings"

	"github.com/casosorg/casos/controllers"
)

// AIGateway serves the OpenAI-compatible model API ahead of beego, for the
// same reasons MCP does, and so that a streamed reply is never buffered.
func AIGateway(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, controllers.AIGatewayPrefix) || controllers.IsAppGatewayHost(r.Host) {
			next.ServeHTTP(w, r)
			return
		}
		controllers.ServeAIGateway(w, r)
	})
}
