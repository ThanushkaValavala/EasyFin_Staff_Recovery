/**
 * Offline storage for recovery sessions.
 * Pending sessions are stored in SecureStore and synced to the backend
 * when connectivity is restored.
 *
 * For Bike/Car sessions, the ending speedometer photo URI is preserved
 * locally and uploaded during sync before the session is marked synced.
 */
import * as SecureStore from 'expo-secure-store';
import { apiPost, apiUploadFile } from '../api';

const PENDING_KEY = 'pending_recovery_sessions';
const HISTORY_CACHE_KEY = 'cached_recovery_history';

// ── Read / write pending list ────────────────────────────────────────────────

async function readPending() {
  try {
    const raw = await SecureStore.getItemAsync(PENDING_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('[offlineStore] readPending error:', e.message);
    return [];
  }
}

async function writePending(list) {
  try {
    await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('[offlineStore] writePending error:', e.message);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Save a completed session locally (pending sync).
 * For Bike/Car sessions, pass endPhotoUri so it can be uploaded during sync.
 */
export async function savePendingSession(session) {
  const list = await readPending();
  // Avoid duplicates by deviceSessionId
  const exists = list.some((s) => s.deviceSessionId === session.deviceSessionId);
  if (!exists) {
    list.push({ ...session, _syncStatus: 'PENDING' });
    await writePending(list);
    console.log('[offlineStore] Saved pending session:', session.deviceSessionId,
      'endPhotoUri:', session.endPhotoUri ? 'present' : 'none');
  }
}

/**
 * Return all locally stored pending sessions.
 */
export async function getPendingSessions() {
  return readPending();
}

/**
 * Attempt to sync all pending sessions to the backend.
 *
 * For WALK sessions: POST /recovery/sync (JSON, no photo).
 * For Bike/Car sessions WITH endPhotoUri:
 *   - If the session already exists on the backend (it was started online),
 *     use POST /recovery/sessions/:sessionId/finish (multipart with endPhoto).
 *   - If the session was entirely offline (no backend sessionId yet),
 *     use POST /recovery/sync (JSON metadata only, photo lost — noted as limitation).
 *
 * Each session is only removed from the local list after the backend confirms success.
 * Returns { synced, failed } counts.
 */
export async function syncPendingSessions() {
  const list = await readPending();
  if (!list.length) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;
  const remaining = [];

  for (const session of list) {
    try {
      const isWalk = (session.vehicleType || '').toUpperCase() === 'WALK';
      const hasEndPhoto = !isWalk && !!session.endPhotoUri;

      // A session started online has a real backend sessionId (SESS-... format).
      // A session that was never sent to the backend at all would use the deviceSessionId.
      const hasBackendSession = session.sessionId && session.sessionId !== session.deviceSessionId;

      if (hasEndPhoto && hasBackendSession) {
        // Bike/Car session: the session exists on the backend (start succeeded),
        // but finish failed. Upload end photo via the existing finish endpoint.
        console.log('[offlineStore] Syncing Bike/Car session with end photo:', session.sessionId);

        const end = session.endLocation || {};
        await apiUploadFile(
          '/recovery/sessions/' + session.sessionId + '/finish',
          {
            remarks: session.remarks || session.rawRemarks || '',
            distanceMeters: String(Math.round(session.distanceMeters || 0)),
            durationSeconds: String(Math.round(session.durationSeconds || 0)),
            endLocation: JSON.stringify({
              latitude: end.latitude || 0,
              longitude: end.longitude || 0,
              accuracy: end.accuracy || 0,
            }),
          },
          'endPhoto',
          session.endPhotoUri
        );

        console.log('[offlineStore] End photo uploaded and session finished:', session.sessionId);
        synced++;
        // Do NOT push to remaining — confirmed synced
      } else {
        // Walk session, or Bike/Car without a saved photo (or without backend session):
        // fall back to the metadata-only sync endpoint.
        if (hasEndPhoto && !hasBackendSession) {
          console.warn('[offlineStore] Bike/Car session has no backend sessionId — '
            + 'syncing metadata only, end photo cannot be uploaded:', session.deviceSessionId);
        }

        // Idempotency: backend checks deviceSessionId and returns alreadySynced if duplicate
        await apiPost('/recovery/sync', session);
        console.log('[offlineStore] Metadata sync success:', session.deviceSessionId);
        synced++;
      }
    } catch (e) {
      console.warn('[offlineStore] sync failed for', session.deviceSessionId, '—', e.message);
      failed++;
      remaining.push(session);
      // endPhotoUri is still in session — it will be retried next time
    }
  }

  await writePending(remaining);
  return { synced, failed };
}

// ── History cache (fallback when backend is unreachable) ─────────────────────

export async function cacheHistory(sessions) {
  try {
    await SecureStore.setItemAsync(HISTORY_CACHE_KEY, JSON.stringify(sessions));
  } catch (e) {
    console.warn('[offlineStore] cacheHistory error:', e.message);
  }
}

export async function getCachedHistory() {
  try {
    const raw = await SecureStore.getItemAsync(HISTORY_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('[offlineStore] getCachedHistory error:', e.message);
    return [];
  }
}
