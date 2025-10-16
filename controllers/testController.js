const Machine = require("../models/machineModel");
const mqttHelper = require('../mqtt/mqttHelper')

exports.testMQTTConnection = async (req, res) => {
  try {
    const { machineId } = req.params;
    
    const machine = await Machine.findById(machineId);
    if (!machine) {
      return res.status(404).json({
        success: false,
        message: "Machine not found"
      });
    }

    const health = mqttHelper.isHealthy();
    const rentalStatus = mqttHelper.getRentalStatus(machineId);
    
    res.json({
      success: true,
      data: {
        machine: {
          id: machine._id,
          name: machine.name,
          esp_address: machine.esp_address
        },
        mqttBroker: health,
        machineRental: rentalStatus,
        suggestedTopic: `machine/${machine.esp_address}/config`,
        timestamp: new Date()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};