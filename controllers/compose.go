package controllers

import (
	"encoding/json"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/validation"
	"k8s.io/client-go/rest"

	"github.com/casosorg/casos/deploy"
	"github.com/casosorg/casos/object"
)

// Deploying a docker-compose.yml.
//
// A compose project becomes one app in a namespace of its own. Each service is
// a workload with a Service of the same name, so the names services use to
// reach each other (db:5432) keep working. One service is the app; the others
// are its parts, listed and uninstalled with it. A service that publishes a
// port gets an address through the app gateway. What has no equivalent here,
// a host path or a privileged container, is left out with a warning rather than
// failing the whole file.

const (
	composeVolumeSize = "5Gi"
	composeMaxBytes   = 512 * 1024
)

var composeDatabaseNames = regexp.MustCompile(`(?i)(postgres|mysql|mariadb|redis|mongo|valkey|memcached|^db$|database|cache)`)

type composeServicePlan struct {
	Name      string   `json:"name"`
	Image     string   `json:"image"`
	Main      bool     `json:"main"`
	Ports     []int32  `json:"ports"`
	Url       string   `json:"url"`
	Volumes   []string `json:"volumes"`
	EnvCount  int      `json:"envCount"`
	Replicas  int32    `json:"replicas"`
	Gpu       bool     `json:"gpu"`
	published bool
}

type composePlan struct {
	Project  string               `json:"project"`
	Main     string               `json:"main"`
	Services []composeServicePlan `json:"services"`
	Warnings []string             `json:"warnings"`
	Missing  []string             `json:"missingVariables"`

	requests []deployAppRequest
	extras   map[string]composeExtras
}

// composeExtras is what a service needs beyond the launchpad form.
type composeExtras struct {
	workingDir string
	runAsUser  *int64
	runAsGroup *int64
	gpu        bool
	tmpfs      []string
}

type composeInput struct {
	Project string `json:"project"`
	Compose string `json:"compose"`
	// Env is a .env file: what ${VAR} in the compose file resolves to.
	Env string `json:"env"`
	// The domain app addresses are named under, from the address casos is
	// reached by.
	domain string
}

func (p *composePlan) warn(format string, args ...interface{}) {
	p.Warnings = append(p.Warnings, fmt.Sprintf(format, args...))
}

func parseDotEnv(text string) map[string]string {
	env := map[string]string{}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
			value = value[1 : len(value)-1]
		}
		env[strings.TrimSpace(key)] = value
	}
	return env
}

var composeVariable = regexp.MustCompile(`\$(?:\$|\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?+])([^}]*))?\}|([A-Za-z_][A-Za-z0-9_]*))`)

// interpolate resolves ${VAR}, ${VAR:-default}, ${VAR:?message} and friends the
// way docker compose does, noting each variable nothing sets.
func interpolate(text string, env map[string]string, missing map[string]bool) string {
	return composeVariable.ReplaceAllStringFunc(text, func(match string) string {
		if match == "$$" {
			return "$"
		}
		parts := composeVariable.FindStringSubmatch(match)
		name, op, arg := parts[1], parts[2], parts[3]
		if name == "" {
			name = parts[4]
		}
		value, set := env[name]
		empty := !set || value == ""
		switch op {
		case ":-":
			if empty {
				return arg
			}
		case "-":
			if !set {
				return arg
			}
		case ":+":
			if empty {
				return ""
			}
			return arg
		case "+":
			if !set {
				return ""
			}
			return arg
		case ":?", "?":
			if (op == ":?" && empty) || (op == "?" && !set) {
				missing[name] = true
			}
		default:
			if !set {
				missing[name] = true
			}
		}
		return value
	})
}

func interpolateTree(value interface{}, env map[string]string, missing map[string]bool) interface{} {
	switch v := value.(type) {
	case string:
		return interpolate(v, env, missing)
	case map[string]interface{}:
		for key, item := range v {
			v[key] = interpolateTree(item, env, missing)
		}
	case []interface{}:
		for i, item := range v {
			v[i] = interpolateTree(item, env, missing)
		}
	}
	return value
}

