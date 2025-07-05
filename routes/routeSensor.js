const express = require('express');
const sensorController = require('../controllers/sensorController');

const router = express.Router();

// router.use((req, res, next) => {
//     console.log('--------------------------------');
//     console.log('Sensor route accessed:');
//     console.log('Full URL:', req.originalUrl);
//     console.log('Path:', req.path);
//     console.log('Params:', req.params);
//     console.log('Headers:', req.headers);
//     console.log('--------------------------------');
//     next();
// });

// Route untuk peminjaman
router.post('/startRental', sensorController.startRental);

// Route untuk sensor dan peminjaman button
router.post('/:type/buttonPeminjaman', sensorController.buttonPeminjaman);

router.get('/:type/buttonPeminjaman', sensorController.getLatestData);

// Route untuk arus listrik
router.post('/:type/updateCurrent', sensorController.updateCurrent);

router.get('/:type/current', sensorController.getLatestCurrent);

module.exports = router;
