/**
 * 打字音效：用 Web Audio 现场合成，不带音频文件，离线可用。
 * - playKey：每次按键的轻敲声
 * - playError：跟写 / 照抄时打错字母
 * - playCorrect / playWrong：按 Enter 判定后的结果音（跟写完成也算答对）
 *
 * AudioContext 在第一次出声时才创建（浏览器要求在用户操作之后）。
 * 环境不支持 Web Audio（如测试用的 jsdom）时全部静默。
 */

type AudioContextClass = typeof AudioContext;

let enabled = true;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

/** 总开关，对应设置里的“打字音效” */
export function setSoundEnabled(value: boolean): void {
  enabled = value;
}

function audio(): AudioContext | null {
  if (!enabled || typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

function noiseBuffer(ac: AudioContext): AudioBuffer {
  if (!noise) {
    const length = Math.floor(ac.sampleRate * 0.05);
    noise = ac.createBuffer(1, length, ac.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

/** 一个带包络的音：从 freq 滑到 endFreq（可选），音量指数衰减 */
function tone(
  ac: AudioContext,
  options: {
    freq: number;
    endFreq?: number;
    at: number;
    duration: number;
    type: OscillatorType;
    volume: number;
    lowpass?: number;
  },
): void {
  const { freq, endFreq, at, duration, type, volume, lowpass } = options;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, at + duration);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  let node: AudioNode = osc;
  if (lowpass) {
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = lowpass;
    osc.connect(filter);
    node = filter;
  }
  node.connect(gain);
  gain.connect(master!);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

function safely(play: (ac: AudioContext) => void): void {
  const ac = audio();
  if (!ac) return;
  try {
    play(ac);
  } catch {
    // 音效出错不影响练习
  }
}

/** 按键：一小段经带通滤波的噪声，加一点低频，像轻敲键盘 */
export function playKey(): void {
  safely((ac) => {
    const at = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(ac);
    src.playbackRate.value = 0.9 + Math.random() * 0.25;
    const filter = ac.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 2000 + Math.random() * 900;
    filter.Q.value = 1.1;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.5, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master!);
    src.start(at);
    src.stop(at + 0.05);
    tone(ac, { freq: 190, endFreq: 120, at, duration: 0.035, type: "sine", volume: 0.18 });
  });
}

/** 打错字母：低沉的短促“嘟” */
export function playError(): void {
  safely((ac) => {
    tone(ac, {
      freq: 150,
      endFreq: 115,
      at: ac.currentTime,
      duration: 0.13,
      type: "square",
      volume: 0.12,
      lowpass: 900,
    });
  });
}

/** 答对：两个上行的清脆音 */
export function playCorrect(): void {
  safely((ac) => {
    const at = ac.currentTime;
    tone(ac, { freq: 880, at, duration: 0.16, type: "sine", volume: 0.2 });
    tone(ac, { freq: 1318.5, at: at + 0.075, duration: 0.24, type: "sine", volume: 0.2 });
  });
}

/** 答错：两个下行的低音 */
export function playWrong(): void {
  safely((ac) => {
    const at = ac.currentTime;
    tone(ac, { freq: 330, at, duration: 0.15, type: "triangle", volume: 0.22, lowpass: 1600 });
    tone(ac, {
      freq: 233,
      at: at + 0.11,
      duration: 0.24,
      type: "triangle",
      volume: 0.22,
      lowpass: 1600,
    });
  });
}
