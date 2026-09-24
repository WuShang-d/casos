import React from "react";
import i18next from "i18next";
import {Code2, Cpu, FileCode2, Flame, FlaskConical, Hexagon, Package, Rabbit} from "lucide-react";
import {cn} from "@/lib/utils";

const PIP_REQUIREMENTS = "if [ -f requirements.txt ]; then pip install -r requirements.txt; fi";

// Each setup runs once, as uid 1000, and must install into the home disk: nothing else survives a restart.
export const DEVBOX_PRESETS = [
  {key: "general", icon: Code2, label: () => i18next.t("devbox:General"), image: "", setup: ""},
  {key: "python", icon: FileCode2, label: () => "Python", image: "python:3.12", setup: PIP_REQUIREMENTS},
  {
    key: "conda",
    icon: FlaskConical,
    label: () => "Conda",
    image: "continuumio/miniconda3:latest",
    setup: "if [ -f environment.yml ]; then conda env create -f environment.yml; fi",
  },
  {
    key: "pytorch",
    icon: Flame,
    label: () => "PyTorch + CUDA",
    image: "pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime",
    setup: PIP_REQUIREMENTS,
    hint: () => i18next.t("devbox:x86 only. The editor takes no GPU; ask for one when you start a run."),
  },
  {key: "node", icon: Hexagon, label: () => "Node.js", image: "node:24", setup: "if [ -f package.json ]; then npm install; fi"},
  {
    key: "go",
    icon: Rabbit,
    label: () => "Go",
    image: "golang:1.26",
    // The image sets GOPATH in its environment, which go env -w cannot override.
    setup: "go env -w GOMODCACHE=\"$HOME/go/pkg/mod\"\nif [ -f go.mod ]; then go mod download; fi",
  },
  {key: "cpp", icon: Cpu, label: () => "C / C++", image: "gcc:15", setup: ""},
  {key: "custom", icon: Package, label: () => i18next.t("devbox:Custom image"), image: "", setup: ""},
];

export const presetByKey = (key) => DEVBOX_PRESETS.find((preset) => preset.key === key) ?? DEVBOX_PRESETS[0];

export function DevboxEnvironmentPicker({value, onChange}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" data-testid="devbox-environment">
      {DEVBOX_PRESETS.map((preset) => {
        const Icon = preset.icon;
        const selected = preset.key === value;
        return (
          <button
            key={preset.key}
            type="button"
            role="radio"
            aria-checked={selected}
            data-testid={`devbox-preset-${preset.key}`}
            onClick={() => onChange(preset)}
            className={cn(
              "flex min-w-0 flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-colors outline-none",
              "hover:bg-accent focus-visible:ring-ring/50 focus-visible:ring-[3px]",
              selected && "border-primary bg-primary/5 ring-primary/30 ring-1"
            )}
          >
            <Icon className={cn("size-4", selected ? "text-primary" : "text-muted-foreground")} />
            <span className="text-sm font-medium">{preset.label()}</span>
            <span className="text-muted-foreground w-full truncate font-mono text-[11px]">
              {preset.key === "general" ? "code-server" : preset.image || "—"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
