---
name: ui-dashboard
description: >-
  Builds the lightweight read-only Vite + Vanilla TypeScript + Motion One AI CRM web dashboard: pure black (#000) asymmetrical 65/35 CSS Grid, magnetic cards with ±12° cursor rotation, radar border glow, EventTarget-based state store, Supabase Realtime, and LiveKit transcript stream.
---

# UI Dashboard

## Stack
- **Vite 6+** — Vanilla TypeScript template, `apps/web/`
- **Motion One 4.x** (3KB, no React/Vue) — smooth magnetic card animations
- **CSS Custom Properties + @container queries** — responsive layout without media breakpoints
- **EventTarget** — lightweight state store, no Redux/Zustand/signals
- **Supabase Realtime WebSocket** — for deal/pipeline updates
- **LiveKit transcript stream** — for real-time voice transcript pane
- **Read-only** — no mutation routes from UI

## Layout
Pure `#000` (solid black) CSS Grid, 3 zones:
- Left pane (65%): **LiveKit transcript stream** — scrollable, user/bot bubbles (300px width), timestamp, speaker name, glow on new message
- Right sidebar (35%): **4 magnetic cards** (2x2 grid) — each is a metric panel (pipeline coverage, AI conversion, voice latency, WhatsApp volume)
- Bottom bar (80px full): **Contact context** — selected contact name, phone/email (encrypted in UI tooltip), tags

## Magnetic Cards
- **Animation trigger**: Hover-gated via `matchMedia("(hover: hover)")` only (no touch)
- **Perspective**: `perspective: 800px`
- **Cursor tracking**: Track `mousemove` on `.card` parent → `--cursor-x`/`--cursor-y` from center (0–1 normalized; clamp to container bounds)
- **Rotation**: `rotateX`/`rotateY` ±12° max, `transition: transform 0.15s ease-out` via Motion One `animate()`
- **Reset**: `mouseleave` → `rotateX(0) rotateY(0)`
- **Performance**: `will-change: transform`, GPU-accelerated, no reflows

## Radar Border Glow
- Pseudo-element `::before` on the sidebar container
- `radial-gradient(600px circle at var(--cursor-x) var(--cursor-y), rgba(255,255,255,0.06), transparent)`
- `position: absolute`, `inset: -10px`, `border-radius: inherit`, `pointer-events: none`, `opacity: 0.8`
- Updated on global `mousemove` → no per-card listeners

## Data Sources (Read-Only)
1. `GET http://localhost:8280/ready` — every 30s (polling, no persistent WS)
2. **Supabase Realtime** channel `deals:INSERT/UPDATE` and `pipeline:UPDATE` → update cards
3. **LiveKit transcript stream** → populate left pane
4. **OTel Prometheus scrape endpoint** → feed card metrics (optional, fall back to `GET /ready` derived data)

## EventTarget State Store
- Singleton class extends `EventTarget`: `class CRMStore extends EventTarget {}`
- Methods: `getState()`, `setState(key, value)` → dispatches `stateChange` event with `key` and `value`
- No derived stores; components listen for `stateChange` and update DOM directly

## Degradation States
- Each data panel shows dimmed "data unavailable" state on source failure
- No spinners, no modals
- Radar glow falls back to center if no `mousemove` data

## Quick Start (Vite Scaffolding)
```bash
cd apps/web
bun create vite@latest . -- --template vanilla-ts
bun add motion
bun run dev
```

## Reference
See spec **Pillar 4a (UI Dashboard)** for full details.
