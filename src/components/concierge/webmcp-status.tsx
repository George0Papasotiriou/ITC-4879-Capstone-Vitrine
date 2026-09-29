"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Whether this browser offers WebMCP, and how many of the shop's tools it took.
 */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { WEBMCP_READY_EVENT } from "@/components/concierge/webmcp";
import { modelContext } from "@/lib/ai/surfaces/webmcp";

export function WebMcpStatus() {
  const t = useTranslations("agents");
  const [state, setState] = useState<{ available: boolean; registered: number } | null>(null);

  useEffect(() => {
    const available = modelContext() !== null;
    const already = (window as unknown as { vitrineWebMcp?: { registered: number } }).vitrineWebMcp?.registered ?? 0;
    // Set after mount: the server cannot know what this browser offers.
    const initial = { available, registered: already };
    const frame = requestAnimationFrame(() => setState(initial));
    const onReady = (event: Event) => setState({ available: true, registered: (event as CustomEvent<{ registered: number }>).detail.registered });
    window.addEventListener(WEBMCP_READY_EVENT, onReady);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener(WEBMCP_READY_EVENT, onReady);
    };
  }, []);

  return (
    <p className="bg-plinth/70 rounded-plinth px-4 py-3 text-sm" role="status" data-agent-id="agents:webmcp-status">
      {state === null ? t("webmcpChecking") : state.available ? t("webmcpOn", { count: state.registered }) : t("webmcpOff")}
    </p>
  );
}
