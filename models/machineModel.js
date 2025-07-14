const mongoose = require("mongoose");

const machineSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, required: true },
  model: { type: String, required: true },
  description: { type: String },
  status: { type: String, enum: ["available", "maintenance", "inactive"], default: "available" },
  sensor: { type: String, default: "default_sensor_value" },
  esp_address: { type: String, default: "192.168.0.1" },
  imageUrl: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Machine", machineSchema);