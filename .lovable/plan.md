
# Fix: AR Camera Closes and Grey Screen Appears After Marker Detection

## Root Cause (The Real Bug)

Looking at the screenshot and the code, the problem is architectural. The AR experience is split into two completely separate React components that cannot share the same camera/AR session:

**What happens today:**
1. `ARDetection` mounts → `MindARScene` inside it starts the camera, loads the .mind file, and starts the WebGL render loop
2. User points camera at AR marker → MindAR detects it → `onTargetFound` fires → `allDetected` becomes true → `onAllDetected()` is called
3. `ARViewer` switches `viewState` from `"detecting"` to `"active"`
4. **`ARDetection` UNMOUNTS** → its `MindARScene` child runs its cleanup → `mindarThree.stop()` is called → **camera stream stops, WebGL context is destroyed**
5. `ARActiveView` mounts → it renders a static grey `bg-gradient` `<div>` with buttons — **there is no camera, no WebGL, no 3D model**

The user sees: project name pill (top left) ✓ green dot (top right) camera/reset buttons — all overlaid on a dead grey rectangle. This is exactly what the screenshot shows.

**This is not a MindAR bug. It is a design flaw**: the AR session is destroyed at the exact moment the user needs it most.

---

## The Fix: Eliminate the "Active" State — Keep MindARScene Alive

The correct pattern for AR viewers is to keep the AR session running the entire time the user is in the experience. The UI overlay (info pill, buttons) should render **on top of** the live camera feed, not replace it.

### Approach: Merge ARDetection + ARActiveView into a single persistent AR screen

The `"active"` view state should be removed. Instead, `ARDetection` should have two display phases:
1. **Detection phase** (guide card + marker status indicators visible, camera running)
2. **Active phase** (guide card hidden, project info pill + action buttons visible, camera still running — same `MindARScene` never unmounts)

This is controlled by a local boolean inside `ARDetection` (or promoted to a prop), not by swapping the entire component in `ARViewer`.

---

## Files to Change

### 1. `src/components/ar/ARDetection.tsx`
- Add an `isActive` local state that becomes `true` when `allDetected` fires (instead of immediately calling `onAllDetected`)  
- When `isActive === false`: show the detection guide card and marker status bar
- When `isActive === true`: show the `ARActiveView`-equivalent overlay (project name pill, camera button, reset button, exit button) while keeping `MindARScene` mounted underneath
- Accept `project` name/description props to display in the active overlay
- Accept `onExit` and `onReset` props
- Remove the call to `onAllDetected` (or keep it as a side-effect for parent logging if needed, but don't use it to swap components)

### 2. `src/pages/ARViewer.tsx`
- Remove the `"active"` view state entirely from the state machine
- Instead of switching to `"active"`, stay in `"detecting"` — let `ARDetection` internally handle the UI phase switch
- Pass `project.name`, `project.description`, `onReset`, and `onExit` props down to `ARDetection`
- Update `handleReset` to reset marker state (already done) — ARDetection will reset its `isActive` state via a prop or key change

### 3. `src/components/ar/ARActiveView.tsx`
- This component becomes redundant and can be deleted, or kept as a pure presentational component that `ARDetection` renders internally (preferred — cleaner separation)
- The grey gradient background `div` must be removed. The active overlay must have `bg-transparent` so the camera feed shows through

---

## Detailed Implementation

### `ARDetection.tsx` — New Internal State Machine

```tsx
const [isActive, setIsActive] = useState(false);

// When all markers detected, switch to active phase (don't unmount!)
useEffect(() => {
  if (allDetected && !isActive) {
    // Small delay for "Loading model..." UX moment
    const t = setTimeout(() => {
      setIsActive(true);
      onAllDetected?.(); // notify parent (optional, for state tracking)
    }, 800);
    return () => clearTimeout(t);
  }
}, [allDetected, isActive, onAllDetected]);
```

When `isActive` is true, hide the detection UI and show the AR controls overlay — but `MindARScene` stays mounted in both phases.

### `ARActiveView.tsx` — Remove the grey background

The current code has:
```tsx
<div className="fixed inset-0 bg-black flex flex-col">
  <div className="absolute inset-0 bg-gradient-to-b from-zinc-800 via-zinc-700 to-zinc-800" />
```

This must become fully transparent when used as an overlay:
```tsx
<div className="fixed inset-0 flex flex-col bg-transparent">
  {/* no background div — camera shows through */}
```

### Reset Flow
When the user taps Reset:
- `ARViewer.handleReset` resets marker state and sets `viewState` back to `"detecting"` 
- Since `viewState` was already `"detecting"` (it never changed to `"active"` anymore), we need a different signal
- Solution: pass a `resetKey` or call a ref-exposed `reset()` function inside `ARDetection` to set `isActive` back to `false`
- Simplest: pass `isActive` control up via a callback and use a `key` prop on `ARDetection` to remount it on reset (remounting is acceptable here since the user intentionally resets)

---

## Summary of Changes

| File | Change |
|---|---|
| `src/components/ar/ARDetection.tsx` | Add `isActive` state; render detection UI OR active overlay UI based on it; keep `MindARScene` mounted always |
| `src/components/ar/ARActiveView.tsx` | Remove grey/black background so it can overlay a live camera feed |
| `src/pages/ARViewer.tsx` | Remove `"active"` state; pass project info + exit/reset handlers to `ARDetection`; use `key` prop to reset `ARDetection` on reset |

No database changes, no new dependencies, no new files needed.

---

## Why This Definitely Fixes the Bug

- `MindARScene` never unmounts during the user's AR session
- The camera stream, WebGL context, and 3D model all remain alive
- The UI phase change (detection → active controls) is a CSS visibility toggle inside a single component, not a React tree swap
- The grey background the user sees in the screenshot is replaced by the live camera feed + rendered 3D model
