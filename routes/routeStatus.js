// routes/machineStatusRoutes.js
const express = require('express');
const router = express.Router();
const machineStatusController = require('../controllers/machineStatusController');
const authenticateToken = require('../middleware/verifyToken');

router.get('/machine-status/:type', authenticateToken, machineStatusController.getMachineStatus);

module.exports = router;