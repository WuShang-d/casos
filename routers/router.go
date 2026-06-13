package routers

import (
	"github.com/beego/beego"
	"github.com/casosorg/casos/controllers"
)

func InitAPI() {
	beego.Router("/api/get-pods", &controllers.ApiController{}, "GET:GetPods")
	beego.Router("/api/get-pod", &controllers.ApiController{}, "GET:GetPod")
	beego.Router("/api/get-pod-events", &controllers.ApiController{}, "GET:GetPodEvents")
	beego.Router("/api/get-pod-logs", &controllers.ApiController{}, "GET:GetPodLogs")
	beego.Router("/api/add-pod", &controllers.ApiController{}, "POST:AddPod")
	beego.Router("/api/update-pod", &controllers.ApiController{}, "POST:UpdatePod")
	beego.Router("/api/delete-pod", &controllers.ApiController{}, "POST:DeletePod")

	beego.Router("/api/get-nodes", &controllers.ApiController{}, "GET:GetNodes")
	beego.Router("/api/get-node", &controllers.ApiController{}, "GET:GetNode")
	beego.Router("/api/update-node", &controllers.ApiController{}, "POST:UpdateNode")
	beego.Router("/api/delete-node", &controllers.ApiController{}, "POST:DeleteNode")
	beego.Router("/api/get-worker-kubeconfig", &controllers.ApiController{}, "GET:GetWorkerKubeconfig")

	beego.Router("/api/get-namespaces", &controllers.ApiController{}, "GET:GetNamespaces")
	beego.Router("/api/get-namespace", &controllers.ApiController{}, "GET:GetNamespace")
	beego.Router("/api/add-namespace", &controllers.ApiController{}, "POST:AddNamespace")
	beego.Router("/api/update-namespace", &controllers.ApiController{}, "POST:UpdateNamespace")
	beego.Router("/api/delete-namespace", &controllers.ApiController{}, "POST:DeleteNamespace")
	beego.Router("/api/force-delete-namespace", &controllers.ApiController{}, "POST:ForceDeleteNamespace")

	beego.Router("/api/get-serviceaccounts", &controllers.ApiController{}, "GET:GetServiceAccounts")
	beego.Router("/api/get-serviceaccount", &controllers.ApiController{}, "GET:GetServiceAccount")
	beego.Router("/api/add-serviceaccount", &controllers.ApiController{}, "POST:AddServiceAccount")
	beego.Router("/api/update-serviceaccount", &controllers.ApiController{}, "POST:UpdateServiceAccount")
	beego.Router("/api/delete-serviceaccount", &controllers.ApiController{}, "POST:DeleteServiceAccount")

	beego.Router("/api/search-docker-hub-images", &controllers.ApiController{}, "GET:SearchDockerHubImages")

	beego.Router("/api/get-services", &controllers.ApiController{}, "GET:GetServices")
	beego.Router("/api/get-service", &controllers.ApiController{}, "GET:GetService")
	beego.Router("/api/add-service", &controllers.ApiController{}, "POST:AddService")
	beego.Router("/api/update-service", &controllers.ApiController{}, "POST:UpdateService")
	beego.Router("/api/delete-service", &controllers.ApiController{}, "POST:DeleteService")

	beego.Router("/api/get-configmaps", &controllers.ApiController{}, "GET:GetConfigMaps")
	beego.Router("/api/get-configmap", &controllers.ApiController{}, "GET:GetConfigMap")
	beego.Router("/api/add-configmap", &controllers.ApiController{}, "POST:AddConfigMap")
	beego.Router("/api/update-configmap", &controllers.ApiController{}, "POST:UpdateConfigMap")
	beego.Router("/api/delete-configmap", &controllers.ApiController{}, "POST:DeleteConfigMap")
}
