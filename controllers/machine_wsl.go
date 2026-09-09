package controllers

import (
	"github.com/casosorg/casos/deploy"
)

// AddLocalWSLMachine starts enrolling the WSL distro of the local Windows host
// as a machine, without asking the user for any connection detail. It runs in
// the background because a host without WSL has a distribution to install
// first, so the caller polls GetLocalWSLMachineStatus for progress.
// @router /api/add-local-wsl-machine [post]
func (c *ApiController) AddLocalWSLMachine() {
	if c.RequireAdmin() {
		return
	}

	status, err := deploy.StartLocalWSLEnrollment("admin")
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