func composeString(value interface{}) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	case bool:
		return strconv.FormatBool(v)
	case int:
		return strconv.Itoa(v)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	}
	return fmt.Sprint(value)
}

func composeMap(value interface{}) map[string]interface{} {
	m, _ := value.(map[string]interface{})
	return m
}

func composeList(value interface{}) []interface{} {
	list, _ := value.([]interface{})
	return list
}

// splitCommand splits a command line into words the way compose does: on
// spaces, honouring quotes and backslashes, with no shell involved.
func splitCommand(line string) []string {
	var words []string
	var current strings.Builder
	inWord := false
	var quote rune
	escaped := false
	for _, r := range line {
		switch {
		case escaped:
			current.WriteRune(r)
			escaped = false
		case r == '\\' && quote != '\'':
			escaped = true
			inWord = true
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				current.WriteRune(r)
			}
		case r == '"' || r == '\'':
			quote = r
			inWord = true
		case r == ' ' || r == '\t' || r == '\n':
			if inWord {
				words = append(words, current.String())
				current.Reset()
				inWord = false
			}
		default:
			current.WriteRune(r)
			inWord = true
		}
	}
	if inWord {
		words = append(words, current.String())
	}
	return words
}

func composeCommand(value interface{}) []string {
	if list := composeList(value); list != nil {
		words := make([]string, 0, len(list))
		for _, item := range list {
			words = append(words, composeString(item))
		}
		return words
	}
	if text := composeString(value); text != "" {
		return splitCommand(text)
	}
	return nil
}

var composeMemory = regexp.MustCompile(`(?i)^\s*(\d+(?:\.\d+)?)\s*([bkmgt]?)b?\s*$`)

// composeQuantity turns compose's 512m and 1g into Kubernetes' 512Mi and 1Gi.
func composeQuantity(value string, memory bool) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", false
	}
	if memory {
		if parts := composeMemory.FindStringSubmatch(value); parts != nil {
			suffix := map[string]string{"": "", "b": "", "k": "Ki", "m": "Mi", "g": "Gi", "t": "Ti"}[strings.ToLower(parts[2])]
			value = parts[1] + suffix
		}
	}
	if _, err := resource.ParseQuantity(value); err != nil {
		return "", false
	}
	return value, true
}

func composePort(text string) (int32, bool) {
	text, _, _ = strings.Cut(strings.TrimSpace(text), "/")
	port, err := strconv.Atoi(text)
	if err != nil || port < 1 || port > 65535 {
		return 0, false
	}
	return int32(port), true
}

// serviceNamesInOrder reads the services in the order the file lists them,
// which decoding into a map forgets.
func serviceNamesInOrder(text string) []string {
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(text), &doc); err != nil || len(doc.Content) == 0 {
		return nil
	}
	root := doc.Content[0]
	for i := 0; i+1 < len(root.Content); i += 2 {
		if root.Content[i].Value != "services" {
			continue
		}
		services := root.Content[i+1]
		var names []string
		for j := 0; j+1 < len(services.Content); j += 2 {
			names = append(names, services.Content[j].Value)
		}
		return names
	}
	return nil
}

