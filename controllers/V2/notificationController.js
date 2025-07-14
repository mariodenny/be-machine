const admin = require("firebase-admin");
const User = require("../../models/userModel");
const Rental = require("../../models/rentalModel");
const Machine = require("../../models/machineModel");
const Notification = require("../../models/V2/notificationModel");

async function sendNotification(user, title, body, data = {}) {
    if (!user.fcmToken) return { success: false, message: "No FCM token" };

    const message = {
        notification: { title, body },
        data: { ...data, timestamp: new Date().toISOString() },
        token: user.fcmToken,
    };

    await admin.messaging().send(message);
    await Notification.create({
        userId: user._id,
        title,
        body,
        data,
        type: "peminjaman_status",
        read: false,
    });

    return { success: true };
}

async function checkAndSendRentalNotification(req, res) {
    const { rentalId } = req.params;
    const userId = req.user?.userId;

    const rental = await Rental.findOne({ _id: rentalId, userId }).populate("machineId");
    if (!rental) return res.status(404).json({ success: false, message: "Rental not found" });

    if (rental.status !== "Disetujui") {
        return res.status(400).json({ success: false, message: "Rental not active" });
    }

    const now = new Date();
    const endTime = new Date(rental.endTime);
    const timeToEnd = Math.floor((endTime - now) / 60000);

    if (timeToEnd <= 5 && timeToEnd > 0) {
        const user = await User.findById(userId);
        await sendNotification(
            user,
            "Peminjaman Akan Berakhir",
            `Peminjaman ${rental.machineId.name} berakhir ${timeToEnd} menit lagi.`,
            { rentalId: rental._id.toString() }
        );
        return res.json({ success: true, timeToEnd });
    }

    return res.json({ success: true, message: "Not yet", timeToEnd });
}

async function sendRentalNotification(req, res) {
    try {
        const { rentalId } = req.params;
        const rental = await Rental.findById(rentalId).populate("machineId userId");

        if (!rental) return res.status(404).json({ success: false, message: "Rental not found" });

        const machine = rental.machineId;
        const user = rental.userId;

        const title = `Status Peminjaman ${machine.name}`;
        const body = `Status peminjaman kamu: ${rental.status}`;

        if (user.fcmToken) {
            await admin.messaging().send({
                token: user.fcmToken,
                notification: { title, body },
                data: { rentalId: rental._id.toString(), status: rental.status },
            });

            await Notification.create({
                userId: user._id,
                title,
                body,
                type: "rental_status",
                read: false,
            });
        }

        res.json({ success: true, message: "Notification sent" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}

async function getUserNotifications(req, res) {
    try {
        const notifications = await Notification.find({
            userId: req.user.userId,
        }).sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: notifications });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

async function updateNotificationStatus(req, res) {
    try {
        const notification = await Notification.findOneAndUpdate(
            {
                _id: req.params.notificationId,
                userId: req.user.userId,
            },
            { read: true },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }

        res.json({ success: true, data: notification });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

async function getRentalNotifications(req, res) {
    try {
        const notifications = await Notification.find({
            userId: req.user.userId,
            "data.rentalId": req.params.rentalId,
        }).sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: notifications });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = {
    sendNotification,
    checkAndSendRentalNotification,
    sendRentalNotification,
    getUserNotifications,
    updateNotificationStatus,
    getRentalNotifications,
};
