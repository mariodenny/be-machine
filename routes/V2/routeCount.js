const express = require("express");
const router = express.Router();
const countController = require("../../controllers/V2/countController");
const verifyToken = require("../../middleware/verifyToken");

router.get("/counts", verifyToken, countController.getAllCounts);
router.get("/reports", verifyToken, countController.getUsageReport)

module.exports = router;
