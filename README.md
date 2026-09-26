# SIEGEprac — First Strike

Competitive first-person PvP practice in the browser. Stylised voxel arena, 1.8.9-inspired combat (hit windows, sprint resets, W/S-taps, crits, combos), and a practice bot that actually fights.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Production build (static files in `dist/`, deploy anywhere):

```bash
npm run build && npm run preview   # http://localhost:4173
```

Tests (headless simulation: movement, knockback, hit detection, bot-vs-bot): `npm test`

## Controls

| Key | Action |
| --- | --- |
| WASD | Move (auto-sprint when moving forward) |
| Space | Jump (hold to bunny-hop) |
| Shift / C | Sneak (won't walk off edges) |
| LMB | Attack |
| RMB | Block (sword) / eat (golden apple) |
| 1–9, scroll | Hotbar |
| E | Inventory |
| R | Instant rematch |
| V / F5 | Third-person view |
| Esc | Pause |

**Sprint reset:** a sprint hit knocks harder but drops your sprint. Release W for a split second (W-tap) or tap S to re-arm it — the `»` indicator above the hotbar turns orange until you do.
