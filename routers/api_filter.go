package routers

import (
	"github.com/beego/beego/context"
	"github.com/casosorg/casos/conf"
	"github.com/casosorg/casos/controllers"
)

// Every other /api/ route requires a signed-in session, so a newly added
// handler is private unless it is listed here.
var publicApiPaths = map[string]bool{
	"/api/health":             true,
	"/api/get-signin-options": true,
	"/api/signin":             true,
	"/api/signout":            true,
	// Decides for itself: it signs the default admin in automatically.
	"/api/get-account":       true,
	"/api/e2e/signin":        true,
	"/api/get-built-in-site": true,
}

func ApiFilter(ctx *context.Context) {
	urlPath := ctx.Request.URL.Path
	if conf.IsDemoMode() && !isAllowedInDemoMode(ctx.Request.Method, urlPath) {
		denyRequest(ctx)
		return
	}
	if !publicApiPaths[urlPath] && !controllers.IsSignedIn(ctx) {
		responseError(ctx, "please sign in first")
	}
}

func isAllowedInDemoMode(method, urlPath string) bool {
	if method == "POST" {
		return urlPath == "/api/signin" || urlPath == "/api/signout"
	}
	return true
}
