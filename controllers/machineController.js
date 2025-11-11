const Machine = require("../models/machineModel");
const Rental = require("../models/rentalModel")
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
    const { name, type, model, description, sensor } = req.body;
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

exports.getRealTimeStatus = async (req, res) => {
  try {
    const { machineId } = req.params;
    const { sensorType } = req.query; // Optional: filter by sensor type

    const machine = await Machine.findById(machineId);
    
    if (!machine) {
      return res.status(404).json({ success: false, message: "Machine not found" });
    }

    // If specific sensor type requested
    if (sensorType) {
      const sensorEntry = Array.from(machine.realTimeStatus.entries())
        .find(([key, value]) => value.sensorType === sensorType);
      
      if (!sensorEntry) {
        return res.status(404).json({ 
          success: false, 
          message: `Sensor type ${sensorType} not found` 
        });
      }

      const [sensorId, sensorData] = sensorEntry;
      const response = {
        success: true,
        data: {
          sensorValue: sensorData.sensorValue,
          status: sensorData.status,
          lastUpdate: sensorData.lastUpdate,
          sensorType: sensorData.sensorType,
          unit: sensorData.unit,
          displayConfig: getWidgetDisplayConfig(sensorData.sensorType),
          sensorId: sensorId
        }
      };

      return res.json(response);
    }

    // Return all sensors data
    const sensorsData = Array.from(machine.realTimeStatus.entries()).map(([sensorId, sensorData]) => ({
      sensorId,
      sensorValue: sensorData.sensorValue,
      status: sensorData.status,
      lastUpdate: sensorData.lastUpdate,
      sensorType: sensorData.sensorType,
      unit: sensorData.unit,
      displayConfig: getWidgetDisplayConfig(sensorData.sensorType)
    }));

    const response = {
      success: true,
      data: sensorsData,
      globalStatus: machine.globalStatus,
      relayState: machine.relayState,
      buzzerState: machine.buzzerState
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// New endpoint to update sensor data from ESP32
exports.updateRealTimeStatus = async (req, res) => {
  try {
    const { machineId } = req.params;
    const { sensorId, sensorValue, sensorType, unit, status, relayState, buzzerState } = req.body;

    const machine = await Machine.findById(machineId);
    if (!machine) {
      return res.status(404).json({ success: false, message: "Machine not found" });
    }

    // Update sensor data
    machine.updateSensorStatus(sensorId, {
      sensorValue,
      sensorType,
      unit,
      status: status || 'normal'
    });

    // Update relay and buzzer state if provided
    if (relayState !== undefined) machine.relayState = relayState;
    if (buzzerState !== undefined) machine.buzzerState = buzzerState;

    await machine.save();

    // Emit real-time update via Socket.io if available
    if (req.app.get('socketio')) {
      req.app.get('socketio').emit(`machine-${machineId}-update`, {
        sensorId,
        sensorValue,
        sensorType,
        status: status || 'normal',
        unit,
        relayState: machine.relayState,
        buzzerState: machine.buzzerState,
        globalStatus: machine.globalStatus,
        timestamp: new Date()
      });
    }

    res.json({ 
      success: true, 
      message: "Sensor data updated",
      globalStatus: machine.globalStatus
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Helper function untuk display config
function getWidgetDisplayConfig(sensorType) {
  const configs = {
    'suhu': {
      icon: '🌡️',
      title: 'Suhu',
      color: '#FF6B6B',
      gradient: ['#FF6B6B', '#FF8E8E'],
      minValue: 0,
      maxValue: 100,
      formatValue: (value) => `${value}°C`
    },
    'kelembaban': {
      icon: '💧', 
      title: 'Kelembaban',
      color: '#4FC3F7',
      gradient: ['#4FC3F7', '#81D4FA'],
      minValue: 0,
      maxValue: 100,
      formatValue: (value) => `${value}%`
    },
    'tekanan': {
      icon: '🔧',
      title: 'Tekanan',
      color: '#FFD54F',
      gradient: ['#FFD54F', '#FFE082'],
      minValue: 0,
      maxValue: 10,
      formatValue: (value) => `${value} bar`
    },
    'getaran': {
      icon: '📳',
      title: 'Getaran',
      color: '#BA68C8',
      gradient: ['#BA68C8', '#CE93D8'],
      minValue: 0,
      maxValue: 10,
      formatValue: (value) => `${value} mm/s`
    },
    'vibration': {
      icon: '📳',
      title: 'Getaran',
      color: '#BA68C8',
      gradient: ['#BA68C8', '#CE93D8'],
      minValue: 0,
      maxValue: 10,
      formatValue: (value) => `${value} mm/s`
    },
    'thermocouple': {
      icon: '🔥',
      title: 'Thermocouple',
      color: '#FF5722',
      gradient: ['#FF5722', '#FF8A65'],
      minValue: 0,
      maxValue: 1000,
      formatValue: (value) => `${value}°C`
    },
    'current': {
      icon: '⚡',
      title: 'Arus',
      color: '#FFC107',
      gradient: ['#FFC107', '#FFD54F'],
      minValue: 0,
      maxValue: 100,
      formatValue: (value) => `${value}A`
    }
  };

  return configs[sensorType] || configs['suhu'];
}

function getUnit(sensorType) {
  const units = {
    'suhu': '°C',
    'kelembaban': '%',
    'tekanan': 'bar',
    'getaran': 'mm/s'
  };
  return units[sensorType] || '';
}

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