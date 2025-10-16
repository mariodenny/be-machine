const express = require('express');
const router = express.Router();
const testController = require('../controllers/testController')

router.get('/test/:machineId/mqtt',testController.testMQTTConnection)

module.exports = router;
