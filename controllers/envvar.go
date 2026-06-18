package controllers

import (
	corev1 "k8s.io/api/core/v1"
)

type envVarRequest struct {
	Name          string `json:"name"`
	Value         string `json:"value,omitempty"`
	ConfigMapName string `json:"configMapName,omitempty"`
	ConfigMapKey  string `json:"configMapKey,omitempty"`
	SecretName    string `json:"secretName,omitempty"`
	SecretKey     string `json:"secretKey,omitempty"`
}

type envVarSummary struct {
	Name          string `json:"name"`
	Value         string `json:"value,omitempty"`
	ConfigMapName string `json:"configMapName,omitempty"`
	ConfigMapKey  string `json:"configMapKey,omitempty"`
	SecretName    string `json:"secretName,omitempty"`
	SecretKey     string `json:"secretKey,omitempty"`
}

func buildEnvVars(evs []envVarRequest) []corev1.EnvVar {
	result := make([]corev1.EnvVar, 0, len(evs))
	for _, e := range evs {
		if e.Name == "" {
			continue
		}
		ev := corev1.EnvVar{Name: e.Name}
		if e.ConfigMapName != "" && e.ConfigMapKey != "" {
			ev.ValueFrom = &corev1.EnvVarSource{
				ConfigMapKeyRef: &corev1.ConfigMapKeySelector{
					LocalObjectReference: corev1.LocalObjectReference{Name: e.ConfigMapName},
					Key:                  e.ConfigMapKey,
				},
			}
		} else if e.SecretName != "" && e.SecretKey != "" {
			ev.ValueFrom = &corev1.EnvVarSource{
				SecretKeyRef: &corev1.SecretKeySelector{
					LocalObjectReference: corev1.LocalObjectReference{Name: e.SecretName},
					Key:                  e.SecretKey,
				},
			}
		} else {
			ev.Value = e.Value
		}
		result = append(result, ev)
	}
	return result
}

func extractEnvVars(containers []corev1.Container) []envVarSummary {
	if len(containers) == 0 {
		return []envVarSummary{}
	}
	envs := containers[0].Env
	result := make([]envVarSummary, 0, len(envs))
	for _, e := range envs {
		ev := envVarSummary{Name: e.Name}
		if e.ValueFrom != nil {
			if e.ValueFrom.ConfigMapKeyRef != nil {
				ev.ConfigMapName = e.ValueFrom.ConfigMapKeyRef.Name
				ev.ConfigMapKey = e.ValueFrom.ConfigMapKeyRef.Key
			} else if e.ValueFrom.SecretKeyRef != nil {
				ev.SecretName = e.ValueFrom.SecretKeyRef.Name
				ev.SecretKey = e.ValueFrom.SecretKeyRef.Key
			}
		} else {
			ev.Value = e.Value
		}
		result = append(result, ev)
	}
	return result
}
