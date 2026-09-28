"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The user study's small panel: the task in hand, and buttons for starting it and saying how it went.
 */

import { useTranslations } from "next-intl";
import { useSyncExternalStore, useState } from "react";

import { Button } from "@/components/ui/button";
import { PARTICIPANT_CODE, STUDY_COOKIE, STUDY_TASKS, type StudyEvent } from "@/lib/study/tasks";

/**
 * docs/adr/037. Shown only in a study session (the cookie set at /study), on
 * every page, folded to one line when not in use. The participant reads the
 * task here, presses Start, does it in the shop, and says how it went; the
 * moderator watches and takes notes. The panel never says whether an answer
 * was right: that would change what is being measured.
 */

const TASK_KEY = "vt_study_task";

function readCode(): string | null {
  const match = /(?:^|; )vt_study=([^;]*)/.exec(document.cookie);
  return match !== null && PARTICIPANT_CODE.test(match[1]!) ? match[1]! : null;
}

function readProgress(): { task: number; running: boolean } {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(TASK_KEY) ?? "{}") as { task?: number; running?: boolean };
    return { task: Math.min(STUDY_TASKS.length, Math.max(0, saved.task ?? 0)), running: saved.running === true };
  } catch {
    return { task: 0, running: false };
  }
}

// The cookie is read in the browser only; on the server there is never a session to show.
const noSubscription = () => () => undefined;

export function StudyPanel() {
  const t = useTranslations("study");
  const cookieCode = useSyncExternalStore(noSubscription, readCode, () => null);
  const [ended, setEnded] = useState(false);
  const [progress, setProgress] = useState<{ task: number; running: boolean } | null>(null);
  const [open, setOpen] = useState(true);

  const code = ended ? null : cookieCode;
  if (code === null) return null;
  const { task, running } = progress ?? readProgress();

  const save = (next: { task: number; running: boolean }) => {
    setProgress(next);
    try {
      window.sessionStorage.setItem(TASK_KEY, JSON.stringify(next));
    } catch {
      // The panel still works for this page.
    }
  };
  const send = (event: StudyEvent) =>
    fetch("/api/study", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participant: code, task: STUDY_TASKS[task], event }) }).catch(() => undefined);

  const finished = task >= STUDY_TASKS.length;
  const end = () => {
    document.cookie = `${STUDY_COOKIE}=; path=/; max-age=0; samesite=lax`;
    try {
      window.sessionStorage.removeItem(TASK_KEY);
    } catch {
      // Nothing kept to remove.
    }
    setEnded(true);
  };

  return (
    <aside
      aria-label={t("panelLabel")}
      className="border-hairline bg-glass shadow-sheet rounded-plinth fixed bottom-20 left-4 z-[45] w-[min(22rem,calc(100vw-2rem))] border p-4 md:bottom-4"
      data-agent-id="study:panel"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{t("session", { code })}</p>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="text-slate min-h-6 cursor-pointer text-sm underline underline-offset-4">
          {open ? t("fold") : t("unfold")}
        </button>
      </div>
      {!open ? null : finished ? (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm">{t("finished")}</p>
          <Button variant="secondary" size="sm" className="self-start" onClick={end} data-agent-id="study:end">
            {t("end")}
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3" aria-live="polite">
          <p className="text-slate text-xs">{t("taskOf", { index: task + 1, count: STUDY_TASKS.length })}</p>
          <p className="text-sm" data-agent-id="study:task">
            {t(`tasks.${STUDY_TASKS[task]!}`)}
          </p>
          {running ? (
            <div className="flex flex-wrap gap-2">
              {(["success", "partial", "fail"] as const).map((outcome) => (
                <Button
                  key={outcome}
                  variant={outcome === "success" ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => {
                    void send(outcome);
                    save({ task: task + 1, running: false });
                  }}
                  data-agent-id={`study:${outcome}`}
                >
                  {t(`outcomes.${outcome}`)}
                </Button>
              ))}
            </div>
          ) : (
            <Button
              size="sm"
              className="self-start"
              onClick={() => {
                void send("start");
                save({ task, running: true });
              }}
              data-agent-id="study:start"
            >
              {t("start")}
            </Button>
          )}
        </div>
      )}
    </aside>
  );
}
