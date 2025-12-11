const express = require("express");
const router = express.Router();

const rentalController = require("../controllers/rentalController");
const verifyToken = require("../middleware/verifyToken"); // Sama, kalau mau pakai auth

// CRUD Rental
router.post("/rentals", rentalController.createRental);
router.get("/rentals", rentalController.getRentals);
router.get("/rentals/status", rentalController.getRentalsByStatus);
router.put("/rentals/:id", rentalController.updateRental);
router.delete("/rentals/:id", rentalController.deleteRental);
router.patch("/rentals/:id/status", rentalController.updateRentalStatus);
router.patch("/rentals/:id/start", rentalController.startRental);
router.patch("/rentals/:id/end", rentalController.endRental);
router.get("/rentals/:id", rentalController.getRentalById);
router.get("/rentals/user/:userId", rentalController.getRentalByUserId)
router.post("/rentals/:id/extend", rentalController.extendRental)

// emergency shutdown
router.post('/rentals/:rentalId/emergency-shutdown', rentalController.emergencyShutdown);

// new rental data for monitoring
router.get('/machine/:machineId/history', rentalController.getRentalHistoryByMachine);
router.get('/machine/:machineId/statistics', rentalController.getRentalStatisticsByMachine);

module.exports = router;
