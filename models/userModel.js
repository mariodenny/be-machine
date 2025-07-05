const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ["user", "admin", "superadmin"],
    default: "user",
    required: true,
  },
  refresh_token: {
    type: String,
    default: null,
  },
  fcmToken: {
    // Tambahkan field untuk FCM token
    type: String,
    default: null,
  },
  isVerified: { 
    type: Boolean, 
    default: false 
  },
  verificationToken: {
    type: String
  },
  verificationCode: {
    type: String
  },
  verificationCodeExpires: {
    type: Date
  },
  verifiedAt: {
    type: Date
  },
  lastLogin: {
    type: Date
  },
  peminjamanCnc: [{ type: Schema.Types.ObjectId, ref: "Cnc" }],
});

// Tambahkan method untuk update FCM token
userSchema.methods.updateFcmToken = async function (token) {
  this.fcmToken = token;
  return this.save();
};

const User = mongoose.model("User", userSchema);

module.exports = User;
