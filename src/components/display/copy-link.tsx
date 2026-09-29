"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Copying a window display's link, which opens the same display for anyone.
 */

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/ui/use-hydrated";

export function CopyLink() {
  const t = useTranslations("showcase");
  const hydrated = useHydrated();
  const [copied, setCopied] = useState(false);
  return (
    <>
      <Button
        variant="tertiary"
        disabled={!hydrated}
        onClick={() =>
          void navigator.clipboard
            ?.writeText(window.location.href)
            .then(() => setCopied(true))
            .catch(() => setCopied(false))
        }
        data-agent-id="action:copy-window-link"
      >
        {t("share")}
      </Button>
      <span className="text-slate text-sm" role="status" aria-live="polite">
        {copied ? t("copied") : ""}
      </span>
    </>
  );
}
