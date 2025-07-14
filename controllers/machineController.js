const Machine = require("../models/machineModel");

exports.createMachine = async (req, res) => {
  try {
    const { name, type, model, description, sensor, esp_address } = req.body;
    if (!name || !type || !model) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    let imageUrl = "";
    if (req.file) {
      imageUrl = `../uploads/${req.file.filename}`;
    }

    const machine = await Machine.create({
      name,
      type,
      model,
      description,
      sensor,
      esp_address,
      imageUrl
    });

    res.status(201).json({ success: true, data: machine });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getMachines = async (req, res) => {
  try {
    const machines = await Machine.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: machines });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateMachine = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (req.file) {
      updates.imageUrl = `../uploads/${req.file.filename}`;
    }

    const machine = await Machine.findByIdAndUpdate(id, updates, { new: true });
    if (!machine) return res.status(404).json({ success: false, message: "Machine not found" });

    res.status(200).json({ success: true, data: machine });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};


exports.deleteMachine = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Machine.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ success: false, message: "Machine not found" });
    res.status(200).json({ success: true, message: "Machine deleted" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
