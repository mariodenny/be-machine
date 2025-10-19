const express = require("express");
const router = express.Router();

const rentalController = require("../controllers/rentalController");
const verifyToken = require("../middleware/verifyToken"); // Sama, kalau mau pakai auth

// CRUD Rental
router.post("/rentals", verifyToken, rentalController.createRental);
router.get("/rentals", verifyToken, rentalController.getRentals);
router.get("/rentals/status", verifyToken, rentalController.getRentalsByStatus);
router.put("/rentals/:id", verifyToken, rentalController.updateRental);
router.delete("/rentals/:id", verifyToken, rentalController.deleteRental);
router.patch("/rentals/:id/status", verifyToken, rentalController.updateRentalStatus);
router.patch("/rentals/:id/start", verifyToken, rentalController.startRental);
router.patch("/rentals/:id/end", verifyToken, rentalController.endRental);
router.get("/rentals/:id", verifyToken, rentalController.getRentalById);
router.get("/rentals/user/:userId", verifyToken, rentalController.getRentalByUserId)
router.get("/rentals/:id/extend", verifyToken, rentalController.extendRental)

// emergency shutdown
router.post('/rentals/:rentalId/emergency-shutdown', rentalController.emergencyShutdown);
module.exports = router;