func planCompose(cfg *rest.Config, input composeInput) (*composePlan, error) {
	if len(input.Compose) > composeMaxBytes {
		return nil, fmt.Errorf("the compose file is too large")
	}
	var doc map[string]interface{}
	if err := yaml.Unmarshal([]byte(input.Compose), &doc); err != nil {
		return nil, fmt.Errorf("that is not valid YAML: %v", err)
	}
	services := composeMap(doc["services"])
	if len(services) == 0 {
		return nil, fmt.Errorf("the file has no services")
	}

	project := strings.ToLower(strings.TrimSpace(input.Project))
	if project == "" {
		project = strings.ToLower(composeString(doc["name"]))
	}
	if project == "" {
		return nil, fmt.Errorf("give the project a name")
	}
	if problems := validation.IsDNS1123Label(project); len(problems) > 0 {
		return nil, fmt.Errorf("the project name %q is invalid: %s", project, strings.Join(problems, "; "))
	}

	plan := &composePlan{Project: project, Services: []composeServicePlan{}, Warnings: []string{}, Missing: []string{}, extras: map[string]composeExtras{}}
	missing := map[string]bool{}
	interpolateTree(doc, parseDotEnv(input.Env), missing)
	for name := range missing {
		plan.Missing = append(plan.Missing, name)
	}
	sort.Strings(plan.Missing)

	gpuAvailable := clusterGPU(cfg).Name != ""
	names := serviceNamesInOrder(input.Compose)
	if len(names) != len(services) {
		names = names[:0]
		for name := range services {
			names = append(names, name)
		}
		sort.Strings(names)
	}

	for _, name := range names {
		service := composeMap(services[name])
		if service == nil {
			continue
		}
		if problems := validation.IsDNS1123Label(name); len(problems) > 0 {
			return nil, fmt.Errorf("the service name %q cannot name a Kubernetes service: use lowercase letters, digits and '-'", name)
		}
		if profiles := composeList(service["profiles"]); len(profiles) > 0 {
			plan.warn("%s is left out: it belongs to a profile, which docker compose also skips unless asked", name)
			continue
		}
		req, extras, servicePlan, err := planComposeService(plan, name, service, gpuAvailable)
		if err != nil {
			return nil, err
		}
		plan.Services = append(plan.Services, servicePlan)
		plan.requests = append(plan.requests, req)
		plan.extras[name] = extras
	}
	if len(plan.Services) == 0 {
		return nil, fmt.Errorf("no service is left to deploy")
	}

	main := pickComposeMain(project, plan.Services)
	plan.Main = main
	for i := range plan.Services {
		servicePlan := &plan.Services[i]
		req := &plan.requests[i]
		servicePlan.Main = servicePlan.Name == main
		if !servicePlan.Main {
			req.Owner = main
			req.Component = servicePlan.Name
		}
		if servicePlan.published && len(servicePlan.Ports) > 0 {
			host := servicePlan.Name + "-" + project + "." + input.domain
			if servicePlan.Name == project {
				host = project + "." + input.domain
			}
			req.Domains = &[]appDomain{{Host: host, Port: servicePlan.Ports[0]}}
			servicePlan.Url = "http://" + host
			if IsAppGatewayHost(host) && appGatewayHTTPPort() != 80 {
				servicePlan.Url += fmt.Sprintf(":%d", appGatewayHTTPPort())
			}
		}
	}
	return plan, nil
}

func pickComposeMain(project string, services []composeServicePlan) string {
	for _, s := range services {
		if s.Name == project {
			return s.Name
		}
	}
	for _, s := range services {
		if s.published && !composeDatabaseNames.MatchString(s.Name) && !composeDatabaseNames.MatchString(s.Image) {
			return s.Name
		}
	}
	for _, s := range services {
		if s.published {
			return s.Name
		}
	}
	return services[0].Name
}

