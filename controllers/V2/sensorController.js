const Sensor = require("../../models/V2/sensorModel");
const MachineStatus = require("../../models/V2/machineStatusModel"); // New model
const Machine = require("../../models/machineModel");
const { Parser } = require('json2csv');
const ExcelJS = require('exceljs');
const Rental = require('../../models/rentalModel')


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

exports.exportToXlsx = async (req, res) => {
  try {
    const { startDate, endDate, machineId, sensorType } = req.query;
    
    // Build query filter
    let filter = {};
    
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999); // End of day
      
      filter.waktu = {
        $gte: start,
        $lte: end
      };
    }
    
    if (machineId) {
      filter.machineId = machineId;
    }
    
    if (sensorType && sensorType !== 'all') {
      filter.sensorType = sensorType;
    }
    
    console.log('Export filter:', filter);
    console.log('Start Date:', startDate, 'End Date:', endDate);
    
    // Get sensor data with machine info
    const sensorData = await Sensor.find(filter)
      .populate({
        path: 'machineId',
        select: 'name type model'
      })
      .sort({ waktu: -1 })
      .limit(1000); // Limit untuk menghindari memory issues
    
    if (!sensorData.length) {
      return res.status(404).json({ 
        message: 'No sensor data found for the specified criteria',
        filter: filter 
      });
    }
    
    console.log('Total sensor data found:', sensorData.length);
    
    // Log first few items untuk debugging
    sensorData.slice(0, 3).forEach((item, index) => {
      console.log(`Sample data ${index + 1}:`, {
        waktu: item.waktu,
        sensorType: item.sensorType,
        value: item.value,
        unit: item.unit,
        machineName: item.machineId?.name || 'No machine'
      });
    });
    
    // Function to map sensorType ke nama yang lebih baik
    const getSensorDisplayName = (sensorType) => {
      const sensorNames = {
        'suhu': 'Suhu',
        'kelembaban': 'Kelembaban',
        'tekanan': 'Tekanan',
        'getaran': 'Getaran',
        'current': 'Arus',
        'button': 'Tombol',
        'buzzer': 'Buzzer',
        'delay_test': 'Test Delay',
        'thermocouple_k': 'Thermocouple K',
        'vibration_sensor': 'Sensor Getaran'
      };
      return sensorNames[sensorType] || sensorType;
    };
    
    // Function untuk mendapatkan unit yang benar
    const getDisplayUnit = (sensorType, itemUnit) => {
      if (itemUnit && itemUnit !== 'undefined') {
        return itemUnit;
      }
      
      const defaultUnits = {
        'suhu': '°C',
        'kelembaban': '%',
        'tekanan': 'Bar',
        'getaran': 'mm/s',
        'current': 'A',
        'button': 'state',
        'buzzer': 'state',
        'delay_test': 'ms',
        'thermocouple_k': '°C',
        'vibration_sensor': 'mm/s'
      };
      
      return defaultUnits[sensorType] || '';
    };
    
    // Create workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();
    
    const worksheet = workbook.addWorksheet('Laporan Sensor');
    
    // Define columns - TANPA STATUS dan KETERANGAN
    worksheet.columns = [
      { header: 'No', key: 'no', width: 8 },
      { header: 'Tanggal/Waktu', key: 'timestamp', width: 25 },
      { header: 'Nama Mesin', key: 'machineName', width: 25 },
      { header: 'Jenis Mesin', key: 'machineType', width: 20 },
      { header: 'Model', key: 'machineModel', width: 20 },
      { header: 'Tipe Sensor', key: 'sensorType', width: 20 },
      { header: 'ID Sensor', key: 'sensorId', width: 20 },
      { header: 'Nilai', key: 'value', width: 15, style: { numFmt: '0.00' } },
      { header: 'Satuan', key: 'unit', width: 10 }
      // Status dan Keterangan dihapus
    ];
    
    // Add data rows
    let rowNumber = 1;
    let validDataCount = 0;
    
    sensorData.forEach((item, index) => {
      const machine = item.machineId;
      
      // Skip jika tidak ada data mesin
      if (!machine) {
        console.log(`Skipping row ${index + 1}: No machine data`);
        return;
      }
      
      // Format timestamp
      let timestamp;
      if (item.waktu) {
        if (typeof item.waktu === 'string') {
          timestamp = item.waktu;
        } else {
          timestamp = new Date(item.waktu).toLocaleString('id-ID', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
        }
      } else {
        timestamp = 'N/A';
      }
      
      // Get unit
      const unit = getDisplayUnit(item.sensorType, item.unit);
      
      // Add row - TANPA status dan description
      worksheet.addRow({
        no: rowNumber++,
        timestamp: timestamp,
        machineName: machine.name || 'N/A',
        machineType: machine.type || 'N/A',
        machineModel: machine.model || 'N/A',
        sensorType: getSensorDisplayName(item.sensorType),
        sensorId: item.sensorId || item.chipId || 'N/A',
        value: item.value,
        unit: unit
        // Status dan description dihapus
      });
      
      validDataCount++;
      
      // Apply styling to the row
      const row = worksheet.lastRow;
      
      // Format nilai cell
      if (row && row.getCell('value')) {
        row.getCell('value').numFmt = '0.00';
        row.getCell('value').alignment = { horizontal: 'right' };
      }
    });
    
    console.log(`Exported ${validDataCount} valid rows out of ${sensorData.length} total`);
    
    if (validDataCount === 0) {
      return res.status(404).json({ 
        message: 'No valid data to export after processing' 
      });
    }
    
    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF2E75B6' } // Biru
      };
      cell.alignment = { 
        vertical: 'middle', 
        horizontal: 'center',
        wrapText: true 
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
      };
    });
    
    // Set row height untuk header
    headerRow.height = 30;
    
    // Apply borders to all data cells
    for (let i = 2; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
          left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
          bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
          right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
        };
        cell.alignment = { vertical: 'middle' };
      });
      row.height = 22;
    }
    
    // Auto-fit columns
    worksheet.columns.forEach((column, index) => {
      let maxLength = 0;
      const headerLength = column.header ? column.header.length : 0;
      maxLength = headerLength;
      
      column.eachCell({ includeEmpty: false }, (cell) => {
        const cellValue = cell.value ? cell.value.toString() : '';
        const cellLength = cellValue.length;
        if (cellLength > maxLength) {
          maxLength = cellLength;
        }
      });
      
      column.width = Math.min(Math.max(maxLength + 4, 10), 60);
    });
    
    // Freeze header row
    worksheet.views = [
      {
        state: 'frozen',
        xSplit: 0,
        ySplit: 1,
        activeCell: 'A2',
        showGridLines: true
      }
    ];
    
    // Add worksheet metadata
    worksheet.properties.defaultRowHeight = 22;
    
    // Add title row - Update merge cells karena kolom berkurang
    worksheet.insertRow(1, [
      `LAPORAN DATA SENSOR`,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '' // Kolom berkurang dari 11 ke 9
    ]);
    
    const titleRow = worksheet.getRow(1);
    titleRow.height = 35;
    titleRow.font = { bold: true, size: 16, color: { argb: 'FF2E75B6' } };
    titleRow.alignment = { horizontal: 'center' };
    worksheet.mergeCells('A1:I1'); // A1:I1 (9 kolom)
    
    // Add filter info row
    const filterInfo = [];
    if (machineId) {
      const machineName = sensorData[0]?.machineId?.name || machineId;
      filterInfo.push(`Mesin: ${machineName}`);
    }
    if (startDate && endDate) {
      filterInfo.push(`Periode: ${startDate} s/d ${endDate}`);
    }
    if (sensorType && sensorType !== 'all') {
      filterInfo.push(`Sensor: ${getSensorDisplayName(sensorType)}`);
    }
    
    if (filterInfo.length > 0) {
      worksheet.insertRow(2, [
        filterInfo.join(' | '),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '' // Kolom berkurang dari 11 ke 9
      ]);
      
      const filterRow = worksheet.getRow(2);
      filterRow.font = { italic: true, size: 10 };
      filterRow.alignment = { horizontal: 'center' };
      worksheet.mergeCells('A2:I2'); // A2:I2 (9 kolom)
      
      // Shift data rows down
      worksheet._rows.splice(2, 0, worksheet._rows.pop());
    }
    
    // Add summary row
    const lastRow = worksheet.rowCount + 1;
    worksheet.addRow([
      'Total Data:',
      '',
      '',
      '',
      '',
      '',
      '',
      validDataCount,
      'records'
      // Kolom berkurang
    ]);
    
    const summaryRow = worksheet.getRow(lastRow);
    summaryRow.font = { bold: true };
    summaryRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF2F2F2' }
    };
    worksheet.mergeCells(`A${lastRow}:G${lastRow}`); // A-G (7 kolom pertama)
    worksheet.mergeCells(`H${lastRow}:I${lastRow}`); // H-I (2 kolom terakhir)
    
    // Set response headers
    const machineName = sensorData[0]?.machineId?.name || 'all-machines';
    const safeMachineName = machineName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const fileName = `sensor-report-${safeMachineName}-${new Date().toISOString().split('T')[0]}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    
    // Write to response
    await workbook.xlsx.write(res);
    res.end();
    
    console.log(`Export completed: ${fileName} with ${validDataCount} records`);
    
  } catch (error) {
    console.error('Export XLSX error:', error);
    res.status(500).json({ 
      error: 'Failed to export data',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

exports.checkSystemDelay = async (req, res) => {
  try {
    const { machineId } = req.params;
    
    // Test timing dari ESP ke MongoDB ke Response
    const testStart = Date.now();
    
    // Simpan test data
    const testSensor = await Sensor.create({
      machineId,
      sensorType: 'delay_test',
      value: 99.99,
      unit: 'ms',
      deviceTimestamp: Date.now(),
      waktu: new Date()
    });
    
    const dbWriteTime = Date.now() - testStart;
    
    // Query data terbaru
    const latestData = await Sensor.findOne({
      machineId,
      sensorType: 'delay_test'
    }).sort({ waktu: -1 });
    
    const totalDelay = Date.now() - testStart;
    
    res.json({
      success: true,
      data: {
        testId: testSensor._id,
        dbWriteTime: `${dbWriteTime}ms`,
        totalSystemDelay: `${totalDelay}ms`,
        timestamp: new Date().toISOString(),
        recommendation: totalDelay > 1000 ? 'High latency detected' : 'System responsive'
      }
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.exportSensorDataWithDelay = async (req, res) => {
  try {
    const { machineId } = req.params;
    const { startDate, endDate } = req.query;
    
    // Build filter
    let filter = { machineId };
    if (startDate && endDate) {
      filter.waktu = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    const sensorData = await Sensor.find(filter)
      .populate('machineId')
      .sort({ waktu: -1 });
    
    if (!sensorData.length) {
      return res.status(404).json({ message: 'No data found' });
    }
    
    // Calculate processing delays for each record
    const dataWithDelay = sensorData.map(record => ({
      Timestamp: record.waktu,
      'ID Mesin': record.machineId?.name || 'N/A',
      Sensor: record.sensorType,
      Value: record.value,
      Unit: record.unit,
      'Processing Delay (ms)': record.deviceTimestamp ? 
        (new Date(record.waktu) - new Date(record.deviceTimestamp)) : 'N/A',
      'Data Quality': record.deviceTimestamp && 
        (new Date(record.waktu) - new Date(record.deviceTimestamp)) < 5000 ? 'Good' : 'Delayed'
    }));
    
    // Convert to CSV
    const csv = convertToCsv(dataWithDelay);
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 
      `attachment; filename=sensor-data-with-delay-${machineId}.csv`);
    res.send(csv);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Helper function untuk CSV
const convertToCsv = (data) => {
  if (!data.length) return '';
  
  const headers = Object.keys(data[0]);
  let csv = headers.join(',') + '\n';
  
  data.forEach(item => {
    const row = headers.map(header => {
      let value = item[header] || '';
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        value = `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    });
    csv += row.join(',') + '\n';
  });
  
  return csv;
};

