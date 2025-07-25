const mongoose = require("mongoose");

const countSchema = new mongoose.Schema({
  machineId: { type: mongoose.Schema.Types.ObjectId, ref: "Machine" },
  disetujui: { type: Number, default: 0 },
  ditolak: { type: Number, default: 0 },
  menunggu: { type: Number, default: 0 },
  waktu: { type: Date, default: Date.now }
});

module.exports = mongoose.model("CountV2", countSchema);
