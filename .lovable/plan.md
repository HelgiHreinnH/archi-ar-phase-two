

# Fix: MindAR Camera Launch Failure on Mobile Safari

## Root Cause

The error message is:
```
Module name, 'three/addons/renderers/CSS3DRenderer.js' does not resolve to a valid URL.
```

MindAR v1.2.5 internally imports modules using the `three/addons/` path prefix (e.g. `CSS3DRenderer.js`). Our import map in `index.html` only maps the base `"three"` and one specific loader file, but is **missing the wildcard `"three/addons/"` prefix** that MindAR needs to resolve its internal Three.js dependencies.

The official MindAR installation docs confirm the required import map must include `"three/addons/"` as a trailing-slash mapping (which acts as a path prefix in import maps).

## Fix (single file change)

**File: `index.html`**

Replace the current import map entries:
```json
{
  "imports": {
    "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
    "three/examples/jsm/loaders/GLTFLoader.js": "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js"
  }
}
```

With the correct map matching the official MindAR docs:
```json
{
  "imports": {
    "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/",
    "mindar-image-three": "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js"
  }
}
```

This adds:
- `"three/addons/"` -- resolves all internal MindAR imports like `CSS3DRenderer.js`
- `"mindar-image-three"` -- allows cleaner importing (optional but matches official docs)

The specific `GLTFLoader` entry is no longer needed because it is covered by the `three/addons/` wildcard.

**File: `src/components/ar/MindARScene.tsx`**

Update the `GLTF_LOADER_URL` constant to use the new `three/addons/` path so it also resolves through the import map:
```ts
const GLTF_LOADER_URL = "three/addons/loaders/GLTFLoader.js";
```

No other changes needed. The `loadMindAR()` dynamic import approach stays as-is.

## Why This Will Work

This is not a guess -- the exact error message (`three/addons/renderers/CSS3DRenderer.js does not resolve`) tells us precisely which import map entry is missing, and the official MindAR v1.2.5 installation documentation prescribes the `"three/addons/"` trailing-slash mapping as required configuration.

