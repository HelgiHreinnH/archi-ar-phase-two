## Goal

Remove the friction of the extra "View in AR" tap on the tabletop flow. When a client scans the QR and the model finishes loading, native AR (iOS Quick Look / Android Scene Viewer) should launch automatically after a brief 1.5s beat. The orbit viewer remains as a fallback for users who dismiss AR.

## Change

One file: `src/components/ar/tabletop/TabletopViewer.tsx` (note: Notion doc references the pre-split path `ar/ModelViewerScene.tsx` — we apply it at the new location).

### 1. Add auto-launch effect

After the existing load/error effect, add:

```ts
useEffect(() => {
  if (loadState !== "loaded") return;
  const iosUsdz = (hasUsdz(usdzUrl) ? usdzUrl : null) || (hasUsdz(modelUrl) ? modelUrl : undefined);
  if (isIOS() && !iosUsdz) return; // iOS-without-USDZ: keep warning banner, no auto-launch
  const t = window.setTimeout(() => {
    const el = mvRef.current as (HTMLElement & { activateAR?: () => void }) | null;
    try { el?.activateAR?.(); } catch (err) { console.warn("[TabletopViewer] activateAR failed:", err); }
  }, 1500);
  return () => window.clearTimeout(t);
}, [loadState, modelUrl, usdzUrl]);
```

Guards:
- Only fires once per successful load (cleanup clears the timer if user navigates away or model reloads).
- Skipped on iOS with no USDZ — preserves existing `iosBlocked` warning banner, no regression.
- `activateAR()` must be triggered from a user gesture on some browsers; the QR-scan → "Launch AR Camera" tap on the landing page counts as the originating gesture for the session, so this should work on iOS Safari. If a particular browser rejects it, the existing manual "View in AR" button is still rendered as a fallback.

### 2. Update footer hint

```
Drag to orbit · Pinch to zoom · AR launches automatically when ready
```

### 3. Analytics

The existing `ar-status: session-started` handler already logs `ar_launched` events — no changes needed. Auto-launches will show up the same way as manual ones in `ar_events`.

## Out of scope (logged for later)

- True single-step landing → camera (would need `<model-viewer ar>` on the landing page itself or a direct USDZ link button).
- Removing the orbit viewer entirely.

## Verification

- Code path check: confirm `loadState === "loaded"` fires on real device (already wired via `load` event).
- Manual test on iPhone 12 Pro after deploy: QR → Launch AR Camera → model loads → Quick Look opens within ~1.5s without extra tap.
- Android: Scene Viewer should auto-open the same way.
- iOS without USDZ: warning banner still shows, no auto-launch attempt.
