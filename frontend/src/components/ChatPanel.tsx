import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { LANGUAGES, useI18n } from '../lib/i18n';
import { detectScriptLanguage } from '../lib/scriptDetect';
import { useFeatures } from '../providers/FeaturesProvider';
import { useToast } from '../providers/ToastProvider';
import { useCart } from '../providers/CartProvider';
import {
  languageSupportsBackendTts,
  playBase64Audio,
  PlaybackError,
  shouldAutoSpeak,
  speakWithBrowser,
  startRecording,
  type RecorderHandle,
  type SpeakHandle,
} from '../lib/speech';
import { Spinner, StarRating } from './ui';
import type { AssistantProposal, LanguageCode } from '../lib/types';

interface DisplayMessage {
  id: string;
  role: 'CUSTOMER' | 'ASSISTANT';
  content: string;
  source: 'TEXT' | 'VOICE';
  /** The language this message is in, used to pick the correct TTS voice. */
  language: LanguageCode;
}

const GUEST_TOKEN_KEY = 'dukaansaathi.guestConversations';

function readGuestTokens(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(GUEST_TOKEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeGuestToken(businessId: string, token: string) {
  try {
    const all = readGuestTokens();
    all[businessId] = token;
    window.localStorage.setItem(GUEST_TOKEN_KEY, JSON.stringify(all));
  } catch {
    // Guests can still chat for this page view (the session pool keeps it in memory).
  }
}

/**
 * Chat tied to exactly one business. The business id comes from the route and is
 * validated by the backend, which also creates the guest token. Voice uses
 * Sarvam STT through the backend, with an editable transcript before sending.
 */
export function ChatPanel({ businessId, businessName }: { businessId: string; businessName: string }) {
  const { t, language } = useI18n();
  const { voiceConfigured } = useFeatures();
  const { push } = useToast();
  const cart = useCart();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [proposals, setProposals] = useState<AssistantProposal[]>([]);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const [recorder, setRecorder] = useState<RecorderHandle | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [detectionNote, setDetectionNote] = useState<string | null>(null);
  const [pendingSource, setPendingSource] = useState<'TEXT' | 'VOICE'>('TEXT');
  const [speaking, setSpeaking] = useState(false);
  /**
   * The language the customer SPOKE, which is independent of the interface
   * language. It drives the conversation locale (and therefore the reply
   * language and TTS voice) for voice-originated questions.
   */
  const [spokenLanguage, setSpokenLanguage] = useState<LanguageCode | null>(null);
  const spokenLanguageRef = useRef<LanguageCode | null>(null);
  spokenLanguageRef.current = spokenLanguage;

  /**
   * Explicit reply-language choice for TYPED text. Latin-only input cannot be
   * classified, so the customer may state the language; script-detected Bengali
   * or Hindi is used automatically when no override is set.
   */
  const [replyLanguageOverride, setReplyLanguageOverride] = useState<LanguageCode | null>(null);
  const draftDetection = detectScriptLanguage(draft);

  /** Latest computed language for typed text (script-detected or overridden). */
  const typedLanguageRef = useRef<LanguageCode>(language);
  typedLanguageRef.current = replyLanguageOverride ?? draftDetection.language ?? language;

  const transcriptRef = useRef<string | null>(null);
  transcriptRef.current = transcript;

  const speechRef = useRef<SpeakHandle | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [feedbackGiven, setFeedbackGiven] = useState(false);

  /**
   * Conversations are created lazily, on the first message.
   *
   * Creating one when the page merely opens left empty conversations in the
   * merchant's inbox, and because the effect depended on the UI language,
   * switching language created a second one. A ref keeps it to exactly one
   * conversation per chat session, regardless of language changes.
   */
  const conversationRef = useRef<string | null>(null);
  const startingRef = useRef<Promise<string | null> | null>(null);

  /**
   * The guest token must be readable SYNCHRONOUSLY by the very next request.
   *
   * ensureConversation() resolves inside the same tick that send() continues
   * in, so a value written only through React state is still null when send()
   * reads it from its closure. That produced a first message sent without the
   * X-Guest-Token header, which the backend correctly rejected with
   * "You do not have access to this conversation".
   *
   * This ref is therefore the single source of truth for requests. The token is
   * a secret and is never rendered, so there is deliberately no state copy.
   */
  const guestTokenRef = useRef<string | null>(null);

  const ensureConversation = useCallback(
    async (spokenLanguage: LanguageCode): Promise<string | null> => {
      if (conversationRef.current) return conversationRef.current;
      // Reuse an in-flight creation so two quick messages cannot race.
      if (startingRef.current) return startingRef.current;

      const pending = (async () => {
        try {
          const result = await api.conversations.start(businessId, spokenLanguage);
          conversationRef.current = result.conversation.id;
          setConversationId(result.conversation.id);
          if (result.guestToken) {
            // Stored synchronously so the request that triggered this
            // creation already sees the token. It is kept in a ref and in
            // browser storage only - never in render state, because it is a
            // secret and is never displayed.
            guestTokenRef.current = result.guestToken;
            writeGuestToken(businessId, result.guestToken);
          }
          setStartError(null);
          return result.conversation.id;
        } catch (error) {
          setStartError(error instanceof Error ? error.message : t('common.somethingWentWrong'));
          return null;
        } finally {
          startingRef.current = null;
        }
      })();

      startingRef.current = pending;
      return pending;
    },
    [businessId, t],
  );

  /** Explicit retry from the error state. */
  const retryConversation = useCallback(async () => {
    // A retry starts a brand-new conversation, so the old id and the old token
    // must both be discarded. Leaving a stale token behind would authorise the
    // new conversation with the previous one's secret.
    conversationRef.current = null;
    guestTokenRef.current = null;
    setConversationId(null);
    setStartError(null);
    setStarting(true);
    await ensureConversation(spokenLanguageRef.current ?? language);
    setStarting(false);
  }, [ensureConversation, language]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length, sending]);

  useEffect(
    () => () => {
      speechRef.current?.stop();
      recorder?.cancel();
    },
    [recorder],
  );

  const speak = useCallback(
    async (text: string, lang: LanguageCode) => {
      speechRef.current?.stop();
      setSpeaking(true);
      try {
        if (languageSupportsBackendTts(lang)) {
          const result = await api.speech.speak(text, lang);
          // Awaited: play() rejects when the browser refuses to play, and the
          // previous fire-and-forget call hid that completely.
          speechRef.current = await playBase64Audio(result.audioBase64, result.mimeType);
          // Let the audio finish; the button stays available as a replay.
          window.setTimeout(() => setSpeaking(false), Math.min(20000, 60 * text.length));
          return;
        }
        const handle = speakWithBrowser(text);
        if (!handle) {
          // No suitable English voice on this device: keep the text answer.
          push(t('chat.playbackFailed'), 'info');
          setSpeaking(false);
          return;
        }
        speechRef.current = handle;
        window.setTimeout(() => setSpeaking(false), Math.min(20000, 70 * text.length));
      } catch (error) {
        setSpeaking(false);

        /**
         * Two different failures reach here and must be reported differently:
         *
         *  - ApiError  -> Sarvam rejected or could not serve the request. The
         *                 API message is already user-facing, so show it.
         *  - PlaybackError -> the browser refused to play audio we received
         *                 successfully. Show the localized message; the raw
         *                 DOMException text is English and not actionable.
         *
         * The written answer stays on screen either way.
         */
        const isApiFailure = error instanceof ApiError;
        const isPlaybackFailure = error instanceof PlaybackError;

        // Safe diagnostic only: a reason code and the character count. Never
        // the answer text, the audio, or any credential.
        if (isPlaybackFailure) {
          console.warn('[tts] browser playback failed', {
            reason: (error as PlaybackError).reason,
            characters: text.length,
          });
        } else if (isApiFailure) {
          console.warn('[tts] speech service rejected the request', {
            status: (error as ApiError).status,
            code: (error as ApiError).code,
            characters: text.length,
          });
        }

        push(isApiFailure ? (error as ApiError).message : t('chat.playbackFailed'), 'error');
      }
    },
    [push, t],
  );

  const send = useCallback(
    async (content: string, source: 'TEXT' | 'VOICE') => {
      if (!content.trim() || sending) return;

      /**
       * A voice question is answered in the language that was SPOKEN, never the
       * interface language. When detection gave nothing usable the customer
       * must have chosen a language explicitly; we refuse to guess, because
       * guessing English for Bengali speech would answer in the wrong language.
       */
      const replyLanguage = source === 'VOICE' ? spokenLanguageRef.current : typedLanguageRef.current;
      if (source === 'VOICE' && !replyLanguage) {
        setDetectionNote(t('chat.pickLanguageBeforeSending'));
        setSending(false);
        return;
      }
      const effectiveLanguage = replyLanguage ?? language;

      setSending(true);
      setNotice(null);
      setProposals([]);
      // Remember the transcript so a failed request can restore it: losing the
      // customer's words on a network error would force them to re-record.
      const transcriptBeforeSend = source === 'VOICE' ? transcriptRef.current : null;
      setTranscript(null);

      const localId = `local-${Date.now()}`;
      setMessages((current) => [...current, { id: localId, role: 'CUSTOMER', content, source, language: effectiveLanguage }]);

      try {
        const activeConversationId = await ensureConversation(effectiveLanguage);
        if (!activeConversationId) {
          setSending(false);
          return;
        }

        const result = await api.messages.send({
          conversationId: activeConversationId,
          // Read from the ref: on the first message the state value is stale.
          guestToken: guestTokenRef.current,
          content,
          locale: effectiveLanguage,
          source,
          cart: cart.lines.map((line) => ({
            productId: line.productId,
            name: line.name,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            availability: line.availability,
          })),
        });

        const assistantMessage = result.messages.find((message) => message.role === 'ASSISTANT');
        setMessages((current) => [
          ...current,
          {
            id: assistantMessage?.id ?? `assistant-${Date.now()}`,
            role: 'ASSISTANT',
            content: result.assistant.reply,
            source: 'TEXT',
            // The language the ASSISTANT answered in, not the UI language.
            language: result.assistant.language ?? effectiveLanguage,
          },
        ]);

        if (!result.assistant.available) {
          setNotice(result.assistant.notice?.message ?? t('chat.assistantUnavailable'));
        }
        setProposals(result.assistant.proposals.filter((proposal) => proposal.orderable));

        // Voice questions speak the answer automatically; a replay button stays.
        if (shouldAutoSpeak(source)) {
          void speak(result.assistant.reply, result.assistant.language ?? effectiveLanguage);
        }
      } catch (error) {
        const message = error instanceof ApiError ? error.message : t('common.somethingWentWrong');
        setNotice(message);
        // Restore the spoken words and the language choice so the customer can
        // simply press Send again. The UI must never look stuck processing.
        if (transcriptBeforeSend !== null) {
          setTranscript(transcriptBeforeSend);
          setDetectionNote(t('chat.sendFailedRetry'));
        }
      } finally {
        setSending(false);
      }
    },
    [ensureConversation, language, cart.lines, sending, speak, t],
  );

  /**
   * Typed messages get their language from the SCRIPT they are written in, not
   * from the interface language. Bengali typed while the UI is English must be
   * answered in Bengali.
   *
   * Latin-only text is ambiguous - "acha" could be English or romanised Bengali
   * - so it uses the interface language, which the customer can override with
   * the reply-language selector below the composer.
   */
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setDraft('');
    void send(content, 'TEXT');
  };

  const beginRecording = async () => {
    if (!voiceConfigured) {
      push(t('chat.voiceNotConfigured'), 'info');
      return;
    }
    try {
      const { handle } = await startRecording();
      setRecorder(handle);
      setRecording(true);
    } catch {
      push(t('chat.micDenied'), 'error');
    }
  };

  const stopRecording = async () => {
    if (!recorder) return;
    setRecording(false);
    try {
      const blob = await recorder.stop();
      setRecorder(null);
      setTranscribing(true);
      // null = let Sarvam detect the spoken language. Sending the UI locale
      // here would force Bengali speech through an English model when the
      // interface happens to be in English.
      const result = await api.speech.transcribe(blob, null);
      setTranscript(result.transcript);
      setPendingSource('VOICE');
      // Keep the detected language with the transcript so the reply and the
      // TTS voice match what the customer actually spoke. Fall back to the
      // selected language when detection gave nothing usable.
      // Keep the detected language with the transcript. When detection failed
      // we deliberately leave it null rather than assuming the interface
      // language, and the submit button stays blocked until the customer picks.
      setSpokenLanguage(result.detectedLanguage ?? null);
      setDetectionNote(
        result.detectedLanguage
          ? t('chat.detectedLanguage', {
              language: LANGUAGES.find((entry) => entry.code === result.detectedLanguage)?.native ?? '',
            })
          : t('chat.detectionUnclear'),
      );
    } catch (error) {
      push(error instanceof ApiError ? error.message : t('chat.playbackFailed'), 'error');
    } finally {
      setTranscribing(false);
    }
  };

  const submitFeedback = async (rating: number) => {
    // Use the refs so feedback works even if it is sent before a re-render.
    const activeConversationId = conversationRef.current ?? conversationId;
    if (!activeConversationId) return;
    try {
      await api.messages.feedback(activeConversationId, guestTokenRef.current, { rating });
      setFeedbackGiven(true);
      push(t('chat.feedbackThanks'), 'success');
    } catch {
      // Feedback is optional; ignore failures silently rather than blocking chat.
    }
  };

  return (
    <section className="card flex h-[70vh] min-h-[420px] flex-col lg:h-[600px]" aria-labelledby="chat-heading">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 id="chat-heading" className="text-base font-semibold text-ink">
            {t('chat.title', { business: businessName })}
          </h2>
          <p className="text-xs text-ink-muted">{t('chat.guestNote')}</p>
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {starting ? <p className="text-sm text-ink-muted">{t('common.loading')}</p> : null}

        {startError ? (
          <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">
            {startError}
            <button type="button" className="btn-ghost mt-2" onClick={() => void retryConversation()}>
              {t('common.retry')}
            </button>
          </div>
        ) : null}

        {!starting && messages.length === 0 && !startError ? (
          <p className="text-sm text-ink-muted">{t('chat.intro')}</p>
        ) : null}

        {messages.map((message) => {
          const isCustomer = message.role === 'CUSTOMER';
          return (
            <div key={message.id} className={`flex ${isCustomer ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                  isCustomer ? 'bg-brand-600 text-white' : 'bg-slate-100 text-ink'
                }`}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                {!isCustomer ? (
                  <button
                    type="button"
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white/70 px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-white"
                    onClick={() => void speak(message.content, message.language)}
                  >
                    <span aria-hidden="true">🔊</span>
                    {speaking ? t('chat.speaking') : t('chat.speakReply')}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}

        {sending ? (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Spinner className="text-brand-600" />
            {t('common.loading')}
          </div>
        ) : null}

        {notice ? (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="alert">
            {notice}
          </p>
        ) : null}

        {proposals.length > 0 ? (
          <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3">
            <p className="text-sm font-semibold text-brand-800">{t('chat.proposedItems')}</p>
            <ul className="mt-2 space-y-2">
              {proposals.map((proposal) => (
                <li key={proposal.productId} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink">
                    {proposal.productName} × {proposal.quantity}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary px-3 py-1.5 text-xs"
                    onClick={() => {
                      cart.add({
                        productId: proposal.productId,
                        name: proposal.productName,
                        unitPrice: proposal.unitPrice,
                        availability: proposal.availability,
                      }, proposal.quantity);
                      push(t('cart.itemCount', { count: cart.count + proposal.quantity }), 'success');
                    }}
                  >
                    {t('chat.addProposal')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {conversationId && messages.length >= 2 && !feedbackGiven ? (
          <div className="rounded-xl border border-slate-200 p-3">
            <p className="text-sm font-medium text-ink">{t('chat.feedbackPrompt')}</p>
            <StarRating value={0} size="sm" onChange={(rating) => void submitFeedback(rating)} />
          </div>
        ) : null}

        {feedbackGiven ? <p className="text-sm text-emerald-700">{t('chat.feedbackThanks')}</p> : null}

        <div ref={bottomRef} />
      </div>

      {transcript !== null ? (
        <div className="border-t border-slate-200 bg-slate-50 px-4 py-3">
          <label className="field-label" htmlFor="chat-transcript">
            {t('chat.transcriptReview')}
          </label>
          <textarea
            id="chat-transcript"
            className="input min-h-[72px]"
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
          />
          {detectionNote ? <p className="mt-1 text-xs text-ink-muted">{detectionNote}</p> : null}

          {/* The detected language is editable: if detection guessed wrong the
              customer can pick the language they actually spoke, which also
              chooses the reply language and the TTS voice. */}
          <div className="mt-2">
            <label className="field-label" htmlFor="chat-spoken-language">
              {t('chat.spokenLanguage')}
              {spokenLanguage === null ? (
                <span className="ml-1 text-red-600" aria-hidden="true">
                  *
                </span>
              ) : null}
            </label>
            <select
              id="chat-spoken-language"
              className="input w-auto py-2"
              value={spokenLanguage ?? ''}
              onChange={(event) => {
                const next = event.target.value;
                setSpokenLanguage(next ? (next as LanguageCode) : null);
              }}
            >
              <option value="">{t('chat.chooseLanguage')}</option>
              {LANGUAGES.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.native}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="btn-primary"
              // Detection failed and no language was chosen yet: sending would
              // mean guessing, so the customer must pick first.
              disabled={spokenLanguage === null}
              title={spokenLanguage === null ? t('chat.pickLanguageBeforeSending') : undefined}
              onClick={() => {
                const value = transcript.trim();
                if (!value) return;
                setPendingSource('VOICE');
                void send(value, 'VOICE');
              }}
            >
              {t('chat.useTranscript')}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setTranscript(null);
                setDetectionNote(null);
              }}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      <form className="border-t border-slate-200 p-3" onSubmit={handleSubmit}>
        <div className="flex items-end gap-2">
          <label className="sr-only" htmlFor="chat-input">
            {t('chat.placeholder')}
          </label>
          <textarea
            id="chat-input"
            className="input min-h-touch flex-1 resize-none py-2.5"
            rows={1}
            maxLength={2000}
            placeholder={t('chat.placeholder')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSubmit(event);
              }
            }}
          />
          <button
            type="button"
            className={recording ? 'btn-danger min-w-touch' : 'btn-secondary min-w-touch'}
            onClick={recording ? () => void stopRecording() : () => void beginRecording()}
            aria-label={recording ? t('chat.stopRecording') : t('chat.startRecording')}
            title={voiceConfigured ? undefined : t('chat.voiceNotConfigured')}
          >
            <span aria-hidden="true">{recording ? '⏹' : '🎤'}</span>
          </button>
          <button type="submit" className="btn-primary min-w-touch" disabled={sending || !draft.trim()}>
            {t('chat.send')}
          </button>
        </div>
        {/* Typed text in Latin letters cannot be reliably classified, so the
            customer can state the reply language explicitly. Script-detected
            Bengali/Hindi is preselected and shown here too. */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="text-xs text-ink-muted" htmlFor="chat-reply-language">
            {t('chat.replyLanguage')}
          </label>
          <select
            id="chat-reply-language"
            className="input w-auto py-1 text-xs"
            value={replyLanguageOverride ?? ''}
            onChange={(event) => {
              const next = event.target.value;
              setReplyLanguageOverride(next ? (next as LanguageCode) : null);
            }}
          >
            <option value="">
              {draftDetection.language
                ? t('chat.detectedFromScript', {
                    language:
                      LANGUAGES.find((entry) => entry.code === draftDetection.language)?.native ?? '',
                  })
                : t('chat.followInterfaceLanguage')}
            </option>
            {LANGUAGES.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.native}
              </option>
            ))}
          </select>
        </div>

        <p className="mt-2 text-xs text-ink-muted">
          {recording
            ? t('chat.recording')
            : transcribing
              ? t('chat.transcribing')
              : sending
                ? t('chat.waitingForReply')
                : pendingSource === 'VOICE'
                  ? t('chat.transcriptReview')
                  : t('business.paymentNote')}
        </p>
      </form>
    </section>
  );
}
