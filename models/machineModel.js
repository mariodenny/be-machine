const mongoose = require("mongoose");

const machineSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, required: true },
  description: { type: String },
  status: { type: String, enum: ["available", "maintenance", "inactive"], default: "available" },
  sensor: { type: String, required: true, default: "default_sensor_value" },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Machine", machineSchema);