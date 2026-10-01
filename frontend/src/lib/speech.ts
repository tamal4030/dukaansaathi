import type { LanguageCode } from './types';

/**
 * Voice helpers. Everything here is browser-side and best effort:
 *  - English playback uses the device voice (speechSynthesis) when a suitable
 *    English voice exists.
 *  - Bengali and Hindi playback go through the backend, which calls Sarvam TTS.
 *  - The written answer is always kept on screen if playback fails.
 */

export function speechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function pickEnglishVoice(): SpeechSynthesisVoice | null {
  if (!speechSynthesisSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const exact = voices.find((voice) => voice.lang?.toLowerCase() === 'en-in');
  if (exact) return exact;
  return voices.find((voice) => voice.lang?.toLowerCase().startsWith('en')) ?? null;
}

export interface SpeakHandle {
  stop: () => void;
}

/** Speaks English text with the browser voice. Returns null when unavailable. */
export function speakWithBrowser(text: string): SpeakHandle | null {
  if (!speechSynthesisSupported()) return null;
  const voice = pickEnglishVoice();
  if (!voice) return null;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return { stop: () => window.speechSynthesis.cancel() };
}

/**
 * Why playback failed. Kept as a small closed set so callers can react and log
 * a safe diagnostic without ever handling the audio content.
 */
export type PlaybackFailureReason = 'blocked' | 'unsupported' | 'decode' | 'unknown';

/**
 * A browser-side playback failure, as opposed to a provider (Sarvam) rejection.
 *
 * The distinction matters when reporting: a provider rejection carries a
 * user-facing message from the API, while a playback failure must show the
 * localized "playback failed" text. `reason` is safe to log - it contains no
 * audio data, no customer text and no credentials.
 */
export class PlaybackError extends Error {
  readonly reason: PlaybackFailureReason;

  constructor(reason: PlaybackFailureReason, message: string) {
    super(message);
    this.name = 'PlaybackError';
    this.reason = reason;
  }
}

function classifyPlaybackFailure(error: unknown): PlaybackFailureReason {
  const name = (error as { name?: string } | null)?.name ?? '';
  if (name === 'NotAllowedError') return 'blocked';
  if (name === 'NotSupportedError') return 'unsupported';
  if (name === 'EncodingError') return 'decode';
  return 'unknown';
}

/**
 * Plays base64 audio returned by the backend (Sarvam TTS).
 *
 * `HTMLAudioElement.play()` returns a promise that rejects when the browser
 * refuses to play (autoplay policy, unsupported codec, decode failure). The
 * previous implementation used `void audio.play()`, so every rejection was
 * swallowed: the UI kept showing "playing" and the customer heard nothing.
 * This version awaits it and propagates a typed error.
 *
 * The object URL is released exactly once, on whichever of these happens first:
 * playback ending, an audio error, an explicit stop, or a failed play().
 */
export async function playBase64Audio(base64: string, mimeType: string): Promise<SpeakHandle> {
  let url: string;
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  } catch {
    // atob throws on malformed base64. Nothing was allocated, so there is no
    // object URL to release.
    throw new PlaybackError('decode', 'The spoken answer could not be decoded.');
  }

  const audio = new Audio(url);

  // Released at most once, however many paths call it.
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    audio.removeEventListener('ended', handleEnded);
    audio.removeEventListener('error', handleError);
    URL.revokeObjectURL(url);
  };

  function handleEnded() {
    release();
  }
  function handleError() {
    release();
  }

  audio.addEventListener('ended', handleEnded);
  audio.addEventListener('error', handleError);

  try {
    await audio.play();
  } catch (error) {
    // Release immediately: a rejected play() will never reach 'ended'.
    release();
    throw new PlaybackError(
      classifyPlaybackFailure(error),
      error instanceof Error ? error.message : 'Playback was refused by the browser.',
    );
  }

  return {
    stop: () => {
      audio.pause();
      release();
    },
  };
}

export interface RecorderHandle {
  stop: () => Promise<Blob>;
  cancel: () => void;
}

export interface StartRecordingResult {
  handle: RecorderHandle;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type));
}

/**
 * Records microphone audio in the browser. Permission problems surface as a
 * clear message so the UI can suggest typing instead.
 */
export async function startRecording(): Promise<StartRecordingResult> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not support microphone recording.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  recorder.start();

  const release = () => stream.getTracks().forEach((track) => track.stop());

  return {
    handle: {
      stop: () =>
        new Promise<Blob>((resolve) => {
          recorder.addEventListener('stop', () => {
            release();
            resolve(new Blob(chunks, { type: mimeType ?? 'audio/webm' }));
          });
          recorder.stop();
        }),
      cancel: () => {
        try {
          recorder.stop();
        } catch {
          // Recorder already stopped.
        }
        release();
      },
    },
  };
}

/** Whether the answer should be spoken automatically for a voice-originated query. */
export function shouldAutoSpeak(source: 'TEXT' | 'VOICE'): boolean {
  return source === 'VOICE';
}

export function languageSupportsBackendTts(language: LanguageCode): boolean {
  return language === 'bn' || language === 'hi';
}
