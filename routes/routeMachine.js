const express = require("express");
const router = express.Router();

const machineController = require("../controllers/machineController");
const verifyToken = require("../middleware/verifyToken"); // Kalau perlu auth
const upload = require("../middleware/upload")


// CRUD Machine
router.post("/machines", upload.single("image"), verifyToken, machineController.createMachine);
router.get("/machines", machineController.getMachines);
router.put("/machines/:id", upload.single("image"), verifyToken, machineController.updateMachine);
router.delete("/machines/:id", verifyToken, machineController.deleteMachine);
router.get("/machine/:id",verifyToken,machineController.getMachineById)

//new routes for live
router.get("/:machineId/thresholds", machineController.getMachineThresholds);
router.put("/:machineId/thresholds", machineController.updateMachineThresholds);
router.get("/machine/:machineId/real-time-status", machineController.getRealTimeStatus);
router.put("/machine/:machineId/real-time-status", machineController.updateRealTimeStatus);

// new routes for update esp address to machine
router.post("/:machineId/esp", machineController.updateEspMachineAddress)

module.exports = router;
