---
name: Blankmind
description: Native iPhone app with an atmospheric conversational Home and preserved paper-and-charcoal interiors.
colors:
  paper: "#FFFFFC"
  charcoal: "#292929"
  lichen-gray: "#C9CAC4"
  stone-gray: "#8E8F8A"
  alert-red: "rgb(82.7% 18.4% 18.4%)"
  home-ink: "#FFFEF5"
  home-base: "#D5DBDC"
  home-voice-ink: "#49544E"
typography:
  home-response:
    fontFamily: "Neue Montreal, sans-serif"
    fontSize: "26px"
    fontWeight: 400
  home-status:
    fontFamily: "Neue Montreal, sans-serif"
    fontSize: "14px"
    fontWeight: 400
  home-recovery:
    fontFamily: "Neue Montreal, sans-serif"
    fontSize: "15px"
    fontWeight: 400
  home-action:
    fontFamily: "Neue Montreal, sans-serif"
    fontSize: "16px"
    fontWeight: 400
  home-input:
    fontFamily: "Neue Montreal, sans-serif"
    fontSize: "17px"
    fontWeight: 400
  home-sheet-title:
    fontFamily: "Neue Montreal, sans-serif"
    fontSize: "20px"
    fontWeight: 400
  control-protection:
    fontFamily: "Neue Montreal, sans-serif"
    fontSize: "22px"
    fontWeight: 400
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
  home-panel: "0px 0px 56px 56px"
  home-voice: "50%"
spacing:
  card-inset: "16px"
  home-nav-gap: "20px"
  home-voice-gap: "22px"
  home-content-inset: "28px"
components:
  home-nav-target:
    textColor: "{colors.home-ink}"
    size: "44px"
  home-panel:
    rounded: "{rounded.home-panel}"
  home-response:
    textColor: "{colors.home-ink}"
    typography: "{typography.home-response}"
    width: "360px"
  home-voice:
    backgroundColor: "{colors.home-ink}"
    textColor: "{colors.home-voice-ink}"
    rounded: "{rounded.home-voice}"
    size: "70px"
  home-composer:
    textColor: "{colors.home-voice-ink}"
    typography: "{typography.home-input}"
    rounded: "{rounded.chat-composer}"
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

Home presents one centered conversation inside an atmospheric panel, with quiet icon navigation above and a fixed circular voice control below. The approved center-phone reference governs Home geometry; the local Minimal Web supplies only the actual atmospheric material and Neue Montreal face. Existing interiors, section hierarchy and BMB controls remain authoritative.

**Key Characteristics:**
- Atmospheric conversational Home with centered response and fixed circular voice input.
- Three custom-glyph destinations: Control, Chat and Progress.
- Preserved paper-and-charcoal interiors and native accessibility.

The previous lower-right orb Home and swipe-menu guidance are historical, superseded on 2026-10-06. See the current surface contract in [Minimal App Home](docs/MINIMAL_HOME_2026-10-06.md).

## Colors

### Primary

Home Ink provides the ivory response, navigation and voice-button surface; Home Voice Ink provides the contrasting waveform and keyboard-composer text. On Control and Progress, navigation uses the existing scheme-aware interior foreground.

### Neutral

Home Base supplies the exposed lower ground and keyboard-sheet background. Paper and Charcoal remain the shared light/dark primitives for existing interiors, widget and shield surfaces. Lichen Gray, Stone Gray, semantic Alert Red and native Apple controls keep their existing roles.

**The Scoped Home Palette Rule.** Home-specific colors apply to the new Home shell; preserve the shared Paper/Charcoal primitives and supporting semantics elsewhere.

## Typography

Home uses the bundled `NeueMontreal-Regular` face from the local web project. Responses scale relative to native `.title3`; status, recovery, actions, input and sheet title scale through the native body role. The response is centered, has three points of additional line spacing and a maximum width defined by its component token. Control's protection prompt also uses this face with native `.title3` scaling.

Interior section headings retain Times New Roman, body and standalone BMB input retain Helvetica Neue, and onboarding controls retain the system font. Frontmatter sizes are base iOS points represented as portable CSS pixels; native Dynamic Type remains authoritative. Portable previews need the custom font installed to display the actual face.

## Layout

Home has a full-width panel, navigation fixed above its scrollable conversation, and voice input fixed below the panel. For viewport height `H` and safe bottom inset `S`, panel height is `max(180, H - max(116, max(0.144 × H, S + 92)))` points. Navigation top is `max(56, safeTop + 12)`; conversation starts 68 points below that top and reserves 88 points within the panel. Its minimum content height is `max(80, panelHeight - contentTop - 88)`.

Each navigation glyph is 17 points within an actual 44-by-44-point rectangular target. Navigation uses Home Nav Gap; the selected underline is 32 by 1 point. Home Voice Gap separates the panel and circular voice button. Conversation content uses Home Content Inset and 14-point vertical padding; long responses and accessibility text scroll while navigation and voice stay fixed. Preserve interior layouts, cards, spacing and standalone chat-composer structure.

## Elevation & Depth

Home depth comes from the actual `MinimalAtmosphere` image, scaled to fill and clipped to the panel, with a black shade at 0.28 opacity for text contrast. The image's pre-existing web pixels are unchanged; source provenance is stored in PNG metadata. Navigation and the voice circle have no added borders or shadows. Interior tonal layering and native shield materials retain their incumbent treatment.

## Shapes

Only the Home panel's lower corners are rounded; its upper corners remain square. The voice input is a true circle and its waveform uses five small capsule bars. The three top glyphs are stacked diamonds, a five-dot constellation and ascending bars, drawn as custom vectors. Existing black cards keep their small continuous corners; minimal primary buttons stay rectangular, and BMB's composer retains its rounded container.

## Components

Home navigation exposes exactly three main destinations in order: Control, Chat and Progress. Chat opens initially. Settings, Distractions, Schedule and protection are in Control; Back from a Control detail returns to Control. Selected state is a single underline and VoiceOver selected trait, with labels on all three targets. Chat stays mounted across destination switches to preserve its latest response and conversation state.

Tapping the centered response opens the keyboard sheet; holding the voice button exposes Write a message. Voice toggles recording and sending, shows starting/recording states, and stops when leaving Chat. Pending requests disable voice; authentication, retries, durable drafts and canonical action confirmation retain their existing implementation. Errors and recovery actions stay inside the conversation scroll area.

Control holds preserve the existing protection policy: three seconds to block, twenty seconds to unlock followed by the sixty-second cooldown, with hard-mode protection and recovery conditions retained. Chat input does not trigger protection holds. Reduce Motion retains the native reduced section transitions.

Black cards, light/dark minimal primary buttons and the standalone BMB composer retain their current structure and states. Sidecar snippets are portable previews of native primitives, not native interaction implementations; atmosphere and custom font fidelity remain in the native captures.

## Do's and Don'ts

### Do:
- **Do** keep the custom glyph order, selected underline, lower-rounded panel, centered response and fixed voice circle scoped to Home.
- **Do** preserve interior structures, conversation/protection policies, Dynamic Type, VoiceOver and Reduce Motion.
- **Do** use Home tokens for Home and shared Paper/Charcoal primitives for existing interiors, widgets and shields.

### Don't:
- **Don't** restore the superseded lower-right orb or swipe menu as current Home guidance.
- **Don't** transfer web composition or Home-specific geometry to existing interior screens.
- **Don't** replace supporting grays, semantic errors or native Apple button styling.
- **Don't** claim Simulator review proves physical microphone or Screen Time behavior.
