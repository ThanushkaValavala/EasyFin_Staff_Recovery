const { v4: uuidv4 } = require('uuid');
const Evidence = require('../models/Evidence');
const { getIsConnected } = require('../config/db');

exports.uploadEvidence = async (req, res) => {
  try {
    if (!getIsConnected()) {
      return res.status(503).json({ success: false, message: 'Database is not connected.' });
    }
    const { sessionId } = req.params;
    const staffId = req.staff._id.toString();
    const { caption, latitude, longitude } = req.body;
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No photo evidence file received.' });
    }
    const evidenceId = `EVID-${Date.now()}-${uuidv4().substring(0, 6)}`;
    const evidence = await Evidence.create({
      evidenceId, sessionId, staffId, kind: 'EVIDENCE',
      fileName: `evidence-${evidenceId}.jpg`,
      originalName: req.file.originalname || 'photo.jpg',
      filePath: `/api/v1/recovery/evidence/${evidenceId}/image`,
      fileSize: req.file.size, mimeType: req.file.mimetype,
      caption: caption || 'Recovery visit supporting evidence',
      latitude: Number(latitude) || 0, longitude: Number(longitude) || 0,
      data: req.file.buffer
    });
    return res.status(201).json({ success: true, message: 'Evidence photo saved.', evidence });
  } catch (error) {
    console.error('Evidence upload error:', error.message);
    return res.status(500).json({ success: false, message: 'Could not save the photo. Please try again.' });
  }
};

exports.getSessionEvidence = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const staffId = req.staff._id.toString();
    const evidences = await Evidence.find({ sessionId, staffId }).sort({ capturedAt: -1 });
    return res.status(200).json({ success: true, count: evidences.length, evidences });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to retrieve session evidence.' });
  }
};

exports.getEvidenceImage = async (req, res) => {
  try {
    const ev = await Evidence.findOne({ evidenceId: req.params.evidenceId }).select('+data');
    if (!ev || !ev.data) return res.status(404).json({ success: false, message: 'Image not found.' });
    const isOwner = ev.staffId.toString() === req.staff._id.toString();
    if (!isOwner && !['admin', 'recovery_supervisor'].includes(req.staff.role)) {
      return res.status(403).json({ success: false, message: 'Not allowed to view this image.' });
    }
    res.set('Content-Type', ev.mimeType || 'image/jpeg');
    return res.send(ev.data);
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Could not load the image.' });
  }
};