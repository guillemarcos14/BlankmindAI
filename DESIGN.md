---
name: Blankmind
description: Native iPhone protection and conversation with one atmospheric, ivory and green-gray visual system.
colors:
  ivory: "#FFFEF5"
  cool-ground: "#D5DBDC"
  green-gray-ink: "#49544E"
  protected-ground: "#26312C"
  idle-card: "rgba(255,254,245,0.64)"
  protected-card: "rgba(73,84,78,0.50)"
  alert-red: "rgb(82.7% 18.4% 18.4%)"
  lichen-gray: "#C9CAC4"
  stone-gray: "#8E8F8A"
typography:
  response:
    fontFamily: "Neue Montreal, sans-serif"
    fontSize: "26px"
    fontWeight: 400
  section-title:
    fontFamily: "Neue Montreal, sans-serif"
    fontSize: "32px"
    fontWeight: 400
    letterSpacing: "-0.9px"
  body:
    fontFamily: "Neue Montreal, sans-serif"
    fontSize: "17px"
    fontWeight: 400
  action:
    fontFamily: "Neue Montreal, sans-serif"
    fontSize: "16px"
    fontWeight: 500
  secondary:
    fontFamily: "Neue Montreal, sans-serif"
    fontSize: "14px"
    fontWeight: 400
  caption:
    fontFamily: "Neue Montreal, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  sheet-title:
    fontFamily: "Neue Montreal, sans-serif"
    fontSize: "20px"
    fontWeight: 400
  protection:
    fontFamily: "Neue Montreal, sans-serif"
    fontSize: "22px"
    fontWeight: 400
rounded:
  tonal-card: "16px"
  routine-surface: "18px"
  chat-composer: "28px"
  home-panel: "0px 0px 56px 56px"
  voice: "50%"
spacing:
  compact-gap: "8px"
  form-gap: "12px"
  control-vertical: "14px"
  card-inset: "16px"
  nav-gap: "20px"
  voice-gap: "22px"
  section-inset: "24px"
  conversation-inset: "28px"
components:
  home-nav-target:
    textColor: "{colors.ivory}"
    size: "44px"
  home-panel:
    rounded: "{rounded.home-panel}"
  home-response:
    textColor: "{colors.ivory}"
    typography: "{typography.response}"
    width: "360px"
  home-voice:
    backgroundColor: "{colors.ivory}"
    textColor: "{colors.green-gray-ink}"
    rounded: "{rounded.voice}"
    size: "70px"
  home-composer:
    textColor: "{colors.green-gray-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.chat-composer}"
  tonal-card-idle:
    backgroundColor: "{colors.idle-card}"
    textColor: "{colors.green-gray-ink}"
    rounded: "{rounded.tonal-card}"
    padding: "{spacing.card-inset}"
  tonal-card-protected:
    backgroundColor: "{colors.protected-card}"
    textColor: "{colors.ivory}"
    rounded: "{rounded.tonal-card}"
    padding: "{spacing.card-inset}"
  primary-idle:
    textColor: "{colors.cool-ground}"
    typography: "{typography.action}"
    rounded: "{rounded.tonal-card}"
  primary-protected:
    textColor: "{colors.protected-ground}"
    typography: "{typography.action}"
    rounded: "{rounded.tonal-card}"
  permission:
    backgroundColor: "{colors.green-gray-ink}"
    textColor: "{colors.ivory}"
    typography: "{typography.body}"
    rounded: "{rounded.tonal-card}"
    padding: "12px 14px"
---

# Design System: Blankmind

## Overview

**Creative North Star: "Silencio visual"**

Blankmind uses the approved conversational Home as the material and type authority for the native app. Its real atmospheric image, ivory, cool ground, green-gray ink and bundled Neue Montreal extend across Control, Progress, detail screens, account, history, emergency and onboarding. Reading and editing use solid tonal surfaces with natural alignment; conversation and emergency content may remain centered.

Guillem's explicit uniformity request of 2026-10-06 supersedes the former Home-only palette and Times/Helvetica interior rules. It preserves Home geometry, navigation, conversation, data, permissions and protection policies. [PRODUCT.md](PRODUCT.md) and [Uniformity](docs/UNIFORM_APP_2026-10-06.md) govern that extension; [Minimal App Home](docs/MINIMAL_HOME_2026-10-06.md) records the approved Home reference and its earlier evidence.

