import { Composition } from "remotion";
import { OnyxV1 } from "./OnyxV1";
import { OnyxV2 } from "./OnyxV2";

const FPS = 30;
const DURATION = 2760; // 92s

export const RemotionRoot = () => (
  <>
    <Composition id="onyx-v1" component={OnyxV1} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} />
    <Composition id="onyx-v2" component={OnyxV2} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} />
  </>
);
