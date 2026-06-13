package routers

import (
	"github.com/beego/beego/v2/server/web"
	"github.com/casosorg/casos/controllers"
)

func InitAPI() {
	web.Router("/api/get-pods", &controllers.ApiController{}, "GET:GetPods")

	web.Router("/api/get-configmaps", &controllers.ApiController{}, "GET:GetConfigMaps")
	web.Router("/api/get-configmap", &controllers.ApiController{}, "GET:GetConfigMap")
	web.Router("/api/add-configmap", &controllers.ApiController{}, "POST:AddConfigMap")
	web.Router("/api/update-configmap", &controllers.ApiController{}, "POST:UpdateConfigMap")
	web.Router("/api/delete-configmap", &controllers.ApiController{}, "POST:DeleteConfigMap")
}
