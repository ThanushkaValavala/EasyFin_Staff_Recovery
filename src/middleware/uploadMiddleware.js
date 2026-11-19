const multer = require('multer');

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  cb(new Error('Only JPEG, PNG, and WebP images are allowed.'), false);
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter
});

// Same as upload.single(field) but answers with a clear JSON error.
upload.safeSingle = (field) => (req, res, next) =>
  upload.single(field)(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Photo is too large (max 10 MB).' : err.message;
    return res.status(400).json({ success: false, message });
  });

// Multi-field safe upload (e.g. startPhoto + endPhoto for sync)
upload.safeFields = (fields) => (req, res, next) =>
  upload.fields(fields)(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Photo is too large (max 10 MB).' : err.message;
    return res.status(400).json({ success: false, message });
  });

// Second multer instance that also accepts an optional voice file
const uploadWithVoice = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB overall; individual file checked in middleware
  fileFilter(req, file, cb) {
    if (file.fieldname === 'voice') {
      // audio only, max 5 MB enforced below
      if (!file.mimetype.startsWith('audio/')) {
        return cb(new Error('Voice file must be an audio file.'), false);
      }
      return cb(null, true);
    }
    // photo fields
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPEG, PNG, and WebP images are allowed.'), false);
  }
});

upload.safeFieldsWithVoice = (fields) => (req, res, next) =>
  uploadWithVoice.fields(fields)(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large.' : err.message;
      return res.status(400).json({ success: false, message });
    }
    // Check voice file size (max 5 MB)
    const voiceFile = req.files && req.files.voice && req.files.voice[0];
    if (voiceFile && voiceFile.size > 5 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Voice file is too large (max 5 MB).' });
    }
    next();
  });

upload.safeFinishWithVoice = () => (req, res, next) =>
  uploadWithVoice.fields([
    { name: 'endPhoto', maxCount: 1 },
    { name: 'voice', maxCount: 1 }
  ])(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large.' : err.message;
      return res.status(400).json({ success: false, message });
    }
    const voiceFile = req.files && req.files.voice && req.files.voice[0];
    if (voiceFile && voiceFile.size > 5 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Voice file is too large (max 5 MB).' });
    }
    // For backward compat: req.file = endPhoto if present
    if (req.files && req.files.endPhoto && req.files.endPhoto[0]) {
      req.file = req.files.endPhoto[0];
    }
    next();
  });

upload.safeStartWithVoice = () => (req, res, next) =>
  uploadWithVoice.fields([
    { name: 'startPhoto', maxCount: 1 },
    { name: 'voice', maxCount: 1 }
  ])(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large.' : err.message;
      return res.status(400).json({ success: false, message });
    }
    const voiceFile = req.files && req.files.voice && req.files.voice[0];
    if (voiceFile && voiceFile.size > 5 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Voice file is too large (max 5 MB).' });
    }
    if (req.files && req.files.startPhoto && req.files.startPhoto[0]) {
      req.file = req.files.startPhoto[0];
    }
    next();
  });

module.exports = upload;