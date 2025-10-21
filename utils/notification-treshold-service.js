const admin = require("firebase-admin");
const User = require("../models/userModel");
const Rental = require("../models/rentalModel");
const Machine = require("../models/machineModel");

const SensorV2 = require("../models/V2/sensorModel");
const Notification = require("../models/notificationModel");
const { calculateHybridThresholds } = require('./ml-treshold');


// Cache untuk mencegah notifikasi spam
const notificationCache = new Map();

async function sendThresholdNotification(machineId, sensorData) {
    console.log('🔔 [DEBUG] START sendThresholdNotification');
    
    try {
        const ObjectId = require('mongoose').Types.ObjectId;
        const machineObjectId = new ObjectId(machineId);
        
        console.log('🔔 [DEBUG] Searching rental for machine:', machineObjectId);

     
        const activeRental = await Rental.findOne({
            machineId: machineObjectId,
            status: "Disetujui",
            isStarted: true
        })
        .populate("userId", "username fcmToken email") 
        .populate("machineId", "name");            

        console.log('🔔 [DEBUG] Rental query result:', activeRental ? 'FOUND' : 'NOT FOUND');

        if (!activeRental) {
            console.log('❌ No active rental found');
            return { success: false, message: "No active rental" };
        }

        console.log('🔔 [DEBUG] User:', activeRental.userId);
        console.log('🔔 [DEBUG] Machine:', activeRental.machineId);

        const user = activeRental.userId;
        const machine = activeRental.machineId;


        const admins = await User.find({ 
            role: 'admin', 
            fcmToken: { $exists: true } 
        }, 'username fcmToken email');  

        console.log('🔔 [DEBUG] Admins found:', admins.length);
        console.log('🔔 [DEBUG] Admin details:', admins);

        for (const admin of admins) {
            console.log('🔔 [DEBUG] Sending to admin:', admin.name, admin.fcmToken ? 'HAS TOKEN' : 'NO TOKEN');
        }

        // 4. Kirim ke user
        if (user.fcmToken) {
            console.log('🔔 [DEBUG] Sending to user:', user.username);
        } else {
            console.log('❌ User has no FCM token - User:', user.username, user.email);
        }

        console.log('✅ [DEBUG] sendThresholdNotification SUCCESS');

    } catch (error) {
        console.error('❌ [DEBUG] ERROR in sendThresholdNotification:', error);
    }
}
// Helper function untuk konten notifikasi
function getNotificationContent(machine, sensorData, status, thresholds) {
    const machineName = machine.name;
    const value = sensorData.value;
    const unit = sensorData.unit;
    
    const templates = {
        'Caution': {
            title: `⚠️ Caution: ${machineName}`,
            body: `${sensorData.sensorType} ${value}${unit} - Mendekati batas aman (Batas: ${thresholds.warning}${unit})`
        },
        'Warning': {
            title: `🚨 Warning: ${machineName}`,
            body: `${sensorData.sensorType} ${value}${unit} - Melebihi batas warning! (Batas: ${thresholds.warning}${unit})`
        },
        'Critical': {
            title: `🔥 Danger: ${machineName}`,
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