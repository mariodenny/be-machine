const Sensor = require("../../models/V2/sensorModel");
const MachineStatus = require("../../models/V2/machineStatusModel"); // New model
const Machine = require("../../models/machineModel");
const { Parser } = require('json2csv');
const ExcelJS = require('exceljs');
// const { sendThresholdNotification } = require('./notification-threshold-service');
const { sendThresholdNotification, checkMachineStatus } = require('../../utils/notification-treshold-service');

// Legacy endpoint untuk backward compatibility

async function handleNewSensorData(sensorData) {
    try {
        // Kirim notifikasi jika melebihi threshold
        if (sensorData.machineId) {
            await sendThresholdNotification(sensorData.machineId, {
                sensorType: sensorData.sensorType,
                value: sensorData.value,
                unit: sensorData.unit,
                timestamp: sensorData.waktu
            });
        }
        
        // Juga bisa simpan ke database atau processing lain
        return true;
    } catch (error) {
        console.error('Error handling sensor data:', error);
        return false;
    }
}


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

exports.saveSensorDataFromMQTT = async (data) => {
    try {
        if (!data.rentalId || !data.machineId || !data.sensorType) {
            console.warn("⚠️ Incomplete sensor data, skipping:", data);
            return;
        }

        const sensorData = new Sensor({
            rentalId: data.rentalId,
            machineId: data.machineId,
            sensorType: data.sensorType,
            value: data.value || 0,
            waktu: new Date()
        });

        await sensorData.save();
        console.log("✅ Sensor data saved:", sensorData);
    } catch (error) {
        console.error("❌ Error saving sensor data:", error.message);
    }
};

