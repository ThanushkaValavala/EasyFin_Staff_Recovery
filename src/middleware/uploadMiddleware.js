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

module.exports = upload;