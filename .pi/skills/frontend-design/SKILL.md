---
name: frontend-design
description: >
  Distinctive visual UI design: research the subject's own visual
  vernacular, build a token system (color, type, layout, signature),
  critique against defaults, then code. Use when building or reshaping
  a user-facing UI where templated defaults won't do.
license: Apache-2.0 (see LICENSE.txt)
source: Anthropic Skills — frontend-design (https://github.com/anthropics/skills)
---

# Frontend Design

**Leading word:** _vernacular_ — every subject has its own visual language: materials, instruments, artifacts. The design grows from the subject's world, not from a palette library.

Approach this as the design lead at a small studio known for giving each client a visual identity that could not be mistaken for anyone else's. Take one real aesthetic risk you can justify.

## Process: Two Passes

### Pass 1: Brainstorm → Token System

Create a compact token system with four axes:

| Axis | Output | Description |
|------|--------|-------------|
| **Color** | 4–6 named hex values | Palette from the subject's world, not a template |
| **Type** | 2+ typeface roles | A characterful display face (used with restraint), a complementary body face, a utility face |
| **Layout** | 1-sentence prose + ASCII wireframe | A layout concept tested against the content |
| **Signature** | Single unique element | The one thing this page will be remembered by |

### Pass 2: Critique → Build

Review the plan against the brief. If any part reads like the generic default you'd produce for any similar page (the warm cream + terracotta, the near-black + acid green, the broadsheet columns), **revise it**. Say what you changed and why. Only after confirming uniqueness should you code.

## Design Principles

**Hero is a thesis** — Open with the most characteristic thing in the subject's world: a headline, image, animation, live demo. A big number with gradient is the template answer — use it only if it's genuinely the best option.

**Typography carries personality** — Pair display and body deliberately. Make the type treatment itself memorable, not a neutral delivery vehicle.

**Structure is information** — Numbered markers (01/02/03) only belong if the content is actually a sequence where order carries information. Don't decorate — encode.

**Motion serves the subject** — Page-load sequences, scroll-triggered reveals, hover micro-interactions. One orchestrated moment beats scattered effects. Extra animation signals AI-generation.

**Complexity matches the vision** — Maximalist directions need elaborate execution. Minimal needs precision in spacing, type, and detail. Elegance is executing the chosen vision well.

**Copy is design material** — Words exist to make the experience easier. Write from the user's side of the screen. Name things by what people control, not how the system is built. Use active voice. Treat failure as direction, not mood. See [`references/writing-in-design.md`](references/writing-in-design.md) for the full guide.

## Restraint & Self-Critique

- Spend boldness in one place. Let the signature element be the one memorable thing; keep everything else quiet and disciplined.
- Build to a quality floor without announcing it: responsive to mobile, visible keyboard focus, reduced motion respected.
- Chanel's advice: before leaving the house, remove one accessory. Cut any decoration that does not serve the brief.
- Not taking a risk can be a risk itself.

## Known Defaults to Avoid

AI-generated design clusters around three looks. All are legitimate for some briefs; none should be the default choice:

1. Warm cream background (~#F4F1EA) + high-contrast serif display + terracotta accent
2. Near-black background + single bright acid-green or vermilion accent
3. Broadsheet layout + hairline rules + zero border-radius + dense newspaper-like columns

Where the brief specifies one, follow it exactly. Where it leaves an axis free, don't spend that freedom on a default.

## CSS Caution

Be careful with selector specificity — it's easy to generate classes that cancel each other out (`.section` type selector vs `.cta` element selector). This happens often with paddings/margins between sections.

---

*Source: [Anthropic Skills — frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) — Apache 2.0 License. Adapted for LemonHarness using progressive disclosure (writing guide extracted to reference).*
