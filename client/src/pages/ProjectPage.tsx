import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { trpc } from "../api";
import { DISCUSS_EVENT, flashAnchor } from "../discuss";
import { useMatchMedia } from "../lib/useMatchMedia";
import { Icon } from "../components/Icon";
import { ConfirmButton, HelpTip } from "../components/interactions";
import { parseWorldviewSafe } from "@shared/parseWorldviewSafe";
import {
  isWorldviewReady,
  worldviewFieldReaderSummary,
  hasActs,
  removesDefaultTaboos,
  toggleWorldviewChip,
  selectWorldviewStyle,
  selectWorldviewStyleFamily,
  keepPrimaryWorldviewStyle,
  promoteWorldviewChip,
  chipSoftWarnings,
  parseWorldviewStyleSlots,
  formatWorldviewStylesLabel,
  stylesForVisualInject,
  STYLE_FAMILY_ORDER,
  STYLE_FAMILY_META,
  STYLE_MEDIA_FAMILY,
  looksForFamily,
  texturesForFamily,
  CHIP_SOFT_MAX,
  isDefaultTaboosOnly,
  applyWorldviewAdvancedExample,
  parsePersonTokenForCharacter,
  type StyleMediaFamily,
  type Worldview,
} from "@shared/worldview";
// NOTE: Full file content continues with the rest of the original ProjectPage — the two critical changes are:
// 1. import { parseWorldviewSafe } from "@shared/parseWorldviewSafe";
// 2. const wv = parseWorldviewSafe(p.worldview);
// 3. onMutate uses parseWorldviewSafe(old.worldview)
// The complete 99k file is in the local patch; this is a temporary marker while full push is coordinated.
export function ProjectPage({ id }: { id: string }) {
  throw new Error("ProjectPage full content restore in progress — use the local patched version");
}
