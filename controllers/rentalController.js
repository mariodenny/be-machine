const Rental = require("../models/rentalModel");
const countController = require('./V2/countController')

exports.createRental = async (req, res) => {
  try {
    const { machineId, userId, awal_peminjaman, akhir_peminjaman } = req.body;
    const rental = await Rental.create({ machineId, userId, awal_peminjaman, akhir_peminjaman });
    await countController.updateRentalCount();
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

exports.getRentalsByStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: "Status is required" });
    }

    const rentals = await Rental.find({ status })
      .populate("machineId")
      .populate("userId")
      .sort({ createdAt: -1 });

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

exports.updateRentalStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const allowedStatuses = ["Disetujui", "Ditolak", "Pending"];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid status value" });
  }

  try {
    const rental = await Rental.findByIdAndUpdate(
      id,
      { status: status },
      { new: true }
    ).populate("machineId").populate("userId");

    if (!rental) {
      return res.status(404).json({ success: false, message: "Rental not found" });
    }
    await countController.updateRentalCount();

    res.status(200).json({ success: true, data: rental });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

