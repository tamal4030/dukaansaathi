import multer from 'multer';
import { badRequest } from '../lib/errors';

const ALLOWED_EXTENSIONS = ['.csv', '.xlsx'];
const ALLOWED_MIME = [
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
];

export const uploadSpreadsheet = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const lower = file.originalname.toLowerCase();
    const extensionOk = ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension));
    const mimeOk = ALLOWED_MIME.includes(file.mimetype);
    if (!extensionOk || !mimeOk) {
      cb(badRequest('Upload a .xlsx or .csv file exported from the DukaanSaathi template.'));
      return;
    }
    cb(null, true);
  },
}).single('file');

export const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('audio/') && !file.mimetype.startsWith('video/')) {
      cb(badRequest('Record audio in the browser before sending it for transcription.'));
      return;
    }
    cb(null, true);
  },
}).single('audio');
