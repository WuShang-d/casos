package controllers

import (
	"encoding/json"
	"strconv"

	"github.com/casosorg/casos/object"
)

// GetCasbinRules godoc
// @router /api/get-casbin-rules [get]
func (c *ApiController) GetCasbinRules() {
	rules, err := object.GetCasbinRules()
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(rules)
}

// AddCasbinRule godoc
// @router /api/add-casbin-rule [post]
func (c *ApiController) AddCasbinRule() {
	var rule object.CasbinRule
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &rule); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return
	}
	if rule.PType == "" || rule.V0 == "" {
		c.ResponseError("pType and v0 are required")
		return
	}
	if err := object.AddCasbinRule(&rule); err != nil {
		c.ResponseError(err.Error())
		return
	}
	if err := object.ReloadEnforcer(); err != nil {
		c.ResponseError("rule saved but enforcer reload failed: " + err.Error())
		return
	}
	c.ResponseOk()
}

// DeleteCasbinRule godoc
// @router /api/delete-casbin-rule [post]
func (c *ApiController) DeleteCasbinRule() {
	var body struct {
		Id string `json:"id"`
	}
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &body); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return
	}
	id, err := strconv.ParseInt(body.Id, 10, 64)
	if err != nil {
		c.ResponseError("invalid id")
		return
	}
	if err := object.DeleteCasbinRule(id); err != nil {
		c.ResponseError(err.Error())
		return
	}
	if err := object.ReloadEnforcer(); err != nil {
		c.ResponseError("rule deleted but enforcer reload failed: " + err.Error())
		return
	}
	c.ResponseOk()
}

// ReloadCasbinEnforcer godoc
// @router /api/reload-casbin-enforcer [post]
func (c *ApiController) ReloadCasbinEnforcer() {
	if err := object.ReloadEnforcer(); err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk()
}
