/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Types for the parts of Khronos's glTF-Validator the shop uses (the package ships none).
 */

declare module "gltf-validator" {
  type Message = { code: string; message: string; severity: number; pointer?: string };
  export type ValidationReport = {
    issues: { numErrors: number; numWarnings: number; numInfos: number; numHints: number; messages: Message[] };
    info?: { totalTriangleCount?: number; extensionsUsed?: string[] };
  };
  export function validateBytes(data: Uint8Array, options?: { uri?: string; maxIssues?: number }): Promise<ValidationReport>;
}
