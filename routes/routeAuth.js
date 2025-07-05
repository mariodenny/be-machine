const express = require('express');
const userController = require('../controllers/authController');
const verifyToken = require('../middleware/verifyToken');

const router = express.Router();

router.post('/register', userController.register);
router.post('/login', userController.login);
router.post('/logout', verifyToken, userController.logout);
router.post('/update-fcm-token', verifyToken, userController.updateFcmToken);
router.post('/verify-email', userController.verifyCode);
router.post('/resend-code', userController.resendVerificationCode);

module.exports = router;