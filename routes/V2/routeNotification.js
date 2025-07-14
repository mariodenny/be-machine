const express = require("express");
const router = express.Router();
const notificationController = require("../../controllers/V2/notificationController");
const authenticate = require("../../middleware/verifyToken");
const checkRole = require("../../middleware/checkRole");

router.post(
    "/rentals/:rentalId/notify",
    authenticate,
    checkRole(["admin"]),
    notificationController.sendRentalNotification
);

router.get(
    "/rentals/:rentalId/check",
    authenticate,
    notificationController.checkAndSendRentalNotification
);

router.get(
    "/notifications",
    authenticate,
    notificationController.getUserNotifications
);

router.patch(
    "/notifications/:notificationId",
    authenticate,
    notificationController.updateNotificationStatus
);

router.get(
    "/rentals/:rentalId/notifications",
    authenticate,
    notificationController.getRentalNotifications
);

module.exports = router;