func planComposeService(plan *composePlan, name string, service map[string]interface{}, gpuAvailable bool) (deployAppRequest, composeExtras, composeServicePlan, error) {
	req := deployAppRequest{Namespace: plan.Project, Name: name, ServiceType: string(corev1.ServiceTypeClusterIP)}
	extras := composeExtras{}
	servicePlan := composeServicePlan{Name: name, Ports: []int32{}, Volumes: []string{}, Replicas: 1}

	req.Image = strings.TrimSpace(composeString(service["image"]))
	if req.Image == "" {
		if service["build"] != nil {
			return req, extras, servicePlan, fmt.Errorf("%s is built from source (build:), which a pasted compose file cannot bring along; push the image to a registry and name it with image:, or deploy the repository with Deploy from Git", name)
		}
		return req, extras, servicePlan, fmt.Errorf("%s has no image", name)
	}
	if service["build"] != nil {
		plan.warn("%s: build: is ignored and the image %s is pulled instead", name, req.Image)
	}
	servicePlan.Image = req.Image

	for _, key := range []string{"privileged", "cap_add", "devices", "network_mode", "pid", "ipc", "extra_hosts", "sysctls", "security_opt", "configs", "secrets", "env_file"} {
		if service[key] == nil {
			continue
		}
		switch key {
		case "env_file":
			plan.warn("%s: env_file is not read; paste its variables into the environment box instead", name)
		case "network_mode":
			plan.warn("%s: network_mode is ignored; services reach each other by name", name)
		default:
			plan.warn("%s: %s is not supported and is left out", name, key)
		}
	}

	env := map[string]string{}
	if m := composeMap(service["environment"]); m != nil {
		for key, value := range m {
			env[key] = composeString(value)
		}
	} else {
		for _, item := range composeList(service["environment"]) {
			key, value, _ := strings.Cut(composeString(item), "=")
			env[key] = value
		}
	}

	ports := map[int32]bool{}
	addPort := func(port int32, published bool) {
		if !ports[port] {
			ports[port] = true
			servicePlan.Ports = append(servicePlan.Ports, port)
		}
		servicePlan.published = servicePlan.published || published
	}
	for _, item := range composeList(service["ports"]) {
		if long := composeMap(item); long != nil {
			if port, ok := composePort(composeString(long["target"])); ok {
				addPort(port, composeString(long["published"]) != "")
			}
			continue
		}
		spec := composeString(item)
		if strings.Contains(spec, "-") {
			plan.warn("%s: the port range %s is left out", name, spec)
			continue
		}
		parts := strings.Split(spec, ":")
		port, ok := composePort(parts[len(parts)-1])
		if !ok {
			plan.warn("%s: cannot read the port %q", name, spec)
			continue
		}
		addPort(port, true)
	}
	for _, item := range composeList(service["expose"]) {
		if port, ok := composePort(composeString(item)); ok {
			addPort(port, false)
		}
	}
	for _, port := range servicePlan.Ports {
		req.Ports = append(req.Ports, appPortRequest{Name: fmt.Sprintf("p%d", port), ContainerPort: port, Protocol: "TCP"})
	}
	if servicePlan.published {
		req.ServiceType = string(corev1.ServiceTypeNodePort)
	}

	mounted := map[string]bool{}
	for _, item := range composeList(service["volumes"]) {
		kind, source, target := "", "", ""
		if long := composeMap(item); long != nil {
			kind, source, target = composeString(long["type"]), composeString(long["source"]), composeString(long["target"])
		} else {
			parts := strings.Split(composeString(item), ":")
			switch len(parts) {
			case 1:
				target = parts[0]
			default:
				source, target = parts[0], parts[1]
			}
		}
		if kind == "" {
			switch {
			case source == "":
				kind = "volume"
			case strings.HasPrefix(source, "/") || strings.HasPrefix(source, ".") || strings.HasPrefix(source, "~"):
				kind = "bind"
			default:
				kind = "volume"
			}
		}
		if !path.IsAbs(target) || mounted[target] {
			continue
		}
		switch kind {
		case "tmpfs":
			extras.tmpfs = append(extras.tmpfs, target)
			continue
		case "bind":
			if strings.HasSuffix(source, "docker.sock") {
				plan.warn("%s: the Docker socket is not available here and is left out", name)
				continue
			}
			if path.Ext(source) != "" && path.Ext(target) != "" {
				plan.warn("%s: the file %s cannot be brought along; add it later as a config file in the app's settings", name, source)
				continue
			}
			plan.warn("%s: the folder %s becomes a new, empty disk at %s; files on your machine are not copied", name, source, target)
		}
		mounted[target] = true
		req.Volumes = append(req.Volumes, volumeRequest{MountPath: target, Size: composeVolumeSize})
		servicePlan.Volumes = append(servicePlan.Volumes, target)
	}
	for _, item := range composeList(service["tmpfs"]) {
		extras.tmpfs = append(extras.tmpfs, composeString(item))
	}
	if text := composeString(service["tmpfs"]); text != "" && composeList(service["tmpfs"]) == nil {
		extras.tmpfs = append(extras.tmpfs, text)
	}

	req.Command = composeCommand(service["entrypoint"])
	req.Args = composeCommand(service["command"])
	extras.workingDir = composeString(service["working_dir"])
	if user := composeString(service["user"]); user != "" {
		uidText, gidText, _ := strings.Cut(user, ":")
		uid, err := strconv.ParseInt(uidText, 10, 64)
		if err != nil {
			plan.warn("%s: user %q is not a number, so the image's own user is kept", name, user)
		} else {
			extras.runAsUser = &uid
			if gid, err := strconv.ParseInt(gidText, 10, 64); err == nil {
				extras.runAsGroup = &gid
			}
		}
	}

	deploySpec := composeMap(service["deploy"])
	replicas := composeString(deploySpec["replicas"])
	if replicas == "" {
		replicas = composeString(service["scale"])
	}
	if count, err := strconv.Atoi(replicas); err == nil && count >= 0 {
		value := int32(count)
		req.Replicas = &value
		servicePlan.Replicas = value
	}
	limits := composeMap(composeMap(deploySpec["resources"])["limits"])
	cpu := composeString(limits["cpus"])
	if cpu == "" {
		cpu = composeString(service["cpus"])
	}
	if value, ok := composeQuantity(cpu, false); ok {
		req.CpuLimit = &value
	}
	memory := composeString(limits["memory"])
	if memory == "" {
		memory = composeString(service["mem_limit"])
	}
	if value, ok := composeQuantity(memory, true); ok {
		req.MemoryLimit = &value
	}

	wantsGpu := composeString(service["runtime"]) == "nvidia"
	for _, device := range composeList(composeMap(composeMap(composeMap(deploySpec["resources"])["reservations"]))["devices"]) {
		spec := composeMap(device)
		wantsGpu = wantsGpu || composeString(spec["driver"]) == "nvidia"
		for _, capability := range composeList(spec["capabilities"]) {
			wantsGpu = wantsGpu || composeString(capability) == "gpu"
		}
	}
	if wantsGpu {
		if gpuAvailable {
			extras.gpu = true
			servicePlan.Gpu = true
			env["NVIDIA_VISIBLE_DEVICES"] = "all"
			if _, ok := env["NVIDIA_DRIVER_CAPABILITIES"]; !ok {
				env["NVIDIA_DRIVER_CAPABILITIES"] = "compute,utility"
			}
		} else {
			plan.warn("%s asks for an NVIDIA GPU, but no node in this cluster has one, so it runs without", name)
		}
	}

	keys := make([]string, 0, len(env))
	for key := range env {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		req.EnvVars = append(req.EnvVars, envVarRequest{Name: key, Value: env[key]})
	}
	servicePlan.EnvCount = len(env)
	return req, extras, servicePlan, nil
}

