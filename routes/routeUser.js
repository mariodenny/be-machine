const express = require('express');
const { upload, peminjamanHandler, getPeminjamanAllHandler, getPeminjamanByIdHandler, extendPeminjamanHandler, checkPeminjamanStatus } = require('../controllers/userController');
const { getApprovedPeminjaman, getApprovedPeminjamanByDate } = require('../controllers/approvedPeminjamanController');
const { getAndUpdateCounts } = require('../controllers/countController');
const authenticate = require('../middleware/verifyToken');

const router = express.Router();

// Rute dinamis berdasarkan parameter 'type'
router.post('/:type/peminjaman', authenticate, upload.single('desain_benda'), peminjamanHandler);
router.get('/peminjamanAll', authenticate, getPeminjamanAllHandler);
router.get('/peminjaman/:peminjamanId', authenticate, getPeminjamanByIdHandler);

// Rute untuk calendar
router.get('/approved-peminjaman', authenticate, getApprovedPeminjaman);
router.get('/approved-peminjaman/:date', authenticate, getApprovedPeminjamanByDate);

// Rute untuk memperpanjang peminjaman
router.put('/peminjaman/:peminjamanId/extend', authenticate, extendPeminjamanHandler);

router.get('/check-peminjaman-status', authenticate, checkPeminjamanStatus);


// router.get('/counts', authenticate, getCounts);
router.get('/counts', authenticate, getAndUpdateCounts);

module.exports = router;
