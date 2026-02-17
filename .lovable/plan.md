
# Fix: MindAR Restart Loop After Target Detection

## Problem

When the QR marker is detected on mobile, the app enters an infinite restart loop instead of transitioning to the active AR view. Two bugs are at play:

### Bug 1: MindAR restarts in a loop
The `MindARScene` component includes callback props (`onTargetFound`, `onTargetLost`, etc.) in the dependency array of its `startAR` useCallback. Every time a marker is detected, the parent state changes, causing new inline function references to be passed down, which recreates `startAR`, which triggers the useEffect cleanup/restart cycle -- stopping and restarting MindAR endlessly.

### Bug 2: No transition to "active" state
`ARDetection` receives an `onAllDetected` prop but **never calls it**. Even if the loop were fixed, the user would be stuck on the detection screen forever.

---

## Solution

### 1. Stabilize callbacks with refs in `MindARScene.tsx`
- Store all callback props (`onTargetFound`, `onTargetLost`, `onReady`, `onError`) in refs
- Remove them from the `startAR` dependency array
- Use the refs inside the MindAR event handlers so they always call the latest version without triggering re-initialization

### 2. Call `onAllDetected` in `ARDetection.tsx`
- Add a `useEffect` that watches the `allDetected` computed boolean
- When all markers are detected, call `onAllDetected()` to transition to the "active" view state

---

## Technical Details

### File: `src/components/ar/MindARScene.tsx`

Add refs for callbacks at the top of the component:
```ts
const onTargetFoundRef = useRef(onTargetFound);
const onTargetLostRef = useRef(onTargetLost);
const onReadyRef = useRef(onReady);
const onErrorRef = useRef(onError);
```

Keep refs in sync with a useEffect:
```ts
useEffect(() => {
  onTargetFoundRef.current = onTargetFound;
  onTargetLostRef.current = onTargetLost;
  onReadyRef.current = onReady;
  onErrorRef.current = onError;
}, [onTargetFound, onTargetLost, onReady, onError]);
```

Inside `startAR`, use refs instead of direct props:
```ts
anchor.onTargetFound = () => onTargetFoundRef.current?.(i);
anchor.onTargetLost = () => onTargetLostRef.current?.(i);
// ...
onReadyRef.current?.();
// ...
onErrorRef.current?.(err);
```

Remove callbacks from the `startAR` dependency array -- only keep stable values:
```ts
}, [imageTargetSrc, modelUrl, maxTrack, modelScale, initialRotation]);
```

### File: `src/components/ar/ARDetection.tsx`

Add a useEffect to trigger the transition:
```ts
import { useState, useEffect } from "react";

// Inside the component, after the allDetected calculation:
useEffect(() => {
  if (allDetected) {
    onAllDetected();
  }
}, [allDetected, onAllDetected]);
```

---

## Why This Will Work

- **Bug 1 fix**: By using refs for callbacks, MindAR only starts once and never restarts due to parent re-renders. The refs always point to the latest callback so behavior is correct.
- **Bug 2 fix**: The useEffect ensures the view transitions to "active" as soon as all required markers are detected, completing the user journey.

This is a standard React pattern for breaking dependency cycles in useCallback/useEffect without losing access to up-to-date prop values.
