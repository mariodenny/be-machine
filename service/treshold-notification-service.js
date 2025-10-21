// services/threshold-notification-service.js - BUAT FILE BARU
const admin = require("firebase-admin");
const Rental = require("../models/rentalModel");
const Machine = require("../models/machineModel");
const Notification = require("../models/V2/notificationModel");
const User = require("../models/userModel")

const notificationCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 menit

setInterval(() => {
    const now = Date.now();
    for (const [key, value] of notificationCache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
            notificationCache.delete(key);
        }
    }
}, 60 * 1000); // Cleanup setiap 1 menit

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

        // KIRIM KE 2 TOPIC
        await admin.messaging().sendAll([
            {
                notification: {
                    title: `🚨 ADMIN - ${machine.name}`,
                    body: `${sensorData.sensorType}: ${sensorData.value}${sensorData.unit}`
                },
                data: {
                    type: 'ADMIN_ALERT',
                    machineId: machineId.toString(),
                    machineName: machine.name
                },
                topic: 'admin_alerts'
            },
            {
                notification: {
                    title: `⚠️ ${machine.name}`,
                    body: `${sensorData.sensorType} tinggi: ${sensorData.value}${sensorData.unit}`
                },
                data: {
                    type: 'MACHINE_ALERT',
                    machineId: machineId.toString(), 
                    machineName: machine.name
                },
                topic: `user_${user._id}`
            }
        ]);
        
        console.log(`📢 Threshold notif sent for: ${machine.name}`);

    } catch (error) {
        console.error('Error:', error);
    }
};

const calculateSensorStatus = (value, thresholds, sensorType) => {
    if (!thresholds || !thresholds[sensorType]) return 'normal';
    
    const sensorThresholds = thresholds[sensorType];
    
    if (!sensorThresholds || 
        typeof sensorThresholds.critical !== 'number' ||
        typeof sensorThresholds.warning !== 'number' ||
        typeof sensorThresholds.caution !== 'number') {
        return 'normal';
    }
    
    if (value >= sensorThresholds.critical) return 'critical';
    if (value >= sensorThresholds.warning) return 'warning';
    if (value >= sensorThresholds.caution) return 'caution';
    
    return 'normal';
};

const getNotificationContent = (machine, sensorData, status) => {
    const statusText = {
        'caution': 'Perhatian',
        'warning': 'Peringatan', 
        'critical': 'Bahaya'
    };

    const templates = {
        'caution': {
            title: `⚠️ ${statusText[status]}: ${machine.name}`,
            body: `${sensorData.sensorType} ${sensorData.value}${sensorData.unit} - Mendekati batas aman`
        },
        'warning': {
            title: `🚨 ${statusText[status]}: ${machine.name}`,
            body: `${sensorData.sensorType} ${sensorData.value}${sensorData.unit} - Melebihi batas peringatan!`
        },
        'critical': {
            title: `🔴 ${statusText[status]}: ${machine.name}`,
            body: `${sensorData.sensorType} ${sensorData.value}${sensorData.unit} - Kondisi kritis! Segera hentikan mesin!`
        }
    };
    
    return templates[status] || { 
        title: 'Info Mesin', 
        body: `${machine.name} beroperasi normal` 
    };
};

const getPriorityLevel = (status) => {
    const priorities = {
        'critical': 'urgent',
        'warning': 'high', 
        'caution': 'medium',
        'normal': 'low'
    };
    return priorities[status] || 'medium';
};