// Enhanced live status dengan semua sensor types + rental context + ESP connection check
exports.getLiveStatus = async (req, res) => {
    const { machineId, rentalId } = req.params; // Tambah rentalId sebagai optional

    try {
        // 1. Get machine basic info
        const machine = await Machine.findById(machineId);
        if (!machine) {
            return res.status(404).json({ 
                success: false, 
                message: "Machine not found" 
            });
        }

        let rentalInfo = null;
        if (rentalId) {
            rentalInfo = await Rental.findOne({
                _id: rentalId,
                machineId: machineId,
                status: "Disetujui"
            }).populate("userId", "name email");
            
            if (!rentalInfo) {
                return res.status(404).json({
                    success: false,
                    message: "Active rental not found for this machine"
                });
            }
        }

        const machineStatus = await MachineStatus.findOne({ machineId });

        const sensorTypes = ['suhu', 'tekanan', 'getaran', 'current', 'button', 'buzzer'];
        const sensors = {};
        let lastDataTime = null;

        for (const type of sensorTypes) {
            const sensor = await Sensor.findOne({
                machineId,
                sensorType: type
            }).sort({ waktu: -1 });

            if (sensor) {
                if (!lastDataTime || sensor.waktu > lastDataTime) {
                    lastDataTime = sensor.waktu;
                }

                const status = calculateSensorStatus(type, sensor.value, machine.sensorThresholds);
                
                sensors[type] = {
                    value: sensor.value,
                    displayValue: sensor.displayValue || `${sensor.value}${sensor.unit}`,
                    unit: sensor.unit,
                    timestamp: sensor.waktu,
                    isValid: sensor.isValid,
                    status: status, // normal, caution, warning
                    color: getStatusColor(status), // untuk Flutter
                    thresholdInfo: getThresholdInfo(type, sensor.value, machine.sensorThresholds)
                };
            } else {
                sensors[type] = {
                    value: null,
                    displayValue: "No data",
                    unit: "",
                    timestamp: null,
                    isValid: false,
                    status: "no_data",
                    color: "#9CA3AF", // gray
                    thresholdInfo: "No sensor data available"
                };
            }
        }

        const espStatus = await checkESPConnectionStatus(machineId, lastDataTime);
        
        const realTimeStatus = machine.realTimeStatus || {
            sensorValue: 0,
            status: "disconnected",
            lastUpdate: new Date()
        };

        const response = {
            success: true,
            data: {
                machine: {
                    id: machine._id,
                    name: machine.name,
                    type: machine.type,
                    status: machine.status,
                    imageUrl: machine.imageUrl
                },
                rental: rentalInfo ? {
                    id: rentalInfo._id,
                    user: rentalInfo.userId ? {
                        name: rentalInfo.userId.name,
                        email: rentalInfo.userId.email
                    } : null,
                    startTime: rentalInfo.startTime,
                    endTime: rentalInfo.endTime,
                    status: rentalInfo.status,
                    isStarted: rentalInfo.isStarted
                } : null,
                connection: {
                    espConnected: espStatus.connected,
                    status: espStatus.status, // connected, disconnected, stale
                    lastDataReceived: lastDataTime,
                    timeSinceLastData: espStatus.timeSinceLastData,
                    message: espStatus.message
                },
                sensors,
                realTimeStatus: {
                    ...realTimeStatus,
                    color: getStatusColor(realTimeStatus.status)
                },
                thresholds: machine.sensorThresholds,
                machineStatus: machineStatus || null,
                lastUpdated: new Date()
            }
        };

        res.json(response);

    } catch (err) {
        console.error('Error in getLiveStatus:', err);
        res.status(500).json({ 
            success: false, 
            error: err.message,
            message: "Failed to get live status" 
        });
    }
};


