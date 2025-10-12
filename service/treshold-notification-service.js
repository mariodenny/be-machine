// services/threshold-notification-service.js - BUAT FILE BARU
const admin = require("firebase-admin");
const Rental = require("../models/rentalModel");
const Machine = require("../models/machineModel");
const Notification = require("../models/notificationModel");

const notificationCache = new Map();

exports.sendThresholdNotification = async (machineId, sensorData) => {
    try {
        console.log('🔔 Checking threshold notification for:', machineId, sensorData);
        
        // 1. Cari rental aktif untuk mesin ini
        const activeRental = await Rental.findOne({
            machineId: machineId,
            status: "Disetujui",
            startTime: { $lte: new Date() },
            endTime: { $gte: new Date() }
        }).populate("userId machineId");

        if (!activeRental) {
            console.log('No active rental for machine:', machineId);
            return;
        }

        const user = activeRental.userId;
        const machine = activeRental.machineId;
        
        if (!user.fcmToken) {
            console.log('No FCM token for user:', user._id);
            return;
        }

        // 2. Hitung status berdasarkan thresholds
        const status = calculateSensorStatus(sensorData.value, machine.sensorThresholds, sensorData.sensorType);
        
        // 3. Hanya kirim notifikasi untuk status Caution, Warning
        if (status === 'normal') return;

        // 4. Cek cache untuk prevent spam
        const cacheKey = `${machineId}-${sensorData.sensorType}-${status}`;
        const lastNotification = notificationCache.get(cacheKey);
        if (lastNotification && (Date.now() - lastNotification < 5 * 60 * 1000)) {
            return;
        }

        // 5. Buat konten notifikasi
        const { title, body } = getNotificationContent(machine, sensorData, status);

        // 6. Kirim FCM
        const message = {
            notification: { title, body },
            data: {
                type: 'THRESHOLD_ALERT',
                machineId: machineId.toString(),
                machineName: machine.name,
                sensorType: sensorData.sensorType,
                value: sensorData.value.toString(),
                unit: sensorData.unit || '',
                status: status,
                timestamp: new Date().toISOString()
            },
            token: user.fcmToken
        };

        await admin.messaging().send(message);
        
        // 7. Simpan ke database
        await Notification.create({
            userId: user._id,
            title,
            body,
            data: message.data,
            type: "sensor_threshold",
            priority: getPriorityLevel(status),
            read: false,
        });

        notificationCache.set(cacheKey, Date.now());
        console.log(`📢 Threshold notification sent: ${title}`);

    } catch (error) {
        console.error('Error sending threshold notification:', error);
    }
};

// Helper functions
const calculateSensorStatus = (value, thresholds, sensorType) => {
    if (!thresholds) return 'normal';
    if (value >= thresholds.warning) return 'warning';
    if (value >= thresholds.caution) return 'caution';
    return 'normal';
};

const getNotificationContent = (machine, sensorData, status) => {
    const templates = {
        'caution': {
            title: `⚠️ Perhatian: ${machine.name}`,
            body: `${sensorData.sensorType} ${sensorData.value}${sensorData.unit} - Mendekati batas aman`
        },
        'warning': {
            title: `🚨 Peringatan: ${machine.name}`,
            body: `${sensorData.sensorType} ${sensorData.value}${sensorData.unit} - Melebihi batas warning!`
        }
    };
    return templates[status] || { title: 'Info', body: 'Status updated' };
};

const getPriorityLevel = (status) => {
    return status === 'warning' ? 'high' : 'medium';
};