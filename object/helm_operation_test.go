package object

import (
	"testing"
)

func TestFailInterruptedHelmOperationTasks(t *testing.T) {
	withTestOrmer(t)

	interrupted, err := CreateHelmOperationTask("admin", HelmOperationInstall, "kubeview", "default", "kubeview", "", "2.0.6")
	if err != nil {
		t.Fatalf("CreateHelmOperationTask: %v", err)
	}
	if err := StartHelmOperationTaskContext(t.Context(), interrupted.Id, HelmOperationPhaseLoading); err != nil {
		t.Fatalf("StartHelmOperationTaskContext: %v", err)
	}
	finished, err := CreateHelmOperationTask("admin", HelmOperationInstall, "traefik", "kube-system", "traefik", "", "27.0.2")
	if err != nil {
		t.Fatalf("CreateHelmOperationTask: %v", err)
	}
	if err := FinishHelmOperationTask(finished.Id, true, ""); err != nil {
		t.Fatalf("FinishHelmOperationTask: %v", err)
	}

	affected, err := FailInterruptedHelmOperationTasks()
	if err != nil {
		t.Fatalf("FailInterruptedHelmOperationTasks: %v", err)
	}
	if affected != 1 {
		t.Fatalf("FailInterruptedHelmOperationTasks affected %d rows, want 1", affected)
	}

	recovered, err := GetHelmOperationTask(interrupted.Id)
	if err != nil {
		t.Fatalf("GetHelmOperationTask: %v", err)
	}
	if recovered.Status != HelmOperationStatusFailed || recovered.Phase != HelmOperationPhaseFailed {
		t.Fatalf("interrupted task is %s/%s, want %s/%s",
			recovered.Status, recovered.Phase, HelmOperationStatusFailed, HelmOperationPhaseFailed)
	}
	if recovered.ErrorMsg != HelmOperationInterruptedMessage {
		t.Fatalf("interrupted task error = %q, want %q", recovered.ErrorMsg, HelmOperationInterruptedMessage)
	}
	if recovered.FinishedAt.IsZero() {
		t.Fatal("interrupted task was not given a finish time")
	}

	untouched, err := GetHelmOperationTask(finished.Id)
	if err != nil {
		t.Fatalf("GetHelmOperationTask: %v", err)
	}
	if untouched.Status != HelmOperationStatusSucceeded {
		t.Fatalf("finished task is %s, want %s", untouched.Status, HelmOperationStatusSucceeded)
	}

	// Clearing active_key is what frees the release name; without it the next
	// install collides with a task nothing is running any more.
	next, err := CreateHelmOperationTask("admin", HelmOperationInstall, "kubeview", "default", "kubeview", "", "2.0.6")
	if err != nil {
		t.Fatalf("CreateHelmOperationTask after recovery: %v", err)
	}
	if next.Id == interrupted.Id {
		t.Fatal("CreateHelmOperationTask reused the interrupted task")
	}
}

func TestGetLatestHelmOperationTaskForRelease(t *testing.T) {
	withTestOrmer(t)

	if _, err := GetLatestHelmOperationTaskForRelease("", "kubeview"); err == nil {
		t.Fatal("GetLatestHelmOperationTaskForRelease accepted an empty namespace")
	}
	missing, err := GetLatestHelmOperationTaskForRelease("default", "kubeview")
	if err != nil {
		t.Fatalf("GetLatestHelmOperationTaskForRelease: %v", err)
	}
	if missing != nil {
		t.Fatalf("GetLatestHelmOperationTaskForRelease returned %+v for a release with no history", missing)
	}

	first, err := CreateHelmOperationTask("admin", HelmOperationInstall, "kubeview", "default", "kubeview", "", "2.0.6")
	if err != nil {
		t.Fatalf("CreateHelmOperationTask: %v", err)
	}
	if err := FinishHelmOperationTask(first.Id, false, "boom"); err != nil {
		t.Fatalf("FinishHelmOperationTask: %v", err)
	}
	// Another owner's task is still the answer: the question is about a release
	// every administrator on this page can already see.
	second, err := CreateHelmOperationTask("someone-else", HelmOperationUpgrade, "kubeview", "default", "kubeview", "", "2.0.7")
	if err != nil {
		t.Fatalf("CreateHelmOperationTask: %v", err)
	}
	// Same release name in another namespace must not be mistaken for it.
	if _, err := CreateHelmOperationTask("admin", HelmOperationInstall, "kubeview", "other", "kubeview", "", "2.0.6"); err != nil {
		t.Fatalf("CreateHelmOperationTask: %v", err)
	}

	latest, err := GetLatestHelmOperationTaskForRelease("default", "kubeview")
	if err != nil {
		t.Fatalf("GetLatestHelmOperationTaskForRelease: %v", err)
	}
	if latest == nil || latest.Id != second.Id {
		t.Fatalf("GetLatestHelmOperationTaskForRelease returned %+v, want task %d", latest, second.Id)
	}
}
