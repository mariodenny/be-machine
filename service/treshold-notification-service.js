// services/threshold-notification-service.js - BUAT FILE BARU
const admin = require("firebase-admin");
const Rental = require("../models/rentalModel");
const Machine = require("../models/machineModel");
const Notification = require("../models/notificationModel");

const notificationCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 menit

// Fungsi cleanup cache expired
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
        console.log('🔔 Checking threshold notification for:', machineId, sensorData);
        
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

        const status = calculateSensorStatus(sensorData.value, machine.sensorThresholds, sensorData.sensorType);
        
        // 3. Hanya kirim notifikasi untuk status Caution, Warning
        if (status === 'normal') {
            // Clear cache jika status kembali normal
            const cacheKey = `${machineId}-${sensorData.sensorType}`;
            notificationCache.delete(cacheKey);
            return;
        }

        // 4. Cek cache untuk prevent spam dengan TTL
        const cacheKey = `${machineId}-${sensorData.sensorType}-${status}`;
        const cachedNotification = notificationCache.get(cacheKey);
        
        if (cachedNotification && (Date.now() - cachedNotification.timestamp < CACHE_TTL)) {
            console.log('⏳ Notification skipped (anti-spam):', cacheKey);
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
            token: user.fcmToken,
            android: {
                priority: status === 'warning' ? 'high' : 'normal'
            },
            apns: {
                headers: {
                    'apns-priority': status === 'warning' ? '10' : '5'
                }
            }
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

        // 8. Update cache dengan timestamp
        notificationCache.set(cacheKey, {
            timestamp: Date.now(),
            status: status,
            value: sensorData.value
        });
        
        console.log(`📢 Threshold notification sent: ${title}`);

    } catch (error) {
        console.error('Error sending threshold notification:', error);
        // Handle specific FCM errors
        if (error.code === 'messaging/registration-token-not-registered') {
            // Update user FCM token to null
            await User.findByIdAndUpdate(user._id, { fcmToken: null });
        }
    }
};

const calculateSensorStatus = (value, thresholds, sensorType) => {
    if (!thresholds || !thresholds[sensorType]) return 'normal';
    
    const sensorThresholds = thresholds[sensorType];
    
    // Untuk nilai yang semakin besar = semakin buruk (temperature, pressure, dll)
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