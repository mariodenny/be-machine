const mongoose = require("mongoose");

const rentalSchema = new mongoose.Schema({
  machineId: { type: mongoose.Schema.Types.ObjectId, ref: "Machine", required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  status: { type: String, enum: ["Disetujui", "Ditolak", "Pending"], default: "Pending" },
  awal_peminjaman: Date,
  akhir_peminjaman: Date,
  isStarted: { type: Boolean, default: false },
  isActivated: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Rental", rentalSchema);