package server

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/beego/beego/v2/core/config"
	"github.com/sirupsen/logrus"
	"github.com/spf13/pflag"

	// kine: MySQL -> etcd v3 gRPC adapter
	"github.com/k3s-io/kine/pkg/endpoint"

	// apiserver in-process entry point (k3s-io/kubernetes fork)
	apiserverapp "k8s.io/kubernetes/cmd/kube-apiserver/app"
	"k8s.io/kubernetes/cmd/kube-apiserver/app/options"

	globalflag "k8s.io/component-base/cli/globalflag"
	"k8s.io/component-base/logs"
)

// Config holds control-plane settings populated from app.conf.
type Config struct {
	DataDir       string
	ApiserverBind string
	ApiserverPort int
	DSN           string // MySQL DSN forwarded to kine
}

// ConfigFromAppConf reads server config from the beego app.conf.
func ConfigFromAppConf() (Config, error) {
	dataDir, _ := config.String("dataDir")
	if dataDir == "" {
		dataDir = "/var/lib/casos"
	}
	bind, _ := config.String("apiserverBind")
	if bind == "" {
		bind = "127.0.0.1"
	}
	port, _ := config.Int("apiserverPort")
	if port == 0 {
		port = 6443
	}
	dsn, err := config.String("dataSourceName")
	if err != nil || dsn == "" {
		return Config{}, fmt.Errorf("dataSourceName not set in app.conf")
	}
	dbName, _ := config.String("dbName")
	if dbName == "" {
		dbName = "casos"
	}
	dsn = injectDBName(dsn, dbName)

	return Config{
		DataDir:       dataDir,
		ApiserverBind: bind,
		ApiserverPort: port,
		DSN:           dsn,
	}, nil
}

// Start launches kine and the apiserver in-process.
// The returned channel is closed once the apiserver /readyz endpoint responds 200.
func Start(ctx context.Context, cfg Config) (<-chan struct{}, error) {
	certDir := filepath.Join(cfg.DataDir, "tls")
	if err := os.MkdirAll(certDir, 0700); err != nil {
		return nil, fmt.Errorf("mkdir tls: %w", err)
	}
	if err := ensureCerts(certDir, cfg.ApiserverBind); err != nil {
		return nil, fmt.Errorf("certs: %w", err)
	}

	// Step 1: start kine (MySQL backend exposed as etcd v3 gRPC on loopback).
	// endpoint.Listen returns (ETCDConfig, error) directly — not a struct field.
	etcdCfg, err := endpoint.Listen(ctx, endpoint.Config{
		Endpoint:         "mysql://" + cfg.DSN,
		Listener:         "tcp://127.0.0.1:2379",
		CompactBatchSize: 100,
	})
	if err != nil {
		return nil, fmt.Errorf("kine listen: %w", err)
	}
	logrus.Infof("kine started, etcd endpoint: %v", etcdCfg.Endpoints)

	// Step 2: build apiserver options and parse flags.
	// Mirrors what NewAPIServerCommand does: merge NamedFlagSets into one pflag.FlagSet.
	s := options.NewServerRunOptions()
	namedFlagSets := s.Flags()
	globalflag.AddGlobalFlags(namedFlagSets.FlagSet("global"), "kube-apiserver", logs.SkipLoggingConfigurationFlags())
	fs := pflag.NewFlagSet("kube-apiserver", pflag.ContinueOnError)
	for _, f := range namedFlagSets.FlagSets {
		fs.AddFlagSet(f)
	}
	if err := fs.Parse(buildApiserverArgs(cfg, certDir, etcdCfg.Endpoints[0])); err != nil {
		return nil, fmt.Errorf("apiserver flag parse: %w", err)
	}

	// Step 3: complete and validate options.
	completedOpts, err := s.Complete(ctx)
	if err != nil {
		return nil, fmt.Errorf("apiserver complete: %w", err)
	}
	if errs := completedOpts.Validate(); len(errs) != 0 {
		return nil, fmt.Errorf("apiserver validate: %v", errs)
	}

	// Step 4: run apiserver in a goroutine, then poll /readyz.
	stopCh := make(chan struct{})
	go func() {
		// TODO: launch scheduler and controller-manager in-process using
		// k8s.io/kubernetes/cmd/kube-{scheduler,controller-manager}/app
		if err := apiserverapp.Run(ctx, completedOpts, stopCh); err != nil {
			logrus.Errorf("apiserver exited: %v", err)
		}
	}()

	readyCh := make(chan struct{})
	go func() {
		waitForAPIServer(ctx, fmt.Sprintf("https://127.0.0.1:%d", cfg.ApiserverPort))
		close(readyCh)
	}()

	return readyCh, nil
}

