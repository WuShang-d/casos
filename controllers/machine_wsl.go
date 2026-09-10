package controllers

import (
	"github.com/casosorg/casos/deploy"
)

// GetLocalWSLDistros lists the WSL distros of the local Windows host, so a host
// with several can choose which one to enroll.
// @router /api/get-local-wsl-distros [get]
func (c *ApiController) GetLocalWSLDistros() {
	if c.RequireAdmin() {
		return
	}

	distros, err := deploy.ListLocalWSLDistros(c.Ctx.Request.Context(), "admin")
	if err != nil {
		c.ResponseError(err.Error())
		return
	}

	c.ResponseOk(distros)
}

// AddLocalWSLMachine starts enrolling a WSL distro of the local Windows host as
// a machine, without asking the user for any connection detail. The optional
// distro parameter picks one; without it CasOS picks one itself. It runs in
// the background because a host without WSL has a distribution to install
// first, so the caller polls GetLocalWSLMachineStatus for progress.
// @router /api/add-local-wsl-machine [post]
func (c *ApiController) AddLocalWSLMachine() {
	if c.RequireAdmin() {
		return
	}

	status, err := deploy.StartLocalWSLEnrollment("admin", c.GetString("distro"))
	if err != nil {
		c.ResponseError(err.Error())
		return
	}

	c.ResponseOk(status)
}

// GetLocalWSLMachineStatus reports the progress of the enrollment started by
// AddLocalWSLMachine.
// @router /api/get-local-wsl-machine-status [get]
func (c *ApiController) GetLocalWSLMachineStatus() {
	if c.RequireAdmin() {
		return
	}

	c.ResponseOk(deploy.GetLocalWSLEnrollment())
}
