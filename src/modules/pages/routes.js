/**
 * HTML page routes. MUST be registered last: the catch-all redirect at the
 * bottom shadows anything not already matched.
 *
 * Legacy note: express.static is mounted before these (see app.js), so
 * GET / serves public/index.html and GET /menu.html is served by static —
 * the sendFile/redirect routes below are effectively dead for those two
 * paths. Preserved as-is for behaviour parity.
 */
const express = require('express');
const path = require('path');

const router = express.Router();
const PUBLIC = path.join(__dirname, '..', '..', '..', 'public');

router.get('/staff', (req, res) => res.redirect('/admin'));
router.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));
router.get('/menu.html', (req, res) => res.sendFile(path.join(PUBLIC, 'menu.html')));
router.get('/', (req, res) => res.redirect('/menu.html?table=1'));
router.get('*', (req, res) => res.redirect('/menu.html'));

module.exports = router;
