const Machine = require("../models/machineModel");
const serverUrl = process.env.SERVER_URL || "http://localhost:5000";

// GET machine by id
exports.getMachineById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const machine = await Machine.findById(id);
    if (!machine) {
      return res.status(404).json({ success: false, message: "Machine not found" });
    }

    res.status(200).json({ success: true, data: machine });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// CREATE machine
exports.createMachine = async (req, res) => {
  try {
    const { name, type, model, description, sensor, esp_address } = req.body;
    if (!name || !type || !model) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    let imageUrl = "";
    if (req.file) {
      imageUrl = `${serverUrl}/uploads/${req.file.filename}`;
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

// GET all machines
exports.getMachines = async (req, res) => {
  try {
    const machines = await Machine.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: machines });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// UPDATE machine
exports.updateMachine = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (req.file) {
      updates.imageUrl = `${serverUrl}/uploads/${req.file.filename}`;
    }

    const machine = await Machine.findByIdAndUpdate(id, updates, { new: true });
    if (!machine) return res.status(404).json({ success: false, message: "Machine not found" });

    res.status(200).json({ success: true, data: machine });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// DELETE machine
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

// ✅ GET machine thresholds
exports.getMachineThresholds = async (req, res) => {
  try {
    const { machineId } = req.params;
    const machine = await Machine.findById(machineId);
    
    if (!machine) {
      return res.status(404).json({ success: false, message: "Machine not found" });
    }
    
    res.json({
      success: true,
      data: {
        thresholds: machine.sensorThresholds,
        realTimeStatus: machine.realTimeStatus
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ✅ UPDATE machine thresholds
exports.updateMachineThresholds = async (req, res) => {
  try {
    const { machineId } = req.params;
    const { caution, warning, autoShutdown } = req.body;

    const machine = await Machine.findByIdAndUpdate(
      machineId,
      {
        $set: {
          'sensorThresholds.caution': caution,
          'sensorThresholds.warning': warning,
          'sensorThresholds.autoShutdown': autoShutdown || false
        }
      },
      { new: true }
    );

    if (!machine) {
      return res.status(404).json({ success: false, message: "Machine not found" });
    }

    res.json({
      success: true,
      message: 'Threshold updated successfully',
      data: machine
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ✅ UPDATE real-time status (untuk MQTT/ESP update)
exports.updateRealTimeStatus = async (req, res) => {
  try {
    const { machineId } = req.params;
    const { sensorValue, status } = req.body;

    const machine = await Machine.findByIdAndUpdate(
      machineId,
      {
        $set: {
          'realTimeStatus.sensorValue': sensorValue,
          'realTimeStatus.status': status,
          'realTimeStatus.lastUpdate': new Date()
        }
      },
      { new: true }
    );

    if (!machine) {
      return res.status(404).json({ success: false, message: "Machine not found" });
    }

    res.json({
      success: true,
      message: 'Real-time status updated',
      data: machine.realTimeStatus
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ✅ GET real-time status
exports.getRealTimeStatus = async (req, res) => {
  try {
    const { machineId } = req.params;
    const machine = await Machine.findById(machineId);
    
    if (!machine) {
      return res.status(404).json({ success: false, message: "Machine not found" });
    }

    res.json({
      success: true,
      data: machine.realTimeStatus
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ✅ GET machines with real-time status (for dashboard)
exports.getMachinesWithStatus = async (req, res) => {
  try {
    const machines = await Machine.find().sort({ createdAt: -1 });
    
    const machinesWithStatus = machines.map(machine => ({
      _id: machine._id,
      name: machine.name,
      type: machine.type,
      status: machine.status,
      realTimeStatus: machine.realTimeStatus,
      sensorThresholds: machine.sensorThresholds,
      imageUrl: machine.imageUrl,
      lastUpdate: machine.realTimeStatus.lastUpdate
    }));

    res.status(200).json({ 
      success: true, 
      data: machinesWithStatus 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};