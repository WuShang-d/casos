package controllers

import (
	"encoding/gob"

	"github.com/beego/beego"
	"github.com/beego/beego/context"
	"github.com/casdoor/casdoor-go-sdk/casdoorsdk"
)

type ApiController struct {
	beego.Controller
}

func init() {
	gob.Register(casdoorsdk.Claims{})
}

const sessionUserKey = "user"

func IsSignedIn(ctx *context.Context) bool {
	return ctx.Input.Session(sessionUserKey) != nil
}

func (c *ApiController) GetSessionClaims() *casdoorsdk.Claims {
	s := c.GetSession(sessionUserKey)
	if s == nil {
		return nil
	}

	claims := s.(casdoorsdk.Claims)
	return &claims
}

func (c *ApiController) SetSessionClaims(claims *casdoorsdk.Claims) {
	if claims == nil {
		c.DelSession(sessionUserKey)
		return
	}

	c.SetSession(sessionUserKey, *claims)
}

func (c *ApiController) GetSessionUser() *casdoorsdk.User {
	claims := c.GetSessionClaims()
	if claims == nil {
		return nil
	}

	return &claims.User
}
