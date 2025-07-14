const express = require("express");
const router = express.Router();
const sensorController = require("../../controllers/V2/sensorController");

console.log("✅ sensorController keys:", Object.keys(sensorController));

router.post("/sensors/:machineId", sensorController.saveSensorData);
router.patch("/sensors/:machineId/relay", sensorController.updateRelayStatus);
router.get("/sensors/:machineId/latest", sensorController.getLatestSensorData);

module.exports = router;
