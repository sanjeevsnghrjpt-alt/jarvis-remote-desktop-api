const express = require('express');
const crypto  = require('crypto');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const sessions = new Map();

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Jarvis Remote Desktop API', uptime: process.uptime() });
});

app.get('/', (req, res) => {
  res.json({
    name:    'Jarvis Remote Desktop API',
    version: '1.0.0',
    tagline: 'Control It Your Way',
    routes: [
      'POST /pair              → Generate QR session',
      'POST /pair/:id/ready   → Desktop agent registers',
      'GET  /pair/:id/status  → Mobile polls for status',
      'POST /pair/:id/connected → Mobile confirms connected',
      'GET  /health           → Health check',
    ]
  });
});

app.post('/pair', (req, res) => {
  const sessionId = crypto.randomBytes(16).toString('hex');
  const secret    = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 5 * 60 * 1000;

  sessions.set(sessionId, {
    sessionId,
    secret,
    status:     'waiting',
    expiresAt,
    createdAt:  Date.now(),
    deviceInfo: null,
    rustdeskId: null,
  });

  setTimeout(() => {
    const s = sessions.get(sessionId);
    if (s && s.status === 'waiting') s.status = 'expired';
  }, 5 * 60 * 1000);

  const qrData = `jarvisremote://connect?session=${sessionId}&secret=${secret}`;
  res.json({ sessionId, qrData, expiresAt });
});

app.post('/pair/:sessionId/ready', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session)                     return res.status(404).json({ error: 'Session not found' });
  if (session.status === 'expired') return res.status(410).json({ error: 'Session expired' });

  session.deviceInfo = req.body.deviceInfo || {};
  session.rustdeskId = req.body.rustdeskId || null;
  session.status     = 'ready';

  res.json({ ok: true });
});

app.get('/pair/:sessionId/status', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (Date.now() > session.expiresAt) session.status = 'expired';

  res.json({
    status:     session.status,
    rustdeskId: session.rustdeskId,
    deviceInfo: session.deviceInfo,
    expiresAt:  session.expiresAt,
  });
});

app.post('/pair/:sessionId/connected', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  session.status      = 'connected';
  session.connectedAt = Date.now();

  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`✓ Jarvis Remote Desktop API running on port ${PORT}`);
});
