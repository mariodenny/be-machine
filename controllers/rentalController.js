const Rental = require("../models/rentalModel");

exports.createRental = async (req, res) => {
  try {
    const { machineId, userId, awal_peminjaman, akhir_peminjaman } = req.body;
    const rental = await Rental.create({ machineId, userId, awal_peminjaman, akhir_peminjaman });
    res.status(201).json({ success: true, data: rental });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getRentals = async (req, res) => {
  try {
    const rentals = await Rental.find().populate("machineId").populate("userId").sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: rentals });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateRental = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const rental = await Rental.findByIdAndUpdate(id, updates, { new: true });
    if (!rental) return res.status(404).json({ success: false, message: "Rental not found" });
    res.status(200).json({ success: true, data: rental });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteRental = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Rental.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ success: false, message: "Rental not found" });
    res.status(200).json({ success: true, message: "Rental deleted" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
