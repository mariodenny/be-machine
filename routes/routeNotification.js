const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
// const { sendNotification, checkAndSendPeminjamanNotification, sendAdminNotification } = require("../controllers/notificationController");
const authenticate = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");

// Basic notification routes
router.get(
  "/status",
  authenticate,
  notificationController.NotificationController.getNotificationStatus
);

router.patch(
  "/status/:notificationId",
  authenticate,
  notificationController.NotificationController.updateNotificationStatus
);

// User notification routes
router.get(
  "/user/notifications",
  authenticate,
  notificationController.NotificationController.getUserNotifications
);

// Tambahkan route baru untuk notifikasi status peminjaman
router.get(
  "/peminjaman-status/:peminjamanId",
  authenticate,
  async (req, res) => {
    try {
      const notifications = await Notification.find({
        userId: req.user.userId,
        "data.peminjamanId": req.params.peminjamanId,
        type: "peminjaman_status",
      }).sort({ createdAt: -1 });

      res.status(200).json({
        success: true,
        data: notifications,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch peminjaman status notifications",
        error: error.message,
      });
    }
  }
);

router.post(
  "/check-peminjaman/:peminjamanId",
  authenticate,
  notificationController.checkAndSendPeminjamanNotification
);
// Admin notification routes (dengan middleware checkRole)
router.post(
  "/admin/send-notification/:type",
  authenticate,
  checkRole(["admin"]),
  async (req, res) => {
    try {
      const { type } = req.params;
      const peminjaman = req.body;

      const result = await sendAdminNotification(peminjaman, type);

      if (result.success) {
        res.status(200).json({
          success: true,
          message: "Notification sent successfully",
          data: result,
        });
      } else {
        res.status(400).json({
          success: false,
          message: "Failed to send notification",
          error: result.message,
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  }
);

// New peminjaman notification middleware
router.post(
  "/peminjaman/new/:type",
  authenticate,
  notificationController.NotificationController.handleNewPeminjaman
);

module.exports = router;
