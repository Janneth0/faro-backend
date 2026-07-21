require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const eventsRoutes = require('./routes/events');

const app = express();

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());
app.use(cors({
    origin: allowedOrigins.includes('*') ? true : allowedOrigins,
}));
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/events', eventsRoutes);

app.use((err, req, res, next) => {
    console.error('[server] error no manejado', err);
    res.status(500).json({ error: 'error interno' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`[server] FARO backend escuchando en puerto ${port}`);
});
