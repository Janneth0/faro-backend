const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'falta token de autenticacion' });
    }

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        // payload trae: site_id, user_id, moodle_user_id
        req.faroUser = payload;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'token invalido o expirado' });
    }
}

module.exports = { requireAuth };
