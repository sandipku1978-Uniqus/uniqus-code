"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";

/**
 * Minimal shape of the browser SpeechRecognition we use — typed locally so we
 * don't pull in DOM lib ambient types (and avoid `any`). Only the bits we touch.
 */
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  start(): void;
  stop(): void;
};
type SpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};
/** Subset of SpeechRecognitionErrorEvent — `error` carries the failure code. */
type SpeechErrorEvent = { error?: string };
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/**
 * Map a SpeechRecognition error code to user-facing copy. Returns "" for codes
 * we want to swallow silently (an intentional stop). Without this, every
 * failure — blocked mic, no network, no speech — was a silent no-op that made
 * the button look broken.
 */
function friendlyMicError(code: string | undefined): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Allow mic access in your browser, then try again.";
    case "audio-capture":
      return "No microphone found. Check that one is connected and enabled.";
    case "network":
      return "Voice input needs a network connection — check your connection and retry.";
    case "no-speech":
      return "Didn't catch any speech — click the mic and try again.";
    case "aborted":
      return ""; // user/programmatic stop — not an error worth announcing
    default:
      return "Voice input failed — try again.";
  }
}

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Voice-dictation button shared by every composer. Uses the browser's built-in
 * SpeechRecognition (Chrome/Edge/Safari); on browsers without it the button is
 * disabled with an explanatory title rather than hidden, so the control set
 * stays visually consistent across chat boxes. Recognised text is handed back
 * via `onText` for the caller to append to its input.
 *
 * `className` lets each composer reuse its own icon-button styling (e.g.
 * `hp-icon-btn` on the landing page, `mic-btn` in the workspace).
 */
export default function MicButton({
  onText,
  className,
  disabled = false,
  title = "Dictate with your voice",
}: {
  onText: (text: string) => void;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
    // Stop any in-flight recognition if the button unmounts.
    return () => recRef.current?.stop();
  }, []);

  function toggle(): void {
    if (listening) {
      try {
        recRef.current?.stop();
      } catch {
        // stop() can throw if recognition never actually started — recover.
        setListening(false);
      }
      return;
    }
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang =
      (typeof navigator !== "undefined" && navigator.language) || "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        text += e.results[i][0]?.transcript ?? "";
      }
      if (text.trim()) onText(text.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = (e) => {
      setListening(false);
      const msg = friendlyMicError(e?.error);
      if (msg) toast.error(msg);
    };
    recRef.current = rec;
    setListening(true);
    try {
      // start() throws synchronously in an insecure context, when blocked by a
      // permissions policy, or on a double-start. Without this guard the button
      // gets wedged in the "listening" state forever (onend/onerror never fire).
      rec.start();
    } catch {
      setListening(false);
      recRef.current = null;
      toast.error(
        "Couldn't start voice input. Make sure the page is on https and microphone access is allowed.",
      );
    }
  }

  return (
    <button
      type="button"
      className={className}
      onClick={toggle}
      disabled={disabled || !supported}
      data-on={listening ? "true" : undefined}
      aria-pressed={listening}
      aria-label={listening ? "Stop dictation" : "Dictate with your voice"}
      title={
        supported
          ? listening
            ? "Listening… click to stop"
            : title
          : "Voice input isn't supported in this browser"
      }
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
      </svg>
    </button>
  );
}
