/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * JSX types for the <model-viewer> custom element (docs/adr/025).
 */

import type { DetailedHTMLProps, HTMLAttributes } from "react";

/**
 * `@google/model-viewer` registers a custom element, so React has no idea what
 * its attributes are. Only the ones this shop sets are declared: a longer list
 * copied from the documentation would rot without anyone noticing.
 */
type ModelViewerAttributes = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  src?: string;
  alt?: string;
  ar?: boolean;
  "ar-modes"?: string;
  "ar-scale"?: "auto" | "fixed";
  "camera-controls"?: boolean;
  "auto-rotate"?: boolean;
  "disable-zoom"?: boolean;
  "shadow-intensity"?: string;
  "shadow-softness"?: string;
  "touch-action"?: string;
  "interaction-prompt"?: "auto" | "none";
  "camera-orbit"?: string;
  "field-of-view"?: string;
  exposure?: string;
  loading?: "auto" | "lazy" | "eager";
  reveal?: "auto" | "manual";
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": ModelViewerAttributes;
    }
  }
}
