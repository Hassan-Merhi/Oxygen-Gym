---
name: GymPro i18n setup
description: How multilingual (EN/FR/AR) and RTL is implemented in GymPro
---

## Implementation
- Zustand store with `persist` middleware in `artifacts/gym-app/src/lib/i18n.ts`.
- `useI18n()` hook returns `{ t, language, setLanguage }`.
- Changing language triggers `useEffect` that sets `document.documentElement.dir = "rtl"` for Arabic.
- Language preference stored in localStorage.
- All UI strings go through `t("key")` — no hardcoded English strings in components.

## Dependency
- `zustand` is a non-catalog dependency — must be installed explicitly: `pnpm --filter @workspace/gym-app add zustand`.

**Why:** Custom Zustand store chosen over react-i18next to keep bundle size minimal and avoid library configuration complexity for a 3-language app.