const checkESPConnectionStatus = async (machineId, lastDataTime) => {
    const now = new Date();
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    if (!lastDataTime) {
        return {
            connected: false,
            status: "disconnected",
            timeSinceLastData: null,
            message: "ESP tidak terkoneksi - Tidak ada data diterima"
        };
    }

    const timeSinceLastData = now.getTime() - new Date(lastDataTime).getTime();
    
    if (lastDataTime > twoMinutesAgo) {
        return {
            connected: true,
            status: "connected",
            timeSinceLastData: timeSinceLastData,
            message: "ESP terkoneksi dengan baik"
        };
    } else if (lastDataTime > fiveMinutesAgo) {
        return {
            connected: true,
            status: "stale",
            timeSinceLastData: timeSinceLastData,
            message: "ESP terkoneksi tetapi data tertunda"
        };
    } else {
        return {
            connected: false,
            status: "disconnected", 
            timeSinceLastData: timeSinceLastData,
            message: "ESP tidak terkoneksi - Tidak ada data dalam 5 menit terakhir"
        };
    }
};

const calculateSensorStatus = (sensorType, value, thresholds) => {
    if (value === null || value === undefined) return "no_data";
    if (!thresholds) return "normal";

    // Default thresholds jika tidak ada di machine
    const defaultThresholds = {
        suhu: { caution: 70, warning: 85 },
        tekanan: { caution: 6.5, warning: 7.5 },
        getaran: { caution: 2.0, warning: 3.0 },
        current: { caution: 60, warning: 80 }
    };

    const sensorThresholds = thresholds[sensorType] || defaultThresholds[sensorType];
    if (!sensorThresholds) return "normal";

    if (value >= sensorThresholds.warning) return "warning";
    if (value >= sensorThresholds.caution) return "caution";
    return "normal";
};

