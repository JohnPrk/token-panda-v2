import type { PetState } from "./types";
import pandaFull from "./skins/panda/full.png";
import pandaHigh from "./skins/panda/high.png";
import pandaGood from "./skins/panda/good.png";
import pandaMid from "./skins/panda/mid.png";
import pandaLow from "./skins/panda/low.png";
import pandaTired from "./skins/panda/tired.png";
import pandaSleepy from "./skins/panda/sleepy.png";
import pandaDead from "./skins/panda/dead.png";

// disconnected 상태(API 끊김)에서는 캐릭터 본체를 dead.png로 바꾸고,
// 그 앞에 "연결 실패" 나무 표지판 오버레이를 캐릭터 앞에 띄운다.
import pandaDisconnected from "./skins/panda/dead.png";
import pandaDisconnectedSign from "./skins/panda/disconnected_sign.png";

import pandaBamboo from "./skins/panda/bamboo.png";
import pandaApple from "./skins/panda/apple.png";
import pandaDumbbell from "./skins/panda/dumbbell.png";

// panda-v2 — 7 감정 PNG 를 9-state PetState 에 매핑.
//   full   (90-100%) → idle      (활기)
//   high   (77-90%)  → cheerful  (양호)
//   good   (63-77%)  → cheerful  (양호 유지, 같은 이미지)
//   mid    (49-63%)  → tired     (피곤한 기색)
//   low    (33-49%)  → weary     (지친)
//   tired  (15-33%)  → sleepy    (졸린, 눈 반감 + Zzz)
//   sleepy (0-15%)   → sleep     (완전히 누워 자는)
//   dead             → dead      (X 눈)
//   disconnected     → dead      (panda 와 동일, ACCESSORIES.disconnectedSign 오버레이)
import pandaV2Idle from "./skins/panda-v2/idle.png";
import pandaV2Cheerful from "./skins/panda-v2/cheerful.png";
import pandaV2Tired from "./skins/panda-v2/tired.png";
import pandaV2Weary from "./skins/panda-v2/weary.png";
import pandaV2Sleepy from "./skins/panda-v2/sleepy.png";
import pandaV2Sleep from "./skins/panda-v2/sleep.png";
import pandaV2Dead from "./skins/panda-v2/dead.png";

// panda-v3 — v2 와 동일한 매핑 규칙. 전신이 다 보이는 새 캐릭터 셋,
// 시각적 무게중심(centroid) 기준으로 좌우 정렬 + 발끝 동일 Y 정렬.
import pandaV3Idle from "./skins/panda-v3/idle.png";
import pandaV3Cheerful from "./skins/panda-v3/cheerful.png";
import pandaV3Tired from "./skins/panda-v3/tired.png";
import pandaV3Weary from "./skins/panda-v3/weary.png";
import pandaV3Sleepy from "./skins/panda-v3/sleepy.png";
import pandaV3Sleep from "./skins/panda-v3/sleep.png";
import pandaV3Dead from "./skins/panda-v3/dead.png";

// Action names used by the idle micro-action loop in App.tsx.
// A skin can optionally provide a .gif for any of these to express the
// motion via the gif itself instead of relying on CSS transforms.
export type ActionName =
  | "roll"
  | "jump"
  | "run"
  | "scratch"
  | "wobble"
  | "squish";

export type Skin = {
  id: string;
  name: string;
  /** Static PNG (or any image) per pet state. Required. */
  frames: Record<PetState, string>;
  /**
   * Optional motion GIFs per idle action. If a gif is provided for an
   * action, the renderer swaps the static state PNG for the gif while
   * the action plays. If absent, the static PNG remains visible and the
   * existing CSS keyframes provide a fallback motion.
   */
  actions?: Partial<Record<ActionName, string>>;
};

export const SKINS: Skin[] = [
  {
    id: "panda",
    name: "Panda",
    frames: {
      full: pandaFull,
      high: pandaHigh,
      good: pandaGood,
      mid: pandaMid,
      low: pandaLow,
      tired: pandaTired,
      sleepy: pandaSleepy,
      dead: pandaDead,
      disconnected: pandaDisconnected,
    },
    // No motion GIFs yet — drop files into src/skins/panda/<action>.gif and
    // wire them up here (e.g. `roll: pandaRollGif`) to enable per-action
    // gif playback. Until then, CSS keyframes animate the static PNG.
    actions: {},
  },
  {
    id: "panda-v2",
    name: "Panda v2",
    frames: {
      full: pandaV2Idle,
      high: pandaV2Cheerful,
      good: pandaV2Cheerful,
      mid: pandaV2Tired,
      low: pandaV2Weary,
      tired: pandaV2Sleepy,
      sleepy: pandaV2Sleep,
      dead: pandaV2Dead,
      disconnected: pandaV2Dead,
    },
    actions: {},
  },
  {
    id: "panda-v3",
    name: "Panda v3",
    frames: {
      full: pandaV3Idle,
      high: pandaV3Cheerful,
      good: pandaV3Cheerful,
      mid: pandaV3Tired,
      low: pandaV3Weary,
      tired: pandaV3Sleepy,
      sleepy: pandaV3Sleep,
      dead: pandaV3Dead,
      disconnected: pandaV3Dead,
    },
    actions: {},
  },
];

export const ACCESSORIES = {
  bamboo: pandaBamboo,
  apple: pandaApple,
  dumbbell: pandaDumbbell,
  disconnectedSign: pandaDisconnectedSign,
};

export const DEFAULT_SKIN_ID = "panda";

export function findSkin(id: string): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}
