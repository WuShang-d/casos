package routers

import (
	"net/http"
	"net/http/httputil"

	"github.com/beego/beego/logs"

	"github.com/casosorg/casos/controllers"
)

// AppGateway serves apps under *.localhost on the casos port. It wraps the
// whole beego handler rather than running as a filter, because beego reads
// form and multipart bodies before any filter runs, and an app's uploads have
// to reach it untouched.
func AppGateway(next http.Handler) http.Handler {
	proxy := &httputil.ReverseProxy{
		Rewrite: func(request *httputil.ProxyRequest) {
			target, _ := controllers.AppGatewayTarget()
			request.SetURL(target)
			request.SetXForwarded()
			request.Out.Host = request.In.Host
		},
		// The ingress controller is on the cluster network next door, so a
		// proxy the host is configured with must not be asked for it.
		Transport: appGatewayTransport(),
		// Chat replies stream token by token.
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			logs.Warning("app gateway %s: %v", r.Host, err)
			http.Error(w, "the app is not reachable yet", http.StatusBadGateway)
		},
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !controllers.IsAppGatewayHost(r.Host) {
			next.ServeHTTP(w, r)
			return
		}
		if _, err := controllers.AppGatewayTarget(); err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		proxy.ServeHTTP(w, r)
	})
}

func appGatewayTransport() *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	return transport
}
