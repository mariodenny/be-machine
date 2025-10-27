import admin from 'firebase-admin';
import { getMessaging } from 'firebase-admin/messaging';
const User = require("../models/userModel");
const Rental = require("../models/rentalModel");
const Machine = require("../models/machineModel");

const SensorV2 = require("../models/V2/sensorModel");
const Notification = require("../models/notificationModel");
const { calculateHybridThresholds } = require('./ml-treshold');


// Cache untuk mencegah notifikasi spam
const notificationCache = new Map();

exports.sendThresholdNotification = async (machineId, sensorData) => {
    try {
        const activeRental = await Rental.findOne({
            machineId: machineId,
            status: "Disetujui",
            isStarted: true
        }).populate("userId machineId");

        if (!activeRental) return;

        const user = activeRental.userId;
        const machine = activeRental.machineId;

        const messages = [
            {
                notification: {
                    title: `🚨 ADMIN - ${machine.name}`,
                    body: `${sensorData.sensorType}: ${sensorData.value}${sensorData.unit}`
                },
                topic: 'admin_alerts'
            },
            {
                notification: {
                    title: `⚠️ ${machine.name}`,
                    body: `${sensorData.sensorType} tinggi: ${sensorData.value}${sensorData.unit}`
                }, 
                topic: `user_${user._id}`
            }
        ];

        for (const message of messages) {
            await admin.messaging().send(message);
        }
        
        console.log(`📢 Notif terkirim ke topic admin & user_${user._id}`);

    } catch (error) {
        console.error('Error:', error);
    }
};


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
    checkMachineStatus,
    determineMachineType,
    determineHybridStatus
};