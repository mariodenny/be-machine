const Sensor = require("../../models/V2/sensorModel");
const MachineStatus = require("../../models/V2/machineStatusModel"); // New model
const Machine = require("../../models/machineModel");

// Legacy endpoint untuk backward compatibility
exports.saveSensorData = async (req, res) => {
    const { machineId } = req.params;
    const { current, button, buzzerStatus } = req.body;

    try {
        const machine = await Machine.findById(machineId);
        if (!machine) {
            return res.status(404).json({ success: false, message: "Machine not found" });
        }

        // Save multiple sensor records untuk legacy data
        const sensorPromises = [];

        if (current !== undefined) {
            sensorPromises.push(Sensor.create({
                machineId,
                sensorId: `${machineId}_current`,
                sensorType: 'current',
                value: current,
                current: current, // legacy field
                chipId: machine.chipId || 'unknown',
                waktu: new Date(),
            }));
        }

        if (button !== undefined) {
            sensorPromises.push(Sensor.create({
                machineId,
                sensorId: `${machineId}_button`,
                sensorType: 'button',
                value: button ? 1 : 0,
                button: button, // legacy field
                chipId: machine.chipId || 'unknown',
                waktu: new Date(),
            }));
        }

        if (buzzerStatus !== undefined) {
            sensorPromises.push(Sensor.create({
                machineId,
                sensorId: `${machineId}_buzzer`,
                sensorType: 'buzzer',
                value: buzzerStatus ? 1 : 0,
                buzzerStatus: buzzerStatus, // legacy field
                chipId: machine.chipId || 'unknown',
                waktu: new Date(),
            }));
        }

        const sensors = await Promise.all(sensorPromises);

        res.json({ success: true, data: sensors });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// NEW: Save sensor data dari MQTT (format baru dari ESP32)
exports.saveSensorDataFromMQTT = async (sensorData) => {
    try {
        const { sensorId, machineId, rentalId, sensorType, value, timestamp, chipId } = sensorData;

        // Validasi machine exists
        const machine = await Machine.findById(machineId);
        if (!machine) {
            console.error(`❌ Machine not found: ${machineId}`);
            return null;
        }

        // Create sensor record
        const sensor = await Sensor.create({
            sensorId,
            machineId,
            rentalId,
            chipId,
            sensorType,
            value,
            deviceTimestamp: timestamp,
            mqttTopic: `sensor/${sensorId}/data`,
            waktu: new Date(),
        });

        console.log(`💾 Sensor data saved: ${sensorType} = ${value} (${sensor.unit})`);
        return sensor;

    } catch (error) {
        console.error('❌ Error saving sensor data from MQTT:', error.message);
        return null;
    }
};

// NEW: Save machine status dari MQTT
exports.saveMachineStatus = async (statusData) => {
    try {
        const { 
            machineId, rentalId, status, activeSensors, chipId, 
            uptime, freeHeap, wifiRSSI, timestamp 
        } = statusData;

        // Update atau create machine status
        const machineStatus = await MachineStatus.findOneAndUpdate(
            { machineId, chipId },
            {
                rentalId,
                status,
                activeSensors,
                uptime,
                freeHeap,
                wifiRSSI,
                deviceTimestamp: timestamp,
                lastSeen: new Date(),
            },
            { new: true, upsert: true }
        );

        console.log(`📊 Machine status saved: ${machineId} - ${status}`);
        return machineStatus;

    } catch (error) {
        console.error('❌ Error saving machine status:', error.message);
        return null;
    }
};

// NEW: Save connection status dari MQTT
exports.saveConnectionStatus = async (connectionData) => {
    try {
        const { chipId, status, ip, rssi } = connectionData;

        // Find machine by chipId
        const machine = await Machine.findOne({ chipId });
        if (!machine) {
            console.error(`❌ Machine not found for chipId: ${chipId}`);
            return null;
        }

        // Update connection status
        const machineStatus = await MachineStatus.findOneAndUpdate(
            { chipId },
            {
                connectionStatus: status,
                ipAddress: ip,
                wifiRSSI: rssi,
                lastSeen: new Date(),
                ...(status === 'online' && { lastHeartbeat: new Date() })
            },
            { new: true, upsert: true }
        );

        console.log(`🔌 Connection status updated: ${chipId} - ${status}`);
        return machineStatus;

    } catch (error) {
        console.error('❌ Error saving connection status:', error.message);
        return null;
    }
};

// NEW: Save heartbeat dari MQTT
exports.saveHeartbeat = async (heartbeatData) => {
    try {
        const { chipId, uptime, freeHeap, wifiRSSI, machineId, isStarted } = heartbeatData;

        const machineStatus = await MachineStatus.findOneAndUpdate(
            { chipId },
            {
                uptime,
                freeHeap,
                wifiRSSI,
                status: isStarted ? 'ON' : 'OFF',
                lastHeartbeat: new Date(),
                lastSeen: new Date(),
            },
            { new: true, upsert: true }
        );

        console.log(`💓 Heartbeat saved: ${chipId} - ${isStarted ? 'ON' : 'OFF'}`);
        return machineStatus;

    } catch (error) {
        console.error('❌ Error saving heartbeat:', error.message);
        return null;
    }
};

exports.updateRelayStatus = async (req, res) => {
    const { machineId } = req.params;
    const { buzzerStatus } = req.body;

    try {
        const sensor = await Sensor.findOneAndUpdate(
            { machineId, sensorType: 'buzzer' },
            {
                value: buzzerStatus ? 1 : 0,
                buzzerStatus,
                lastBuzzerActivation: buzzerStatus ? new Date() : null,
            },
            { new: true, sort: { waktu: -1 } }
        );

        if (!sensor) {
            return res.status(404).json({ success: false, message: "Sensor not found" });
        }

        res.json({ success: true, data: sensor });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

exports.getLatestSensorData = async (req, res) => {
    const { machineId } = req.params;

    try {
        const sensor = await Sensor.findOne({ machineId }).sort({ waktu: -1 });

        if (!sensor) {
            return res.status(404).json({ success: false, message: "Sensor not found" });
        }

        res.json({ success: true, data: sensor });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// NEW: Get latest data untuk semua sensor types dari machine
exports.getLatestSensorsByType = async (req, res) => {
    const { machineId } = req.params;

    try {
        // Get latest sensor untuk setiap type
        const sensorTypes = ['suhu', 'tekanan', 'getaran', 'current', 'button', 'buzzer'];
        const sensors = {};

        for (const type of sensorTypes) {
            const latestSensor = await Sensor.findOne({ 
                machineId, 
                sensorType: type 
            }).sort({ waktu: -1 });
            
            if (latestSensor) {
                sensors[type] = latestSensor;
            }
        }

        res.json({ 
            success: true, 
            data: sensors,
            count: Object.keys(sensors).length 
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// NEW: Get machine dengan status dan latest sensors
exports.getMachineWithSensors = async (req, res) => {
    const { machineId } = req.params;

    try {
        // Get machine info
        const machine = await Machine.findById(machineId);
        if (!machine) {
            return res.status(404).json({ success: false, message: "Machine not found" });
        }

        // Get machine status
        const machineStatus = await MachineStatus.findOne({ machineId });

        // Get latest sensors by type
        const sensorTypes = ['suhu', 'tekanan', 'getaran', 'current', 'button', 'buzzer'];
        const latestSensors = {};

        for (const type of sensorTypes) {
            const sensor = await Sensor.findOne({ 
                machineId, 
                sensorType: type 
            }).sort({ waktu: -1 });
            
            if (sensor) {
                latestSensors[type] = sensor;
            }
        }

        res.json({
            success: true,
            data: {
                machine,
                status: machineStatus,
                sensors: latestSensors,
                isOnline: machineStatus?.isOnline || false,
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// Enhanced get recent sensor data dengan filter by type
exports.getRecentSensorData = async (req, res) => {
    const { machineId } = req.params;
    const { minutes = 5, sensorType } = req.query;

    try {
        const timeAgo = new Date();
        timeAgo.setMinutes(timeAgo.getMinutes() - parseInt(minutes));

        let query = { 
            machineId,
            waktu: { $gte: timeAgo }
        };

        if (sensorType) {
            query.sensorType = sensorType;
        }

        const sensors = await Sensor.find(query).sort({ waktu: -1 });

        res.json({ 
            success: true, 
            data: sensors,
            timeRange: `${minutes} minutes`,
            sensorType: sensorType || 'all',
            count: sensors.length
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// Enhanced live status dengan semua sensor types
exports.getLiveStatus = async (req, res) => {
    const { machineId } = req.params;

    try {
        // Get machine status
        const machineStatus = await MachineStatus.findOne({ machineId });
        
        // Get latest sensors
        const sensorTypes = ['suhu', 'tekanan', 'getaran', 'current', 'button', 'buzzer'];
        const sensors = {};

        for (const type of sensorTypes) {
            const sensor = await Sensor.findOne({ 
                machineId, 
                sensorType: type 
            }).sort({ waktu: -1 });
            
            if (sensor) {
                sensors[type] = {
                    value: sensor.value,
                    displayValue: sensor.displayValue,
                    timestamp: sensor.waktu,
                    isValid: sensor.isValid,
                };
            }
        }

        res.json({
            success: true,
            data: {
                machineStatus: machineStatus || null,
                sensors,
                isOnline: machineStatus?.isOnline || false,
                lastSeen: machineStatus?.lastSeen,
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// Enhanced dashboard overview
exports.getAllMachinesStatus = async (req, res) => {
    try {
        const machines = await Machine.find().select('_id name chipId location status');
        
        const machinesWithStatus = await Promise.all(
            machines.map(async (machine) => {
                // Get machine status
                const machineStatus = await MachineStatus.findOne({ machineId: machine._id });
                
                // Get latest sensors count by type
                const sensorCounts = {};
                const sensorTypes = ['suhu', 'tekanan', 'getaran', 'current', 'button', 'buzzer'];
                
                for (const type of sensorTypes) {
                    const count = await Sensor.countDocuments({ 
                        machineId: machine._id, 
                        sensorType: type,
                        waktu: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // last 24h
                    });
                    if (count > 0) sensorCounts[type] = count;
                }

                return {
                    ...machine.toObject(),
                    machineStatus: machineStatus || null,
                    sensorCounts,
                    isOnline: machineStatus?.isOnline || false,
                };
            })
        );

        // Summary stats
        const summary = {
            total: machines.length,
            online: machinesWithStatus.filter(m => m.isOnline).length,
            offline: machinesWithStatus.filter(m => !m.isOnline).length,
        };

        res.json({ 
            success: true, 
            data: machinesWithStatus,
            summary
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};