// notification-threshold-service.js
const admin = require("firebase-admin");
const User = require("../models/userModel");
const Rental = require("../models/rentalModel");
const Machine = require("../models/machineModel");

const SensorV2 = require("../models/V2/sensorModel");
const Notification = require("../models/V2/notificationModel");
const { calculateHybridThresholds } = require('./ml-treshold');


// Cache untuk mencegah notifikasi spam
const notificationCache = new Map();

async function sendThresholdNotification(machineId, sensorData) {
    try {
        // Dapatkan rental aktif untuk mesin ini
        const activeRental = await Rental.findOne({
            machineId: machineId,
            status: "Disetujui",
            startTime: { $lte: new Date() },
            endTime: { $gte: new Date() }
        }).populate("userId machineId");

        if (!activeRental) return;

        const user = activeRental.userId;
        const machine = activeRental.machineId;
        
        if (!user.fcmToken) return;

        // Hitung thresholds untuk mesin ini
        const machineType = determineMachineType(machine);
        const thresholds = await calculateHybridThresholds(
            machineType, 
            sensorData.sensorType, 
            machineId
        );

        const status = determineHybridStatus(sensorData.value, thresholds);
        
        // Hanya kirim notifikasi untuk status Caution, Warning, Critical
        if (status === 'Normal') return;

        // Cek cache untuk mencegah spam (notifikasi sama dalam 5 menit)
        const cacheKey = `${machineId}-${sensorData.sensorType}-${status}`;
        const lastNotification = notificationCache.get(cacheKey);
        
        if (lastNotification && (Date.now() - lastNotification < 5 * 60 * 1000)) {
            return; // Skip jika notifikasi sama dalam 5 menit terakhir
        }

        // Buat konten notifikasi berdasarkan status
        const { title, body } = getNotificationContent(machine, sensorData, status, thresholds);

        const message = {
            notification: { title, body },
            data: {
                machineId: machineId.toString(),
                sensorType: sensorData.sensorType,
                value: sensorData.value.toString(),
                status: status,
                thresholdType: thresholds.basedOn,
                timestamp: new Date().toISOString()
            },
            token: user.fcmToken,
        };

        // Kirim notifikasi
        await admin.messaging().send(message);
        
        // Simpan ke database
        await Notification.create({
            userId: user._id,
            title,
            body,
            data: message.data,
            type: "sensor_alert",
            priority: getPriorityLevel(status),
            read: false,
        });

        // Update cache
        notificationCache.set(cacheKey, Date.now());

        console.log(`📢 Notifikasi ${status} terkirim untuk ${machine.name}: ${sensorData.value}${sensorData.unit}`);

    } catch (error) {
        console.error('Error sending threshold notification:', error);
    }
}

// Helper function untuk konten notifikasi
function getNotificationContent(machine, sensorData, status, thresholds) {
    const machineName = machine.name;
    const value = sensorData.value;
    const unit = sensorData.unit;
    
    const templates = {
        'Caution': {
            title: `⚠️ Perhatian: ${machineName}`,
            body: `${sensorData.sensorType} ${value}${unit} - Mendekati batas aman (Batas: ${thresholds.warning}${unit})`
        },
        'Warning': {
            title: `🚨 Peringatan: ${machineName}`,
            body: `${sensorData.sensorType} ${value}${unit} - Melebihi batas warning! (Batas: ${thresholds.warning}${unit})`
        },
        'Critical': {
            title: `🔥 CRITICAL: ${machineName}`,
            body: `${sensorData.sensorType} ${value}${unit} - DANGER! Melebihi batas kritis! (Batas: ${thresholds.critical}${unit})`
        }
    };

    return templates[status] || {
        title: `ℹ️ Info: ${machineName}`,
        body: `${sensorData.sensorType} ${value}${unit} - Status: ${status}`
    };
}

function getPriorityLevel(status) {
    const priorities = {
        'Normal': 'low',
        'Caution': 'medium', 
        'Warning': 'high',
        'Critical': 'urgent'
    };
    return priorities[status] || 'low';
}

function determineMachineType(machine) {
    const name = machine.name.toLowerCase();
    const type = machine.type.toLowerCase();
    
    if (name.includes('oven') || name.includes('hardening')) return 'oven-hardening';
    if ((name.includes('frais') || name.includes('milling')) && type.includes('getaran')) return 'mesin-frais-getaran';
    if (name.includes('pneumatic') || type.includes('pneumatic')) return 'pneumatic-trainer';
    return 'motor-mesin-frais';
}

function determineHybridStatus(value, thresholds) {
    if (value >= thresholds.critical) return 'Critical';
    if (value >= thresholds.warning) return 'Warning';
    if (value >= thresholds.caution) return 'Caution';
    return 'Normal';
}

async function checkMachineStatus(req, res) {
    try {
        const { machineId } = req.params;
        
        // Dapatkan data sensor terbaru
        const latestSensorData = await SensorV2.find({ machineId })
            .sort({ waktu: -1 })
            .limit(5) // 5 sensor terbaru
            .populate("machineId");
        
        const results = [];
        
        for (const sensor of latestSensorData) {
            const machineType = determineMachineType(sensor.machineId);
            const thresholds = await calculateHybridThresholds(
                machineType, 
                sensor.sensorType, 
                machineId
            );
            
            const status = determineHybridStatus(sensor.value, thresholds);
            
            results.push({
                sensorType: sensor.sensorType,
                value: sensor.value,
                unit: sensor.unit,
                status: status,
                thresholds: thresholds,
                timestamp: sensor.waktu
            });
            
            // Otomatis kirim notifikasi jika status critical/warning
            if (status === 'Warning' || status === 'Critical') {
                await sendThresholdNotification(machineId, {
                    sensorType: sensor.sensorType,
                    value: sensor.value,
                    unit: sensor.unit
                });
            }
        }
        
        res.json({
            success: true,
            machineId,
            checks: results,
            timestamp: new Date()
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = {
    sendThresholdNotification,
    checkMachineStatus,
    determineMachineType,
    determineHybridStatus
};