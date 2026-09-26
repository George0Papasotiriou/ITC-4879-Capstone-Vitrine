"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The list of keyboard shortcuts, as a dialog, loaded the first time it is asked for.
 */

import { useTranslations } from "next-intl";

import { SHORTCUTS } from "@/components/comfort/shortcuts";
import { DialogContent, DialogRoot } from "@/components/ui/dialog";

/** docs/adr/032. */
export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const t = useTranslations("comfort.shortcuts");
  return (
    <DialogRoot open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={t("title")} description={t("description")}>
        <dl className="flex flex-col gap-3" data-agent-id="shortcuts:list">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.key} className="flex items-center gap-4">
              <dt>
                <kbd className="border-hairline bg-plinth rounded-plinth inline-flex min-w-8 justify-center border px-2 py-1 text-sm font-medium">{shortcut.key}</kbd>
              </dt>
              <dd>{t(`actions.${shortcut.action}`)}</dd>
            </div>
          ))}
          <div className="flex items-center gap-4">
            <dt>
              <kbd className="border-hairline bg-plinth rounded-plinth inline-flex min-w-8 justify-center border px-2 py-1 text-sm font-medium">Esc</kbd>
            </dt>
            <dd>{t("actions.escape")}</dd>
          </div>
        </dl>
        <p className="text-slate mt-5 text-sm">{t("off")}</p>
      </DialogContent>
    </DialogRoot>
  );
}
