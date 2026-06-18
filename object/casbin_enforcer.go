package object

import (
	"sync"

	"github.com/casbin/casbin/v2"
	"github.com/casbin/casbin/v2/model"
	"github.com/casbin/casbin/v2/persist"
)

const casbinModelText = `
[request_definition]
r = sub, ns, resource, action

[policy_definition]
p = sub, ns, resource, action

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = (g(r.sub, p.sub) || r.sub == p.sub || p.sub == "*") && (p.ns == "*" || r.ns == p.ns) && (p.resource == "*" || r.resource == p.resource) && (p.action == "*" || r.action == p.action)
`

var (
	enforcerMu sync.RWMutex
	gEnforcer  *casbin.Enforcer
)

// dbAdapter loads Casbin policy from the in-memory rule slice.
type dbAdapter struct{ rules []*CasbinRule }

func (a *dbAdapter) LoadPolicy(m model.Model) error {
	for _, r := range a.rules {
		parts := []string{r.PType, r.V0}
		for _, v := range []string{r.V1, r.V2, r.V3} {
			if v == "" {
				break
			}
			parts = append(parts, v)
		}
		line := ""
		for i, p := range parts {
			if i == 0 {
				line = p
			} else {
				line += ", " + p
			}
		}
		persist.LoadPolicyLine(line, m)
	}
	return nil
}
func (a *dbAdapter) SavePolicy(model.Model) error                              { return nil }
func (a *dbAdapter) AddPolicy(string, string, []string) error                  { return nil }
func (a *dbAdapter) RemovePolicy(string, string, []string) error               { return nil }
func (a *dbAdapter) RemoveFilteredPolicy(string, string, int, ...string) error { return nil }

// ReloadEnforcer rebuilds the enforcer from the current DB rules.
// Call this after every policy mutation.
func ReloadEnforcer() error {
	rules, err := GetCasbinRules()
	if err != nil {
		return err
	}
	m, err := model.NewModelFromString(casbinModelText)
	if err != nil {
		return err
	}
	e, err := casbin.NewEnforcer(m, &dbAdapter{rules: rules})
	if err != nil {
		return err
	}
	enforcerMu.Lock()
	gEnforcer = e
	enforcerMu.Unlock()
	return nil
}

// EnforceAdmission checks whether the user may perform action on resource in namespace.
// Returns (true, nil) when no policy rules exist yet (safe opt-in behaviour).
func EnforceAdmission(user, namespace, resource, action string) (bool, error) {
	enforcerMu.RLock()
	e := gEnforcer
	enforcerMu.RUnlock()
	if e == nil {
		return true, nil
	}
	policies, _ := e.GetPolicy()
	roles, _ := e.GetGroupingPolicy()
	if len(policies) == 0 && len(roles) == 0 {
		return true, nil
	}
	return e.Enforce(user, namespace, resource, action)
}
