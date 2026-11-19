// src/controllers/placesController.js
const https = require('https');

// Per-agent rate limiting: ~1 req/sec
const lastRequestTime = new Map();
const RATE_LIMIT_MS = 1000;

function photonSearch(query) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(query);
    // India bias: lat=20.5937, lon=78.9629
    const options = {
      hostname: 'photon.komoot.io',
      path: `/api/?q=${encoded}&limit=5&lang=en&lat=20.5937&lon=78.9629`,
      method: 'GET',
      headers: {
        'User-Agent': 'EasyFinRecoveryApp/1.0'
      },
      timeout: 5000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON from Photon'));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Photon request timed out'));
    });

    req.on('error', reject);
    req.end();
  });
}

function photonReverse(lat, lon) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'photon.komoot.io',
      path: `/reverse?lat=${lat}&lon=${lon}&lang=en`,
      method: 'GET',
      headers: {
        'User-Agent': 'EasyFinRecoveryApp/1.0'
      },
      timeout: 5000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON from Photon'));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Photon reverse request timed out'));
    });

    req.on('error', reject);
    req.end();
  });
}

function formatFeature(feature) {
  const p = feature.properties || {};
  const coords = feature.geometry && feature.geometry.coordinates;
  const longitude = coords ? coords[0] : null;
  const latitude = coords ? coords[1] : null;

  const parts = [p.name, p.street, p.city, p.state, p.country].filter(Boolean);
  const displayName = parts.join(', ');

  return {
    name: p.name || p.city || displayName,
    displayName,
    latitude,
    longitude,
    city: p.city || '',
    state: p.state || '',
    country: p.country || '',
    type: p.type || p.osm_type || ''
  };
}

// GET /recovery/places/search?q=...
exports.searchPlaces = async (req, res) => {
  try {
    const agentId = (req.agent && req.agent._id) || (req.staff && req.staff._id);
    const agentKey = agentId ? agentId.toString() : req.ip;

    // Per-agent rate limit
    const now = Date.now();
    const last = lastRequestTime.get(agentKey) || 0;
    if (now - last < RATE_LIMIT_MS) {
      return res.status(429).json({ success: false, message: 'Too many requests. Please wait a moment.' });
    }
    lastRequestTime.set(agentKey, now);

    const query = String(req.query.q || '').trim();
    if (!query || query.length < 3) {
      return res.status(400).json({ success: false, message: 'Query must be at least 3 characters.' });
    }
    if (query.length > 200) {
      return res.status(400).json({ success: false, message: 'Query too long.' });
    }

    const data = await photonSearch(query);
    const features = (data.features || []).slice(0, 5);
    const results = features.map(formatFeature);

    return res.status(200).json({ success: true, results });
  } catch (error) {
    console.error('searchPlaces error:', error.message);
    return res.status(502).json({ success: false, message: 'Places search unavailable. Please try again.' });
  }
};

// GET /recovery/places/reverse?lat=...&lon=...
exports.reverseGeocode = async (req, res) => {
  try {
    const agentId = (req.agent && req.agent._id) || (req.staff && req.staff._id);
    const agentKey = agentId ? agentId.toString() : req.ip;

    // Per-agent rate limit
    const now = Date.now();
    const last = lastRequestTime.get(agentKey) || 0;
    if (now - last < RATE_LIMIT_MS) {
      return res.status(429).json({ success: false, message: 'Too many requests. Please wait a moment.' });
    }
    lastRequestTime.set(agentKey, now);

    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ success: false, message: 'Invalid lat/lon.' });
    }

    const data = await photonReverse(lat, lon);
    const features = (data.features || []).slice(0, 1);
    const results = features.map(formatFeature);

    return res.status(200).json({ success: true, results });
  } catch (error) {
    console.error('reverseGeocode error:', error.message);
    return res.status(502).json({ success: false, message: 'Reverse geocoding unavailable. Please try again.' });
  }
};
