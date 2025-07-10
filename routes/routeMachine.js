const express = require("express");
const router = express.Router();

const machineController = require("../controllers/machineController");
const verifyToken = require("../middleware/verifyToken"); // Kalau perlu auth

// CRUD Machine
router.post("/machines", verifyToken, machineController.createMachine);
router.get("/machines", verifyToken, machineController.getMachines);
router.put("/machines/:id", verifyToken, machineController.updateMachine);
router.delete("/machines/:id", verifyToken, machineController.deleteMachine);

module.exports = router;
