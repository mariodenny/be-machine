const express = require("express");
const router = express.Router();
const countController = require("../../controllers/V2/countController");
const verifyToken = require("../../middleware/verifyToken");

router.get("/", verifyToken, countController.getAllCounts);
router.get("/reports/:machineId", verifyToken, countController.getUsageReport)
router.get("/:machineId", verifyToken, countController.getCountByMachine);

module.exports = router;