func (e composeExtras) apply(depl *appsv1.Deployment) error {
	spec := &depl.Spec.Template.Spec
	if len(spec.Containers) == 0 {
		return fmt.Errorf("the workload has no container")
	}
	container := &spec.Containers[0]
	container.WorkingDir = e.workingDir
	// A project pulls several images at once, so a first start easily
	// outlasts the default ten minutes, as a DevBox's does.
	deadline := devboxProgressDeadline
	depl.Spec.ProgressDeadlineSeconds = &deadline
	if e.runAsUser != nil {
		if container.SecurityContext == nil {
			container.SecurityContext = &corev1.SecurityContext{}
		}
		container.SecurityContext.RunAsUser = e.runAsUser
		container.SecurityContext.RunAsGroup = e.runAsGroup
	}
	if e.gpu {
		runtimeClass := deploy.NvidiaRuntimeClass
		spec.RuntimeClassName = &runtimeClass
	}
	for i, target := range e.tmpfs {
		volume := fmt.Sprintf("tmpfs-%d", i)
		spec.Volumes = append(spec.Volumes, corev1.Volume{Name: volume, VolumeSource: corev1.VolumeSource{
			EmptyDir: &corev1.EmptyDirVolumeSource{Medium: corev1.StorageMediumMemory},
		}})
		container.VolumeMounts = append(container.VolumeMounts, corev1.VolumeMount{Name: volume, MountPath: target})
	}
	return nil
}

