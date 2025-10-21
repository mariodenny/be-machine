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
        // 1. Cari rental aktif untuk mesin ini
        const activeRental = await Rental.findOne({
            machineId: machineId,
            status: "Disetujui",
            isStarted: true
        }).populate("userId machineId");

        if (!activeRental) return;

        const user = activeRental.userId;
        const machine = activeRental.machineId;

        const admins = await User.find({ role: 'admin', fcmToken: { $exists: true } });
        
        for (const admin of admins) {
            const adminMessage = {
                notification: {
                    title: `🚨 ADMIN - ${machine.name}`,
                    body: `${sensorData.sensorType}: ${sensorData.value}${sensorData.unit}`
                },
                data: {
                    type: 'ADMIN_ALERT',
                    machineId: machineId.toString(),
                    machineName: machine.name,
                    sensorType: sensorData.sensorType,
                    value: sensorData.value.toString()
                },
                token: admin.fcmToken
            };
            
            await admin.messaging().send(adminMessage);
        }
        
        console.log(`📢 Notif terkirim ke ${admins.length} admin`);
        
        if (!user.fcmToken) return;

        const status = sensorData.value > 80 ? 'warning' : 'normal';
        if (status === 'normal') return;

        const message = {
            notification: {
                title: `⚠️ ${machine.name}`,
                body: `${sensorData.sensorType} tinggi: ${sensorData.value}${sensorData.unit}`
            },
            data: {
                type: 'MACHINE_ALERT',
                machineId: machineId.toString(),
                machineName: machine.name
            },
            token: user.fcmToken
        };

        await admin.messaging().send(message);
        console.log(`📢 Notif terkirim ke user: ${user.name}`);

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