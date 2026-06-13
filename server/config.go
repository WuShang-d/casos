package server

import (
	"fmt"
	"net"
	"strings"

	"github.com/beego/beego"
)

// Config holds control-plane settings populated from app.conf.
type Config struct {
	DataDir          string
	ApiserverBind    string // actual bind / SAN IP (may be loopback in dev)
	AdvertiseAddress string // non-loopback IP registered as kubernetes service endpoint
	ApiserverPort    int
	DSN              string // MySQL DSN forwarded to kine
}

// ConfigFromAppConf reads server config from the beego app.conf.
func ConfigFromAppConf() (Config, error) {
	dataDir := beego.AppConfig.String("dataDir")
	if dataDir == "" {
		dataDir = "/var/lib/casos"
	}
	bind := beego.AppConfig.String("apiserverBind")
	if bind == "" {
		bind = outboundIP()
	}
	port, _ := beego.AppConfig.Int("apiserverPort")
	if port == 0 {
		port = 6443
	}
	dsn := beego.AppConfig.String("dataSourceName")
	if dsn == "" {
		return Config{}, fmt.Errorf("dataSourceName not set in app.conf")
	}
	dbName := beego.AppConfig.String("dbName")
	if dbName == "" {
		dbName = "casos"
	}
	dsn = injectDBName(dsn, dbName)

	advertise := outboundIP()
	if advertise == "127.0.0.1" || advertise == "::1" {
		advertise = bind
	}

	return Config{
		DataDir:          dataDir,
		ApiserverBind:    bind,
		AdvertiseAddress: advertise,
		ApiserverPort:    port,
		DSN:              dsn,
	}, nil
}

// injectDBName inserts dbName into a MySQL DSN of the form
// user:pass@tcp(host:port)/ (trailing slash, no database).
// If a database is already present it is replaced.
func injectDBName(dsn, dbName string) string {
	idx := strings.LastIndex(dsn, "/")
	if idx < 0 {
		return dsn + dbName
	}
	base := dsn[:idx+1]
	rest := dsn[idx+1:]
	if q := strings.Index(rest, "?"); q >= 0 {
		return base + dbName + rest[q:]
	}
	return base + dbName
}

// outboundIP returns the preferred non-loopback outbound IP of this machine.
func outboundIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return "127.0.0.1"
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP.String()
}