**Key Characteristics:**
- Actual atmospheric material with tonal reading and editing surfaces.
- Scalable Neue Montreal throughout authored app content.
- Exactly three main destinations: Control, Chat and Progress.
- Native controls, accessible targets and protection-state appearance.

## Colors

### Primary

Green-gray Ink carries inactive text, tint, actions and permission-button surfaces. Ivory carries atmospheric text and navigation, the voice circle and active-protection foreground. Alert Red retains its semantic error/destructive role; native alerts and Apple authentication keep platform semantics.

### Neutral

Cool Ground is the inactive canvas and exposed Home lower ground. Protected Ground is the active-protection interior canvas. Idle Card and Protected Card are the actual translucent tonal fills; judge text contrast against their composited backgrounds. Lichen Gray and Stone Gray remain supporting aliases, not alternate screen themes.

**The Protection Appearance Rule.** Root appearance follows protection state, not device appearance: inactive uses Cool Ground with Green-gray Ink; active uses Protected Ground with Ivory. Onboarding uses the inactive appearance; Home's atmospheric conversation and exposed lower ground retain their approved colors.

Legacy names such as `charcoal`, `pureWhite`, `porcelain` and `blankBlackCard` are implementation aliases for this palette and tonal surfaces. They no longer prescribe the former charcoal-and-paper interior world.

## Typography

The bundled `NeueMontreal-Regular` face supplies authored titles, body, fields, metrics, explanations and actions through `MinimalHomeDesign.font` and `Font.blankInter`. Font role names retained from older code no longer select Times New Roman or Helvetica Neue. Frontmatter dimensions are base iOS points represented as portable CSS pixels; native relative text styles and Dynamic Type govern rendered size.

Response scales relative to `.title3`; section titles to `.title`; body and input to `.body`; primary actions to `.headline`; secondary copy to `.subheadline`; metric captions to native caption roles. The response has three points of extra line spacing and its component maximum width. Section titles use the recorded tracking. Progress metrics use scalable sizes for their individual prominence, including 34-point risk, 30-point headline and 26-point smaller metrics, with monospaced digits where implemented.

**The Readable Growth Rule.** Let titles and explanatory text wrap at their natural height. At accessibility sizes, Progress metric and risk/action rows stack; routine day controls use a target-sized grid, and long content scrolls. The composer places actions below the field at accessibility sizes.

Native navigation chrome, SF Symbols, date and selection controls, system confirmations and Sign in with Apple are deliberate platform exceptions. Do not restyle their internal lettering or glyphs to imitate authored app content.

## Layout

Home preserves the center-phone reference: full-width atmospheric panel, navigation above its scrollable centered conversation and fixed voice circle below. For viewport height `H` and safe bottom inset `S`, panel height is `max(180, H - max(116, max(0.144 × H, S + 92)))` points. Navigation top is `max(56, safeTop + 12)`; conversation starts 68 points below it and reserves 88 points within the panel. Minimum conversation content height is `max(80, panelHeight - contentTop - 88)`.

Navigation glyphs are 17 points inside actual 44-by-44-point targets, separated by Nav Gap; the selected underline is 32 by 1 point. Home conversation uses Conversation Inset and Control Vertical padding. Voice Gap separates panel and circle. Long responses scroll while navigation and voice stay fixed.

Interior section content begins below the 132-point atmospheric header, uses Section Inset and reserves 40 points below. Native forms, lists, date pickers, switches, steppers and disclosures retain their structure and behavior. Onboarding scrolls a naturally aligned column with a 400-point maximum content width, Section Inset and the shared atmospheric header; buttons grow inside the viewport.

**The Native Target Rule.** Every tappable control requires at least 44-by-44 points of reachable hit area. Preserve VoiceOver labels, selected traits and explicit actions; grouping a metric must not hide its protect action.

## Elevation & Depth

The actual `MinimalAtmosphere` image supplies atmospheric depth, scaled to fill and clipped with a black shade at 0.28 opacity. Source pixels and font remain the supplied Minimal Web material; PNG metadata records image provenance. Interior backgrounds reuse it in the header and place solid tonal reading/editing ground below.

Minimal app surfaces are flat: no added shadows on navigation, voice, primary buttons or tonal cards. Tonal fills and fine rules establish hierarchy. Native system controls and materials retain platform treatment; historical nonminimal glass branches do not define new interior surfaces.

## Shapes