// waitForAPIServer polls /readyz every 2 s until it gets HTTP 200 or ctx is done.
func waitForAPIServer(ctx context.Context, base string) {
	// #nosec G402: self-signed cert, InsecureSkipVerify intentional for milestone 1.
	client := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
		Timeout: 5 * time.Second,
	}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			resp, err := client.Get(base + "/readyz")
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					return
				}
			}
		}
	}
}

// injectDBName inserts dbName into a MySQL DSN of the form
// user:pass@tcp(host:port)/ (trailing slash, no database).
// If a database is already present it is replaced.
func injectDBName(dsn, dbName string) string {
	// MySQL DSN format: [user[:pass]@][protocol[(addr)]]/dbname[?params]
	// Find the slash after the closing ')' of the address part.
	idx := strings.LastIndex(dsn, "/")
	if idx < 0 {
		return dsn + dbName
	}
	base := dsn[:idx+1] // everything up to and including the slash
	rest := dsn[idx+1:] // existing dbname + optional ?params
	// Keep query params if present, replace (possibly empty) db name.
	if q := strings.Index(rest, "?"); q >= 0 {
		return base + dbName + rest[q:]
	}
	return base + dbName
}

func buildApiserverArgs(cfg Config, certDir, etcdEndpoint string) []string {
	return []string{
		"--advertise-address=" + cfg.ApiserverBind,
		"--bind-address=0.0.0.0",
		fmt.Sprintf("--secure-port=%d", cfg.ApiserverPort),
		"--etcd-servers=" + etcdEndpoint,
		"--service-cluster-ip-range=10.43.0.0/16",
		"--allow-privileged=true",
		"--authorization-mode=Node,RBAC",
		"--enable-admission-plugins=NodeRestriction",
		"--tls-cert-file=" + filepath.Join(certDir, "apiserver.crt"),
		"--tls-private-key-file=" + filepath.Join(certDir, "apiserver.key"),
		"--client-ca-file=" + filepath.Join(certDir, "ca.crt"),
		// Pure control-plane mode: no embedded kubelet / agent components.
		"--cloud-provider=",
	}
}

// ensureCerts generates a self-signed CA and apiserver cert/key if absent.
// Replace with a proper PKI in production.
func ensureCerts(dir, ip string) error {
	caKeyFile  := filepath.Join(dir, "ca.key")
	caCertFile := filepath.Join(dir, "ca.crt")
	srvKeyFile := filepath.Join(dir, "apiserver.key")
	srvCrtFile := filepath.Join(dir, "apiserver.crt")

	if fileExists(caCertFile) && fileExists(srvCrtFile) {
		return nil
	}

	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}
	caTemplate := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "casos-ca"},
		NotBefore:             time.Now().Add(-time.Minute),
		NotAfter:              time.Now().Add(10 * 365 * 24 * time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caKey.PublicKey, caKey)
	if err != nil {
		return err
	}
	if err := writePEM(caCertFile, "CERTIFICATE", caDER); err != nil {
		return err
	}
	caKeyDER, _ := x509.MarshalECPrivateKey(caKey)
	if err := writePEM(caKeyFile, "EC PRIVATE KEY", caKeyDER); err != nil {
		return err
	}
	caCert, _ := x509.ParseCertificate(caDER)

	srvKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}
	srvTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "kube-apiserver"},
		NotBefore:    time.Now().Add(-time.Minute),
		NotAfter:     time.Now().Add(10 * 365 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP(ip)},
		DNSNames:     []string{"localhost", "kubernetes", "kubernetes.default", "kubernetes.default.svc"},
	}
	srvDER, err := x509.CreateCertificate(rand.Reader, srvTemplate, caCert, &srvKey.PublicKey, caKey)
	if err != nil {
		return err
	}
	if err := writePEM(srvCrtFile, "CERTIFICATE", srvDER); err != nil {
		return err
	}
	srvKeyDER, _ := x509.MarshalECPrivateKey(srvKey)
	return writePEM(srvKeyFile, "EC PRIVATE KEY", srvKeyDER)
}

func writePEM(path, typ string, der []byte) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	return pem.Encode(f, &pem.Block{Type: typ, Bytes: der})
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
