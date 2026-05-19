"use client";

import { useState, useTransition } from "react";
import { savePodio } from "@/lib/actions/predictions";
import { Button } from "@/components/ui/button";

interface Team {
  id: string;
  code: string;
  name: string;
  flag_url: string | null;
}

interface PodioPrediction {
  champion_team_id: string | null;
  runner_up_team_id: string | null;
  third_place_team_id: string | null;
}

interface PodioProp {
  teams: Team[];
  existing: PodioPrediction | null;
  isLocked: boolean;
  t: {
    champion: string;
    runnerUp: string;
    thirdPlace: string;
    save: string;
    saving: string;
    saved: string;
    selectTeam: string;
    mustBeDistinct: string;
    errorSaving: string;
    pts: string;
  };
}

export function PodioPicker({ teams, existing, isLocked, t }: PodioProp) {
  const [champion, setChampion] = useState(existing?.champion_team_id ?? "");
  const [runnerUp, setRunnerUp] = useState(existing?.runner_up_team_id ?? "");
  const [third, setThird] = useState(existing?.third_place_team_id ?? "");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">(
    existing !== null ? "saved" : "idle"
  );
  const [distinctError, setDistinctError] = useState(false);
  const [, startTransition] = useTransition();

  if (isLocked) {
    const c = teams.find((t) => t.id === champion);
    const r = teams.find((t) => t.id === runnerUp);
    const th = teams.find((t) => t.id === third);
    return (
      <div className="space-y-4">
        <PodioSlot label={`🥇 ${t.champion}`} team={c ?? null} />
        <PodioSlot label={`🥈 ${t.runnerUp}`} team={r ?? null} />
        <PodioSlot label={`🥉 ${t.thirdPlace}`} team={th ?? null} />
      </div>
    );
  }

  const isDirty =
    champion !== (existing?.champion_team_id ?? "") ||
    runnerUp !== (existing?.runner_up_team_id ?? "") ||
    third !== (existing?.third_place_team_id ?? "");

  const isDistinct =
    !!champion && !!runnerUp && !!third &&
    champion !== runnerUp &&
    champion !== third &&
    runnerUp !== third;

  const canSave = saveStatus !== "saving" && isDistinct && (isDirty || saveStatus === "error");

  function handleSelect(setter: (v: string) => void, value: string) {
    setter(value);
    setSaveStatus("idle");
    setDistinctError(false);
  }

  function handleSave() {
    if (!isDistinct) {
      setDistinctError(true);
      return;
    }
    setDistinctError(false);
    setSaveStatus("saving");
    startTransition(async () => {
      const result = await savePodio(champion, runnerUp, third);
      setSaveStatus(result.ok ? "saved" : "error");
    });
  }

  return (
    <div className="space-y-6">
      {distinctError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t.mustBeDistinct}
        </p>
      )}

      <TeamPicker
        label={`🥇 ${t.champion}`}
        teams={teams}
        selected={champion}
        disabledIds={[runnerUp, third]}
        onSelect={(v) => handleSelect(setChampion, v)}
        placeholder={t.selectTeam}
      />
      <TeamPicker
        label={`🥈 ${t.runnerUp}`}
        teams={teams}
        selected={runnerUp}
        disabledIds={[champion, third]}
        onSelect={(v) => handleSelect(setRunnerUp, v)}
        placeholder={t.selectTeam}
      />
      <TeamPicker
        label={`🥉 ${t.thirdPlace}`}
        teams={teams}
        selected={third}
        disabledIds={[champion, runnerUp]}
        onSelect={(v) => handleSelect(setThird, v)}
        placeholder={t.selectTeam}
      />

      <Button
        onClick={handleSave}
        disabled={!canSave}
        className="w-full"
      >
        {saveStatus === "saving"
          ? t.saving
          : saveStatus === "saved"
            ? t.saved
            : saveStatus === "error"
              ? t.errorSaving
              : t.save}
      </Button>
    </div>
  );
}

function TeamPicker({
  label,
  teams,
  selected,
  disabledIds,
  onSelect,
  placeholder,
}: {
  label: string;
  teams: Team[];
  selected: string;
  disabledIds: string[];
  onSelect: (id: string) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-semibold">{label}</p>
      <select
        value={selected}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <option value="">{placeholder}</option>
        {teams.map((team) => (
          <option
            key={team.id}
            value={team.id}
            disabled={disabledIds.includes(team.id)}
          >
            {team.name} ({team.code})
          </option>
        ))}
      </select>
    </div>
  );
}

function PodioSlot({ label, team }: { label: string; team: Team | null }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className="ml-auto font-semibold">
        {team ? `${team.name} (${team.code})` : "—"}
      </span>
    </div>
  );
}