Home panel and interior atmospheric header have square upper corners and the recorded rounded lower corners. Voice is a true circle with five capsule waveform bars. Main navigation retains its custom stacked-diamond, five-dot and ascending-bar vectors, an explicit approved-reference exception to default native iconography.

Shared primary actions, permission buttons and tonal cards use the Tonal Card radius. Existing routine surfaces retain their recorded local radii; the home/standalone composer retains Chat Composer. Control rows use fine bottom rules rather than black cards. Preserve native picker, switch, disclosure, alert and Apple-button shapes.

## Components

### Navigation and Control

Exactly Control, Chat and Progress appear in that order; Chat opens initially. The selected destination has an underline and VoiceOver selected trait. Settings, Distractions, Schedule/Routines and protection live in Control; Back from a Control detail returns to Control. Chat remains mounted across destination changes.

### Conversation, voice and composer

Tapping the centered response opens the keyboard sheet; holding voice exposes Write a message. Voice has native starting/recording/send states, disables for pending work and dims to 0.5 while waiting. Recording stops on leaving Chat. The keyboard composer uses Green-gray Ink at 0.08 opacity behind the field, whose placeholder uses 0.72 opacity; microphone/send actions keep native labels and disabled gates. Authentication, durable drafts, retries and canonical action confirmation remain authoritative.

### Primary and permission buttons

Minimal primary buttons have a 342-point maximum width, Control Vertical padding and a 52-point minimum height, growing with text. Default fill is the state foreground at 0.94 opacity, or full opacity for the light variant; pressed fill uses 0.72 or 0.78 respectively and scale 0.985. Text uses the state canvas. Disabled primary actions visibly dim to 0.42, including unavailable Emergency; eligibility and confirmation gates remain intact.

Permission buttons use their component palette, naturally wrapping leading text and a native completion check. They have at least a 44-point height, expose Completed/Not completed to VoiceOver and retain completion/disabled behavior.

### Tonal cards, metrics and rows

The former `blankBlackCard` helper now produces a tonal card with Card Inset, at least a 64-point height and natural leading alignment. Progress cards use state-aware foreground and fill; small secondary Progress and history copy uses foreground at 0.86 opacity. Validate contrast against actual compositing rather than lowering text opacity for decoration. Control rows have a 52-point minimum height, Control Vertical padding and a one-point rule at foreground opacity 0.16.

### Forms, recovery and protection

Native dates, switches, steppers, disclosures, Family Controls selection, destructive confirmations and Sign in with Apple retain their behavior and platform styling. Sheets use the state canvas, foreground/tint and hidden scroll backgrounds; native navigation titles remain platform chrome.

Unloaded preferences conceal and remove the disabled form from accessibility, showing a dedicated loading or clear retry state on the canvas. Recovery text wraps and retry targets meet the native floor. Conversation errors remain inside the scroll area.

Control retains hold three seconds to block, hold twenty seconds to unlock, sixty-second cooldown, hard protection and recovery conditions. Chat input never triggers those holds. Reduce Motion retains reduced native section/state transitions.

Sidecar HTML/CSS snippets are self-contained visual excerpts of native primitives, with preview-only browser focus rings. They do not implement native navigation, voice, permissions, Dynamic Type or protection; actual atmosphere and custom-font fidelity require native captures. The final native correction verdict is ship for the seven scored material fixes in e1497c5: 40 valid Simulator captures and five passing XCTest cases, including a hittable 44×44pt Emergency confirmation and cancellation. Earlier Home acceptance remains separate evidence; this verdict does not certify physical Screen Time, microphone or release readiness.

## Do's and Don'ts

### Do:
- **Do** extend the shared palette, scalable Neue Montreal and tonal surfaces throughout authored app screens and onboarding.
- **Do** preserve approved Home geometry, glyph order, underline, centered response and fixed voice circle.
- **Do** keep native controls, wrapping, 44-point targets, VoiceOver and Reduce Motion.
- **Do** preserve conversation, data, permissions, canonical actions and protection policies.
- **Do** verify error, loading, unavailable and protection states against native rendered evidence.

### Don't:
- **Don't** restore the superseded Times/Helvetica interior rule, charcoal cards, lower-right orb or swipe menu.
- **Don't** copy web composition or apply Home's centered conversation layout to forms and data.
- **Don't** let cards, accessibility grouping or recovery overlays obscure text, configuration or actions.
- **Don't** treat device dark appearance as the source of protection state.
- **Don't** claim Simulator captures certify physical microphone, Screen Time, TestFlight upload or release readiness.
