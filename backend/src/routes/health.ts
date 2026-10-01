import { Router } from 'express';
import { features } from '../config/env';

export function healthRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'dukaansaathi-api',
      time: new Date().toISOString(),
    });
  });

  // Reports which integrations have credentials. The frontend uses this to show
  // honest setup messages instead of pretending a feature works.
  router.get('/features', (_req, res) => {
    res.json({
      database: features.database(),
      supabaseAuth: features.supabaseAuth(),
      assistant: features.assistant(),
      speechToText: features.speechToText(),
      speechPlayback: features.speechToSpeech(),
      email: features.email(),
    });
  });

  return router;
}
