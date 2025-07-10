const mongoose = require("mongoose");

const machineSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, required: true }, // cnc, laser, printing
  description: { type: String },
  status: { type: String, enum: ["available", "maintenance", "inactive"], default: "available" },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Machine", machineSchema);