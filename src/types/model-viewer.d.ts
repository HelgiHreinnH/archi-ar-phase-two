/**
 * JSX type declarations for the <model-viewer> web component.
 * @see https://modelviewer.dev/docs/
 */
declare namespace JSX {
  interface IntrinsicElements {
    "model-viewer": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement>,
      HTMLElement
    > & {
      src?: string;
      "ios-src"?: string;
      poster?: string;
      alt?: string;
      ar?: boolean | string;
      "ar-modes"?: string;
      "ar-scale"?: string;
      "ar-placement"?: string;
      "camera-controls"?: boolean | string;
      "touch-action"?: string;
      "auto-rotate"?: boolean | string;
      "rotation-per-second"?: string;
      "shadow-intensity"?: string;
      "shadow-softness"?: string;
      "environment-image"?: string;
      exposure?: string;
      "camera-orbit"?: string;
      "min-camera-orbit"?: string;
      "max-camera-orbit"?: string;
      "field-of-view"?: string;
      loading?: "auto" | "lazy" | "eager";
      reveal?: "auto" | "manual";
      "interaction-prompt"?: "auto" | "none";
    };
  }
}
