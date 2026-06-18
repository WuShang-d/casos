package server

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"

	"github.com/beego/beego/logs"
	"github.com/casosorg/casos/object"
	admissionv1 "k8s.io/api/admission/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// StartAdmissionWebhook generates the webhook TLS cert (if absent) and
// launches the HTTPS server. Callers only need to pass the server Config.
func StartAdmissionWebhook(cfg Config) error {
	certDir := cfg.DataDir + "/tls"
	if err := EnsureWebhookCert(certDir); err != nil {
		return fmt.Errorf("webhook cert: %w", err)
	}
	return StartAdmissionServer(certDir, cfg.WebhookPort)
}

// StartAdmissionServer launches an HTTPS server on webhookPort serving the
// Casbin ValidatingAdmissionWebhook endpoint.
func StartAdmissionServer(certDir string, webhookPort int) error {
	certFile := filepath.Join(certDir, "webhook.crt")
	keyFile := filepath.Join(certDir, "webhook.key")

	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return fmt.Errorf("load webhook cert: %w", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/admission/validate", admissionValidateHandler)

	srv := &http.Server{
		Addr:    fmt.Sprintf(":%d", webhookPort),
		Handler: mux,
		TLSConfig: &tls.Config{
			Certificates: []tls.Certificate{cert},
			MinVersion:   tls.VersionTLS12,
		},
	}

	go func() {
		logs.Info("admission webhook server listening on :%d", webhookPort)
		if err := srv.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
			logs.Error("admission webhook server error: %v", err)
		}
	}()
	return nil
}

func admissionValidateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var review admissionv1.AdmissionReview
	if err := json.NewDecoder(r.Body).Decode(&review); err != nil {
		http.Error(w, "decode error: "+err.Error(), http.StatusBadRequest)
		return
	}

	req := review.Request
	allowed, err := object.EnforceAdmission(
		req.UserInfo.Username,
		req.Namespace,
		req.Resource.Resource,
		string(req.Operation),
	)

	resp := &admissionv1.AdmissionReview{
		TypeMeta: metav1.TypeMeta{APIVersion: "admission.k8s.io/v1", Kind: "AdmissionReview"},
		Response: &admissionv1.AdmissionResponse{
			UID:     req.UID,
			Allowed: allowed && err == nil,
		},
	}
	if !allowed || err != nil {
		msg := "denied by Casbin policy"
		if err != nil {
			msg = err.Error()
		}
		resp.Response.Result = &metav1.Status{Message: msg}
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		logs.Error("admission response encode: %v", err)
	}
}
