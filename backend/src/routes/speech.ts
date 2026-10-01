import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error';
import { speechLimiter } from '../middleware/rateLimit';
import { uploadAudio } from '../middleware/upload';
import { badRequest } from '../lib/errors';
import { parseBody } from '../lib/validate';
import { features, missingEnvFor } from '../config/env';
import { normalizeSarvamLanguage, sarvamLanguageCode } from '../services/sarvam';
import type { AppDeps } from '../app';
import type { createAuthMiddleware } from '../middleware/auth';

type Auth = ReturnType<typeof createAuthMiddleware>;

/**
 * Maximum characters sent to Sarvam TTS in one request.
 *
 * Sarvam Bulbul v3 documents a 2500-character limit per input, so 2400 keeps a
 * deliberate margin below it. A long Bengali or Hindi answer that previously
 * tripped the old 800-character ceiling now goes through in one request.
 *
 * Note: raising this limit does NOT fix every playback failure. A 569-character
 * Bengali reply was already below the old 800 limit, so its failure came from
 * somewhere else (most likely the browser refusing to autoplay). See
 * frontend/src/lib/speech.ts.
 */
const MAX_TTS_CHARS = 2400;

const speakSchema = z.object({
  text: z.string().trim().min(1, 'There is nothing to read out.').max(MAX_TTS_CHARS),
  language: z.enum(['en', 'bn', 'hi']).optional(),
});

const transcribeSchema = z.object({
  language: z.enum(['en', 'bn', 'hi']).optional(),
});

export function speechRouter(deps: AppDeps, _auth: Auth): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      speechToText: features.speechToText(),
      speechPlayback: features.speechToSpeech(),
      missing: {
        stt: missingEnvFor('speechToText'),
        tts: missingEnvFor('speechToSpeech'),
      },
      note: 'English playback uses the browser voice (speechSynthesis). Bengali and Hindi playback use Sarvam TTS.',
    });
  });

  /**
   * Voice input: the browser records, the backend forwards to Sarvam STT.
   * Transcripts come back in the spoken language - never translated to English.
   */
  router.post(
    '/transcribe',
    speechLimiter,
    uploadAudio,
    asyncHandler(async (req, res) => {
      const file = req.file;
      if (!file) throw badRequest('No audio was received. Record a message first.');
      const body = parseBody(transcribeSchema, req.body);
      // Automatic detection by default. The customer's UI language is NOT sent
      // as the spoken language: someone browsing in English may speak Bengali,
      // and forcing en-IN would transcribe their speech wrongly.
      const languageCode = sarvamLanguageCode(body.language ?? null);

      const result = await deps.speech.transcribe(file.buffer, {
        filename: file.originalname || 'recording.webm',
        mimetype: file.mimetype || 'audio/webm',
        languageCode,
      });

      if (!result.transcript) {
        res.status(422).json({
          error: {
            code: 'EMPTY_TRANSCRIPT',
            message: 'We could not hear anything in that recording. Please try again or type your question.',
          },
        });
        return;
      }

      // `languageCode` is what the provider reported; `detectedLanguage` is the
      // same value normalised to the app's LanguageCode, or null when the
      // provider gave nothing we recognise. The frontend keeps the transcript
      // together with this value and sends it back as the conversation
      // language, so the reply and the spoken answer use the language the
      // customer actually spoke.
      const detected = normalizeSarvamLanguage(result.languageCode);
      res.json({
        transcript: result.transcript,
        languageCode: result.languageCode ?? languageCode,
        detectedLanguage: detected,
        // Confidence when the provider reports it, otherwise null. The UI uses
        // this only to decide whether to ask the customer to confirm.
        languageProbability: result.languageProbability,
        mode: result.mode,
        requestedLanguage: body.language ?? null,
        // True when we asked for automatic detection rather than a fixed
        // language, so the client can explain the fallback accurately.
        autoDetected: body.language === undefined || body.language === null,
      });
    }),
  );

  /** Bengali/Hindi playback through Sarvam TTS. The text answer stays visible. */
  router.post(
    '/speak',
    speechLimiter,
    asyncHandler(async (req, res) => {
      const body = parseBody(speakSchema, req.body);
      if (!body.language || body.language === 'en') {
        res.status(400).json({
          error: {
            code: 'USE_BROWSER_VOICE',
            message: 'English replies are spoken with your browser voice. Bengali and Hindi use the speech service.',
          },
        });
        return;
      }
      const result = await deps.speech.synthesize(body.text, { languageCode: sarvamLanguageCode(body.language) });
      res.json({ audioBase64: result.audioBase64, mimeType: result.mimeType, language: body.language });
    }),
  );

  return router;
}
