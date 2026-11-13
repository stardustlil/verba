/**
 * 朗读：使用系统自带的语音（Web Speech API），离线可用。
 * Linux 的 WebKitGTK 通常没有语音合成，此时 speechSupported 为 false，界面隐藏朗读按钮。
 */

export const speechSupported =
  typeof window !== "undefined" &&
  "speechSynthesis" in window &&
  typeof window.SpeechSynthesisUtterance === "function";

let voice: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (!speechSupported) return null;
  const voices = window.speechSynthesis.getVoices();
  const english = voices.filter((v) => v.lang.replace("_", "-").startsWith("en"));
  return (
    english.find((v) => v.lang.replace("_", "-") === "en-US" && v.localService) ??
    english.find((v) => v.lang.replace("_", "-") === "en-US") ??
    english[0] ??
    null
  );
}

if (speechSupported) {
  voice = pickVoice();
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    voice = pickVoice();
  });
}

/** 朗读一段英文；正在朗读的会被打断 */
export function speak(text: string): void {
  if (!speechSupported || !text.trim()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.92;
  if (voice) utterance.voice = voice;
  synth.speak(utterance);
}

export function stopSpeaking(): void {
  if (speechSupported) window.speechSynthesis.cancel();
}