const getStatusColor = (status) => {
    const colors = {
        normal: "#10B981",    // green
        caution: "#F59E0B",   // yellow  
        warning: "#EF4444",   // red
        critical: "#DC2626",  // dark red
        disconnected: "#6B7280", // gray
        no_data: "#9CA3AF",   // light gray
        stale: "#F97316"      // orange
    };
    return colors[status] || "#6B7280";
};

const getThresholdInfo = (sensorType, value, thresholds) => {
    if (!thresholds) return "No thresholds set";
    
    const sensorThresholds = thresholds[sensorType];
    if (!sensorThresholds) return "No thresholds for this sensor";

    if (value >= sensorThresholds.warning) {
        return `⚠️ WARNING: Melebihi batas ${sensorThresholds.warning}`;
    } else if (value >= sensorThresholds.caution) {
        return `⚠️ CAUTION: Mendekati batas ${sensorThresholds.warning}`;
    } else {
        return `✅ NORMAL: Dalam batas aman`;
    }
};


exports.getLiveStatusByRental = async (req, res) => {
    const { rentalId } = req.params;
    
    try {
        // 1. Dapatkan rental info
        const rental = await Rental.findOne({
            _id: rentalId,
            status: "Disetujui"
        }).populate("machineId userId");
        
        if (!rental) {
            return res.status(404).json({
                success: false,
                message: "Rental not found or not active"
            });
        }

        const machineId = rental.machineId._id;
        
        const liveStatus = await getLiveStatusData(machineId, rentalId);
        
        liveStatus.data.rental = {
            id: rental._id,
            user: {
                name: rental.userId.name,
                email: rental.userId.email
            },
            startTime: rental.startTime,
            endTime: rental.endTime,
            status: rental.status,
            isStarted: rental.isStarted
        };
        
        res.json(liveStatus);
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
// ✅ COMMON FUNCTION untuk kedua approach (by machineId dan by rentalId)
const getLiveStatusData = async (machineId, rentalId = null) => {
    try {
        // 1. Get machine basic info
        const machine = await Machine.findById(machineId);
        if (!machine) {
            throw new Error("Machine not found");
        }

        // 2. Get latest sensors data dengan ESP connection check
        const sensorTypes = ['suhu', 'tekanan', 'getaran', 'current', 'button', 'buzzer'];
        const sensors = {};
        let lastDataTime = null;

        for (const type of sensorTypes) {
            const sensor = await Sensor.findOne({
                machineId,
                sensorType: type
            }).sort({ waktu: -1 });

            if (sensor) {
                // Update lastDataTime
                if (!lastDataTime || sensor.waktu > lastDataTime) {
                    lastDataTime = sensor.waktu;
                }

                // Calculate status based on thresholds
                const status = calculateSensorStatus(type, sensor.value, machine.sensorThresholds);
                
                sensors[type] = {
                    value: sensor.value,
                    displayValue: sensor.displayValue || `${sensor.value}${sensor.unit}`,
                    unit: sensor.unit,
                    timestamp: sensor.waktu,
                    isValid: sensor.isValid,
                    status: status, // normal, caution, warning
                    color: getStatusColor(status), // untuk Flutter
                    thresholdInfo: getThresholdInfo(type, sensor.value, machine.sensorThresholds)
                };
            } else {
                // Sensor tidak ada data
                sensors[type] = {
                    value: null,
                    displayValue: "No data",
                    unit: "",
                    timestamp: null,
                    isValid: false,
                    status: "no_data",
                    color: "#9CA3AF", // gray
                    thresholdInfo: "No sensor data available"
                };
            }
        }

        // 3. Check ESP connection status
        const espStatus = await checkESPConnectionStatus(machineId, lastDataTime);
        
        // 4. Get real-time status dari machine
        const realTimeStatus = machine.realTimeStatus || {
            sensorValue: 0,
            status: "disconnected",
            lastUpdate: new Date()
        };

        // 5. Get machine status (jika ada model MachineStatus)
        const machineStatus = await MachineStatus.findOne({ machineId });

        // 6. Prepare base response
        const response = {
            success: true,
            data: {
                machine: {
                    id: machine._id,
                    name: machine.name,
                    type: machine.type,
                    status: machine.status,
                    imageUrl: machine.imageUrl,
                    esp_address: machine.esp_address
                },
                sensors,
                connection: {
                    espConnected: espStatus.connected,
                    status: espStatus.status, // connected, disconnected, stale
                    lastDataReceived: lastDataTime,
                    timeSinceLastData: espStatus.timeSinceLastData,
                    message: espStatus.message
                },
                realTimeStatus: {
                    ...realTimeStatus,
                    color: getStatusColor(realTimeStatus.status)
                },
                thresholds: machine.sensorThresholds,
                machineStatus: machineStatus || null,
                lastUpdated: new Date()
            }
        };

        return response;

    } catch (error) {
        console.error('Error in getLiveStatusData:', error);
        throw error;
    }
};

