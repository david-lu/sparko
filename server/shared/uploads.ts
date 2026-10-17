import type { RequestHandler } from 'express';
import multer from 'multer';
import { rm } from 'node:fs/promises';
import { receiveHosted } from '../hosting.js';

export function createUploadReceiver(uploadDir: string) {
  const upload = multer({ dest: uploadDir, limits: { fileSize: 256 * 1024 * 1024, files: 1, fields: 12, fieldSize: 24 * 1024 * 1024 } });
  const receive = (field: string): RequestHandler[] => [
    // Install cleanup before Multer so aborted requests and parsing failures also clean up.
    ((req, res, next) => {
      const clean = () => { if (req.file) void rm(req.file.path, { force: true }).catch(() => undefined); };
      res.once('finish', clean);
      res.once('close', clean);
      next();
    }) as RequestHandler,
    upload.single(field),
    receiveHosted(uploadDir, field),
  ];
  return receive;
}

export type UploadReceiver = ReturnType<typeof createUploadReceiver>;
