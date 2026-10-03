---
name: Blankmind
description: Native iPhone surfaces with quiet Home navigation and a shared paper-and-charcoal palette.
colors:
  paper: "#FFFFFC"
  charcoal: "#292929"
  lichen-gray: "#C9CAC4"
  stone-gray: "#8E8F8A"
  alert-red: "rgb(82.7% 18.4% 18.4%)"
typography:
  home-menu:
    fontFamily: "Helvetica Neue, sans-serif"
    fontSize: "32px"
    fontWeight: 400
    letterSpacing: "-0.9px"
  section-title:
    fontFamily: "Times New Roman, serif"
    fontSize: "32px"
    fontWeight: 400
  body:
    fontFamily: "Helvetica Neue, sans-serif"
    fontSize: "16px"
    fontWeight: 400
  chat-input:
    fontFamily: "Helvetica Neue, sans-serif"
    fontSize: "17px"
    fontWeight: 400
  button-label:
    fontFamily: "Helvetica Neue, sans-serif"
    fontSize: "16px"
    fontWeight: 500
rounded:
  rectangular: "0px"
  black-card: "4px"
  chat-composer: "28px"
spacing:
  card-inset: "16px"
  home-menu-inset: "24px"
components:
  home-orb:
    backgroundColor: "{colors.charcoal}"
  home-menu-row:
    textColor: "{colors.charcoal}"
    typography: "{typography.home-menu}"
  black-card:
    backgroundColor: "{colors.charcoal}"
    textColor: "{colors.paper}"
    rounded: "{rounded.black-card}"
    padding: "{spacing.card-inset}"
  primary-light:
    textColor: "{colors.paper}"
    typography: "{typography.button-label}"
    rounded: "{rounded.rectangular}"
    height: "52px"
  primary-dark:
    textColor: "{colors.charcoal}"
    typography: "{typography.button-label}"
    rounded: "{rounded.rectangular}"
    height: "52px"
  chat-composer:
    typography: "{typography.chat-input}"
    rounded: "{rounded.chat-composer}"
---

# Design System: Blankmind

## Overview

**Creative North Star: "Silencio visual"**

Home leaves the screen empty around one circular control. The shared paper-and-charcoal palette applies throughout the iPhone app and its widget/shield surfaces; Home composition and gestures apply only to Home. Existing interiors, section hierarchy and BMB controls remain authoritative.

**Key Characteristics:**
- Quiet Home with one lower-right circle.
- Shared white/black primitives with preserved supporting grays and semantic errors.
- Native accessibility and existing protected actions.

## Colors

### Primary
Charcoal is the shared dark primitive for text, controls, dark surfaces and the Home circle. Paper is its light counterpart for backgrounds, inverted labels and light controls. Existing aliases in `BlankColors.swift` resolve to these primitives; alpha variants remain intentional.

### Neutral
Lichen Gray and Stone Gray retain their existing supporting roles. Preserve semantic Alert Red for errors and destructive states. Apple-managed controls, including Sign in with Apple, retain their native appearance.

**The Shared Palette Rule.** All custom app white/black roles use Paper/Charcoal, including widget and shield tokens; this does not replace supporting grays, error semantics or native Apple controls.

## Typography

Home menu uses Helvetica Neue regular with tight tracking, one-line labels and Dynamic Type. Body and BMB input retain Helvetica Neue. Existing interior headings retain Times New Roman; onboarding controls retain the system font. Frontmatter sizes are base iOS points represented as portable CSS pixels; native Dynamic Type remains authoritative.

## Layout

Home alone uses a full-screen Paper canvas with status bar and persistent system overlays requested hidden. For viewport width `W`, height `H` and safe bottom inset `S`, circle diameter is `max(44, min(72, W × 150/1080))`, right inset is `max(24, W × 108/1080)`, and bottom inset is `max(S + 16, H × 108/1920)` (points).

The menu is bottom-left, inset by Home Menu Inset; its trailing clearance is the circle's right inset plus diameter plus Card Inset. Rows are at least 44 points tall and the menu scrolls when needed. Preserve existing interior layout, cards, spacing and chat composer structure.

## Elevation & Depth

Home's circle and menu are flat, without borders, gradients or shadows. Interior minimal surfaces retain their existing tonal layering; this Home rule does not remove native materials from the shield or change other sections' incumbent treatment.

## Shapes

Home's signature is a true circle. Existing black cards keep their small continuous corners; minimal primary buttons stay rectangular, and BMB's composer retains its rounded container. Use the component tokens rather than applying Home geometry to every screen.

## Components

The Home circle follows drag within the native bounds and returns with ease-out. Swipe up opens the menu; swipe left activates existing manual protection; a two-second hold opens existing chat; swipe down closes an open menu. Directional swipes require 48 points with a 1.25 dominant-axis ratio. The hold tolerates 12 points of movement and consumes its touch, preventing a second swipe action.

Reduce Motion removes circle translation and return animation; menu changes use opacity. VoiceOver activation toggles the menu, with separate protection/chat actions and an active/inactive value. Motion values and native source paths are recorded in `.impeccable/design.json`.

Home menu rows preserve `blank`/`blank active`, Progress, Distractions, Settings and Chat. Existing protected Unblank and hard-mode Emergency remain available under their original conditions. Missing authorization/selection and cooldown use the existing recovery flow. A left swipe does not reset or extend active protection, consume a pending widget timer or change BMB permissions.

Black cards, light/dark minimal primary buttons and the BMB composer retain their current structure and states. Sidecar HTML/CSS entries are portable visual previews of these native components; they do not implement native gestures or certify device behavior.

## Do's and Don'ts

### Do:
- **Do** use the shared Paper/Charcoal primitives for custom app white/black roles.
- **Do** preserve interior structures, BMB controls, Dynamic Type, VoiceOver and Reduce Motion.
- **Do** keep Home geometry and gesture rules scoped to Home.

### Don't:
- **Don't** add borders, shadows, copy or extra controls to resting Home.
- **Don't** replace supporting grays, semantic errors or native Apple button styling with brand primitives.
- **Don't** claim Simulator evidence proves physical Screen Time protection or gesture latency.
