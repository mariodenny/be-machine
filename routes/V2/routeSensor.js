const express = require("express");
const router = express.Router();
const sensorController = require("../../controllers/V2/sensorController");
const { sendMachineConfig, sendMachineCommand } = require("../../mqtt/mqttHelper");

// console.log("✅ sensorController keys:", Object.keys(sensorController));

// ========== LEGACY ROUTES (Backward Compatibility) ==========
router.post("/sensors/:machineId", sensorController.saveSensorData);
router.patch("/sensors/:machineId/relay", sensorController.updateRelayStatus);
router.get("/sensors/:machineId/latest", sensorController.getLatestSensorData);

// ========== NEW MULTI-SENSOR ROUTES ==========

// Get latest sensors by type untuk machine
router.get("/sensors/:machineId/by-type", sensorController.getLatestSensorsByType);

// Get complete machine info dengan status dan sensors
router.get("/machines/:machineId/complete", sensorController.getMachineWithSensors);

// Get recent sensor data dengan filter by type
router.get("/sensors/:machineId/recent", sensorController.getRecentSensorData);

// Get live status dengan semua sensors
router.get("/sensors/:machineId/live", sensorController.getLiveStatus);

// Dashboard overview untuk semua machines
router.get("/dashboard/overview", sensorController.getAllMachinesStatus);

// ========== MQTT CONTROL ROUTES ==========

// Send config ke ESP32
router.post("/machines/:chipId/config", async (req, res) => {
    const { chipId } = req.params;
    const configData = req.body;

    try {
        const success = await sendMachineConfig(chipId, configData);
        
        if (success) {
            res.json({ 
                success: true, 
                message: `Config sent to machine ${chipId}`,
                data: configData 
            });
        } else {
            res.status(500).json({ 
                success: false, 
                message: "Failed to send config" 
            });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Send command ke ESP32 (start/stop)
router.post("/machines/:chipId/command", (req, res) => {
    const { chipId } = req.params;
    const { command } = req.body;

    try {
        if (!['start', 'stop'].includes(command)) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid command. Use 'start' or 'stop'" 
            });
        }

        const success = sendMachineCommand(chipId, command);
        
        if (success) {
            res.json({ 
                success: true, 
                message: `Command '${command}' sent to machine ${chipId}`,
                command 
            });
        } else {
            res.status(500).json({ 
                success: false, 
                message: "Failed to send command" 
            });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========== SENSOR TYPE SPECIFIC ROUTES ==========

// Get specific sensor type data dengan time range
router.get("/sensors/:machineId/:sensorType/history", async (req, res) => {
    const { machineId, sensorType } = req.params;
    const { hours = 24, limit = 100 } = req.query;

    try {
        const Sensor = require("../../models/V2/sensorModel");
        
        const timeAgo = new Date();
        timeAgo.setHours(timeAgo.getHours() - parseInt(hours));

        const sensors = await Sensor.find({ 
            machineId,
            sensorType,
            waktu: { $gte: timeAgo }
        })
        .sort({ waktu: -1 })
        .limit(parseInt(limit));

        // Calculate stats
        const values = sensors.map(s => s.value);
        const stats = values.length > 0 ? {
            min: Math.min(...values),
            max: Math.max(...values),
            avg: values.reduce((a, b) => a + b, 0) / values.length,
            count: values.length
        } : null;

        res.json({ 
            success: true, 
            data: sensors,
            stats,
            sensorType,
            timeRange: `${hours} hours`
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get latest value untuk specific sensor type
router.get("/sensors/:machineId/:sensorType/latest", async (req, res) => {
    const { machineId, sensorType } = req.params;

    try {
        const Sensor = require("../../models/V2/sensorModel");
        
        const sensor = await Sensor.findOne({ 
            machineId, 
            sensorType 
        }).sort({ waktu: -1 });

        if (!sensor) {
            return res.status(404).json({ 
                success: false, 
                message: `No ${sensorType} sensor data found for this machine` 
            });
        }

        res.json({ 
            success: true, 
            data: sensor,
            sensorType 
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========== ANALYTICS ROUTES ==========

// Get sensor analytics untuk dashboard
router.get("/analytics/sensors/:machineId", async (req, res) => {
    const { machineId } = req.params;
    const { days = 7 } = req.query;

    try {
        const Sensor = require("../../models/V2/sensorModel");
        
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - parseInt(days));

        // Aggregate data by sensor type
        const analytics = await Sensor.aggregate([
            {
                $match: {
                    machineId: new require('mongoose').Types.ObjectId(machineId),
                    waktu: { $gte: daysAgo }
                }
            },
            {
                $group: {
                    _id: "$sensorType",
                    count: { $sum: 1 },
                    avgValue: { $avg: "$value" },
                    minValue: { $min: "$value" },
                    maxValue: { $max: "$value" },
                    lastReading: { $max: "$waktu" },
                    firstReading: { $min: "$waktu" }
                }
            }
        ]);

        res.json({ 
            success: true, 
            data: analytics,
            timeRange: `${days} days`,
            machineId 
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get system health untuk monitoring
router.get("/health/system", async (req, res) => {
    try {
        const Machine = require("../../models/machineModel");
        const MachineStatus = require("../../models/V2/machineStatusModel");
        const Sensor = require("../../models/V2/sensorModel");

        // Get counts
        const totalMachines = await Machine.countDocuments();
        const onlineMachines = await MachineStatus.countDocuments({ 
            connectionStatus: 'online',
            lastHeartbeat: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
        });
        
        const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const sensorReadingsToday = await Sensor.countDocuments({ 
            waktu: { $gte: last24h } 
        });

        // Get sensor type distribution
        const sensorTypeDistribution = await Sensor.aggregate([
            { $match: { waktu: { $gte: last24h } } },
            { 
                $group: { 
                    _id: "$sensorType", 
                    count: { $sum: 1 } 
                } 
            }
        ]);

        res.json({
            success: true,
            data: {
                machines: {
                    total: totalMachines,
                    online: onlineMachines,
                    offline: totalMachines - onlineMachines,
                    onlinePercentage: totalMachines > 0 ? (onlineMachines / totalMachines * 100).toFixed(1) : 0
                },
                sensors: {
                    readingsLast24h: sensorReadingsToday,
                    typeDistribution: sensorTypeDistribution
                },
                timestamp: new Date().toISOString()
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;