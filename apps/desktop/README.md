# Agent Nexus Gateway — Desktop App

The desktop app wraps the gateway in an Electron shell, giving you:

- System tray icon with start/stop
- Auto-start on login
- Bundled Node runtime (no need to install Node separately)
- Native notifications for circuit breaker trips
- One-click "Open Dashboard" button

## Status

🚧 **Planned for v0.8.0.** Track progress in [ROADMAP.md](../../docs/ROADMAP.md).

## Architecture (planned)

```
┌─────────────────────────────────────────┐
│ Electron Main Process                   │
│  ┌───────────────────────────────────┐  │
│  │ Bundled Node 22 + gateway binary  │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │ Tray icon + global shortcuts      │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ Electron Renderer (BrowserWindow)       │
│  ┌───────────────────────────────────┐  │
│  │ Loads dashboard from localhost:3000│ │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Why Electron + Tauri?

We're evaluating both. Electron is heavier but more familiar. Tauri produces a ~10MB binary but requires Rust toolchain. We'll likely ship both.
