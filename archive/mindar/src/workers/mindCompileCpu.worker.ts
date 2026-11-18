/**
 * CPU fallback for the MindAR .mind compiler (Oct 2026).
 *
 * WHY: MindAR's browser compiler only registers WebGL kernels. When the
 * browser can't create a WebGL context (GPU process crashed, hardware
 * acceleration off, GPU blocklisted) TensorFlow falls back to CPU and the
 * compile dies with "Kernel 'BinomialFilter' not registered" — the architect
 * can't generate at all. MindAR ships CPU kernels for its Node
 * OfflineCompiler; this worker runs the same pipeline with those kernels, off
 * the main thread, and produces a byte-compatible .mind (msgpack, v2).
 *
 * Mirrors mind-ar@1.2.5 src/image-target/compiler-base.js +
 * compiler.worker.js. Re-check when bumping mind-ar.
 *
 * Input:  { type: "compile", targetImages: { data: Uint8Array (grey), width, height }[] }
 * Output: { type: "progress", percent } … { type: "done", buffer } | { type: "error", message }
 */
import * as tf from "@tensorflow/tfjs";
import * as msgpack from "@msgpack/msgpack";
import { Detector } from "mind-ar/src/image-target/detector/detector.js";
import "mind-ar/src/image-target/detector/kernels/cpu/index.js";
import { buildImageList, buildTrackingImageList } from "mind-ar/src/image-target/image-list.js";
import { build as hierarchicalClusteringBuild } from "mind-ar/src/image-target/matching/hierarchical-clustering.js";
import { extractTrackingFeatures } from "mind-ar/src/image-target/tracker/extract-utils.js";

const CURRENT_VERSION = 2; // must match mind-ar's compiler-base.js

interface GreyImage { data: Uint8Array; width: number; height: number }

const post = (msg: unknown, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

async function compile(targetImages: GreyImage[]): Promise<Uint8Array> {
  await tf.setBackend("cpu");
  await tf.ready();

  // ── Matching features: first 50 % ──
  const perImage = 50 / targetImages.length;
  let percent = 0;
  const dataList: any[] = [];
  for (const targetImage of targetImages) {
    const imageList = buildImageList(targetImage);
    const perAction = perImage / imageList.length;
    const keyframes: any[] = [];
    for (const image of imageList) {
      const detector = new Detector(image.width, image.height);
      tf.tidy(() => {
        const inputT = tf
          .tensor(image.data, [image.data.length], "float32")
          .reshape([image.height, image.width]);
        const { featurePoints: ps } = detector.detect(inputT);
        const maximaPoints = ps.filter((p: any) => p.maxima);
        const minimaPoints = ps.filter((p: any) => !p.maxima);
        keyframes.push({
          maximaPoints,
          minimaPoints,
          maximaPointsCluster: hierarchicalClusteringBuild({ points: maximaPoints }),
          minimaPointsCluster: hierarchicalClusteringBuild({ points: minimaPoints }),
          width: image.width,
          height: image.height,
          scale: image.scale,
        });
      });
      percent += perAction;
      post({ type: "progress", percent });
    }
    dataList.push({ targetImage, matchingData: keyframes });
  }

  // ── Tracking features: second 50 % ──
  for (let i = 0; i < targetImages.length; i++) {
    const imageList = buildTrackingImageList(targetImages[i]);
    const perAction = perImage / imageList.length;
    dataList[i].trackingData = extractTrackingFeatures(imageList, () => {
      percent += perAction;
      post({ type: "progress", percent });
    });
  }

  return msgpack.encode({
    v: CURRENT_VERSION,
    dataList: dataList.map((d) => ({
      targetImage: { width: d.targetImage.width, height: d.targetImage.height },
      trackingData: d.trackingData,
      matchingData: d.matchingData,
    })),
  });
}

self.onmessage = async (e: MessageEvent) => {
  if (e.data?.type !== "compile") return;
  try {
    const bytes = await compile(e.data.targetImages);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    post({ type: "done", buffer }, [buffer]);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
