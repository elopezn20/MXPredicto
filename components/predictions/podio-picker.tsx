"use client";

import { useState, useTransition } from "react";
import { savePodio } from "@/lib/actions/predictions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  t: {
    champion: string;
    runnerUp: string;
    thirdPlace: string;
    submit: string;
    submitted: string;
    selectTeam: string;
    mustBeDistinct: string;
    errorSaving: string;
    pts: string;
  };
}

export function PodioPicker({ teams, existing, t }: PodioProp) {
  const [champion, setChampion] = useState(
    existing?.champion_team_id ?? ""
  );
  const [runnerUp, setRunnerUp] = useState(
    existing?.runner_up_team_id ?? ""
  );
  const [third, setThird] = useState(
    existing?.third_place_team_id ?? ""
  );
  const [submitted, setSubmitted] = useState(existing !== null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (submitted) {
    const c = teams.find((t) => t.id === champion);
    const r = teams.find((t) => t.id === runnerUp);
    const th = teams.find((t) => t.id === third);
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t.submitted}</p>
        <PodioSlot label={`🥇 ${t.champion}`} team={c ?? null} />
        <PodioSlot label={`🥈 ${t.runnerUp}`} team={r ?? null} />
        <PodioSlot label={`🥉 ${t.thirdPlace}`} team={th ?? null} />
      </div>
    );
  }

  const isDistinct =
    champion && runnerUp && third &&
    champion !== runnerUp &&
    champion !== third &&
    runnerUp !== third;

  function handleSubmit() {
    if (!isDistinct) {
      setError(t.mustBeDistinct);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await savePodio(champion, runnerUp, third);
      if (result.ok) {
        setSubmitted(true);
      } else {
        setError(
          result.error === "mustBeDistinct" ? t.mustBeDistinct : t.errorSaving
        );
      }
    });
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <TeamPicker
        label={`🥇 ${t.champion}`}
        teams={teams}
        selected={champion}
        disabledIds={[runnerUp, third]}
        onSelect={setChampion}
        placeholder={t.selectTeam}
      />
      <TeamPicker
        label={`🥈 ${t.runnerUp}`}
        teams={teams}
        selected={runnerUp}
        disabledIds={[champion, third]}
        onSelect={setRunnerUp}
        placeholder={t.selectTeam}
      />
      <TeamPicker
        label={`🥉 ${t.thirdPlace}`}
        teams={teams}
        selected={third}
        disabledIds={[champion, runnerUp]}
        onSelect={setThird}
        placeholder={t.selectTeam}
      />

      <Button
        onClick={handleSubmit}
        disabled={!isDistinct}
        className="w-full"
      >
        {t.submit}
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
