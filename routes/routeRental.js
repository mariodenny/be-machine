const express = require("express");
const router = express.Router();

const rentalController = require("../controllers/rentalController");
const verifyToken = require("../middleware/verifyToken"); // Sama, kalau mau pakai auth

// CRUD Rental
router.post("/rentals", verifyToken, rentalController.createRental);
router.get("/rentals", verifyToken, rentalController.getRentals);
router.put("/rentals/:id", verifyToken, rentalController.updateRental);
router.delete("/rentals/:id", verifyToken, rentalController.deleteRental);

module.exports = router;