// deployCompose creates every service of a planned project, and takes back what
// it created when one of them fails, so a retry starts clean.
func deployCompose(cfg *rest.Config, plan *composePlan) error {
	if err := mcpEnsureNamespace(cfg, plan.Project); err != nil {
		return err
	}
	var taken []string
	for _, req := range plan.requests {
		if _, err := object.GetDeployment(cfg, req.Namespace, req.Name); err == nil {
			taken = append(taken, req.Name)
		} else if !errors.IsNotFound(err) {
			return err
		}
	}
	if len(taken) > 0 {
		return fmt.Errorf("namespace %s already runs %s; pick another project name", plan.Project, strings.Join(taken, ", "))
	}

	for _, req := range plan.requests {
		extras := plan.extras[req.Name]
		_, err := deployAppWorkload(cfg, req, workloadOptions{mutate: extras.apply})
		if err == nil && len(req.Ports) == 0 {
			err = addComposeHeadlessService(cfg, req)
		}
		if err != nil {
			if cleanupErr := uninstallImageApp(cfg, plan.Project, plan.Main, true); cleanupErr != nil {
				return fmt.Errorf("deploy %s: %v (and cleaning up failed: %v)", req.Name, err, cleanupErr)
			}
			return fmt.Errorf("deploy %s: %v", req.Name, err)
		}
	}
	return nil
}

// A compose network lets a service reach another on any port, declared or not:
// the database's 3306 comes from its image, not the compose file. A headless
// Service without ports is the same thing, its name resolving straight to the
// pods.
func addComposeHeadlessService(cfg *rest.Config, req deployAppRequest) error {
	owner := req.Owner
	if owner == "" {
		owner = req.Name
	}
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: req.Name, Namespace: req.Namespace, Labels: appOwnershipLabels(owner, req.Component)},
		Spec: corev1.ServiceSpec{
			ClusterIP: corev1.ClusterIPNone,
			Selector:  map[string]string{"app": req.Name},
		},
	}
	_, err := object.AddService(cfg, svc)
	return err
}

func (c *ApiController) composeInput() (composeInput, bool) {
	var input composeInput
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &input); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return input, false
	}
	input.domain = defaultCloudDomain(c.Ctx.Request.Host)
	return input, true
}

// PreviewCompose shows what deploying a compose file would create, without
// creating anything.
// @router /api/preview-compose [post]
func (c *ApiController) PreviewCompose() {
	if c.RequireSignedIn() {
		return
	}
	input, ok := c.composeInput()
	if !ok {
		return
	}
	plan, err := planCompose(getAdminRestConfig(), input)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(plan)
}

// DeployCompose deploys a compose file as one app.
// @router /api/deploy-compose [post]
func (c *ApiController) DeployCompose() {
	if c.RequireAdmin() {
		return
	}
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	input, ok := c.composeInput()
	if !ok {
		return
	}
	plan, err := planCompose(cfg, input)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	if err := deployCompose(cfg, plan); err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(plan)
}