exports.saveMachineStatus = async (statusData) => {
    try {
        const {
            machineId, rentalId, status, activeSensors,
            uptime, freeHeap, wifiRSSI, timestamp
        } = statusData;

        const machineStatus = await MachineStatus.findOneAndUpdate(
            { machineId },
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
exports.saveConnectionStatus = async (connectionData) => {
    try {
        const { machineId, status, ip, rssi } = connectionData;

        const machineStatus = await MachineStatus.findOneAndUpdate(
            { machineId },
            {
                connectionStatus: status,
                ipAddress: ip,
                wifiRSSI: rssi,
                lastSeen: new Date(),
                ...(status === 'online' && { lastHeartbeat: new Date() })
            },
            { new: true, upsert: true }
        );

        console.log(`🔌 Connection status updated: ${machineId} - ${status}`);
        return machineStatus;
    } catch (error) {
        console.error('❌ Error saving connection status:', error.message);
        return null;
    }
};

exports.saveHeartbeat = async (heartbeatData) => {
    try {
        const { machineId, uptime, freeHeap, wifiRSSI, isStarted } = heartbeatData;

        const machineStatus = await MachineStatus.findOneAndUpdate(
            { machineId },
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

        console.log(`💓 Heartbeat saved: ${machineId} - ${isStarted ? 'ON' : 'OFF'}`);
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

// TODO : Generate report to xlsx / CSV
const determineStatus = (sensorType, value) => {
  switch(sensorType) {
    case 'suhu':
      if (value >= 90) return 'Warning';
      if (value >= 70) return 'Caution';
      return 'Normal';
    
    case 'tekanan':
      if (value >= 8) return 'Critical';
      if (value >= 7) return 'Warning';
      return 'Normal';
    
    case 'getaran':
      if (value >= 1.0) return 'Warning';
      if (value >= 0.7) return 'Caution';
      return 'Normal';
    
    case 'current':
      if (value >= 80) return 'Warning';
      if (value >= 60) return 'Caution';
      return 'Normal';
    
    default:
      return 'Normal';
  }
};

// Helper function untuk menentukan keterangan berdasarkan status
const determineDescription = (sensorType, value, status) => {
  switch(sensorType) {
    case 'suhu':
      if (status === 'Warning') return `Mendekati limit (90 °C)`;
      if (status === 'Caution') return `Perhatian, suhu meningkat`;
      return 'Stabil';
    
    case 'tekanan':
      if (status === 'Critical') return 'Buzzer aktif, notifikasi';
      if (status === 'Warning') return 'Tekanan tinggi';
      return 'Normal';
    
    case 'getaran':
      if (status === 'Warning') return 'Perlu pengecekan bearing';
      if (status === 'Caution') return 'Getaran meningkat';
      return 'Tidak ada anomali';
    
    case 'current':
      if (status === 'Warning') return 'Arus tinggi';
      if (status === 'Caution') return 'Arus meningkat';
      return 'Normal';
    
    default:
      return '';
  }
};

// Export to CSV
exports.exportToCsv = async (req, res) => {
  try {
    const { startDate, endDate, machineId } = req.query;
    
    // Build query filter
    let filter = {};
    
    if (startDate && endDate) {
      filter.waktu = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    if (machineId) {
      filter.machineId = machineId;
    }
    
    // Get sensor data with machine info
    const sensorData = await Sensor.find(filter)
      .populate('machineId', 'name type model')
      .sort({ waktu: -1 });
    
    if (!sensorData.length) {
      return res.status(404).json({ message: 'No data found for the specified criteria' });
    }
    
    // Transform data to match the requested format
    const transformedData = sensorData.map(item => {
      const status = determineStatus(item.sensorType, item.value);
      const keterangan = determineDescription(item.sensorType, item.value, status);
      
      return {
        Timestamp: item.waktu,
        'ID Mesin': item.machineId ? item.machineId.name : 'N/A',
        'Jenis Mesin': item.machineId ? item.machineId.type : 'N/A',
        Sensor: item.sensorType.charAt(0).toUpperCase() + item.sensorType.slice(1),
        Value: item.value,
        Satuan: item.unit,
        Status: status,
        Keterangan: keterangan
      };
    });
    
    // Convert to CSV
    const json2csvParser = new Parser({
      fields: ['Timestamp', 'ID Mesin', 'Jenis Mesin', 'Sensor', 'Value', 'Satuan', 'Status', 'Keterangan']
    });
    
    const csv = json2csvParser.parse(transformedData);
    
    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=sensor-report-${new Date().toISOString().split('T')[0]}.csv`);
    
    res.send(csv);
    
  } catch (error) {
    console.error('Export CSV error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Export to XLSX
exports.exportToXlsx = async (req, res) => {
  try {
    const { startDate, endDate, machineId } = req.query;
    
    // Build query filter
    let filter = {};
    
    if (startDate && endDate) {
      filter.waktu = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    if (machineId) {
      filter.machineId = machineId;
    }
    
    // Get sensor data with machine info
    const sensorData = await Sensor.find(filter)
      .populate('machineId', 'name type model')
      .sort({ waktu: -1 });
    
    if (!sensorData.length) {
      return res.status(404).json({ message: 'No data found for the specified criteria' });
    }
    
    // Create workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sensor Report');
    
    // Define columns
    worksheet.columns = [
      { header: 'Timestamp', key: 'timestamp', width: 20 },
      { header: 'ID Mesin', key: 'machineId', width: 15 },
      { header: 'Jenis Mesin', key: 'machineType', width: 15 },
      { header: 'Sensor', key: 'sensor', width: 15 },
      { header: 'Value', key: 'value', width: 10 },
      { header: 'Satuan', key: 'unit', width: 10 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Keterangan', key: 'description', width: 30 }
    ];
    
    // Add data rows with conditional formatting
    sensorData.forEach(item => {
      const status = determineStatus(item.sensorType, item.value);
      const keterangan = determineDescription(item.sensorType, item.value, status);
      
      worksheet.addRow({
        timestamp: item.waktu,
        machineId: item.machineId ? item.machineId.name : 'N/A',
        machineType: item.machineId ? item.machineId.type : 'N/A',
        sensor: item.sensorType.charAt(0).toUpperCase() + item.sensorType.slice(1),
        value: item.value,
        unit: item.unit,
        status: status,
        description: keterangan
      });
      
      // Get the last row added
      const row = worksheet.lastRow;
      
      // Apply color based on status
      let fillColor;
      switch(status) {
        case 'Normal':
          fillColor = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00FF00' } }; // Hijau
          break;
        case 'Caution':
          fillColor = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }; // Kuning
          break;
        case 'Warning':
          fillColor = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } }; // Merah
          break;
        case 'Critical':
          fillColor = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } }; // Merah
          break;
        default:
          fillColor = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }; // Putih
      }
      
      // Apply fill to status cell
      row.getCell('status').fill = fillColor;
    });
    
    // Style header row
    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD3D3D3' }
      };
    });
    
    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=sensor-report-${new Date().toISOString().split('T')[0]}.xlsx`);
    
    // Write to response
    await workbook.xlsx.write(res);
    res.end();
    
  } catch (error) {
    console.error('Export XLSX error:', error);
    res.status(500).json({ error: error.message });
  }
};